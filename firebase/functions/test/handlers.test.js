"use strict";
// Run with:  node test/handlers.test.js   (from the functions folder)
// Tests the account logic against a fake database that behaves like Firestore,
// including its rule that a transaction must do all its reads before any write.
const { makeHandlers, GRACE_MS, LINK_CODE_TTL_MS, TRANSFER_TTL_MS, MAX_ACTIVE_LINK_CODES, FAIL_LIMIT } = require("../handlers");

// ---------- fake Firestore ----------
const DELETE = { __delete: true };
const FieldValue = { delete: () => DELETE };
const Timestamp = { fromMillis: (ms) => ({ __ts: ms }) };
const clone = (o) => JSON.parse(JSON.stringify(o));

function applyUpdate(db, path, patch) {
  const cur = db.docs.get(path);
  if (!cur) throw new Error("NOT_FOUND: " + path);
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
  db.docs.set(path, next);
}

class Ref {
  constructor(db, col, id) { this.db = db; this.col = col; this.id = id; this.path = col + "/" + id; }
  async get() { return snap(this.db, this.path, this.id); }
  async set(d) { this.db.docs.set(this.path, clone(d)); }
  async update(p) { applyUpdate(this.db, this.path, p); }
  async delete() { this.db.docs.delete(this.path); }
}
const snap = (db, path, id) => ({ exists: db.docs.has(path), id, data: () => clone(db.docs.get(path)) });

class Tx {
  constructor(db) { this.db = db; this.ops = []; this.wrote = false; }
  async get(ref) {
    if (this.wrote) throw new Error("Firestore transactions require all reads to be executed before all writes.");
    return snap(this.db, ref.path, ref.id);
  }
  set(ref, d) { this.wrote = true; this.ops.push(() => this.db.docs.set(ref.path, clone(d))); }
  update(ref, p) { this.wrote = true; this.ops.push(() => applyUpdate(this.db, ref.path, p)); }
  delete(ref) { this.wrote = true; this.ops.push(() => this.db.docs.delete(ref.path)); }
}

function freshWorld() {
  const db = {
    docs: new Map(),
    n: 0,
    collection(name) { return { doc: (id) => new Ref(db, name, id === undefined ? "auto" + ++db.n : id) }; },
    async runTransaction(fn) {
      const tx = new Tx(db);
      const result = await fn(tx);
      tx.ops.forEach((op) => op());
      return result;
    },
  };
  const deleted = [];
  const auth = { deleteUser: async (uid) => { deleted.push(uid); } };
  const clock = { t: 1_700_000_000_000 };
  const h = makeHandlers({ db, auth, FieldValue, Timestamp, now: () => clock.t });
  db.docs.set("households/ABC234", { kids: [{ id: "k1", name: "Jack" }], chores: [] });
  return { db, h, clock, deleted };
}

// ---------- caller identities ----------
const google = (w, uid, email, ip = "1.1.1.1") => ({
  auth: { uid, token: { email, email_verified: true, firebase: { sign_in_provider: "google.com" }, auth_time: w.clock.t / 1000 } },
  ip,
});
const emailUser = (w, uid, email, verified = true, ip = "1.1.1.1") => ({
  auth: { uid, token: { email, email_verified: verified, firebase: { sign_in_provider: "password" }, auth_time: w.clock.t / 1000 } },
  ip,
});
const anon = (uid, ip = "9.9.9.9") => ({ auth: { uid, token: { firebase: { sign_in_provider: "anonymous" } } }, ip });

// ---------- tiny test runner ----------
const results = [];
async function test(name, fn) {
  try { await fn(); results.push(["PASS", name]); }
  catch (e) { results.push(["FAIL", name + "  ->  " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e)]); }
}
const eq = (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg || "not equal") + ": got " + JSON.stringify(a) + " want " + JSON.stringify(b)); };
const ok = (c, msg) => { if (!c) throw new Error(msg || "expected true"); };
async function fails(promise, code) {
  try { await promise; } catch (e) { if (e.code !== code) throw new Error("wanted " + code + " got " + (e.code || e.message)); return; }
  throw new Error("expected failure " + code + " but it succeeded");
}
async function ownerWorld() { // a claimed household with owner "own" and a helper to link devices
  const w = freshWorld();
  await w.h.claimHousehold(google(w, "own", "own@gmail.com"), { code: "ABC234" });
  w.link = async (uid, name) => {
    const { code } = await w.h.createLinkCode(google(w, "own", "own@gmail.com"));
    return w.h.redeemLinkCode(anon(uid), { code, deviceName: name });
  };
  return w;
}

