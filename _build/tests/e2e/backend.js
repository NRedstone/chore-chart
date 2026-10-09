"use strict";
// Stand-in for Firebase, used by the browser tests (run.js).
//
//   * Cloud Functions: the REAL handlers from firebase/functions/handlers.js
//   * Firestore:       an in-memory fake
//   * Security rules:  a hand-written MODEL of firebase/firestore.rules
//
// The model is only as good as my reading of the rules file, and Firebase's
// rules emulator isn't available here, so the real rules still need checking
// with the Rules Playground (see firebase/DEPLOY.md). What this does prove is
// that the app's own screens and flows behave correctly given those rules.
const path = require("path");
const { makeHandlers, Fail } = require(path.resolve(__dirname, "../../../firebase/functions/handlers.js"));

const DELETE = { __delete: true };
const clone = (o) => JSON.parse(JSON.stringify(o));

function applyUpdate(db, p, patch) {
  const cur = db.docs.get(p);
  if (!cur) throw new Error("NOT_FOUND: " + p);
  const next = clone(cur);
  for (const [key, value] of Object.entries(patch)) {
    const parts = key.split(".");
    let obj = next;
    for (let i = 0; i < parts.length - 1; i++) {
      if (obj[parts[i]] === undefined || obj[parts[i]] === null) obj[parts[i]] = {};
      obj = obj[parts[i]];
    }
    const last = parts[parts.length - 1];
    if (value === DELETE) delete obj[last];
    else obj[last] = clone(value);
  }
  db.docs.set(p, next);
}

class Backend {
  constructor() {
    this.docs = new Map();
    this.n = 0;
    this.anon = 0;
    this.deleted = [];
    this.emailAccounts = new Map(); // email -> { uid, password, verified }
    this.mail = [];                 // emails "sent": { kind, to }
    this.clock = { offset: 0 };
    const self = this;
    this.db = {
      docs: this.docs,
      collection(name) {
        return {
          doc(id) {
            const id2 = id === undefined ? "auto" + ++self.n : id;
            const p = name + "/" + id2;
            return {
              id: id2, path: p,
              async get() { return { exists: self.docs.has(p), id: id2, data: () => clone(self.docs.get(p)) }; },
              async set(d) { self.docs.set(p, clone(d)); },
              async update(patch) { applyUpdate(self, p, patch); },
              async delete() { self.docs.delete(p); },
            };
          },
        };
      },
      async runTransaction(fn) {
        const ops = []; let wrote = false;
        const tx = {
          async get(ref) {
            if (wrote) throw new Error("reads after writes");
            return { exists: self.docs.has(ref.path), id: ref.id, data: () => clone(self.docs.get(ref.path)) };
          },
          set(ref, d) { wrote = true; ops.push(() => self.docs.set(ref.path, clone(d))); },
          update(ref, p) { wrote = true; ops.push(() => applyUpdate(self, ref.path, p)); },
          delete(ref) { wrote = true; ops.push(() => self.docs.delete(ref.path)); },
        };
        const r = await fn(tx);
        ops.forEach((o) => o());
        return r;
      },
    };
    this.h = makeHandlers({
      db: this.db,
      auth: { deleteUser: async (uid) => { this.deleted.push(uid); } },
      FieldValue: { delete: () => DELETE },
      Timestamp: { fromMillis: (ms) => ({ __ts: ms }) },
      now: () => this.now(),
    });
  }
  now() { return Date.now() + this.clock.offset; }
  // Makes a household reachable by a linked device (creating an owner record
  // if the household has none yet) and returns the device's id. A test page
  // becomes that device by storing { uid, isAnonymous: true } as "fake_user".
  linkDevice(hid, uid) {
    uid = uid || "dev_" + hid.toLowerCase() + "_" + ++this.n;
    const acc = this.docs.get("access/" + hid) || { ownerUid: "test_owner", ownerEmail: "owner@example.com", devices: {}, linkCodes: {}, pendingTransfer: null, minAuthTime: 0, createdAt: Date.now() };
    acc.devices[uid] = { name: "Test device", linkedAt: Date.now() };
    this.docs.set("access/" + hid, clone(acc));
    this.docs.set("members/" + uid, { hid, role: "device", since: Date.now() });
    return uid;
  }
  doc(p) { return this.docs.has(p) ? clone(this.docs.get(p)) : null; }
  put(p, d) { this.docs.set(p, clone(d)); }

