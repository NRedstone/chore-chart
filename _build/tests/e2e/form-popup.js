"use strict";
// Browser test: the add/edit chore form opens as a popup wherever you are on
// the page (no jump to the top), closes every way it should, and still saves.
//   python3 _build/build.py && node _build/tests/e2e/form-popup.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");
const { chromium } = require("/home/claude/.npm-global/lib/node_modules/playwright");
const { Backend } = require("./backend");

const OUT = path.resolve(__dirname, "../../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fp-"));
fs.writeFileSync(path.join(tmp, "entry.js"), 'import * as React from "react"; import { createRoot } from "react-dom/client"; window.React = React; window.ReactDOM = { createRoot };');
execSync(`NODE_PATH=/home/claude/.npm-global/lib/node_modules /opt/npm-tools/node_modules/@esbuild/linux-x64/bin/esbuild ${tmp}/entry.js --bundle --format=iife --minify --define:process.env.NODE_ENV='"production"' --outfile=${tmp}/react.js`, { stdio: "pipe" });
const reactBundle = fs.readFileSync(path.join(tmp, "react.js"), "utf8");
const appHtml = fs.readFileSync(process.env.APP_HTML || path.join(OUT, "index.html"), "utf8");
const fakeFirebase = fs.readFileSync(path.join(__dirname, "fake-firebase.js"), "utf8");

// A long page: lots of chores so there's real scrolling to lose.
const chore = (id, name, category) => ({ id, name, kidId: "k1", category, freq: 1, dueDay: null, dueDate: null, points: 0, lastDone: null, previousLastDone: null, streak: 0, days: [0, 1, 2, 3, 4, 5, 6] });
const chores = [];
for (let i = 1; i <= 12; i++) chores.push(chore("am" + i, "Morning task " + i, "AM"));
for (let i = 1; i <= 12; i++) chores.push(chore("pm" + i, "Evening task " + i, "PM"));
const SEED = { kids: [{ id: "k1", name: "Jack" }], chores, rewards: { k1: { points: 0, lastPunchDate: null, history: [], log: [] } }, rewardsMenu: [], parentPin: "1234", dailyPointValue: 1 };

const results = [];
const check = (name, cond, extra) => results.push({ name, ok: !!cond, extra });

(async () => {
  const be = new Backend();
  be.put("households/ABC234", SEED);
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 430, height: 760 } });
  await ctx.exposeFunction("__be", (op, a) => be.rpc(op, a));
  await ctx.addInitScript(fakeFirebase);
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
  await page.evaluate(() => { localStorage.setItem("choreChartHouseholdCode", "ABC234"); localStorage.setItem("cc-seen-help", "1"); sessionStorage.setItem("cc-banner-off", "1"); });
  await page.goto("http://app.test/index.html");
  await page.waitForSelector("text=Evening task 12");

  const dialog = '[role="dialog"]';
  const scrollY = () => page.evaluate(() => Math.round(window.scrollY));
  const openFromPlus = async () => { await page.click('button[aria-label="Add an Evening chore for Jack"]'); await page.waitForSelector(dialog); };
  const gone = async () => { try { await page.waitForSelector(dialog, { state: "detached", timeout: 3000 }); return true; } catch (e) { return false; } };

  // Scroll well down the page so the Evening "+" is on screen (but nowhere near the top).
  const plus = page.locator('button[aria-label="Add an Evening chore for Jack"]');
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await plus.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const y0 = await scrollY();
  check("setup: the page is scrolled well down, with the + on screen", y0 > 300, "scrollY=" + y0);

  // Record the scroll position at the exact instant of each click, from inside the
  // page, so any scrolling the test robot does to reach a button doesn't count.
  await page.evaluate(() => document.addEventListener("click", () => { window.__yAtClick = Math.round(window.scrollY); }, true));
  const yAtClick = () => page.evaluate(() => window.__yAtClick);
  await openFromPlus();
  await page.waitForTimeout(400);
  const yc = await yAtClick();
  check("+ opens the form as a popup", await page.isVisible(dialog));
  check("+ was tapped well down the page", yc > 300, "y at click " + yc);
  check("+ does not move the page at all", (await scrollY()) === yc, "now " + (await scrollY()) + " vs " + yc);
  const box = await page.locator(dialog).boundingBox();
  check("the popup sits fully on screen", box && box.y >= 0 && box.y + box.height <= 760 && box.x >= 0 && box.x + box.width <= 430, JSON.stringify(box));
  check("the popup scrolls on its own without dragging the page", (await page.evaluate(() => getComputedStyle(document.querySelector('[role="dialog"]')).overscrollBehaviorY)) === "contain");
  check("the popup already has the Evening category picked", await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] select')].some((s) => s.value === "PM")));
  await page.screenshot({ path: path.join(os.tmpdir(), "form-popup.png") });

  await page.fill('[role="dialog"] input[placeholder="Chore name"]', "Water the plants");
  await page.click('[role="dialog"] button:text-is("Add")');
  check("Add saves and closes the popup", await gone());
  check("the new chore appears", (await page.isVisible("text=Water the plants")));
  check("after saving you're still where you were", Math.abs((await scrollY()) - yc) < 120, "now " + (await scrollY()) + " vs " + yc);

  await openFromPlus(); await page.keyboard.press("Escape");
  check("Esc closes it", await gone());
  await openFromPlus(); await page.click('[role="dialog"] button[aria-label="Close"]');
  check("the × closes it", await gone());
  await openFromPlus(); await page.click('[role="dialog"] button:text-is("Cancel")');
  check("Cancel closes it", await gone());
  await openFromPlus(); await page.mouse.click(5, 5);
  check("a stray tap outside does NOT throw away the form", await page.isVisible(dialog));
  await page.keyboard.press("Escape"); await gone();

  await page.click('button:has-text("Add chore")');
  await page.waitForSelector(dialog);
  check("the top Add chore button also opens the popup in place", (await scrollY()) === (await yAtClick()));
  await page.keyboard.press("Escape"); await gone();

  // Editing (needs the parent PIN)
  await page.click('button[aria-label="Unlock parent controls"]');
  await page.fill('input[placeholder="PIN"]', "1234");
  await page.click('button:has-text("Unlock")');
  await page.waitForSelector('button[aria-label="Lock parent controls"]');
  const pencil = page.locator('button[aria-label="Edit chore"]').last();
  await pencil.click();
  await page.waitForSelector('[role="dialog"][aria-label="Edit chore"]');
  check("the pencil opens Edit as a popup in place", (await scrollY()) === (await yAtClick()));
  await page.fill('[role="dialog"] input[placeholder="Chore name"]', "Evening task renamed");
  await page.click('[role="dialog"] button:text-is("Save changes")');
  check("Save changes works and closes it", (await gone()) && (await page.isVisible("text=Evening task renamed")));

  results.forEach((r) => console.log((r.ok ? "  ok   " : "  FAIL ") + r.name + (r.ok || !r.extra ? "" : "   [" + r.extra + "]")));
  const failed = results.filter((r) => !r.ok).length;
  console.log("\n" + results.length + " checks, " + failed + " failed; page errors: " + (errors.length ? errors.join(" | ") : "none"));
  await browser.close();
  process.exit(failed || errors.length ? 1 : 0);
})().catch((e) => { console.error("CRASHED:", e.message.split("\n").slice(0, 6).join("\n")); results.forEach((r) => console.log((r.ok ? "  ok   " : "  FAIL ") + r.name)); process.exit(2); });
