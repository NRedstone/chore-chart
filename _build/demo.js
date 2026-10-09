// Demo mode: open the app with "?demo" at the end of the address.
//
// A made-up family that lives only in this browser tab. It never connects to
// Firebase (no sign-in, no database, nothing saved anywhere), so it can be
// shared publicly without exposing any real household. Reloading starts over.
(function () {
  var search = (typeof location !== "undefined" && (location.search + location.hash)) || "";
  if (!/[?&#]demo\b/.test(search)) return;
  window.__ccDemo = true;

  var REPO_URL = "https://github.com/NRedstone/chore-chart";
  var DAY = 24 * 60 * 60 * 1000;
  var ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
  function dayKey(daysAgo) { return new Date(Date.now() - daysAgo * DAY).toDateString(); }
  var today = dayKey(0);
  // Monday = 0 ... Sunday = 6, like the app.
  var weekday = (new Date().getDay() + 6) % 7;

  var kids = [
    { id: "maya", name: "Maya", emoji: "🦄", color: "#FF6B9D" },
    { id: "leo", name: "Leo", emoji: "🦖", color: "#22B8A0" },
    { id: "ava", name: "Ava", emoji: "🐼", color: "#FFB03D" },
  ];

  var n = 0;
  function chore(kidId, category, name, opts) {
    opts = opts || {};
    return {
      id: "demo" + ++n, name: name, kidId: kidId, category: category,
      freq: opts.freq !== undefined ? opts.freq : 1,
      dueDay: opts.dueDay !== undefined ? opts.dueDay : null, dueDate: null,
      points: opts.points || 0,
      lastDone: opts.done ? today : opts.lastDone || null, previousLastDone: null,
      streak: opts.streak || 0, days: ALL_DAYS.slice(),
    };
  }
  var chores = [
    chore("maya", "AM", "Brush teeth", { done: true, streak: 12 }),
    chore("maya", "AM", "Make bed", { done: true, streak: 5 }),
    chore("maya", "AM", "Pack school bag"),
    chore("maya", "PM", "Brush teeth", { streak: 11, lastDone: dayKey(1) }),
    chore("maya", "PM", "Lay out tomorrow's clothes"),
    chore("maya", "ANY", "Clean your room", { freq: 7, dueDay: (weekday + 2) % 7 }),
    chore("maya", "BONUS", "Unload the dishwasher", { points: 2 }),
    chore("maya", "BOOK", "Charlotte's Web", { freq: "once", points: 3 }),

    chore("leo", "AM", "Brush teeth", { done: true, streak: 8 }),
    chore("leo", "AM", "Get dressed", { done: true, streak: 8 }),
    chore("leo", "PM", "Brush teeth", { streak: 7, lastDone: dayKey(1) }),
    chore("leo", "PM", "Feed the dog"),
    chore("leo", "ANY", "Water the plants", { freq: 7, dueDay: (weekday + 6) % 7 }),
    chore("leo", "BONUS", "Help fold laundry", { points: 1, done: true }),
    chore("leo", "BOOK", "Dog Man", { freq: "once", points: 3 }),

    chore("ava", "AM", "Brush teeth", { done: true, streak: 3 }),
    chore("ava", "AM", "Get dressed"),
    chore("ava", "PM", "Bath time"),
    chore("ava", "PM", "Brush teeth", { streak: 2, lastDone: dayKey(1) }),
    chore("ava", "BONUS", "Set the table", { points: 1 }),
  ];

  // Two weeks of history, so the per-kid history and streaks have something to show.
  function pastLog(kidId, pattern) {
    var mine = chores.filter(function (c) { return c.kidId === kidId && (c.category === "AM" || c.category === "PM"); });
    var log = [];
    for (var i = 1; i <= 14; i++) {
      var allDone = pattern.charAt((i - 1) % pattern.length) === "1";
      log.push({
        date: dayKey(i),
        pointsEarned: allDone ? 1 : 0,
        chores: mine.map(function (c, j) { return { name: c.name, category: c.category, done: allDone || j % 2 === 0, overdue: false }; }),
      });
    }
    return log;
  }
  var rewards = {
    maya: { points: 14, lastPunchDate: null, log: pastLog("maya", "1101111"), history: [{ name: "Pick dinner", cost: 5, date: dayKey(4), paid: true }] },
    leo: { points: 9, lastPunchDate: null, log: pastLog("leo", "1110110"), history: [{ name: "30 minutes of screen time", cost: 3, date: dayKey(2), paid: true }] },
    ava: { points: 6, lastPunchDate: null, log: pastLog("ava", "1011010"), history: [] },
  };
  var data = {
    kids: kids,
    chores: chores,
    rewards: rewards,
    rewardsMenu: [
      { id: "r1", name: "30 minutes of screen time", cost: 3 },
      { id: "r2", name: "Stay up 15 minutes late", cost: 4 },
      { id: "r3", name: "Pick dinner", cost: 5 },
      { id: "r4", name: "Trip to the park", cost: 8 },
      { id: "r5", name: "Ice cream outing", cost: 10 },
    ],
    parentPin: "1234",
    dailyPointValue: 1,
    location: { name: "San Diego, California", lat: 32.72, lon: -117.16, units: "F" },
  };

  // Storage that lives only in this tab.
  var saved = JSON.stringify(data);
  window.storage = {
    get: function (key) { return Promise.resolve({ key: key, value: saved, shared: true }); },
    set: function (key, value) { saved = value; return Promise.resolve({ key: key, value: value, shared: true }); },
    delete: function (key) { return Promise.resolve({ key: key, deleted: true, shared: true }); },
    list: function () { return Promise.resolve({ keys: [], shared: true }); },
  };
  window.subscribeToSync = function () { return function () {}; };
  window.CCAccount = {
    mode: "demo",
    role: null,
    email: null,
    mountDevices: function (el) {
      el.innerHTML =
        '<div style="font-size:13px;color:#5D5490;font-weight:600;line-height:1.6;">' +
        "<b>In the real app,</b> the parent who sets up the chart signs in with Google or email and owns it. " +
        "Every other device, like the kitchen tablet or the other parent's phone, joins with a one-time code from this screen, with no email needed. " +
        "The owner can rename or remove devices, sign out all other devices, or hand the chart to someone else." +
        '<div style="margin-top:10px;color:#8A82C0;">This demo has no accounts, so there is nothing to manage here.</div></div>';
      return function () { el.innerHTML = ""; };
    },
    openDevicesModal: function () {},
    checkAccess: function () { return Promise.resolve(); },
  };
  window.__syncReady = Promise.resolve();

  // A slim banner above the app that says what this is.
  function addBanner() {
    if (document.getElementById("cc-demo-banner")) return;
    var bar = document.createElement("div");
    bar.id = "cc-demo-banner";
    bar.setAttribute("role", "note");
    bar.style.cssText =
      "background:#2B2250;color:#F4F1FF;font:700 13px 'Nunito',-apple-system,BlinkMacSystemFont,sans-serif;" +
      "padding:9px 16px;text-align:center;line-height:1.5;";
    bar.innerHTML =
      "Demo: a sample family. Nothing you do here is saved. Parent PIN: <b>1234</b>" +
      ' <span style="opacity:.5;">·</span> <a href="' + REPO_URL + '" style="color:#C9BCFF;">About this project</a>';
    document.body.insertBefore(bar, document.body.firstChild);
  }
  if (document.body) addBanner();
  else document.addEventListener("DOMContentLoaded", addBanner);
})();
