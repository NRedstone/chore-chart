"use strict";
// Browser test: the household weather location and the weather-colored date card.
//   python3 _build/build.py && node _build/tests/e2e/weather.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");
const { chromium } = require("/home/claude/.npm-global/lib/node_modules/playwright");
const { Backend } = require("./backend");

const OUT = path.resolve(__dirname, "../../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wx-"));
fs.writeFileSync(path.join(tmp, "entry.js"), 'import * as React from "react"; import { createRoot } from "react-dom/client"; window.React = React; window.ReactDOM = { createRoot };');
execSync(`NODE_PATH=/home/claude/.npm-global/lib/node_modules /opt/npm-tools/node_modules/@esbuild/linux-x64/bin/esbuild ${tmp}/entry.js --bundle --format=iife --minify --define:process.env.NODE_ENV='"production"' --outfile=${tmp}/react.js`, { stdio: "pipe" });
const reactBundle = fs.readFileSync(path.join(tmp, "react.js"), "utf8");
const appHtml = fs.readFileSync(process.env.APP_HTML || path.join(OUT, "index.html"), "utf8");
const fakeFirebase = fs.readFileSync(path.join(__dirname, "fake-firebase.js"), "utf8");

const SEED = {
  kids: [{ id: "k1", name: "Jack" }],
  chores: [{ id: "c1", name: "Brush teeth", kidId: "k1", category: "AM", freq: 1, dueDay: null, dueDate: null, points: 0, lastDone: null, previousLastDone: null, streak: 0, days: [0, 1, 2, 3, 4, 5, 6] }],
  rewards: { k1: { points: 0, lastPunchDate: null, history: [], log: [] } },
  rewardsMenu: [],
  parentPin: "1234",
  dailyPointValue: 1,
  // no "location" field: a household from before the weather setting existed
};

const results = [];
const check = (name, cond, extra) => results.push({ name, ok: !!cond, extra });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// What the fake weather service answers right now, and every request it got.
let current = { temperature_2m: 71.4, weather_code: 0, is_day: 1 };
const weatherCalls = [];
const GEO = {
  results: [
    { id: 1, name: "Pasadena", latitude: 34.14778, longitude: -118.14452, country_code: "US", country: "United States", admin1: "California" },
    { id: 2, name: "Pasadena", latitude: 29.69106, longitude: -95.2091, country_code: "US", country: "United States", admin1: "Texas" },
  ],
};

