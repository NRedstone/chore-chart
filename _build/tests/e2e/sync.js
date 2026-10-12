"use strict";
// Browser test: saves are merged (a device with an out-of-date copy can't undo
// other devices' changes), a save that can't reach the server is retried
// until it goes through, and the connection watchdog reconnects.
//   python3 _build/build.py && node _build/tests/e2e/sync.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");
const { chromium } = require("/home/claude/.npm-global/lib/node_modules/playwright");
const { Backend } = require("./backend");

const OUT = path.resolve(__dirname, "../../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sync-"));
fs.writeFileSync(path.join(tmp, "entry.js"), 'import * as React from "react"; import { createRoot } from "react-dom/client"; window.React = React; window.ReactDOM = { createRoot };');
execSync(`NODE_PATH=/home/claude/.npm-global/lib/node_modules /opt/npm-tools/node_modules/@esbuild/linux-x64/bin/esbuild ${tmp}/entry.js --bundle --format=iife --minify --define:process.env.NODE_ENV='"production"' --outfile=${tmp}/react.js`, { stdio: "pipe" });
const reactBundle = fs.readFileSync(path.join(tmp, "react.js"), "utf8");
const appHtml = fs.readFileSync(process.env.APP_HTML || path.join(OUT, "index.html"), "utf8");
const fakeFirebase = fs.readFileSync(path.join(__dirname, "fake-firebase.js"), "utf8");

const chore = (id, name) => ({ id, name, kidId: "k1", category: "AM", freq: 1, dueDay: null, dueDate: null, points: 0, lastDone: null, previousLastDone: null, streak: 0, days: [0, 1, 2, 3, 4, 5, 6] });
const SEED = {
  kids: [{ id: "k1", name: "Jack" }],
  chores: [chore("a", "Brush teeth"), chore("b", "Make bed"), chore("c", "Get dressed"), chore("d", "Feed the dog")],
  rewards: { k1: { points: 5, lastPunchDate: null, history: [], log: [] } },
  rewardsMenu: [], parentPin: "1234", dailyPointValue: 1, location: null,
};
const results = [];
const check = (name, cond, extra) => results.push({ name, ok: !!cond, extra });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = new Date().toDateString();