  // ---------- model of firestore.rules ----------
  allowed(method, p, user) {
    const [col, id] = p.split("/");
    const access = this.docs.get("access/" + id);
    const isOwner = !!(user && access && access.ownerUid === user.uid && (user.auth_time || 0) >= access.minAuthTime);
    const isDevice = !!(user && access && access.devices && user.uid in access.devices);
    if (col === "households") return isOwner || isDevice;
    if (col === "access") return method === "get" && (isOwner || isDevice);
    if (col === "members") return method === "get" && !!user && user.uid === id;
    return false;
  }

  // ---------- what pages can call ----------
  async rpc(op, a) {
    if (op === "now") return this.now();
    if (op === "auth.newAnon") return "anon_" + ++this.anon;
    if (op === "auth.createEmail") {
      const email = String(a.email).toLowerCase();
      if (this.emailAccounts.has(email)) return { error: "auth/email-already-in-use" };
      if (String(a.password).length < 6) return { error: "auth/weak-password" };
      const uid = "pw_" + email.split("@")[0];
      this.emailAccounts.set(email, { uid, password: a.password, verified: false });
      return { uid, now: this.now() };
    }
    if (op === "auth.signInEmail") {
      const acct = this.emailAccounts.get(String(a.email).toLowerCase());
      if (!acct || acct.password !== a.password) return { error: "auth/invalid-credential" };
      return { uid: acct.uid, verified: acct.verified, now: this.now() };
    }
    if (op === "auth.info") {
      for (const acct of this.emailAccounts.values()) if (acct.uid === a.uid) return { verified: acct.verified };
      return null;
    }
    if (op === "auth.sendVerify") {
      for (const [email, acct] of this.emailAccounts) if (acct.uid === a.uid) this.mail.push({ kind: "verify", to: email });
      return null;
    }
    if (op === "auth.reset") { this.mail.push({ kind: "reset", to: String(a.email).toLowerCase() }); return null; }
    if (op === "fs") {
      const { method, path: p, data, user } = a;
      if (!this.allowed(method === "get" ? "get" : "write", p, user)) return { error: { code: "permission-denied" } };
      if (method === "get") return this.docs.has(p) ? { exists: true, data: clone(this.docs.get(p)) } : { exists: false };
      if (method === "set") { this.docs.set(p, clone(data)); return { ok: true }; }
      if (method === "delete") { this.docs.delete(p); return { ok: true }; }
    }
    if (op === "fn") {
      const { name, data, user, ip } = a;
      const ctx = {
        ip: ip || "203.0.113." + (user ? user.uid.length : 1),
        auth: user ? {
          uid: user.uid,
          token: user.isAnonymous
            ? { firebase: { sign_in_provider: "anonymous" } }
            : user.provider === "password"
              ? { email: user.email, email_verified: !!(this.emailAccounts.get(user.email) || {}).verified, firebase: { sign_in_provider: "password" }, auth_time: user.auth_time }
              : { email: user.email, email_verified: true, firebase: { sign_in_provider: "google.com" }, auth_time: user.auth_time },
        } : undefined,
      };
      try { return { result: await this.h[name](ctx, data || {}) }; }
      catch (e) { return { error: { code: e instanceof Fail ? e.code : "internal", message: e instanceof Fail ? e.message : String(e && e.message) } }; }
    }
    throw new Error("unknown op " + op);
  }
}

module.exports = { Backend };
