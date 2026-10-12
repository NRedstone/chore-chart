// Three-way merge for saving the household.
//
// Every device keeps its own copy of the household and saves the whole thing.
// Saving it as-is would let a device with an out-of-date copy (say, a tablet
// whose connection went stale overnight) wipe out changes other devices made
// meanwhile. Instead, each save is merged:
//
//   base   = the copy this device's edit started from
//   local  = what this device wants to save
//   remote = what is saved right now
//
// Anything this device changed (local differs from base) wins; anything it
// didn't touch keeps whatever is saved now. Chores, kids and rewards are
// merged item by item (by id), and a kid's points add up the changes from
// both sides instead of one overwriting the other.
//
// Plain old JavaScript (no ?. or ??) so it runs on older tablets. Used by the
// page (window.CCMerge) and by the tests (require).
(function (root) {
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function has(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }

  // Field by field: this device's changes win, the rest comes from what's saved.
  function mergeFields(base, local, remote) {
    base = base || {}; local = local || {}; remote = remote || {};
    var out = {};
    var keys = {};
    [base, local, remote].forEach(function (o) { Object.keys(o).forEach(function (k) { keys[k] = true; }); });
    Object.keys(keys).forEach(function (k) {
      var changedHere = !same(base[k], local[k]);
      var v = changedHere ? local[k] : remote[k];
      if (changedHere ? has(local, k) : has(remote, k)) out[k] = v;
    });
    return out;
  }

  // One item that may exist in any of the three versions.
  function mergeItem(b, l, r, mergeBoth) {
    var inB = b !== undefined, inL = l !== undefined, inR = r !== undefined;
    if (!inB) {
      if (inL && inR) return same(l, r) ? l : mergeBoth(undefined, l, r);
      return inL ? l : r; // added on one side
    }
    if (!inL) return undefined; // deleted here: deleted
    if (!inR) return same(l, b) ? undefined : l; // deleted elsewhere: stays deleted unless edited here
    if (same(l, b)) return r;
    if (same(r, b) || same(l, r)) return l;
    return mergeBoth(b, l, r);
  }

  // Lists of things with ids: kids, chores, the reward menu.
  function mergeList(base, local, remote) {
    base = base || []; local = local || []; remote = remote || [];
    var byId = function (list) { var m = {}; list.forEach(function (x) { if (x && x.id !== undefined) m[x.id] = x; }); return m; };
    var B = byId(base), L = byId(local), R = byId(remote);
    var ids = function (list) { return list.map(function (x) { return x && x.id; }); };
    // Keep this device's order if it reordered things, otherwise the saved order.
    var reordered = !same(ids(local).filter(function (id) { return id in B; }), ids(base).filter(function (id) { return id in L; }));
    var first = reordered ? local : remote, second = reordered ? remote : local;
    var order = [];
    var seen = {};
    first.concat(second).forEach(function (x) { if (x && x.id !== undefined && !seen[x.id]) { seen[x.id] = true; order.push(x.id); } });
    var out = [];
    order.forEach(function (id) {
      var v = mergeItem(B[id], L[id], R[id], mergeFields);
      if (v !== undefined) out.push(v);
    });
    return out;
  }

  // One kid's points and history.
  function mergeReward(b, l, r) {
    b = b || {};
    var out = mergeFields(b, l, r);
    // Points: add up what changed on each side (a reward redeemed on a phone
    // and a bonus chore checked on the tablet both count).
    if (typeof l.points === "number" && typeof r.points === "number") {
      var bp = typeof b.points === "number" ? b.points : 0;
      out.points = Math.max(0, r.points + (l.points - bp));
    }
    // Daily log: one entry per date; this device's version of a date wins if it changed it.
    var bl = {}; (b.log || []).forEach(function (e) { bl[e.date] = e; });
    var ll = {}; (l.log || []).forEach(function (e) { ll[e.date] = e; });
    var rl = {}; (r.log || []).forEach(function (e) { rl[e.date] = e; });
    var dates = [];
    var seen = {};
    (l.log || []).concat(r.log || []).forEach(function (e) { if (!seen[e.date]) { seen[e.date] = true; dates.push(e.date); } });
    out.log = dates
      .map(function (d) { return mergeItem(bl[d], ll[d], rl[d], function (x, y) { return y; }); })
      .filter(function (e) { return e !== undefined; })
      .sort(function (x, y) { return new Date(y.date) - new Date(x.date); })
      .slice(0, 60);
    // Redemptions: everything this device has, plus anything new from elsewhere.
    var known = {};
    (b.history || []).concat(l.history || []).forEach(function (h) { known[JSON.stringify(h)] = true; });
    var newElsewhere = (r.history || []).filter(function (h) { return !known[JSON.stringify(h)]; });
    out.history = newElsewhere.concat(l.history || []);
    return out;
  }

  function mergeRewards(base, local, remote) {
    base = base || {}; local = local || {}; remote = remote || {};
    var out = {};
    var keys = {};
    [local, remote].forEach(function (o) { Object.keys(o).forEach(function (k) { keys[k] = true; }); });
    Object.keys(keys).forEach(function (k) {
      var v = mergeItem(base[k], local[k], remote[k], mergeReward);
      if (v !== undefined) out[k] = v;
    });
    return out;
  }

  var LISTS = { kids: true, chores: true, rewardsMenu: true };

  // Bookkeeping fields start with "_" and are never part of what the app saves.
  function mergeHousehold(base, local, remote) {
    base = base || {}; local = local || {}; remote = remote || {};
    var out = {};
    var keys = {};
    [base, local, remote].forEach(function (o) { Object.keys(o).forEach(function (k) { if (k.charAt(0) !== "_") keys[k] = true; }); });
    Object.keys(keys).forEach(function (k) {
      if (LISTS[k]) out[k] = mergeList(base[k], local[k], remote[k]);
      else if (k === "rewards") out[k] = mergeRewards(base[k], local[k], remote[k]);
      else {
        var changedHere = !same(base[k], local[k]);
        var v = changedHere ? local[k] : remote[k];
        if (v !== undefined) out[k] = v;
      }
    });
    return out;
  }

  var api = { mergeHousehold: mergeHousehold, mergeList: mergeList, mergeRewards: mergeRewards };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CCMerge = api;
})(typeof window !== "undefined" ? window : this);
