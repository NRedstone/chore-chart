"use strict";
// Browser test: demo mode ("?demo") shows a sample family, works, saves
// nothing, and never touches Firebase. Also takes the README screenshots
// when SHOTS_DIR is set.
//   python3 _build/build.py && node _build/tests/e2e/demo.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");
const { chromium } = require("/home/claude/.npm-global/lib/node_modules/playwright");

const OUT = path.resolve(__dirname, "../../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "demo-"));
fs.writeFileSync(path.join(tmp, "entry.js"), 'import * as React from "react"; import { createRoot } from "react-dom/client"; window.React = React; window.ReactDOM = { createRoot };');
execSync(`NODE_PATH=/home/claude/.npm-global/lib/node_modules /opt/npm-tools/node_modules/@esbuild/linux-x64/bin/esbuild ${tmp}/entry.js --bundle --format=iife --minify --define:process.env.NODE_ENV='"production"' --outfile=${tmp}/react.js`, { stdio: "pipe" });
const reactBundle = fs.readFileSync(path.join(tmp, "react.js"), "utf8");
const appHtml = fs.readFileSync(process.env.APP_HTML || path.join(OUT, "index.html"), "utf8");
const SHOTS = process.env.SHOTS_DIR || "";

const results = [];
const check = (name, cond, extra) => results.push({ name, ok: !!cond, extra });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
  const firebaseCalls = [];
  async function open(viewport, url) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: SHOTS ? 2 : 1 });
    await ctx.route("**/*", (route) => {
      const u = route.request().url();
      if (u.startsWith("https://app.test/")) {
        if (u.endsWith("sw.js")) return route.fulfill({ status: 404, body: "" });
        return route.fulfill({ status: 200, contentType: "text/html", body: appHtml });
      }
      // The Firebase SDK files are replaced with nothing: if demo mode tried to
      // use Firebase at all, the page would crash.
      if (u.includes("gstatic.com/firebasejs")) return route.fulfill({ status: 200, contentType: "application/javascript", body: "/* no firebase */" });
      if (u.includes("unpkg.com/react@")) return route.fulfill({ status: 200, contentType: "application/javascript", body: reactBundle });
      if (u.includes("unpkg.com/react-dom@")) return route.fulfill({ status: 200, contentType: "application/javascript", body: "//" });
      if (u.includes("api.open-meteo.com")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ current: { temperature_2m: 74, weather_code: 1, is_day: 1 } }) });
      if (/firebase|firestore|identitytoolkit|securetoken|cloudfunctions/.test(u)) firebaseCalls.push(u);
      return route.abort();
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(url || "https://app.test/index.html?demo");
    return { ctx, page, errors };
  }

  const d = await open({ width: 390, height: 844 });
  check("the demo opens straight into the sample family, no sign-in", await d.page.waitForSelector("text=Maya", { timeout: 8000 }).then(() => true, () => false));
  check("all three sample kids are there", (await d.page.isVisible("text=Leo")) && (await d.page.isVisible("text=Ava")));
  check("a banner says it's a demo and gives the PIN", (await d.page.textContent("#cc-demo-banner")).includes("Nothing you do here is saved") && (await d.page.textContent("#cc-demo-banner")).includes("1234"));
  check("the banner links to the project page", (await d.page.getAttribute("#cc-demo-banner a", "href")) === "https://github.com/NRedstone/chore-chart");
  check("the weather shows for the sample family's city", await d.page.waitForSelector("#cc-weather-temp", { timeout: 4000 }).then(() => true, () => false));
  check("no sign-in or join screen appears", !(await d.page.$("#cc-welcome")) && !(await d.page.$("#cc-start-btn")));
  if (SHOTS) {
    await sleep(2500);
    await d.page.screenshot({ path: path.join(SHOTS, "phone-chart.png") });
  }

  // tap a chore: it checks off
  const clicked = await d.page.evaluate(() => {
    const label = [...document.querySelectorAll("*")].find((el) => el.children.length === 0 && el.textContent.trim() === "Pack school bag");
    let n = label;
    while (n && !(n.querySelector && n.querySelector('button[aria-label="Mark done"]'))) n = n.parentElement;
    const b = n && n.querySelector('button[aria-label="Mark done"]');
    if (b) b.click();
    return !!b;
  });
  await sleep(600);
  const saved = await d.page.evaluate(() => window.storage.get("x").then((r) => JSON.parse(r.value)));
  check("checking off a chore works", saved.chores.find((c) => c.name === "Pack school bag").lastDone === new Date().toDateString());

  // parent controls with the PIN from the banner
  await d.page.click('button[aria-label="Unlock parent controls"]');
  await d.page.click("#cc-forgot-pin");
  check("Forgot PIN explains how it works for real", await d.page.waitForSelector("text=In this demo, the PIN is 1234", { timeout: 3000 }).then(() => true, () => false));
  await d.page.fill('input[placeholder="PIN"]', "1234");
  await d.page.click('button:has-text("Unlock")');
  check("the PIN 1234 unlocks parent controls", await d.page.waitForSelector('button[aria-label="Lock parent controls"]', { timeout: 3000 }).then(() => true, () => false));
  await d.page.click('button[aria-label="Settings"]');
  await d.page.click('#cc-settings button:has-text("Devices")');
  check("Devices explains accounts instead of managing real ones", await d.page.waitForSelector("text=This demo has no accounts", { timeout: 3000 }).then(() => true, () => false));
  await d.page.click('#cc-settings button:has-text("Household")');
  check("Household shows the sample city", (await d.page.textContent("#cc-weather-place")).includes("San Diego"));
  if (SHOTS) await d.page.screenshot({ path: path.join(SHOTS, "phone-settings.png") });

  // reloading starts over, and nothing was stored on the device
  await d.page.reload();
  await d.page.waitForSelector("text=Maya");
  const fresh = await d.page.evaluate(() => window.storage.get("x").then((r) => JSON.parse(r.value)));
  check("reloading resets the demo", fresh.chores.find((c) => c.name === "Pack school bag").lastDone === null);
  const ls = await d.page.evaluate(() => Object.keys(localStorage));
  check("the demo leaves no household data or location in the browser", !ls.includes("choreChartHouseholdCode") && !ls.includes("cc-location-cache") && !ls.includes("cc-session"), JSON.stringify(ls));
  check("the demo never contacted Firebase", firebaseCalls.length === 0, firebaseCalls.join(" "));

  // a tablet-sized view, for the README
  const t = await open({ width: 1180, height: 820 });
  await t.page.waitForSelector("text=Maya");
  if (SHOTS) {
    await sleep(2500);
    await t.page.screenshot({ path: path.join(SHOTS, "tablet-chart.png") });
  }

  const errs = [d, t].flatMap((x) => x.errors);
  results.forEach((r) => console.log((r.ok ? "  ok   " : "  FAIL ") + r.name + (r.ok || !r.extra ? "" : "   [" + r.extra + "]")));
  const failed = results.filter((r) => !r.ok).length;
  console.log("\n" + results.length + " checks, " + failed + " failed; page errors: " + (errs.length ? errs.join(" | ") : "none"));
  await browser.close();
  process.exit(failed || errs.length ? 1 : 0);
})().catch((e) => { console.error("CRASHED:", e); process.exit(2); });
