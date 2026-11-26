"use strict";
// Browser test: recurring chores with a last day ("Ends: On a date").
//   python3 _build/build.py && node _build/tests/e2e/end-dates.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");
const { chromium } = require("/home/claude/.npm-global/lib/node_modules/playwright");
const { Backend } = require("./backend");

const OUT = path.resolve(__dirname, "../../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ed-"));
fs.writeFileSync(path.join(tmp, "entry.js"), 'import * as React from "react"; import { createRoot } from "react-dom/client"; window.React = React; window.ReactDOM = { createRoot };');
execSync(`NODE_PATH=/home/claude/.npm-global/lib/node_modules /opt/npm-tools/node_modules/@esbuild/linux-x64/bin/esbuild ${tmp}/entry.js --bundle --format=iife --minify --define:process.env.NODE_ENV='"production"' --outfile=${tmp}/react.js`, { stdio: "pipe" });
const reactBundle = fs.readFileSync(path.join(tmp, "react.js"), "utf8");
const appHtml = fs.readFileSync(process.env.APP_HTML || path.join(OUT, "index.html"), "utf8");
const fakeFirebase = fs.readFileSync(path.join(__dirname, "fake-firebase.js"), "utf8");


const key = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const fromToday = (n) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return key(d); };
const ALL = [0, 1, 2, 3, 4, 5, 6];
const chore = (id, name, category, extra) => Object.assign({ id, name, kidId: "k1", category, freq: 1, dueDay: null, dueDate: null, points: 0, lastDone: null, previousLastDone: null, streak: 0, days: ALL }, extra || {});
const SEED = {
  kids: [{ id: "k1", name: "Jack" }],
  chores: [
    chore("a1", "Brush teeth", "AM"),
    chore("a2", "Practice piano", "AM", { endDate: fromToday(-1) }),           // ended yesterday
    chore("p1", "Swim practice", "PM", { endDate: fromToday(10) }),            // still running
    chore("p2", "Last night only", "PM", { endDate: fromToday(0) }),           // today is its last day
    chore("w1", "Water the garden", "ANY", { freq: 7, dueDay: 0, days: null, endDate: fromToday(-3) }), // ended weekly chore
  ],
  rewards: { k1: { points: 0, lastPunchDate: null, history: [], log: [] } }, rewardsMenu: [], parentPin: "1234", dailyPointValue: 1,
};

const results = [];
const check = (name, cond, extra) => results.push({ name, ok: !!cond, extra });

