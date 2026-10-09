"use strict";
// Browser test: PIN boxes can't be saved/filled by the browser, the Household
// tab's version line and "Check for updates" button, and automatic updating
// when a kiosk tablet is idle (idle time shortened to 1.5 seconds).
//   python3 _build/build.py && node _build/tests/e2e/autoupdate.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");
const { chromium } = require("/home/claude/.npm-global/lib/node_modules/playwright");
const { Backend } = require("./backend");

const ESBUILD = "/opt/npm-tools/node_modules/@esbuild/linux-x64/bin/esbuild";
const OUT = path.resolve(__dirname, "../../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "au-"));
fs.writeFileSync(path.join(tmp, "entry.js"), 'import * as React from "react"; import { createRoot } from "react-dom/client"; window.React = React; window.ReactDOM = { createRoot };');
execSync(`NODE_PATH=/home/claude/.npm-global/lib/node_modules ${ESBUILD} ${tmp}/entry.js --bundle --format=iife --minify --define:process.env.NODE_ENV='"production"' --outfile=${tmp}/react.js`, { stdio: "pipe" });
const reactBundle = fs.readFileSync(path.join(tmp, "react.js"), "utf8");
const appHtml = fs.readFileSync(process.env.APP_HTML || path.join(OUT, "index.html"), "utf8");
const fakeFirebase = fs.readFileSync(path.join(__dirname, "fake-firebase.js"), "utf8");

const chore = (id, name) => ({ id, name, kidId: "k1", category: "AM", freq: 1, dueDay: null, dueDate: null, points: 0, lastDone: null, previousLastDone: null, streak: 0, days: [0, 1, 2, 3, 4, 5, 6] });
const SEED = { kids: [{ id: "k1", name: "Jack" }], chores: [chore("c1", "Brush teeth")], rewards: { k1: { points: 0, lastPunchDate: null, history: [], log: [] } }, rewardsMenu: [], parentPin: "1234", dailyPointValue: 1 };

const results = [];
const check = (name, cond, extra) => results.push({ name, ok: !!cond, extra });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const be = new Backend();
  be.put("households/ABC234", SEED);
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 820, height: 1100 } });
  await ctx.exposeFunction("__be", (op, a) => be.rpc(op, a));
  await ctx.addInitScript(fakeFirebase);
  await ctx.addInitScript(() => { window.__ccAutoUpdateIdleMsForTests = 1500; });
  await ctx.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith("http://app.test/")) {
      if (url.includes("/blank")) return route.fulfill({ status: 200, contentType: "text/html", body: "<html></html>" });
      if (url.endsWith("sw.js")) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({ status: 200, contentType: "text/html", body: appHtml });
    }
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
  await page.waitForSelector("text=Brush teeth");
  const mark = () => page.evaluate(() => { window.__sameLoad = true; });
  const sameLoad = () => page.evaluate(() => window.__sameLoad === true).catch(() => false);

  // ---- PIN boxes
  await page.click('button[aria-label="Unlock parent controls"]');
  const pin = await page.evaluate(() => {
    const i = document.querySelector('input[placeholder="PIN"]');
    return { type: i.type, ac: i.getAttribute("autocomplete"), dots: getComputedStyle(i).webkitTextSecurity };
  });
  check("the PIN box isn't a password field, so the browser won't offer to save or fill it", pin.type === "text" && pin.ac === "off", JSON.stringify(pin));
  check("the PIN still shows as dots while typing", pin.dots === "disc", JSON.stringify(pin));
  await page.fill('input[placeholder="PIN"]', "1234");
  await page.click('button:has-text("Unlock")');
  await page.waitForSelector('button[aria-label="Lock parent controls"]');
  check("unlocking with the PIN still works", true);

  // ---- Household tab: version + check for updates
  await page.click('button[aria-label="Settings"]');
  await page.click('#cc-settings button:text-is("Household")');
  check("Household shows the app version", /Version \d{4}-\d{2}-\d{2}/.test(await page.textContent("#cc-version-line")));
  await page.click('#cc-settings button:text-is("Check for updates")');
  await sleep(300);
  const msg = await page.textContent("#cc-version-line");
  check("Check for updates answers in plain words", /latest version|aren't available|Couldn't check|Updating/.test(msg), msg);
  await page.keyboard.press("Escape");
  await page.click('button[aria-label="Lock parent controls"]');

  // ---- Automatic update when idle
  await mark();
  await page.evaluate(() => window.__ccSimulateUpdateReady());
  check("when an update is ready, the banner still appears", await page.isVisible("#cc-update-banner"));
  // someone is typing a new chore: must NOT reload
  await page.click('button:has-text("Add chore")');
  await page.fill('[role="dialog"] input[placeholder="Chore name"]', "Half-typed chore");
  await sleep(4000);
  check("it does NOT reload while someone has the chore form open", await sameLoad());
  await page.keyboard.press("Escape");
  await page.waitForSelector('[role="dialog"]', { state: "detached" });
  // now idle: it should reload by itself
  let reloaded = false;
  try { await page.waitForFunction(() => window.__sameLoad !== true, null, { timeout: 6000 }); reloaded = true; } catch (e) {}
  check("once nobody is using it, it reloads by itself", reloaded);
  await page.waitForSelector("text=Brush teeth");

  // ---- Screen saver showing: reload right away
  await page.evaluate(() => localStorage.setItem("cc-screensaver", JSON.stringify({ on: true, minutes: 5 })));
  await page.reload();
  await page.waitForSelector("text=Brush teeth");
  await page.evaluate(() => { window.__ccAutoUpdateIdleMsForTests = 600000; }); // only the clock should trigger it now
  await page.click('button[aria-label="Unlock parent controls"]');
  await page.fill('input[placeholder="PIN"]', "1234");
  await page.click('button:has-text("Unlock")');
  await page.click('button[aria-label="Settings"]');
  await page.click('#cc-settings button:text-is("Screen saver")');
  await page.click('#cc-settings button:text-is("Show it now")');
  await page.waitForSelector("#cc-screensaver");
  await mark();
  await page.evaluate(() => window.__ccSimulateUpdateReady());
  reloaded = false;
  try { await page.waitForFunction(() => window.__sameLoad !== true, null, { timeout: 4000 }); reloaded = true; } catch (e) {}
  check("while the clock screen saver is showing, it updates right away", reloaded);

  results.forEach((r) => console.log((r.ok ? "  ok   " : "  FAIL ") + r.name + (r.ok || !r.extra ? "" : "   [" + String(r.extra).slice(0, 140) + "]")));
  const failed = results.filter((r) => !r.ok).length;
  console.log("\n" + results.length + " checks, " + failed + " failed; page errors: " + (errors.length ? errors.join(" | ") : "none"));
  await browser.close();
  process.exit(failed || errors.length ? 1 : 0);
})().catch((e) => { console.error("CRASHED:", e.message.split("\n").slice(0, 6).join("\n")); results.forEach((r) => console.log((r.ok ? "  ok   " : "  FAIL ") + r.name)); process.exit(2); });
