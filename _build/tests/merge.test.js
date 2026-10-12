"use strict";
// Run with:  node _build/tests/merge.test.js
// The three-way merge that keeps an out-of-date device from undoing other devices' changes.
const { mergeHousehold } = require("../merge.js");

const results = [];
function test(name, fn) {
  try { fn(); results.push(["PASS", name]); }
  catch (e) { results.push(["FAIL", name + "  ->  " + e.message]); }
}
const eq = (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg || "not equal") + ": got " + JSON.stringify(a) + " want " + JSON.stringify(b)); };
const clone = (o) => JSON.parse(JSON.stringify(o));
const chore = (id, extra) => Object.assign({ id, name: "Chore " + id, kidId: "k1", category: "AM", lastDone: null, streak: 0 }, extra || {});
const BASE = {
  kids: [{ id: "k1", name: "Jack" }, { id: "k2", name: "Emma" }],
  chores: [chore("a"), chore("b"), chore("c")],
  rewards: { k1: { points: 10, lastPunchDate: null, history: [], log: [] }, k2: { points: 4, lastPunchDate: null, history: [], log: [] } },
  rewardsMenu: [{ id: "r1", name: "TV", cost: 3 }],
  parentPin: "1234",
  dailyPointValue: 1,
  location: null,
};
const ch = (doc, id) => doc.chores.find((c) => c.id === id);