(async () => {
  const be = new Backend();
  be.put("households/ABC234", SEED);
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 820, height: 1100 } });
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
  const devUid = be.linkDevice("ABC234");
  await page.evaluate((u) => { localStorage.setItem("fake_user", JSON.stringify({ uid: u, isAnonymous: true })); localStorage.setItem("cc-seen-help", "1"); }, devUid);
  await page.goto("http://app.test/index.html");
  await page.waitForSelector("text=Brush teeth");
  const sleep = (ms) => page.waitForTimeout(ms);
  const doc = () => be.doc("households/ABC234");
  const byId = (id) => (doc().chores || []).find((c) => c.id === id);
  const row = (name) => page.locator("div[draggable]", { hasText: name });

  // 1. On the chart
  check("an ended chore is gone from the chart", !(await page.isVisible("text=Practice piano")) && !(await page.isVisible("text=Water the garden")));
  check("a chore on its last day still shows", await page.isVisible("text=Last night only"));
  const swimText = await row("Swim practice").textContent();
  check("a running chore shows 'until' its last day", /Every day · until \w+ \d+/.test(swimText), swimText);
  check("the 'done today' count leaves ended chores out", (await page.textContent("body")).includes("0 of 3 done today"));

  // 2. Ended chores don't block the daily point
  for (const n of ["Brush teeth", "Swim practice", "Last night only"]) { await row(n).locator('button[aria-label="Mark done"]').click(); await sleep(700); }
  await sleep(1200);
  const r = doc().rewards.k1;
  check("finishing the live chores earns the day's point, with ended ones left undone", r.points === 1 && !!r.lastPunchDate, JSON.stringify({ p: r.points, l: r.lastPunchDate, log: r.log, ch: doc().chores.map((c) => [c.name, c.lastDone]) }));
  const todayLog = (r.log || [])[0];
  check("...and today's history leaves the ended chores out", todayLog && !todayLog.chores.some((c) => c.name === "Practice piano" || c.name === "Water the garden"), JSON.stringify(todayLog && todayLog.chores.map((c) => c.name)));

  // 3. Setting an end date in the form
  await page.click('button[aria-label="Unlock parent controls"]');
  await page.fill('input[placeholder="PIN"]', "1234");
  await page.click('button:has-text("Unlock")');
  await page.waitForSelector('button[aria-label="Lock parent controls"]');
  await row("Brush teeth").locator('button[aria-label="Edit chore"]').click();
  await page.waitForSelector("#cc-chore-ends");
  check("the form shows Ends: Never for a chore without a last day", (await page.getAttribute('#cc-chore-ends button[role="radio"]:text-is("Never")', "aria-checked")) === "true" && !(await page.isVisible('#cc-chore-ends input[type="date"]')));
  await page.click('#cc-chore-ends button[role="radio"]:text-is("On a date")');
  check("'On a date' shows the date, the shortcuts and the 'last day' note", (await page.isVisible('#cc-chore-ends input[type="date"]')) && (await page.isVisible('#cc-chore-ends button:text-is("In 2 weeks")')) && (await page.textContent("#cc-chore-ends")).includes("Last day on the chart"));
  await page.click('#cc-chore-ends button:text-is("In 2 weeks")');
  check("'In 2 weeks' picks the day two weeks out", (await page.inputValue('#cc-chore-ends input[type="date"]')) === fromToday(14));
  await page.screenshot({ path: path.join(os.tmpdir(), "end-date-form.png") });
  // A day in the past can't be saved
  await page.fill('#cc-chore-ends input[type="date"]', fromToday(-2));
  await page.click('button:text-is("Save changes")');
  await sleep(500);
  check("a day that's already passed can't be saved", !byId("a1").endDate && (await page.textContent("#cc-chore-ends")).includes("already passed"));
  await page.click('#cc-chore-ends button:text-is("In 2 weeks")');
  await page.click('button:text-is("Save changes")');
  await sleep(800);
  check("saving stores the last day, and points are unchanged", byId("a1").endDate === fromToday(14) && byId("a1").points === 0, JSON.stringify(byId("a1")));
  check("the chart shows the new 'until'", /until/.test(await row("Brush teeth").textContent()));
  // Setting it back to Never clears it
  await row("Brush teeth").locator('button[aria-label="Edit chore"]').click();
  await page.waitForSelector("#cc-chore-ends");
  await page.click('#cc-chore-ends button[role="radio"]:text-is("Never")');
  await page.click('button:text-is("Save changes")');
  await sleep(800);
  check("'Never' removes the last day", byId("a1").endDate === null);

  // 4. Ended chores in Settings
  await page.click('button[aria-label="Settings"]');
  await page.waitForSelector("#cc-settings");
  await page.click('#cc-settings button:text-is("Kids")').catch(() => {});
  await page.waitForSelector("#cc-ended-chores");
  const endedText = await page.textContent("#cc-ended-chores");
  check("Settings > Kids lists the ended chores, newest first", endedText.indexOf("Practice piano") >= 0 && endedText.indexOf("Water the garden") > endedText.indexOf("Practice piano") && !endedText.includes("Swim practice"), endedText);
  await page.screenshot({ path: path.join(os.tmpdir(), "end-date-settings.png") });
  await page.click('#cc-ended-chores button[aria-label="Delete Water the garden for good"]');
  check("deleting asks first", (await page.isVisible('#cc-ended-chores button:text-is("Delete for good")')) && !!byId("w1"));
  await page.click('#cc-ended-chores button:text-is("Delete for good")');
  await sleep(800);
  check("...then deletes it for good", !byId("w1"));
  await page.click('#cc-ended-chores button:text-is("Restart…")');
  await page.waitForSelector("#cc-chore-ends");
  check("Restart opens the chore with Ends set to Never", (await page.getAttribute('#cc-chore-ends button[role="radio"]:text-is("Never")', "aria-checked")) === "true" && (await page.inputValue('input[value="Practice piano"]').catch(() => "")) === "Practice piano");
  await page.click('button:text-is("Save changes")');
  await sleep(800);
  check("...and saving puts it back on the chart", byId("a2").endDate === null && (await page.isVisible("text=Practice piano")));
  check("the day's point was taken back now a new chore is undone (as before)", doc().rewards.k1.points === 0);

  // 5. One-time chores and books have no Ends
  await page.click('button[aria-label="Add an Evening chore for Jack"]');
  await page.waitForSelector("#cc-chore-ends");
  await page.selectOption('[role="dialog"] select:has(option[value="BOOK"])', "BOOK");
  await sleep(300);
  check("Books don't offer an end date", !(await page.isVisible("#cc-chore-ends")));

  // 6. Bonus (and Book) chores can be worth 0 points
  await page.selectOption('[role="dialog"] select:has(option[value="BONUS"])', "BONUS");
  await page.fill('[role="dialog"] input[placeholder]:not([type="date"])', "Feed the fish");
  await page.fill('[role="dialog"] input[aria-label="Points"], [role="dialog"] input[type="number"]', "0");
  await page.click('[role="dialog"] button:text-is("Add")');
  await sleep(800);
  const fish = (doc().chores || []).find((c) => c.name === "Feed the fish");
  check("a Bonus chore saves at 0 points", fish && fish.category === "BONUS" && fish.points === 0, JSON.stringify(fish));
  await row("Feed the fish").locator('button[aria-label="Edit chore"]').click();
  await page.waitForSelector('[role="dialog"]');
  check("...and edits as 0, not 1", (await page.inputValue('[role="dialog"] input[aria-label="Points"], [role="dialog"] input[type="number"]')) === "0");
  await page.fill('[role="dialog"] input[aria-label="Points"], [role="dialog"] input[type="number"]', "");
  await page.click('button:text-is("Save changes")');
  await sleep(800);
  check("a blank points box still means the usual 1", (doc().chores.find((c) => c.name === "Feed the fish") || {}).points === 1);

  results.forEach((r) => console.log((r.ok ? "  ok   " : "  FAIL ") + r.name + (r.ok || !r.extra ? "" : "   [" + String(r.extra).slice(0, 200) + "]")));
  console.log(results.length + " checks, " + results.filter((r) => !r.ok).length + " failed; page errors: " + (errors.length ? errors.join(" | ") : "none"));
  await browser.close();
  process.exit(results.some((r) => !r.ok) || errors.length ? 1 : 0);
})().catch((e) => { console.error("CRASHED:", e.message.split("\n").slice(0, 6).join("\n")); results.forEach((r) => console.log((r.ok ? "  ok   " : "  FAIL ") + r.name)); process.exit(2); });