(async () => {
  // ===== createHousehold =====
  await test("createHousehold: makes access, member and status records", async () => {
    const w = freshWorld();
    const r = await w.h.createHousehold(google(w, "u1", "a@gmail.com"));
    const acc = w.db.docs.get("access/" + r.hid);
    eq(acc.ownerUid, "u1"); eq(acc.minAuthTime, 0); eq(acc.devices, {});
    eq(w.db.docs.get("members/u1"), { hid: r.hid, role: "owner", since: w.clock.t });
    eq(w.db.docs.get("status/" + r.hid), { claimed: true, graceUntil: null });
  });
  await test("createHousehold: a second one for the same account is refused", async () => {
    const w = freshWorld(); const c = google(w, "u1", "a@gmail.com");
    await w.h.createHousehold(c); await fails(w.h.createHousehold(c), "already-exists");
  });
  await test("createHousehold: anonymous, unverified and signed-out callers are refused", async () => {
    const w = freshWorld();
    await fails(w.h.createHousehold(anon("d1")), "permission-denied");
    const unverified = google(w, "u2", "b@gmail.com"); unverified.auth.token.email_verified = false;
    await fails(w.h.createHousehold(unverified), "permission-denied");
    await fails(w.h.createHousehold({}), "unauthenticated");
  });

  // ===== claimHousehold =====
  await test("claim: owner gets access/member/status, 14-day window, data untouched", async () => {
    const w = freshWorld(); const before = JSON.stringify(w.db.docs.get("households/ABC234"));
    const r = await w.h.claimHousehold(google(w, "own", "Own@Gmail.com"), { code: "ABC234" });
    eq(r.hid, "ABC234"); eq(r.graceUntil, w.clock.t + GRACE_MS);
    eq(w.db.docs.get("access/ABC234").ownerEmail, "own@gmail.com", "email stored lowercase");
    eq(w.db.docs.get("status/ABC234"), { claimed: true, graceUntil: { __ts: w.clock.t + GRACE_MS } });
    eq(JSON.stringify(w.db.docs.get("households/ABC234")), before, "household data must not change");
    eq(w.db.docs.get("members/own").role, "owner");
  });
  await test("claim: tolerates lowercase and spaces in the code", async () => {
    const w = freshWorld(); eq((await w.h.claimHousehold(google(w, "o", "o@gmail.com"), { code: " abc 234 " })).hid, "ABC234");
  });
  await test("claim: a household can only be claimed once", async () => {
    const w = await ownerWorld();
    await fails(w.h.claimHousehold(google(w, "thief", "t@gmail.com"), { code: "ABC234" }), "already-exists");
  });
  await test("claim: an account already in a household can't claim another", async () => {
    const w = await ownerWorld(); w.db.docs.set("households/XYZ789", {});
    await fails(w.h.claimHousehold(google(w, "own", "own@gmail.com"), { code: "XYZ789" }), "already-exists");
  });
  await test("claim: bad format, unknown code and non-Google callers", async () => {
    const w = freshWorld(); const c = google(w, "u", "u@gmail.com");
    await fails(w.h.claimHousehold(c, { code: "12" }), "invalid-argument");
    await fails(w.h.claimHousehold(c, { code: "QQQQQQ" }), "not-found");
    await fails(w.h.claimHousehold(anon("d"), { code: "ABC234" }), "permission-denied");
  });
  await test("claim: wrong guesses lock the account out after the limit", async () => {
    const w = freshWorld(); const c = google(w, "guesser", "g@gmail.com");
    for (let i = 0; i < FAIL_LIMIT; i++) await fails(w.h.claimHousehold(c, { code: "QQQQQ0" }), "invalid-argument"); // '0' is never a valid character
    await fails(w.h.claimHousehold(c, { code: "ABC234" }), "resource-exhausted");
  });
  await test("claim: the lockout also follows the network address, not just the account", async () => {
    const w = freshWorld();
    for (let i = 0; i < FAIL_LIMIT; i++) await w.h.claimHousehold(google(w, "g" + i, "g" + i + "@gmail.com", "6.6.6.6"), { code: "QQQQQQ" }).catch(() => {});
    await fails(w.h.claimHousehold(google(w, "fresh", "f@gmail.com", "6.6.6.6"), { code: "ABC234" }), "resource-exhausted");
  });
  await test("claim: the lockout expires", async () => {
    const w = freshWorld(); const c = google(w, "g", "g@gmail.com");
    for (let i = 0; i < FAIL_LIMIT; i++) await w.h.claimHousehold(c, { code: "QQQQQQ" }).catch(() => {});
    await fails(w.h.claimHousehold(c, { code: "ABC234" }), "resource-exhausted");
    w.clock.t += 16 * 60 * 1000;
    eq((await w.h.claimHousehold(google(w, "g", "g@gmail.com"), { code: "ABC234" })).hid, "ABC234");
  });

  // ===== link codes =====
  await test("createLinkCode: owner gets an 8-character code that expires in 10 minutes", async () => {
    const w = await ownerWorld();
    const r = await w.h.createLinkCode(google(w, "own", "own@gmail.com"));
    ok(/^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{8}$/.test(r.code), "format " + r.code); eq(r.expiresAt, w.clock.t + LINK_CODE_TTL_MS);
    eq(w.db.docs.get("linkCodes/" + r.code).hid, "ABC234");
  });
  await test("createLinkCode: only the owner, only on Google", async () => {
    const w = await ownerWorld(); await w.link("dev1", "iPad");
    await fails(w.h.createLinkCode(anon("dev1")), "permission-denied");
    await fails(w.h.createLinkCode(google(w, "stranger", "s@gmail.com")), "permission-denied");
    await fails(w.h.createLinkCode({}), "unauthenticated");
  });
  await test("createLinkCode: at most three unused codes; expired ones are cleaned up", async () => {
    const w = await ownerWorld(); const o = google(w, "own", "own@gmail.com"); const made = [];
    for (let i = 0; i < MAX_ACTIVE_LINK_CODES; i++) made.push((await w.h.createLinkCode(o)).code);
    await fails(w.h.createLinkCode(o), "resource-exhausted");
    w.clock.t += LINK_CODE_TTL_MS + 1000;
    const fresh = await w.h.createLinkCode(google(w, "own", "own@gmail.com"));
    made.forEach((c) => ok(!w.db.docs.has("linkCodes/" + c), "expired code doc should be gone"));
    eq(Object.keys(w.db.docs.get("access/ABC234").linkCodes), [fresh.code]);
  });

  await test("redeem: links the device, records its name, burns the code", async () => {
    const w = await ownerWorld(); const { code } = await w.h.createLinkCode(google(w, "own", "own@gmail.com"));
    const r = await w.h.redeemLinkCode(anon("kidtab"), { code, deviceName: "  Kitchen   iPad " });
    eq(r.hid, "ABC234");
    eq(w.db.docs.get("access/ABC234").devices.kidtab, { name: "Kitchen iPad", linkedAt: w.clock.t });
    eq(w.db.docs.get("members/kidtab").role, "device");
    ok(!w.db.docs.has("linkCodes/" + code), "code doc deleted"); eq(w.db.docs.get("access/ABC234").linkCodes, {});
    await fails(w.h.redeemLinkCode(anon("other"), { code }), "not-found"); // one-time
  });
  await test("redeem: accepts lowercase and a hyphen; blank name becomes 'Device'", async () => {
    const w = await ownerWorld(); const { code } = await w.h.createLinkCode(google(w, "own", "own@gmail.com"));
    const typed = (code.slice(0, 4) + "-" + code.slice(4)).toLowerCase();
    await w.h.redeemLinkCode(anon("d1"), { code: typed, deviceName: "   " });
    eq(w.db.docs.get("access/ABC234").devices.d1.name, "Device");
  });
  await test("redeem: names are capped at 40 characters", async () => {
    const w = await ownerWorld(); await w.link("d1", "x".repeat(100));
    eq(w.db.docs.get("access/ABC234").devices.d1.name.length, 40);
  });
  await test("redeem: expired code, wrong code and signed-out caller", async () => {
    const w = await ownerWorld(); const { code } = await w.h.createLinkCode(google(w, "own", "own@gmail.com"));
    await fails(w.h.redeemLinkCode(anon("d1"), { code: "QQQQQQQQ" }), "not-found");
    await fails(w.h.redeemLinkCode({}, { code }), "unauthenticated");
    w.clock.t += LINK_CODE_TTL_MS + 1;
    await fails(w.h.redeemLinkCode(anon("d2"), { code }), "not-found");
  });
  await test("redeem: a device that's already linked can't link again", async () => {
    const w = await ownerWorld(); await w.link("d1", "A"); const { code } = await w.h.createLinkCode(google(w, "own", "own@gmail.com"));
    await fails(w.h.redeemLinkCode(anon("d1"), { code }), "already-exists");
  });
  await test("redeem: guessing codes gets locked out, even after switching to a new device identity", async () => {
    const w = await ownerWorld(); await w.h.createLinkCode(google(w, "own", "own@gmail.com"));
    for (let i = 0; i < FAIL_LIMIT; i++) await w.h.redeemLinkCode(anon("bot" + i, "5.5.5.5"), { code: "QQQQQQQQ" }).catch(() => {});
    await fails(w.h.redeemLinkCode(anon("bot-new", "5.5.5.5"), { code: "QQQQQQQQ" }), "resource-exhausted");
  });
  await test("redeem: a household has a device limit", async () => {
    const w = await ownerWorld();
    for (let i = 0; i < 25; i++) await w.link("dev" + i, "D" + i);
    const { code } = await w.h.createLinkCode(google(w, "own", "own@gmail.com"));
    await fails(w.h.redeemLinkCode(anon("one-too-many"), { code }), "resource-exhausted");
  });

  // ===== managing devices =====
  await test("removeDevice: removes access and membership, deletes the device identity", async () => {
    const w = await ownerWorld(); await w.link("d1", "iPad");
    await w.h.removeDevice(google(w, "own", "own@gmail.com"), { uid: "d1" });
    ok(!("d1" in w.db.docs.get("access/ABC234").devices)); ok(!w.db.docs.has("members/d1")); eq(w.deleted, ["d1"]);
  });
  await test("removeDevice: only the owner; unknown device is not found", async () => {
    const w = await ownerWorld(); await w.link("d1", "iPad"); await w.link("d2", "Phone");
    await fails(w.h.removeDevice(anon("d2"), { uid: "d1" }), "permission-denied");
    await fails(w.h.removeDevice(google(w, "own", "own@gmail.com"), { uid: "nobody" }), "not-found");
  });
  await test("removeDevice: a removed device can link again with a new code", async () => {
    const w = await ownerWorld(); await w.link("d1", "iPad");
    await w.h.removeDevice(google(w, "own", "own@gmail.com"), { uid: "d1" });
    eq((await w.link("d1", "iPad again")).hid, "ABC234");
  });
  await test("renameDevice: owner renames; others can't", async () => {
    const w = await ownerWorld(); await w.link("d1", "iPad");
    await w.h.renameDevice(google(w, "own", "own@gmail.com"), { uid: "d1", name: "Kitchen" });
    eq(w.db.docs.get("access/ABC234").devices.d1.name, "Kitchen"); eq(w.db.docs.get("members/d1").name, "Kitchen");
    await fails(w.h.renameDevice(anon("d1"), { uid: "d1", name: "Mine" }), "permission-denied");
  });
  await test("unlinkSelf: a device leaves; the owner can't", async () => {
    const w = await ownerWorld(); await w.link("d1", "iPad");
    await w.h.unlinkSelf(anon("d1"));
    ok(!w.db.docs.has("members/d1")); ok(!("d1" in w.db.docs.get("access/ABC234").devices)); eq(w.deleted, ["d1"]);
    await fails(w.h.unlinkSelf(anon("d1")), "not-found");
    await fails(w.h.unlinkSelf(google(w, "own", "own@gmail.com")), "failed-precondition");
  });

  // ===== sign out others / grace =====
  await test("signOutOthers: needs a fresh sign-in, then raises the cut-off to that sign-in time", async () => {
    const w = await ownerWorld(); w.clock.t += 10 * 60 * 1000; // owner's session is 10 minutes old
    const stale = google(w, "own", "own@gmail.com"); stale.auth.token.auth_time = (w.clock.t - 10 * 60 * 1000) / 1000;
    await fails(w.h.signOutOthers(stale), "failed-precondition");
    const fresh = google(w, "own", "own@gmail.com"); const r = await w.h.signOutOthers(fresh);
    eq(r.minAuthTime, w.clock.t / 1000); eq(w.db.docs.get("access/ABC234").minAuthTime, w.clock.t / 1000);
  });
  await test("signOutOthers: the cut-off only moves forward", async () => {
    const w = await ownerWorld(); await w.h.signOutOthers(google(w, "own", "own@gmail.com"));
    const t1 = w.db.docs.get("access/ABC234").minAuthTime;
    const older = google(w, "own", "own@gmail.com"); older.auth.token.auth_time = t1 - 60;
    await w.h.signOutOthers(older); eq(w.db.docs.get("access/ABC234").minAuthTime, t1);
  });
  await test("endGrace: owner ends the window; others can't", async () => {
    const w = await ownerWorld();
    await fails(w.h.endGrace(anon("x")), "permission-denied");
    await w.h.endGrace(google(w, "own", "own@gmail.com"));
    eq(w.db.docs.get("status/ABC234").graceUntil, null);
  });

  // ===== transfer ownership =====
  await test("startTransfer: needs a fresh sign-in, a sane email, and not your own", async () => {
    const w = await ownerWorld(); const o = () => google(w, "own", "own@gmail.com");
    await fails(w.h.startTransfer(o(), { toEmail: "not-an-email" }), "invalid-argument");
    await fails(w.h.startTransfer(o(), { toEmail: "OWN@gmail.com" }), "invalid-argument");
    const stale = o(); stale.auth.token.auth_time = (w.clock.t - 3600 * 1000) / 1000;
    await fails(w.h.startTransfer(stale, { toEmail: "new@gmail.com" }), "failed-precondition");
    const r = await w.h.startTransfer(o(), { toEmail: " New@Gmail.com " });
    eq(r.toEmail, "new@gmail.com"); eq(r.expiresAt, w.clock.t + TRANSFER_TTL_MS); ok(/^[A-Z2-9]{8}$/.test(r.code));
  });
  await test("acceptTransfer: ownership moves in one step; devices stay; old owner loses everything", async () => {
    const w = await ownerWorld(); await w.link("tablet", "Kitchen iPad");
    const t = await w.h.startTransfer(google(w, "own", "own@gmail.com"), { toEmail: "new@gmail.com" });
    const r = await w.h.acceptTransfer(google(w, "newbie", "New@gmail.com"), { code: t.code });
    eq(r.hid, "ABC234");
    const acc = w.db.docs.get("access/ABC234");
    eq(acc.ownerUid, "newbie"); eq(acc.ownerEmail, "new@gmail.com"); eq(acc.pendingTransfer, null);
    eq(w.db.docs.get("members/newbie").role, "owner"); ok(!w.db.docs.has("members/own"), "old owner membership removed");
    ok("tablet" in acc.devices, "linked devices keep working"); ok(!w.db.docs.has("transferCodes/" + t.code), "code burned");
    await fails(w.h.createLinkCode(google(w, "own", "own@gmail.com")), "permission-denied"); // old owner is out
    await w.h.createLinkCode(google(w, "newbie", "new@gmail.com"));                           // new owner is in
  });
  await test("acceptTransfer: the wrong Google account can't use the code (and it counts as a wrong try)", async () => {
    const w = await ownerWorld();
    const t = await w.h.startTransfer(google(w, "own", "own@gmail.com"), { toEmail: "new@gmail.com" });
    await fails(w.h.acceptTransfer(google(w, "snoop", "snoop@gmail.com"), { code: t.code }), "not-found");
    eq(w.db.docs.get("access/ABC234").ownerUid, "own"); ok(w.db.docs.has("transferCodes/" + t.code));
    eq(w.db.docs.get("attempts/u_snoop").count, 1);
  });
  await test("acceptTransfer: expired code, wrong code, and an account that already has a household", async () => {
    const w = await ownerWorld(); w.db.docs.set("households/QRS567", {});
    await w.h.claimHousehold(google(w, "busy", "busy@gmail.com"), { code: "QRS567" });
    const t = await w.h.startTransfer(google(w, "own", "own@gmail.com"), { toEmail: "busy@gmail.com" });
    await fails(w.h.acceptTransfer(google(w, "busy", "busy@gmail.com"), { code: t.code }), "already-exists");
    await fails(w.h.acceptTransfer(google(w, "newbie", "new@gmail.com"), { code: "QQQQQQQQ" }), "not-found");
    w.clock.t += TRANSFER_TTL_MS + 1;
    const late = await w.h.startTransfer(google(w, "own", "own@gmail.com"), { toEmail: "new@gmail.com" }); // fresh offer works...
    w.clock.t += TRANSFER_TTL_MS + 1;
    await fails(w.h.acceptTransfer(google(w, "newbie", "new@gmail.com"), { code: late.code }), "not-found"); // ...until it expires
  });
  await test("cancelTransfer / re-offering invalidates the old code", async () => {
    const w = await ownerWorld(); const o = () => google(w, "own", "own@gmail.com");
    const a = await w.h.startTransfer(o(), { toEmail: "new@gmail.com" });
    const b = await w.h.startTransfer(o(), { toEmail: "new@gmail.com" });
    await fails(w.h.acceptTransfer(google(w, "newbie", "new@gmail.com"), { code: a.code }), "not-found");
    await w.h.cancelTransfer(o());
    eq(w.db.docs.get("access/ABC234").pendingTransfer, null); ok(!w.db.docs.has("transferCodes/" + b.code));
    await fails(w.h.acceptTransfer(google(w, "newbie", "new@gmail.com"), { code: b.code }), "not-found");
  });

  // ===== email-and-password owners =====
  await test("email account: a confirmed one can create a household and manage devices", async () => {
    const w = freshWorld(); const me = emailUser(w, "e1", "mom@example.com");
    const r = await w.h.createHousehold(me);
    eq(w.db.docs.get("access/" + r.hid).ownerEmail, "mom@example.com");
    const { code } = await w.h.createLinkCode(me);
    await w.h.redeemLinkCode(anon("d1"), { code, deviceName: "Tablet" });
    ok("d1" in w.db.docs.get("access/" + r.hid).devices);
    await w.h.signOutOthers(me);
    ok(w.db.docs.get("access/" + r.hid).minAuthTime > 0);
  });
  await test("email account: an unconfirmed one is refused everywhere an owner is needed", async () => {
    const w = freshWorld(); const unconfirmed = emailUser(w, "e2", "dad@example.com", false);
    await fails(w.h.createHousehold(unconfirmed), "permission-denied");
    await fails(w.h.claimHousehold(unconfirmed, { code: "ABC234" }), "permission-denied");
    await fails(w.h.acceptTransfer(unconfirmed, { code: "ABCDEFGH" }), "permission-denied");
  });
  await test("email account: a confirmed one can claim, and owners can hand over to an email account", async () => {
    const w = freshWorld();
    await w.h.claimHousehold(emailUser(w, "e3", "Own@Example.com"), { code: "ABC234" });
    eq(w.db.docs.get("access/ABC234").ownerEmail, "own@example.com");
    const offer = await w.h.startTransfer(emailUser(w, "e3", "own@example.com"), { toEmail: "next@gmail.com" });
    await w.h.acceptTransfer(google(w, "g9", "next@gmail.com"), { code: offer.code });
    eq(w.db.docs.get("access/ABC234").ownerUid, "g9");
  });
  await test("email account: owner actions that need a fresh sign-in still need one", async () => {
    const w = freshWorld(); const me = emailUser(w, "e4", "a@example.com");
    await w.h.createHousehold(me);
    w.clock.t += 10 * 60 * 1000;
    await fails(w.h.signOutOthers(me), "failed-precondition");
  });
  await test("only Google and email/password sign-ins can own (not anonymous, phone, etc.)", async () => {
    const w = freshWorld(); const odd = google(w, "p1", "x@example.com"); odd.auth.token.firebase.sign_in_provider = "phone";
    await fails(w.h.createHousehold(odd), "permission-denied");
  });

  // ---------- report ----------
  results.forEach(([s, n]) => console.log(s === "PASS" ? "  ok   " : "  FAIL ", n));
  const failed = results.filter((r) => r[0] === "FAIL").length;
  console.log("\n" + results.length + " tests, " + failed + " failed");
  process.exit(failed ? 1 : 0);
})();
