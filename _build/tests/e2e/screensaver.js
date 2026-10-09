"use strict";
// Browser test for the screensaver clock (idle time shortened to 2 seconds).
//   python3 _build/build.py && node _build/tests/e2e/screensaver.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");
const { chromium } = require("/home/claude/.npm-global/lib/node_modules/playwright");
const { Backend } = require("./backend");

const ESBUILD = "/opt/npm-tools/node_modules/@esbuild/linux-x64/bin/esbuild";
const OUT = path.resolve(__dirname, "../../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ss-"));
fs.writeFileSync(path.join(tmp, "entry.js"), 'import * as React from "react"; import { createRoot } from "react-dom/client"; window.React = React; window.ReactDOM = { createRoot };');
execSync(`NODE_PATH=/home/claude/.npm-global/lib/node_modules ${ESBUILD} ${tmp}/entry.js --bundle --format=iife --minify --define:process.env.NODE_ENV='"production"' --outfile=${tmp}/react.js`, { stdio: "pipe" });
const reactBundle = fs.readFileSync(path.join(tmp, "react.js"), "utf8");
const appHtml = fs.readFileSync(process.env.APP_HTML || path.join(OUT, "index.html"), "utf8");
const fakeFirebase = fs.readFileSync(path.join(__dirname, "fake-firebase.js"), "utf8");

const chore = (id, name) => ({ id, name, kidId: "k1", category: "AM", freq: 1, dueDay: null, dueDate: null, points: 0, lastDone: null, previousLastDone: null, streak: 0, days: [0, 1, 2, 3, 4, 5, 6] });
const SEED = { kids: [{ id: "k1", name: "Jack" }], chores: [chore("c1", "Brush teeth"), chore("c2", "Make bed")], rewards: { k1: { points: 0, lastPunchDate: null, history: [], log: [] } }, rewardsMenu: [], parentPin: "1234", dailyPointValue: 1 };

