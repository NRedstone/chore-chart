"use strict";
// Server-side logic for The Chore Chart's accounts: claiming a household,
// linking devices with one-time codes, removing devices, and handing
// ownership to someone else.
//
// Everything here runs with admin powers, which is the point: the access
// records that decide who can see a household are never written by the app
// itself, only by these handlers, after checking who is asking.
//
// Dependencies are passed in (makeHandlers) so the same code runs in the real
// Cloud Function and in the tests, against a fake database.

const crypto = require("crypto");

const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L, easy to read and type
const GRACE_MS = 14 * 24 * 60 * 60 * 1000;
const LINK_CODE_TTL_MS = 10 * 60 * 1000;
const TRANSFER_TTL_MS = 15 * 60 * 1000;
const RECENT_AUTH_SECONDS = 5 * 60;
const MAX_ACTIVE_LINK_CODES = 3;
const MAX_DEVICES = 25;
const FAIL_LIMIT = 6;
const FAIL_WINDOW_MS = 15 * 60 * 1000;

// Error with a Firebase-style code ("permission-denied", "not-found", ...).
class Fail extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
class NotValid extends Error {}

function randomCode(len) {
  let out = "";
  for (let i = 0; i < len; i++) out += CODE_CHARS[crypto.randomInt(0, CODE_CHARS.length)];
  return out;
}

function normalizeCode(raw, len) {
  const c = String(raw == null ? "" : raw).toUpperCase().replace(/[\s-]/g, "");
  if (c.length !== len) return null;
  for (const ch of c) if (CODE_CHARS.indexOf(ch) === -1) return null;
  return c;
}

function cleanName(raw) {
  const n = String(raw == null ? "" : raw).replace(/\s+/g, " ").trim().slice(0, 40);
  return n || "Device";
}