(async () => {
  const be = new Backend();
  be.put("households/HH1", SEED);
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
  async function device(label) {
    const ctx = await browser.newContext({ viewport: { width: 430, height: 900 } });
    await ctx.exposeFunction("__be", (op, a) => be.rpc(op, a));
    await ctx.addInitScript(fakeFirebase);
    await ctx.route("**/*", (route) => {
      const u = route.request().url();
      if (u.startsWith("http://app.test/")) {
        if (u.includes("/blank")) return route.fulfill({ status: 200, contentType: "text/html", body: "<html></html>" });
        if (u.endsWith("sw.js")) return route.fulfill({ status: 404, body: "" });
        return route.fulfill({ status: 200, contentType: "text/html", body: appHtml });
      }
      if (u.includes("gstatic.com/firebasejs")) return route.fulfill({ status: 200, contentType: "application/javascript", body: "//" });
      if (u.includes("unpkg.com/react@")) return route.fulfill({ status: 200, contentType: "application/javascript", body: reactBundle });
      if (u.includes("unpkg.com/react-dom@")) return route.fulfill({ status: 200, contentType: "application/javascript", body: "//" });
      return route.abort();
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const uid = be.linkDevice("HH1");
    await page.goto("http://app.test/blank");
    await page.evaluate((u) => { localStorage.setItem("fake_user", JSON.stringify({ uid: u, isAnonymous: true })); localStorage.setItem("cc-seen-help", "1"); }, uid);
    await page.goto("http://app.test/index.html");
    await page.waitForSelector("text=Feed the dog");
    return { page, errors, label };
  }
  async function tap(d, name) {
    await d.page.evaluate((n) => {
      const label = [...document.querySelectorAll("*")].find((el) => el.children.length === 0 && el.textContent.trim() === n);
      let x = label;
      while (x && !(x.querySelector && x.querySelector('button[aria-label="Mark done"], button[aria-label="Mark not done"]'))) x = x.parentElement;
      x.querySelector('button[aria-label="Mark done"], button[aria-label="Mark not done"]').click();
    }, name);
  }
  const doneIn = (name) => { const c = be.doc("households/HH1").chores.find((x) => x.name === name); return c && c.lastDone === today; };
  async function waitFor(fn, ms) { const end = Date.now() + (ms || 5000); while (Date.now() < end) { if (await fn()) return true; await sleep(150); } return false; }

  const tablet = await device("tablet");
  const phone = await device("phone");
  check("setup: the app asked Firestore for the sturdier connection mode", await tablet.page.evaluate(() => window.__fakeSettings && window.__fakeSettings.experimentalAutoDetectLongPolling === true));

  // ---- 1. a tablet with an out-of-date copy
  await tablet.page.evaluate(() => { window.__pauseSync = true; });
  await tap(phone, "Make bed");
  check("phone's change is saved", await waitFor(() => doneIn("Make bed")));
  await sleep(600);
  check("setup: the tablet hasn't heard about it", await tablet.page.evaluate(() => !!document.querySelector('button[aria-label="Mark done"]')) && !(await tablet.page.evaluate(() => [...document.querySelectorAll("*")].some((el) => el.children.length === 0 && el.textContent.trim() === "Make bed" && getComputedStyle(el).textDecorationLine.includes("line-through")))));
  await tap(tablet, "Brush teeth");
  check("the tablet's change is saved", await waitFor(() => doneIn("Brush teeth")));
  check("...and it did NOT undo the phone's change", doneIn("Make bed"));
  const pts = be.doc("households/HH1").rewards.k1.points;
  check("points weren't disturbed", pts === 5, "points " + pts);
  await tablet.page.evaluate(() => { window.__pauseSync = false; });
  check("once it catches up, the tablet shows both", await waitFor(() => tablet.page.evaluate(() => document.querySelectorAll('button[aria-label="Mark not done"]').length >= 2)));

  // ---- 2. a save while the connection is dead
  await tablet.page.evaluate(() => { window.__offline = true; });
  await tap(tablet, "Get dressed");
  check("a save that can't reach the server shows the banner", await tablet.page.waitForSelector("#cc-save-banner", { timeout: 15000 }).then(() => true, () => false));
  check("...and isn't saved", !doneIn("Get dressed"));
  await tap(phone, "Feed the dog"); // meanwhile, someone else makes a change
  check("meanwhile the phone saves its own change", await waitFor(() => doneIn("Feed the dog")));
  await tablet.page.evaluate(() => window.__ccCheckConnection());
  check("the watchdog notices the dead connection and reconnects", await waitFor(() => tablet.page.evaluate(() => (window.__fakeNetCycles || 0) > 0), 12000));
  await tablet.page.evaluate(() => { window.__offline = false; });
  await tablet.page.evaluate(() => window.__ccCheckConnection());
  check("when the connection is back, the waiting change saves by itself", await waitFor(() => doneIn("Get dressed"), 8000));
  check("...without undoing the phone's change made meanwhile", doneIn("Feed the dog") && doneIn("Make bed") && doneIn("Brush teeth"));
  check("...and the banner goes away", await tablet.page.waitForSelector("#cc-save-banner", { state: "detached", timeout: 5000 }).then(() => true, () => false));

  // ---- 3. retry without any connection check, just the timer
  await tablet.page.evaluate(() => { window.__offline = true; });
  await tap(tablet, "Brush teeth"); // un-check it
  await tablet.page.waitForSelector("#cc-save-banner", { timeout: 15000 });
  await tablet.page.evaluate(() => { window.__offline = false; });
  check("a waiting change is also retried on a timer", await waitFor(() => !doneIn("Brush teeth"), 20000));

  // ---- 4. redemptions: marked paid on the phone while the tablet is out of date
  {
    const d = be.doc("households/HH1");
    d.rewards.k1.history = [{ name: "Ice cream party", cost: 55, date: "Fri Sep 18 2026", paid: false }];
    be.put("households/HH1", d);
    await sleep(800);
    for (let round = 0; round < 3; round++) {
      await tablet.page.evaluate(() => { window.__pauseSync = true; });
      const x = be.doc("households/HH1"); x.rewards.k1.history = x.rewards.k1.history.map((h) => ({ ...h, paid: !h.paid })); be.put("households/HH1", x);
      await sleep(400);
      await tap(tablet, round % 2 ? "Make bed" : "Feed the dog");
      await sleep(1200);
      await tablet.page.evaluate(() => { window.__pauseSync = false; });
      await sleep(700);
    }
    const h = be.doc("households/HH1").rewards.k1.history;
    check("a redemption marked paid elsewhere is never copied by a stale device's save", h.length === 1, JSON.stringify(h));
  }
  // ---- 5. repeats left by the old bug disappear
  {
    const d = be.doc("households/HH1");
    const X = { name: "Ice cream party", cost: 55, date: "Fri Sep 18 2026", paid: true };
    d.rewards.k1.history = [X, X, X, X, X, { name: "TV", cost: 3, date: "Sat Sep 19 2026", paid: false }];
    be.put("households/HH1", d);
    check("the app shows each redemption once, even if the saved copy has repeats", await waitFor(() => phone.page.evaluate(() => /2 redemptions/.test(document.body.innerText)), 5000));
    await tap(phone, "Make bed");
    check("...and the next save removes the repeats for good", await waitFor(() => be.doc("households/HH1").rewards.k1.history.length === 2, 5000), JSON.stringify(be.doc("households/HH1").rewards.k1.history.length));
  }

  // ---- 6. each save is applied once
  const recent = be.doc("households/HH1")._recentWrites || [];
  check("saves are tagged so a repeat can't be applied twice", recent.length > 0 && new Set(recent).size === recent.length);

  const errs = [tablet, phone].flatMap((x) => x.errors);
  results.forEach((r) => console.log((r.ok ? "  ok   " : "  FAIL ") + r.name + (r.ok || !r.extra ? "" : "   [" + r.extra + "]")));
  const failed = results.filter((r) => !r.ok).length;
  console.log("\n" + results.length + " checks, " + failed + " failed; page errors: " + (errs.length ? errs.join(" | ") : "none"));
  await browser.close();
  process.exit(failed || errs.length ? 1 : 0);
})().catch((e) => { console.error("CRASHED:", e); process.exit(2); });