const results = [];
const check = (name, cond, extra) => results.push({ name, ok: !!cond, extra });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const be = new Backend();
  be.put("households/ABC234", SEED);
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: Number(process.env.VW || 820), height: Number(process.env.VH || 1100) }, hasTouch: true, isMobile: true });
  await ctx.exposeFunction("__be", (op, a) => be.rpc(op, a));
  await ctx.addInitScript(fakeFirebase);
  await ctx.addInitScript(() => { window.__ccScreensaverMsForTests = 2000; });
  // The screensaver is off by default; most checks below run with it switched on for this device.
  await ctx.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith("http://app.test/")) {
      if (url.includes("/blank")) return route.fulfill({ status: 200, contentType: "text/html", body: "<html></html>" });
      if (url.endsWith("sw.js")) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({ status: 200, contentType: "text/html", body: appHtml });
    }
    if (url.includes("open-meteo")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ current: { temperature_2m: 71, weather_code: 0, is_day: 1 } }) });
    if (url.includes("gstatic.com/firebasejs")) return route.fulfill({ status: 200, contentType: "application/javascript", body: "//" });
    if (url.includes("unpkg.com/react@")) return route.fulfill({ status: 200, contentType: "application/javascript", body: reactBundle });
    if (url.includes("unpkg.com/react-dom@")) return route.fulfill({ status: 200, contentType: "application/javascript", body: "//" });
    return route.abort();
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("http://app.test/blank");
  const devUid = be.linkDevice("ABC234"); // this page is a device linked to the household
  await page.evaluate((u) => { localStorage.setItem("fake_user", JSON.stringify({ uid: u, isAnonymous: true })); localStorage.setItem("cc-seen-help", "1"); }, devUid);
  await page.goto("http://app.test/index.html");
  await page.waitForSelector("text=Make bed");
  const ss = "#cc-screensaver";
  const shownAfter = async (ms) => { await sleep(ms); return page.isVisible(ss); };

  // 0. Off by default: nothing happens after the idle time.
  check("off by default: no clock appears on a device that hasn't turned it on", !(await shownAfter(3500)));

  // Turn it on through Settings, as a parent would.
  await page.click('button[aria-label="Unlock parent controls"]');
  await page.fill('input[placeholder="PIN"]', "1234");
  await page.click('button:has-text("Unlock")');
  await page.click('button[aria-label="Settings"]');
  await page.waitForSelector("#cc-settings");
  check("Settings opens with tabs for Kids, Rewards, Screen saver and Household",
    await page.isVisible('#cc-settings button:text-is("Kids")') && await page.isVisible('#cc-settings button:text-is("Rewards")') &&
    await page.isVisible('#cc-settings button:text-is("Screen saver")') && await page.isVisible('#cc-settings button:text-is("Household")'));
  check("the Kids tab shows the kids list", await page.isVisible('#cc-settings input[placeholder="New kid\'s name"]'));
  await page.click('#cc-settings button:text-is("Rewards")');
  check("the Rewards tab shows the rewards menu", await page.isVisible('#cc-settings input[placeholder="New reward name"]'));
  await page.click('#cc-settings button:text-is("Household")');
  check("the Household tab shows the PIN and backup tools", await page.isVisible('#cc-settings #cc-change-pin') && await page.isVisible('#cc-settings button:has-text("Download backup")'));
  await page.click('#cc-settings button:text-is("Screen saver")');
  await sleep(3000);
  check("the clock doesn't start while Settings is open", !(await page.isVisible(ss)));
  await page.click('#cc-settings button[role="switch"]');
  check("the wait-time choices appear once it's on", await page.isVisible('#cc-settings button:text-is("10 min")'));
  await page.click('#cc-settings button:text-is("5 min")');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("cc-screensaver") || "null"));
  check("the choice is remembered on this device", saved && saved.on === true && saved.minutes === 5, JSON.stringify(saved));
  await page.screenshot({ path: path.join(os.tmpdir(), "settings-screensaver.png") });
  await page.keyboard.press("Escape");
  await page.waitForSelector("#cc-settings", { state: "detached" });
  await page.click('button[aria-label="Lock parent controls"]');
  const shown = () => page.isVisible(ss);
  const appears = async (t) => { try { await page.waitForSelector(ss, { timeout: t || 5000 }); return true; } catch (e) { return false; } };

  // 1. It appears after the idle time, showing the time, date, and weather.
  check("the clock appears after the idle time", await appears(6000));
  const text = await page.textContent(ss);
  check("it shows the time", /\d{1,2}:\d{2}/.test(text), text);
  check("it shows the weekday and date", /(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/.test(text), text);
  check("it shows the temperature", /\d+°/.test(text), text);
  // Drift moves the clock up to 7% of the width and 15% of the height either
  // way, so the clock must leave at least that much room on each side.
  const fit = await page.evaluate(() => {
    const el = document.getElementById("cc-screensaver-time").parentElement;
    const prev = el.style.transform; el.style.transition = "none"; el.style.transform = "none";
    const r = el.getBoundingClientRect(); el.style.transform = prev;
    return { spareX: Math.min(r.left, innerWidth - r.right) / innerWidth, spareY: Math.min(r.top, innerHeight - r.bottom) / innerHeight };
  });
  check("even at its farthest drift the clock stays fully on screen", fit.spareX >= 0.07 && fit.spareY >= 0.15, JSON.stringify(fit));
  await page.screenshot({ path: path.join(os.tmpdir(), "screensaver-" + (process.env.VW || 820) + ".png") });

  // 2. The waking tap does nothing else, even right over a chore's checkbox.
  const box = await page.evaluate(() => {
    const ov = document.getElementById("cc-screensaver"); ov.style.display = "none";
    const b = document.querySelector('button[aria-label="Mark done"]').getBoundingClientRect();
    ov.style.display = "";
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  await page.touchscreen.tap(box.x, box.y); // a real finger tap, like on the iPad
  await sleep(600);
  check("a tap wakes it", !(await shown()));
  check("the waking tap did NOT check off the chore under it", (be.doc("households/ABC234").chores || []).every((c) => !c.lastDone) && (await page.locator('button[aria-label="Mark not done"]').count()) === 0);

  // 3. Activity keeps it away.
  for (let i = 0; i < 8; i++) { await page.mouse.move(100 + i * 10, 300); await sleep(400); }
  check("it stays away while someone is using the app", !(await shown()));

  // 4. A key also wakes it.
  check("it comes back after being idle again", await appears(6000));
  await page.keyboard.press("Space");
  await sleep(400);
  check("a key press wakes it", !(await shown()));

  // 5. It never starts on top of the chore form.
  await page.click('button:has-text("Add chore")');
  await page.waitForSelector('[role="dialog"]');
  await sleep(4000);
  check("it doesn't start while the chore form is open", !(await shown()));
  await page.keyboard.press("Escape");
  await page.waitForSelector('[role="dialog"]', { state: "detached" });

  // 6. Starting it locks parent controls.
  await page.click('button[aria-label="Unlock parent controls"]');
  await page.fill('input[placeholder="PIN"]', "1234");
  await page.click('button:has-text("Unlock")');
  await page.waitForSelector('button[aria-label="Lock parent controls"]');
  check("(appears again with parent controls unlocked)", await appears(6000));
  const vp = page.viewportSize();
  await page.touchscreen.tap(Math.round(vp.width / 2), Math.round(vp.height / 2));
  await sleep(400);
  check("after the clock, parent controls are locked again", !(await shown()) && await page.isVisible('button[aria-label="Unlock parent controls"]'));

  // 7. Normal taps still work once it's gone.
  await page.click('button[aria-label="Mark done"] >> nth=0');
  await sleep(800);
  check("checking off a chore still works afterwards", (be.doc("households/ABC234").chores || []).some((c) => !!c.lastDone));

  results.forEach((r) => console.log((r.ok ? "  ok   " : "  FAIL ") + r.name + (r.ok || !r.extra ? "" : "   [" + String(r.extra).slice(0, 120) + "]")));
  const failed = results.filter((r) => !r.ok).length;
  console.log("\n" + results.length + " checks, " + failed + " failed; page errors: " + (errors.length ? errors.join(" | ") : "none"));
  await browser.close();
  process.exit(failed || errors.length ? 1 : 0);
})().catch((e) => { console.error("CRASHED:", e.message.split("\n").slice(0, 6).join("\n")); results.forEach((r) => console.log((r.ok ? "  ok   " : "  FAIL ") + r.name)); process.exit(2); });