(async () => {
  const be = new Backend();
  be.put("households/ABC234", SEED);
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });

  async function device(code, opts) {
    const ctx = await browser.newContext({ viewport: { width: 430, height: 900 }, ...(opts || {}) });
    await ctx.exposeFunction("__be", (op, a) => be.rpc(op, a));
    await ctx.addInitScript(fakeFirebase);
    await ctx.route("**/*", (route) => {
      const url = route.request().url();
      if (url.startsWith("https://app.test/")) {
        if (url.includes("/blank")) return route.fulfill({ status: 200, contentType: "text/html", body: "<html></html>" });
        if (url.endsWith("sw.js")) return route.fulfill({ status: 404, body: "" });
        return route.fulfill({ status: 200, contentType: "text/html", body: appHtml });
      }
      if (url.includes("gstatic.com/firebasejs")) return route.fulfill({ status: 200, contentType: "application/javascript", body: "//" });
      if (url.includes("unpkg.com/react@")) return route.fulfill({ status: 200, contentType: "application/javascript", body: reactBundle });
      if (url.includes("unpkg.com/react-dom@")) return route.fulfill({ status: 200, contentType: "application/javascript", body: "//" });
      if (url.includes("geocoding-api.open-meteo.com")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(url.includes("Nowhereville") ? {} : GEO) });
      if (url.includes("api.open-meteo.com")) {
        weatherCalls.push(url);
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ current }) });
      }
      return route.abort();
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto("https://app.test/blank");
    // code = a household to join as a linked device; or null = a new owner with no household yet
    const user = code ? { uid: be.linkDevice(code), isAnonymous: true } : { uid: "g_newowner", email: "newowner@gmail.com", isAnonymous: false };
    await page.evaluate((u) => { localStorage.setItem("fake_user", JSON.stringify(u)); localStorage.setItem("cc-seen-help", "1"); }, user);
    await page.goto("https://app.test/index.html");
    if (!code) { await page.click("#cc-create-hh"); }
    await page.waitForSelector("#cc-date-card");
    return { ctx, page, errors };
  }
  const theme = (d) => d.page.getAttribute("#cc-date-card", "data-weather");
  async function waitTheme(d, want, ms) {
    const end = Date.now() + (ms || 4000);
    while (Date.now() < end) { if ((await theme(d)) === want) return true; await sleep(100); }
    return false;
  }
  async function refresh(d) { await d.page.evaluate(() => window.__ccRefreshWeather && window.__ccRefreshWeather()); }
  const loc = () => be.doc("households/ABC234").location;

  // ---- 1. an existing household keeps Los Angeles, and it gets saved
  const d = await device("ABC234");
  check("existing household: sunny daytime weather turns the card orange", await waitTheme(d, "sunny"));
  check("existing household: it asks for Los Angeles's weather", weatherCalls.some((u) => u.includes("latitude=34.05") && u.includes("longitude=-118.24") && u.includes("fahrenheit")));
  check("the temperature shows, rounded", (await d.page.textContent("#cc-weather-temp")).trim() === "71°");
  await sleep(800);
  check("existing household: Los Angeles is saved with the household", loc() && loc().name === "Los Angeles, California" && loc().lat === 34.05);

  // ---- 2. colors follow the weather
  const bg = () => d.page.evaluate(() => getComputedStyle(document.getElementById("cc-date-card")).color);
  for (const [code, isDay, want] of [[3, 1, "cloudy"], [45, 1, "cloudy"], [61, 1, "rain"], [81, 1, "rain"], [95, 1, "storm"], [73, 1, "snow"], [0, 0, "night"], [61, 0, "night"], [2, 1, "sunny"]]) {
    current = { temperature_2m: 60, weather_code: code, is_day: isDay };
    await refresh(d);
    check(`weather code ${code} ${isDay ? "by day" : "at night"} -> ${want}`, await waitTheme(d, want));
  }
  current = { temperature_2m: 30, weather_code: 73, is_day: 1 };
  await refresh(d);
  await waitTheme(d, "snow");
  await sleep(2300);
  check("snow uses dark text on the light card", (await bg()) === "rgb(28, 53, 84)", await bg());
  await d.page.screenshot({ path: path.join(os.tmpdir(), "wx-snow.png"), clip: { x: 230, y: 0, width: 200, height: 130 } });
  current = { temperature_2m: 71, weather_code: 0, is_day: 1 };
  await refresh(d);
  await waitTheme(d, "sunny");
  await sleep(2300);
  await d.page.screenshot({ path: path.join(os.tmpdir(), "wx-sunny.png"), clip: { x: 0, y: 0, width: 430, height: 130 } });

  // ---- 3. choosing a place in Settings
  await d.page.click('button[aria-label="Unlock parent controls"]');
  await d.page.fill('input[placeholder="PIN"]', "1234");
  await d.page.click('button:has-text("Unlock")');
  await d.page.click('button[aria-label="Settings"]');
  await d.page.click('#cc-settings button:has-text("Household")');
  await d.page.waitForSelector("#cc-weather-settings");
  check("Household tab has a clear Change PIN button", await d.page.isVisible("#cc-change-pin") && (await d.page.textContent("#cc-change-pin")).includes("Change PIN"));
  check("Settings shows the current place", (await d.page.textContent("#cc-weather-place")).includes("Los Angeles, California"));
  await d.page.fill("#cc-weather-query", "Nowhereville");
  await d.page.click('#cc-weather-settings button:has-text("Search")');
  check("a search with no matches says so", await d.page.waitForSelector("text=No places found", { timeout: 3000 }).then(() => true, () => false));
  await d.page.fill("#cc-weather-query", "Pasadena");
  await d.page.press("#cc-weather-query", "Enter");
  await d.page.waitForSelector("#cc-weather-results");
  const labels = await d.page.$$eval("#cc-weather-results button", (bs) => bs.map((b) => b.textContent.trim()));
  check("search lists matching places by name and state", JSON.stringify(labels) === JSON.stringify(["Pasadena, California", "Pasadena, Texas"]), JSON.stringify(labels));
  await d.page.screenshot({ path: path.join(os.tmpdir(), "wx-settings.png") });
  const before = weatherCalls.length;
  await d.page.click('#cc-weather-results button:has-text("Pasadena, California")');
  await sleep(800);
  check("picking a place saves it for the household (rounded to ~1 km)", loc() && loc().name === "Pasadena, California" && loc().lat === 34.15 && loc().lon === -118.14 && loc().units === "F", JSON.stringify(loc()));
  check("...and fetches that place's weather right away", weatherCalls.slice(before).some((u) => u.includes("latitude=34.15")));
  check("Settings now names the new place", (await d.page.textContent("#cc-weather-place")).includes("Pasadena, California"));

  // ---- 4. another device in the household follows along
  const d2 = await device("ABC234");
  await sleep(600);
  check("a second device uses the household's place", weatherCalls.some((u) => u.includes("latitude=34.15")) && (await waitTheme(d2, "sunny")));

  // ---- 5. an older copy of the app saves over the household (no location field)
  const old = be.doc("households/ABC234"); delete old.location; be.put("households/ABC234", old);
  await sleep(1500);
  check("if an older app version drops the location, it is put back", loc() && loc().name === "Pasadena, California", JSON.stringify(loc()));

  // ---- 6. Celsius
  await d.page.click("#cc-weather-units");
  await sleep(800);
  check("switching to Celsius is saved and asks for Celsius", loc().units === "C" && !weatherCalls[weatherCalls.length - 1].includes("fahrenheit"));
  await d.page.click("#cc-weather-units");
  await sleep(500);

  // ---- 7. turning weather off
  await d.page.click("#cc-weather-off");
  await sleep(800);
  check("turning weather off saves 'no location'", loc() === null);
  check("with no location the card goes back to pink-purple", await waitTheme(d, "none"));
  check("...shows no temperature", !(await d.page.$("#cc-weather-temp")));
  check("...but still shows the time", /\d:\d\d/.test(await d.page.textContent("#cc-date-card-line")));
  check("Settings says weather is hidden", (await d.page.textContent("#cc-weather-place")).includes("No location set"));
  check("the other device drops the weather too", await waitTheme(d2, "none"));
  const callsWhenOff = weatherCalls.length;
  await sleep(500);
  await refresh(d);
  check("no weather requests while no location is set", weatherCalls.length === callsWhenOff);
  // an older app version saving over "no location" doesn't bring Los Angeles back
  const old2 = be.doc("households/ABC234"); delete old2.location; be.put("households/ABC234", old2);
  await sleep(1500);
  check("'off' survives an older app version saving over it", loc() === null, JSON.stringify(loc()));

  // ---- 8. the app never asks for the device's location
  check("there's no 'Use my current location' button", !(await d.page.$("text=Use my current location")));
  check("the app never touches the device's location", await d.page.evaluate(() => !document.documentElement.innerHTML.includes("getCurrentPosition")));
  // and a place can be set again after turning weather off
  await d.page.fill("#cc-weather-query", "Pasadena");
  await d.page.press("#cc-weather-query", "Enter");
  await d.page.click('#cc-weather-results button:has-text("Pasadena, California")');
  await sleep(800);
  check("after turning it off, picking a place brings the weather back", loc() && loc().name === "Pasadena, California" && (await waitTheme(d, "sunny")));

  // ---- 9. a brand-new household starts with no weather
  const callsBefore = weatherCalls.length;
  const n = await device(null);
  const newHid = be.doc("members/g_newowner").hid;
  await sleep(1200);
  check("a brand-new household has no location", be.doc("households/" + newHid) && be.doc("households/" + newHid).location === null, JSON.stringify(be.doc("households/" + newHid) && be.doc("households/" + newHid).location));
  check("...shows no weather and asks for none", (await theme(n)) === "none" && weatherCalls.length === callsBefore);

  const errs = [d, d2, n].flatMap((x) => x.errors);
  results.forEach((r) => console.log((r.ok ? "  ok   " : "  FAIL ") + r.name + (r.ok || !r.extra ? "" : "   [" + r.extra + "]")));
  const failed = results.filter((r) => !r.ok).length;
  console.log("\n" + results.length + " checks, " + failed + " failed; page errors: " + (errs.length ? errs.join(" | ") : "none"));
  await browser.close();
  process.exit(failed || errs.length ? 1 : 0);
})().catch((e) => { console.error("CRASHED:", e); process.exit(2); });