function sameString(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function makeHandlers({ db, auth, FieldValue, Timestamp, now = () => Date.now() }) {
  const col = (name) => db.collection(name);
  const del = () => FieldValue.delete();

  // ---------- who is asking ----------
  function requireAuth(ctx) {
    if (!ctx || !ctx.auth || !ctx.auth.uid) throw new Fail("unauthenticated", "Please sign in first.");
    return ctx.auth;
  }
  // A person who can own a household: signed in with Google, or with an
  // email and password whose address they've confirmed. (Linked devices are
  // anonymous and never pass this.)
  const OWNER_PROVIDERS = ["google.com", "password"];
  function requireAccount(ctx) {
    const a = requireAuth(ctx);
    const t = a.token || {};
    const provider = t.firebase && t.firebase.sign_in_provider;
    if (!OWNER_PROVIDERS.includes(provider) || !t.email) {
      throw new Fail("permission-denied", "Sign in with Google or an email account first.");
    }
    if (!t.email_verified) throw new Fail("permission-denied", "Confirm your email address first (tap the link we emailed you).");
    return a;
  }
  function requireRecent(a) {
    const authTime = a.token && a.token.auth_time;
    if (typeof authTime !== "number" || now() / 1000 - authTime > RECENT_AUTH_SECONDS) {
      throw new Fail("failed-precondition", "Please sign in again to confirm it's you.");
    }
  }

  // ---------- wrong-guess limiter (per person and per network address) ----------
  function limitKeys(ctx, a) {
    const keys = ["u_" + a.uid];
    if (ctx && ctx.ip) keys.push("i_" + crypto.createHash("sha256").update(String(ctx.ip)).digest("hex").slice(0, 24));
    return keys;
  }
  async function assertNotBlocked(keys) {
    for (const k of keys) {
      const s = await col("attempts").doc(k).get();
      if (s.exists) {
        const d = s.data();
        if (d.count >= FAIL_LIMIT && now() < d.windowStart + FAIL_WINDOW_MS) {
          throw new Fail("resource-exhausted", "Too many wrong tries. Wait a few minutes and try again.");
        }
      }
    }
  }
  async function recordFailure(keys) {
    for (const k of keys) {
      const ref = col("attempts").doc(k);
      await db.runTransaction(async (tx) => {
        const s = await tx.get(ref);
        const d = s.exists ? s.data() : null;
        if (!d || now() >= d.windowStart + FAIL_WINDOW_MS) tx.set(ref, { count: 1, windowStart: now() });
        else tx.set(ref, { count: d.count + 1, windowStart: d.windowStart });
      });
    }
  }

  // ---------- helpers ----------
  async function getMember(uid) {
    const s = await col("members").doc(uid).get();
    return s.exists ? s.data() : null;
  }
  async function ownerContext(ctx) {
    const a = requireAccount(ctx);
    const m = await getMember(a.uid);
    if (!m || m.role !== "owner") throw new Fail("permission-denied", "Only the household owner can do that.");
    const accRef = col("access").doc(m.hid);
    const acc = await accRef.get();
    if (!acc.exists || acc.data().ownerUid !== a.uid) throw new Fail("permission-denied", "Only the household owner can do that.");
    return { uid: a.uid, hid: m.hid, accRef, acc: acc.data(), auth: a };
  }
  function newAccess(a) {
    return {
      ownerUid: a.uid,
      ownerEmail: String(a.token.email).toLowerCase(),
      devices: {},
      linkCodes: {},
      pendingTransfer: null,
      minAuthTime: 0,
      createdAt: now(),
    };
  }
  async function dropAuthUser(uid) {
    try {
      await auth.deleteUser(uid); // a removed device's anonymous identity is deleted too
    } catch (e) {
      /* best effort: membership is what actually grants access */
    }
  }

  // ---------- handlers ----------
  return {
    // A parent with a Google account or a confirmed email starts a brand-new household.
    async createHousehold(ctx) {
      const a = requireAccount(ctx);
      return db.runTransaction(async (tx) => {
        const memRef = col("members").doc(a.uid);
        if ((await tx.get(memRef)).exists) throw new Fail("already-exists", "This account already belongs to a household.");
        const accRef = col("access").doc();
        const hid = accRef.id;
        tx.set(accRef, newAccess(a));
        tx.set(memRef, { hid, role: "owner", since: now() });
        tx.set(col("status").doc(hid), { claimed: true, graceUntil: null });
        return { hid };
      });
    },

    // A parent takes ownership of an existing household by proving they know
    // its old code. Starts the 14-day window in which unlinked devices keep
    // working the old way.
    async claimHousehold(ctx, data) {
      const a = requireAccount(ctx);
      const keys = limitKeys(ctx, a);
      await assertNotBlocked(keys);
      const code = normalizeCode(data && data.code, 6);
      if (!code) {
        await recordFailure(keys);
        throw new Fail("invalid-argument", "Enter the 6-character household code.");
      }
      const hh = await col("households").doc(code).get();
      if (!hh.exists) {
        await recordFailure(keys);
        throw new Fail("not-found", "No household has that code.");
      }
      const graceUntil = now() + GRACE_MS;
      await db.runTransaction(async (tx) => {
        const memRef = col("members").doc(a.uid);
        const accRef = col("access").doc(code);
        const [mem, acc] = [await tx.get(memRef), await tx.get(accRef)];
        if (mem.exists) throw new Fail("already-exists", "This account already belongs to a household.");
        if (acc.exists) throw new Fail("already-exists", "That household already has an owner. Ask them for a link code.");
        tx.set(accRef, newAccess(a));
        tx.set(memRef, { hid: code, role: "owner", since: now() });
        tx.set(col("status").doc(code), { claimed: true, graceUntil: Timestamp.fromMillis(graceUntil) });
      });
      return { hid: code, graceUntil };
    },

    // Owner: make a one-time code for linking another device.
    async createLinkCode(ctx) {
      const oc = await ownerContext(ctx);
      return db.runTransaction(async (tx) => {
        const acc = (await tx.get(oc.accRef)).data();
        const t = now();
        const live = [];
        const expired = [];
        for (const [c, exp] of Object.entries(acc.linkCodes || {})) (exp > t ? live : expired).push(c);
        if (live.length >= MAX_ACTIVE_LINK_CODES) {
          throw new Fail("resource-exhausted", "There are already several unused codes. Wait for one to expire.");
        }
        let code = null;
        for (let i = 0; i < 5 && !code; i++) {
          const candidate = randomCode(8);
          if (!(await tx.get(col("linkCodes").doc(candidate))).exists) code = candidate;
        }
        if (!code) throw new Fail("internal", "Couldn't make a code. Try again.");
        const expiresAt = t + LINK_CODE_TTL_MS;
        const updates = { ["linkCodes." + code]: expiresAt };
        for (const c of expired) {
          updates["linkCodes." + c] = del();
          tx.delete(col("linkCodes").doc(c));
        }
        tx.set(col("linkCodes").doc(code), { hid: oc.hid, expiresAt, createdBy: oc.uid });
        tx.update(oc.accRef, updates);
        return { code, expiresAt };
      });
    },

    // Any device (signed in anonymously, with no email) turns a code into access.
    async redeemLinkCode(ctx, data) {
      const a = requireAuth(ctx);
      const keys = limitKeys(ctx, a);
      await assertNotBlocked(keys);
      const code = normalizeCode(data && data.code, 8);
      const name = cleanName(data && data.deviceName);
      const reject = async () => {
        await recordFailure(keys);
        throw new Fail("not-found", "That code isn't valid or has expired.");
      };
      if (!code) return reject();
      try {
        return await db.runTransaction(async (tx) => {
          const memRef = col("members").doc(a.uid);
          const codeRef = col("linkCodes").doc(code);
          const mem = await tx.get(memRef);
          const cs = await tx.get(codeRef);
          if (mem.exists) throw new Fail("already-exists", "This device is already linked to a household.");
          if (!cs.exists || cs.data().expiresAt <= now()) throw new NotValid();
          const accRef = col("access").doc(cs.data().hid);
          const acc = await tx.get(accRef);
          if (!acc.exists) throw new NotValid();
          if (Object.keys(acc.data().devices || {}).length >= MAX_DEVICES) {
            throw new Fail("resource-exhausted", "This household has reached its device limit.");
          }
          const hid = cs.data().hid;
          tx.delete(codeRef);
          tx.update(accRef, { ["devices." + a.uid]: { name, linkedAt: now() }, ["linkCodes." + code]: del() });
          tx.set(memRef, { hid, role: "device", name, since: now() });
          return { hid };
        });
      } catch (e) {
        if (e instanceof NotValid) return reject();
        throw e;
      }
    },

    // Owner: take a device off the household.
    async removeDevice(ctx, data) {
      const oc = await ownerContext(ctx);
      const uid = String((data && data.uid) || "");
      await db.runTransaction(async (tx) => {
        const acc = (await tx.get(oc.accRef)).data();
        if (!uid || !(acc.devices || {})[uid]) throw new Fail("not-found", "That device isn't linked.");
        tx.update(oc.accRef, { ["devices." + uid]: del() });
        tx.delete(col("members").doc(uid));
      });
      await dropAuthUser(uid);
      return { ok: true };
    },

    async renameDevice(ctx, data) {
      const oc = await ownerContext(ctx);
      const uid = String((data && data.uid) || "");
      const name = cleanName(data && data.name);
      await db.runTransaction(async (tx) => {
        const acc = (await tx.get(oc.accRef)).data();
        if (!uid || !(acc.devices || {})[uid]) throw new Fail("not-found", "That device isn't linked.");
        tx.update(oc.accRef, { ["devices." + uid + ".name"]: name });
        tx.update(col("members").doc(uid), { name });
      });
      return { ok: true };
    },

    // A linked device unlinks itself (owners transfer ownership or sign out instead).
    async unlinkSelf(ctx) {
      const a = requireAuth(ctx);
      const m = await getMember(a.uid);
      if (!m) throw new Fail("not-found", "This device isn't linked.");
      if (m.role !== "device") throw new Fail("failed-precondition", "The owner can't unlink. Transfer ownership or sign out instead.");
      await db.runTransaction(async (tx) => {
        tx.update(col("access").doc(m.hid), { ["devices." + a.uid]: del() });
        tx.delete(col("members").doc(a.uid));
      });
      await dropAuthUser(a.uid);
      return { ok: true };
    },

    // Owner: cut off every other session of this account. The caller
    // must have signed in just now; any session that signed in earlier than
    // that is refused by the security rules from this moment on.
    async signOutOthers(ctx) {
      const oc = await ownerContext(ctx);
      requireRecent(oc.auth);
      const t = oc.auth.token.auth_time;
      await db.runTransaction(async (tx) => {
        const acc = (await tx.get(oc.accRef)).data();
        tx.update(oc.accRef, { minAuthTime: Math.max(acc.minAuthTime || 0, t) });
      });
      return { minAuthTime: t };
    },

    // Owner: end the 14-day window early, once every device is linked.
    async endGrace(ctx) {
      const oc = await ownerContext(ctx);
      await col("status").doc(oc.hid).update({ graceUntil: null });
      return { ok: true };
    },

    // Owner: offer the household to another account (Google or email).
    async startTransfer(ctx, data) {
      const oc = await ownerContext(ctx);
      requireRecent(oc.auth);
      const toEmail = String((data && data.toEmail) || "").trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(toEmail)) throw new Fail("invalid-argument", "Enter the other person's email address.");
      if (toEmail === String(oc.acc.ownerEmail).toLowerCase()) throw new Fail("invalid-argument", "That's your own email address.");
      return db.runTransaction(async (tx) => {
        const acc = (await tx.get(oc.accRef)).data();
        const old = acc.pendingTransfer;
        let code = null;
        for (let i = 0; i < 5 && !code; i++) {
          const candidate = randomCode(8);
          if (!(await tx.get(col("transferCodes").doc(candidate))).exists) code = candidate;
        }
        if (!code) throw new Fail("internal", "Couldn't make a code. Try again.");
        const expiresAt = now() + TRANSFER_TTL_MS;
        if (old && old.code) tx.delete(col("transferCodes").doc(old.code));
        tx.set(col("transferCodes").doc(code), { hid: oc.hid, toEmail, expiresAt });
        tx.update(oc.accRef, { pendingTransfer: { toEmail, code, expiresAt } });
        return { code, expiresAt, toEmail };
      });
    },

    async cancelTransfer(ctx) {
      const oc = await ownerContext(ctx);
      await db.runTransaction(async (tx) => {
        const acc = (await tx.get(oc.accRef)).data();
        if (acc.pendingTransfer && acc.pendingTransfer.code) tx.delete(col("transferCodes").doc(acc.pendingTransfer.code));
        tx.update(oc.accRef, { pendingTransfer: null });
      });
      return { ok: true };
    },

    // The new owner (signed in with the email the offer was made to)
    // enters the code. Ownership moves in one step.
    async acceptTransfer(ctx, data) {
      const a = requireAccount(ctx);
      const keys = limitKeys(ctx, a);
      await assertNotBlocked(keys);
      const code = normalizeCode(data && data.code, 8);
      const reject = async () => {
        await recordFailure(keys);
        throw new Fail("not-found", "That code isn't valid for this account, or it has expired.");
      };
      if (!code) return reject();
      try {
        return await db.runTransaction(async (tx) => {
          const memRef = col("members").doc(a.uid);
          const tcRef = col("transferCodes").doc(code);
          const mem = await tx.get(memRef);
          const tc = await tx.get(tcRef);
          if (mem.exists) throw new Fail("already-exists", "This account already belongs to a household. Use an account that doesn't.");
          if (!tc.exists || tc.data().expiresAt <= now()) throw new NotValid();
          if (!sameString(String(a.token.email).toLowerCase(), tc.data().toEmail)) throw new NotValid();
          const hid = tc.data().hid;
          const accRef = col("access").doc(hid);
          const acc = await tx.get(accRef);
          if (!acc.exists || !acc.data().pendingTransfer || !sameString(acc.data().pendingTransfer.code, code)) throw new NotValid();
          const oldOwner = acc.data().ownerUid;
          tx.update(accRef, { ownerUid: a.uid, ownerEmail: String(a.token.email).toLowerCase(), pendingTransfer: null });
          tx.set(memRef, { hid, role: "owner", since: now() });
          tx.delete(col("members").doc(oldOwner));
          tx.delete(tcRef);
          return { hid };
        });
      } catch (e) {
        if (e instanceof NotValid) return reject();
        throw e;
      }
    },
  };
}

module.exports = { makeHandlers, Fail, CODE_CHARS, GRACE_MS, LINK_CODE_TTL_MS, TRANSFER_TTL_MS, MAX_ACTIVE_LINK_CODES, FAIL_LIMIT, normalizeCode };