test("nothing changed elsewhere: this device's save goes through as-is", () => {
  const local = clone(BASE); ch(local, "a").lastDone = "Mon";
  eq(mergeHousehold(BASE, local, BASE), local);
});
test("a stale device checking a chore doesn't undo a chore checked elsewhere", () => {
  const local = clone(BASE); ch(local, "a").lastDone = "Mon";
  const remote = clone(BASE); ch(remote, "b").lastDone = "Mon";
  const m = mergeHousehold(BASE, local, remote);
  eq([ch(m, "a").lastDone, ch(m, "b").lastDone], ["Mon", "Mon"]);
});
test("the same chore edited in different ways on two devices keeps both edits", () => {
  const local = clone(BASE); ch(local, "a").lastDone = "Mon";
  const remote = clone(BASE); ch(remote, "a").name = "Brush teeth";
  const m = mergeHousehold(BASE, local, remote);
  eq([ch(m, "a").lastDone, ch(m, "a").name], ["Mon", "Brush teeth"]);
});
test("a chore added elsewhere survives a save from a stale device", () => {
  const local = clone(BASE); ch(local, "a").lastDone = "Mon";
  const remote = clone(BASE); remote.chores.push(chore("d"));
  eq(mergeHousehold(BASE, local, remote).chores.map((c) => c.id), ["a", "b", "c", "d"]);
});
test("a chore deleted elsewhere stays deleted", () => {
  const local = clone(BASE); ch(local, "a").lastDone = "Mon";
  const remote = clone(BASE); remote.chores = remote.chores.filter((c) => c.id !== "b");
  eq(mergeHousehold(BASE, local, remote).chores.map((c) => c.id), ["a", "c"]);
});
test("a chore deleted here is deleted, even if it changed elsewhere", () => {
  const local = clone(BASE); local.chores = local.chores.filter((c) => c.id !== "b");
  const remote = clone(BASE); ch(remote, "b").lastDone = "Mon";
  eq(mergeHousehold(BASE, local, remote).chores.map((c) => c.id), ["a", "c"]);
});
test("chores added on both devices are both kept", () => {
  const local = clone(BASE); local.chores.push(chore("x"));
  const remote = clone(BASE); remote.chores.push(chore("y"));
  eq(mergeHousehold(BASE, local, remote).chores.map((c) => c.id).sort(), ["a", "b", "c", "x", "y"]);
});
test("reordering here keeps this device's order", () => {
  const local = clone(BASE); local.chores = [local.chores[2], local.chores[0], local.chores[1]];
  const remote = clone(BASE); ch(remote, "a").lastDone = "Mon";
  const m = mergeHousehold(BASE, local, remote);
  eq(m.chores.map((c) => c.id), ["c", "a", "b"]);
  eq(ch(m, "a").lastDone, "Mon");
});
test("points earned here and spent elsewhere both count", () => {
  const local = clone(BASE); local.rewards.k1.points = 12; // +2 bonus chore on the tablet
  const remote = clone(BASE); remote.rewards.k1.points = 7; remote.rewards.k1.history = [{ name: "TV", cost: 3, date: "Mon", paid: false }];
  const m = mergeHousehold(BASE, local, remote);
  eq(m.rewards.k1.points, 9);
  eq(m.rewards.k1.history.length, 1);
});
test("the same daily point awarded on two devices at once isn't counted twice", () => {
  const local = clone(BASE); local.rewards.k1.points = 11; local.rewards.k1.lastPunchDate = "Mon";
  const remote = clone(local);
  eq(mergeHousehold(BASE, local, remote).rewards.k1.points, 11);
});
test("points never go below zero", () => {
  const local = clone(BASE); local.rewards.k2.points = 0;
  const remote = clone(BASE); remote.rewards.k2.points = 1; remote.rewards.k2.lastPunchDate = "Tue";
  eq(mergeHousehold(BASE, local, remote).rewards.k2.points, 0);
});
test("daily logs from both devices are kept, newest first", () => {
  const b = clone(BASE); b.rewards.k1.log = [{ date: "Mon Oct 05 2026", pointsEarned: 1, chores: [] }];
  const local = clone(b); local.rewards.k1.log = [{ date: "Tue Oct 06 2026", pointsEarned: 0, chores: [] }].concat(local.rewards.k1.log); local.rewards.k1.points = 10;
  const remote = clone(b); remote.rewards.k1.points = 11; remote.rewards.k1.log[0] = { date: "Mon Oct 05 2026", pointsEarned: 2, chores: [] };
  const m = mergeHousehold(b, local, remote);
  eq(m.rewards.k1.log.map((e) => e.date + ":" + e.pointsEarned), ["Tue Oct 06 2026:0", "Mon Oct 05 2026:2"]);
});
test("a PIN changed elsewhere isn't reverted by a stale device", () => {
  const local = clone(BASE); ch(local, "a").lastDone = "Mon";
  const remote = clone(BASE); remote.parentPin = "9999";
  eq(mergeHousehold(BASE, local, remote).parentPin, "9999");
});
test("a PIN changed here wins", () => {
  const local = clone(BASE); local.parentPin = "5555";
  eq(mergeHousehold(BASE, local, BASE).parentPin, "5555");
});
test("weather location turned off elsewhere stays off", () => {
  const b = clone(BASE); b.location = { name: "LA", lat: 1, lon: 2, units: "F" };
  const local = clone(b); ch(local, "a").lastDone = "Mon";
  const remote = clone(b); remote.location = null;
  eq(mergeHousehold(b, local, remote).location, null);
});
test("a kid added elsewhere and their rewards survive", () => {
  const local = clone(BASE); ch(local, "a").lastDone = "Mon";
  const remote = clone(BASE); remote.kids.push({ id: "k3", name: "Ava" }); remote.rewards.k3 = { points: 0, lastPunchDate: null, history: [], log: [] };
  const m = mergeHousehold(BASE, local, remote);
  eq(m.kids.map((k) => k.id), ["k1", "k2", "k3"]);
  eq(!!m.rewards.k3, true);
});
test("bookkeeping fields (starting with _) are left out of the merge", () => {
  const remote = clone(BASE); remote._recentWrites = ["w1"];
  eq("_recentWrites" in mergeHousehold(BASE, clone(BASE), remote), false);
});
// ---- redemptions (a bug once multiplied these)
const X = { name: "Ice cream party", cost: 55, date: "Fri Sep 18 2026", paid: false };
const withHist = (h) => { const d = clone(BASE); d.rewards.k1.history = clone(h); return d; };
test("marking a redemption paid elsewhere doesn't duplicate it when a stale device saves", () => {
  const b = withHist([X]);
  const local = clone(b); local.rewards.k1.log = [{ date: "Mon", pointsEarned: 0, chores: [] }];
  const remote = clone(b); remote.rewards.k1.history[0].paid = true;
  const m = mergeHousehold(b, local, remote);
  eq(m.rewards.k1.history.length, 1);
  eq(m.rewards.k1.history[0].paid, true);
});
test("the same redemption with its fields in a different order is still one redemption", () => {
  const sorted = { cost: 55, date: X.date, name: X.name, paid: false };
  const b = withHist([X]);
  const local = clone(b); local.rewards.k1.points = 12;
  const remote = withHist([sorted]); remote.rewards.k1.lastPunchDate = "Mon";
  eq(mergeHousehold(b, local, remote).rewards.k1.history.length, 1);
});
test("repeats copied by the old bug collapse to one", () => {
  const dupes = withHist([X, X, X, Object.assign({}, X, { paid: true }), X]);
  const m = mergeHousehold(dupes, dupes, dupes);
  eq(m.rewards.k1.history.length, 1);
});
test("redemptions made on two devices at once are both kept, newest first", () => {
  const b = withHist([X]);
  const local = clone(b); local.rewards.k1.history.unshift({ id: "hA", name: "TV", cost: 3, date: "Mon", paid: false }); local.rewards.k1.points = 7;
  const remote = clone(b); remote.rewards.k1.history.unshift({ id: "hB", name: "Park", cost: 8, date: "Mon", paid: false }); remote.rewards.k1.points = 2;
  const m = mergeHousehold(b, local, remote);
  eq(m.rewards.k1.history.map((h) => h.id || h.name), ["hB", "hA", "h:Ice cream party|55|Fri Sep 18 2026"]);
  eq(m.rewards.k1.points, 0); // 10 - 3 - 8, never below zero
});
test("a redemption deleted here stays deleted", () => {
  const b = withHist([X, { id: "hA", name: "TV", cost: 3, date: "Mon", paid: false }]);
  const local = clone(b); local.rewards.k1.history = local.rewards.k1.history.filter((h) => h.id !== "hA"); local.rewards.k1.points = 13;
  const remote = clone(b); remote.rewards.k1.log = [{ date: "Mon", pointsEarned: 1, chores: [] }];
  const m = mergeHousehold(b, local, remote);
  eq(m.rewards.k1.history.map((h) => h.name), ["Ice cream party"]);
  eq(m.rewards.k1.points, 13);
});
test("a new redemption made elsewhere survives a stale device's save", () => {
  const b = withHist([X]);
  const local = clone(b); ch(local, "a").lastDone = "Mon";
  const remote = clone(b); remote.rewards.k1.history.unshift({ id: "hB", name: "Park", cost: 8, date: "Mon", paid: false }); remote.rewards.k1.points = 2;
  const m = mergeHousehold(b, local, remote);
  eq(m.rewards.k1.history.length, 2);
  eq(m.rewards.k1.points, 2);
});

test("a first save with nothing saved yet just saves", () => {
  eq(mergeHousehold(undefined, BASE, undefined), BASE);
});

results.forEach(([s, n]) => console.log(s === "PASS" ? "  ok   " : "  FAIL ", n));
const failed = results.filter((r) => r[0] === "FAIL").length;
console.log("\n" + results.length + " tests, " + failed + " failed");
process.exit(failed ? 1 : 0);
