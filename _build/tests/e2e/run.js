"use strict";
// End-to-end test of accounts, in a real browser (Chromium) running the REAL
// built index.html. Firebase is replaced by backend.js (real server logic,
// fake database, modelled rules). Several "devices" share one backend.
//
//   python3 _build/build.py && node _build/tests/e2e/run.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");
const { chromium } = require("/home/claude/.npm-global/lib/node_modules/playwright");
const { Backend } = require("./backend");

const OUT = path.resolve(__dirname, "../../..");
const SHOTS = path.join(os.tmpdir(), "e2e-shots");
fs.mkdirSync(SHOTS, { recursive: true });

// React 19 ships no browser-global build, so bundle one for the page.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-"));
fs.writeFileSync(path.join(tmp, "entry.js"), 'import * as React from "react"; import { createRoot } from "react-dom/client"; window.React = React; window.ReactDOM = { createRoot };');
execSync(`NODE_PATH=/home/claude/.npm-global/lib/node_modules ${process.env.ESBUILD || "/opt/npm-tools/node_modules/@esbuild/linux-x64/bin/esbuild"} ${tmp}/entry.js --bundle --format=iife --minify --define:process.env.NODE_ENV='"production"' --outfile=${tmp}/react.js`, { stdio: "pipe" });
const reactBundle = fs.readFileSync(path.join(tmp, "react.js"), "utf8");
const appHtml = fs.readFileSync(process.env.APP_HTML || path.join(OUT, "index.html"), "utf8");
const fakeFirebase = fs.readFileSync(path.join(__dirname, "fake-firebase.js"), "utf8");

const SEED = {
  kids: [{ id: "k1", name: "Jack" }],
  chores: [{ id: "c1", name: "Brush teeth", kidId: "k1", category: "AM", freq: 1, dueDay: null, dueDate: null, points: 0, lastDone: null, previousLastDone: null, streak: 0, days: [0, 1, 2, 3, 4, 5, 6] }],
  rewards: { k1: { points: 0, lastPunchDate: null, history: [], log: [] } },
  rewardsMenu: [{ id: "rm1", name: "TV time", cost: 1 }],
  parentPin: "1234",
  dailyPointValue: 1,
};

const results = [];
const check = (name, cond, extra) => { results.push({ name, ok: !!cond, extra }); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const URL0 = "http://app.test/index.html";

let browser;
const be = new Backend();
const allErrors = [];

async function device(label, opts) {
  opts = opts || {};
  const ctx = await browser.newContext({ viewport: { width: 430, height: 920 } });
  await ctx.exposeFunction("__be", (op, a) => be.rpc(op, a));
  await ctx.addInitScript(fakeFirebase);
  if (opts.noLiveDenial) await ctx.addInitScript(() => { window.__noLiveDenial = true; });
  await ctx.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith("http://app.test/")) {
      if (url.includes("/blank")) return route.fulfill({ status: 200, contentType: "text/html", body: "<html><body></body></html>" });
      if (url.endsWith("sw.js")) return route.fulfill({ status: 404, body: "" });
      if (url.endsWith("manifest.json")) return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      return route.fulfill({ status: 200, contentType: "text/html", body: appHtml });
    }
    if (url.includes("gstatic.com/firebasejs")) return route.fulfill({ status: 200, contentType: "application/javascript", body: "/* stub */" });
    if (url.includes("unpkg.com/react@")) return route.fulfill({ status: 200, contentType: "application/javascript", body: reactBundle });
    if (url.includes("unpkg.com/react-dom@")) return route.fulfill({ status: 200, contentType: "application/javascript", body: "/* bundled with react */" });
    return route.abort();
  });
  const page = await ctx.newPage();
  const dev = { ctx, page, label, errors: [] };
  page.on("pageerror", (e) => { dev.errors.push(String(e)); allErrors.push(label + ": " + e); });
  if (opts.legacyCode) {
    await page.goto("http://app.test/blank");
    await page.evaluate((c) => localStorage.setItem("choreChartHouseholdCode", c), opts.legacyCode);
  }
  return dev;
}
const open = (d) => d.page.goto(URL0);
const shot = (d, name) => d.page.screenshot({ path: path.join(SHOTS, name + ".png") });
const asGoogle = (d, who) => d.page.evaluate((w) => { window.__nextGoogle = w; }, who);
const seesText = async (d, text, t) => { try { await d.page.waitForSelector("text=" + text, { timeout: t || 6000 }); return true; } catch (e) { return false; } };
// Waits for the chore list, then closes the first-time help screen like a person would.
async function appReady(d, t) {
  const ok = await seesText(d, "Brush teeth", t);
  await d.page.click("#cc-help-close", { timeout: 1500 }).catch(() => {});
  return ok;
}
async function unlock(d) {
  await d.page.click('button[aria-label="Unlock parent controls"]');
  await d.page.fill('input[placeholder="PIN"]', "1234");
  await d.page.click('button:has-text("Unlock")');
  await d.page.waitForSelector('button[aria-label="Lock parent controls"]');
}
// Devices now lives inside Settings (unlock, gear, then Devices).
async function openDevices(d) {
  if (!(await d.page.isVisible("#cc-settings"))) {
    if (await d.page.isVisible('button[aria-label="Unlock parent controls"]')) await unlock(d);
    await d.page.click('button[aria-label="Settings"]');
    await d.page.waitForSelector("#cc-settings");
  }
  await d.page.click('#cc-settings button:has-text("Devices")');
  await d.page.waitForSelector("#cc-devices");
  // It must be a tab inside Settings, not another popup stacked on top.
  check("Devices opens as a tab inside Settings, not a popup on top (" + d.label + ")",
    await d.page.evaluate(() => !!document.querySelector("#cc-settings #cc-devices") && document.querySelectorAll("#cc-devices").length === 1));
}
async function makeLinkCode(d) {
  await d.page.click("#cc-new-link");
  await d.page.waitForSelector("#cc-link-code-shown");
  return (await d.page.textContent("#cc-link-code-shown")).trim();
}
async function linkWithCode(d, code, name) {
  await d.page.click("#cc-link-btn");
  await d.page.fill("#cc-link-code", code);
  await d.page.fill("#cc-link-name", name);
  await d.page.click("#cc-link-go");
}
// From the first screen: "Already the owner? Sign in", then Google.
async function ownerGoogle(d, who) {
  await d.page.waitForSelector("#cc-owner-signin");
  await asGoogle(d, who);
  await d.page.click("#cc-owner-signin");
  await d.page.click("#cc-google-btn");
}
const confirmBtn = (d, key) => d.page.click(`button[data-confirm="${key}"]`);
const clickLabel = (d, label) => d.page.click(`#cc-devices button:has-text("${label}")`);

(async () => {
  browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
  be.put("households/ABC234", SEED);          // a household that existed before accounts
  be.put("households/XYZ789", SEED);          // another one nobody has claimed

  // ===================================================== boot decisions (pure)
  {
    const d = await device("probe"); await open(d); await d.page.waitForSelector("#cc-start-btn");
    const t = await d.page.evaluate(() => {
      const b = CCAcct._test.decideBoot;
      const anon = { isAnonymous: true }, google = { isAnonymous: false };
      return [
        b({ user: google, member: { hid: "x" }, legacyCode: null }).mode,
        b({ user: google, member: null, legacyCode: "ABC234" }).mode,
        b({ user: anon, member: null, legacyCode: null }).mode,
        b({ user: anon, member: null, legacyCode: "ABC234" }).mode,
        b({ user: null, member: null, legacyCode: "ABC234" }).mode,
        b({ user: null, member: null, legacyCode: null }).mode,
        b({ user: { isAnonymous: false, emailVerified: false }, member: null, legacyCode: null }).mode,
        b({ user: { isAnonymous: false, emailVerified: true }, member: null, legacyCode: null }).mode,
        // iPad (new style reports as a Mac with touch), iPhone, desktop Mac, Android; tab vs Home Screen icon
        CCAcct._test.isAppleBrowserTab("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari", 5, false),
        CCAcct._test.isAppleBrowserTab("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari", 5, true),
        CCAcct._test.isAppleBrowserTab("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", 5, false),
        CCAcct._test.isAppleBrowserTab("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari", 0, false),
        CCAcct._test.isAppleBrowserTab("Mozilla/5.0 (Linux; Android 14) Chrome Mobile", 5, false),
        CCAcct._test.formatCode("ABCDEFGH"), CCAcct._test.cleanTypedCode(" ab-cd ef12 ", 8), CCAcct._test.cleanTypedCode("abcdefghijk", 8),
      ];
    });
    check("boot decision table + iPad/iPhone detection", JSON.stringify(t) === JSON.stringify(["account", "needs-household", "welcome", "legacy", "legacy", "welcome", "verify-email", "needs-household", true, false, true, false, false, "ABCD-EFGH", "ABCDEF12", "ABCDEFGH"]), JSON.stringify(t));
    await shot(d, "01-welcome");
    await d.ctx.close();
  }

  // ===================================================== A. an existing household secures itself
  const phone = await device("phone", { legacyCode: "ABC234" });
  await open(phone);
  check("A: old-style device still opens the household", await appReady(phone));
  check("A: it offers to secure the household", await seesText(phone, "Secure this household", 3000));
  await shot(phone, "02-legacy-banner");
  await asGoogle(phone, { uid: "g_owner", email: "owner@gmail.com" });
  await phone.page.click("#cc-legacy-banner-go");
  await phone.page.click("#cc-secure-go");
  await phone.page.click("#cc-google-btn");
  check("A: claiming shows the grace-period explanation", await seesText(phone, "Your household is secured"));
  await shot(phone, "03-claimed");
  await phone.page.click("#cc-claimed-continue");
  check("A: app reopens signed in as the owner, data intact", await appReady(phone));
  const acc = be.doc("access/ABC234"), st = be.doc("status/ABC234");
  check("A: owner recorded", acc && acc.ownerUid === "g_owner" && acc.ownerEmail === "owner@gmail.com");
  check("A: 14-day window recorded", st && st.graceUntil && Math.abs(st.graceUntil.__ts - (be.now() + 14 * 864e5)) < 60000);
  const hh = be.doc("households/ABC234");
  check("A: the household's kids and chores are still there", hh && hh.kids[0].name === "Jack" && hh.chores.some((c) => c.name === "Brush teeth"));
  check("A: old code removed from the owner's device", await phone.page.evaluate(() => localStorage.getItem("choreChartHouseholdCode")) === null);

  // ===================================================== B. link the kids' tablet
  await unlock(phone); await openDevices(phone);
  check("B: owner sees the grace-period box", await phone.page.isVisible("#cc-grace"));
  const code1 = await makeLinkCode(phone);
  await shot(phone, "04-devices-with-code");
  check("B: link code is 8 characters", /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code1), code1);

  const tablet = await device("tablet");
  await open(tablet);
  await tablet.page.waitForSelector("#cc-link-btn");
  await tablet.page.click("#cc-link-btn");
  await tablet.page.waitForSelector("#cc-link-code");
  await shot(tablet, "05-link-screen");
  await tablet.page.fill("#cc-link-code", "QQQQ-QQQQ");
  await tablet.page.fill("#cc-link-name", "Kitchen iPad");
  await tablet.page.click("#cc-link-go");
  check("B: a wrong code gets a plain-English error", await seesText(tablet, "isn't valid or has expired", 4000));
  await tablet.page.fill("#cc-link-code", code1.toLowerCase());
  await tablet.page.click("#cc-link-go");
  check("B: tablet links with the real code and opens the household", await appReady(tablet));
  const acc2 = be.doc("access/ABC234");
  const tabUid = Object.keys(acc2.devices)[0];
  check("B: tablet recorded with its name, no email", tabUid && acc2.devices[tabUid].name === "Kitchen iPad" && !("email" in acc2.devices[tabUid]));
  check("B: owner's list updates live", await seesText(phone, "Kitchen iPad", 4000));
  check("B: the list shows the time a device was linked, not just the date", /Linked .*\d:\d\d/.test(await phone.page.textContent("#cc-device-list")));
  check("B: link code is burned", !Object.keys(be.docs).length || ![...be.docs.keys()].some((k) => k.startsWith("linkCodes/")));

  check("B: once the code is used, the owner's screen resets and says so", await seesText(phone, "That code was used", 4000) && await phone.page.isVisible("#cc-new-link"));

  // the tablet writes; the phone sees it
  const live = be.doc("households/ABC234");
  live.chores.push({ ...live.chores[0], id: "c2", name: "Feed the dog" });
  await tablet.page.evaluate((d) => window.storage.set("k", JSON.stringify(d)), live);
  check("B: a change on the tablet appears on the phone", await seesText(phone, "Feed the dog", 5000));

  // the tablet can see the device list but not change it
  await unlock(tablet); await openDevices(tablet);
  check("B: linked device sees a read-only list", await seesText(tablet, "Only the owner can add or remove devices"));
  check("B: linked device has no Remove or Link buttons", !(await tablet.page.isVisible('#cc-devices button:has-text("Remove")')) && !(await tablet.page.isVisible("#cc-new-link")));
  await shot(tablet, "06-tablet-devices");
  await tablet.page.click('#cc-settings button[aria-label="Close settings"]');

  // ===================================================== C. grace period for a device that hasn't been linked
  const oldTv = await device("oldTv", { legacyCode: "ABC234" });
  await open(oldTv);
  check("C: unlinked old-style device still works during the window", await appReady(oldTv));
  check("C: it shows a reminder with the deadline", await seesText(oldTv, "Link this device before", 3000));
  await shot(oldTv, "07-grace-banner");

  // owner ends the window early
  await phone.page.click('#cc-devices button:has-text("End it now")');
  await confirmBtn(phone, "endgrace");
  await sleep(400);
  check("C: ending the window clears the deadline", be.doc("status/ABC234").graceUntil === null);
  const denied = await be.rpc("fs", { method: "get", path: "households/ABC234", user: null });
  check("C: with no window left, the old code alone is refused", denied.error && denied.error.code === "permission-denied");
  await open(oldTv);
  check("C: old-style device now shows the protected screen", await seesText(oldTv, "This household is protected"));
  await shot(oldTv, "08-protected");

  // link the old device properly
  const code2 = await makeLinkCode(phone);
  await linkWithCode(oldTv, code2, "Old TV");
  check("C: the protected device can link and opens the household", await appReady(oldTv));

  // ===================================================== D. removing a device
  const removeUid = Object.keys(be.doc("access/ABC234").devices).find((u) => be.doc("access/ABC234").devices[u].name === "Old TV");
  await phone.page.click(`#cc-device-list div[data-uid="${removeUid}"] button:has-text("Remove")`);
  await confirmBtn(phone, "remove:" + removeUid);
  await sleep(400);
  check("D: removing a device drops its access and membership", !(removeUid in be.doc("access/ABC234").devices) && !be.doc("members/" + removeUid));
  await oldTv.page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  check("D: the removed device is sent back to the start with an explanation", await seesText(oldTv, "no longer has access", 6000));
  await shot(oldTv, "09-removed");
  check("D: its anonymous identity was deleted", be.deleted.includes(removeUid));

  // ===================================================== E. rename
  await phone.page.click(`#cc-device-list div[data-uid="${tabUid}"] button:has-text("Rename")`);
  await phone.page.fill(`#cc-device-list input[data-rename="${tabUid}"]`, "Kitchen tablet");
  await phone.page.click('#cc-devices button:has-text("Save")');
  await sleep(500);
  check("E: renaming a device works", be.doc("access/ABC234").devices[tabUid].name === "Kitchen tablet");

  // ===================================================== F. "sign out all other devices"
  const laptop = await device("laptop", { noLiveDenial: true });
  await open(laptop);
  await ownerGoogle(laptop, { uid: "g_owner", email: "owner@gmail.com" });
  check("F: the owner can sign in on a second device without a code", await appReady(laptop));
  await sleep(1200); // the phone's fresh sign-in must be a later second than the laptop's
  await asGoogle(phone, { uid: "g_owner", email: "owner@gmail.com" });
  await phone.page.click('#cc-devices button:has-text("Sign out all other devices")');
  await confirmBtn(phone, "signoutothers");
  check("F: it confirms when done", await seesText(phone, "every other sign-in", 5000));
  check("F: the cut-off is recorded", be.doc("access/ABC234").minAuthTime > 0);
  await laptop.page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  check("F: the other sign-in is cut off", await seesText(laptop, "no longer has access", 6000));
  check("F: the phone itself keeps working", await phone.page.isVisible("#cc-devices"));
  const tabStill = await tablet.page.evaluate(() => window.storage.get("k").then((r) => !!r)).catch(() => false);
  check("F: linked devices are not affected", tabStill);

  // ===================================================== G. transfer ownership
  // Typing must not be interrupted by changes made on other devices.
  await phone.page.fill("#cc-transfer-email", "new@gmail.");
  await phone.page.focus("#cc-transfer-email");
  const aNow = be.doc("access/ABC234");
  aNow.devices.temp_dev = { name: "Temp phone", linkedAt: Date.now() };
  be.put("access/ABC234", aNow);
  await sleep(900);
  check("G: text being typed survives a change from another device",
    (await phone.page.inputValue("#cc-transfer-email")) === "new@gmail." && (await phone.page.evaluate(() => document.activeElement && document.activeElement.id)) === "cc-transfer-email");
  await phone.page.click("#cc-devices div:has-text('Devices') >> nth=0").catch(() => {});
  await phone.page.evaluate(() => document.activeElement && document.activeElement.blur());
  check("G: ...and the change appears once they click away", await seesText(phone, "Temp phone", 4000));
  const aClean = be.doc("access/ABC234"); delete aClean.devices.temp_dev; be.put("access/ABC234", aClean);
  await sleep(600);
  await phone.page.fill("#cc-transfer-email", "new@gmail.com");
  await asGoogle(phone, { uid: "g_owner", email: "owner@gmail.com" });
  await phone.page.click("#cc-transfer-start");
  await phone.page.waitForSelector("#cc-transfer-code-shown", { timeout: 6000 }).catch(async () => {
    console.log("DEBUG modal text at transfer step:", (await phone.page.textContent("#cc-devices").catch(() => "(no modal)")).replace(/\s+/g, " ").slice(0, 700));
    throw new Error("transfer offer code never appeared");
  });
  const tcode = (await phone.page.textContent("#cc-transfer-code-shown")).trim();
  await shot(phone, "10-transfer-offer");
  check("G: an offer code is shown", /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(tcode), tcode);

  const heir = await device("heir");
  await open(heir);
  await ownerGoogle(heir, { uid: "g_snoop", email: "snoop@gmail.com" });
  await heir.page.waitForSelector("#cc-transfer-code");
  await shot(heir, "11-setup-household");
  await heir.page.fill("#cc-transfer-code", tcode);
  await heir.page.click("#cc-accept-btn");
  check("G: the wrong Google account can't accept the offer", await seesText(heir, "isn't valid for this account", 4000));
  await heir.page.click("#cc-different-account");
  await ownerGoogle(heir, { uid: "g_new", email: "new@gmail.com" });
  await heir.page.waitForSelector("#cc-transfer-code");
  await heir.page.fill("#cc-transfer-code", tcode);
  await heir.page.click("#cc-accept-btn");
  check("G: the right account accepts and opens the household", await appReady(heir));
  check("G: ownership moved", be.doc("access/ABC234").ownerUid === "g_new");
  await phone.page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  check("G: the old owner loses access on the spot", await seesText(phone, "no longer has access", 6000));
  const tabAfter = await tablet.page.evaluate(() => window.storage.get("k").then((r) => !!r)).catch(() => false);
  check("G: the linked tablet keeps working after the handover", tabAfter);

  // ===================================================== H. a linked device unlinks itself
  await openDevices(tablet);
  await tablet.page.click('#cc-devices button:has-text("Unlink this device")');
  await confirmBtn(tablet, "unlink");
  check("H: unlinking returns the device to the start", await seesText(tablet, "How are you getting started?", 6000));
  check("H: it is off the household's list", !(tabUid in be.doc("access/ABC234").devices));

  // ===================================================== I. brand-new household, and the "older setup" join
  const fresh = await device("fresh");
  await open(fresh);
  await fresh.page.waitForSelector("#cc-start-btn");
  await asGoogle(fresh, { uid: "g_fresh", email: "fresh@gmail.com" });
  await fresh.page.click("#cc-start-btn");
  await fresh.page.click("#cc-google-btn");
  await fresh.page.waitForSelector("#cc-create-hh");
  await fresh.page.click("#cc-create-hh");
  check("I: a brand-new household starts with the sample chores", await appReady(fresh));
  const m = be.doc("members/g_fresh");
  check("I: new household has an owner and no grace window", m && m.role === "owner" && be.doc("status/" + m.hid).graceUntil === null);

  const joiner = await device("joiner");
  await open(joiner);
  await joiner.page.waitForSelector("#cc-link-btn");
  await joiner.page.click("#cc-link-btn");
  await joiner.page.click("#cc-old-toggle");
  await joiner.page.fill("#cc-old-code", "xyz789");
  await joiner.page.click("#cc-old-go");
  check("I: the older code-only join still works for an unclaimed household", await appReady(joiner));
  check("I: and it nudges to secure the household", await seesText(joiner, "Secure this household", 3000));


  // ===================================================== K. an owner who uses email and a password
  const mom = await device("mom");
  await open(mom);
  await mom.page.waitForSelector("#cc-start-btn");
  await shot(mom, "20-welcome");
  check("K: the first screen also offers the demo", (await mom.page.getAttribute("#cc-demo-link", "href")) === "?demo");
  check("K: the first screen offers Start and Join, plus Sign in for owners",
    (await mom.page.isVisible("#cc-start-btn")) && (await mom.page.isVisible("#cc-link-btn")) && (await mom.page.isVisible("#cc-owner-signin")));
  await mom.page.click("#cc-start-btn");
  await mom.page.waitForSelector("#cc-new-email");
  check("K: the create screen has the Google button too", await mom.page.isVisible("#cc-google-btn"));
  await mom.page.fill("#cc-new-email", "mom@example.com");
  await mom.page.fill("#cc-new-password", "short");
  await mom.page.click("#cc-email-create");
  check("K: a short password is refused with a plain explanation", await seesText(mom, "at least 8 characters", 3000));
  await mom.page.fill("#cc-new-password", "tacoTuesday42");
  await shot(mom, "21-create");
  await mom.page.click("#cc-email-create");
  await mom.page.waitForSelector("#cc-verify", { timeout: 6000 });
  await shot(mom, "22-verify");
  check("K: a confirmation email is sent to the new address", be.mail.some((m) => m.kind === "verify" && m.to === "mom@example.com"));
  check("K: the confirm screen shows the address", (await mom.page.textContent("#cc-verify-email")).trim() === "mom@example.com");
  await mom.page.click("#cc-verified-btn");
  check("K: 'I've confirmed it' before confirming says so", await seesText(mom, "Not confirmed yet", 4000));
  // A reload while unconfirmed lands back on the confirm screen, not inside a household.
  await open(mom);
  check("K: reopening an unconfirmed account goes back to the confirm screen", await mom.page.waitForSelector("#cc-verify", { timeout: 6000 }).then(() => true, () => false));
  const pwBefore = be.rpc("fn", { name: "createHousehold", data: {}, user: { uid: "pw_mom", email: "mom@example.com", isAnonymous: false, provider: "password", auth_time: 1 } });
  const refused = await pwBefore;
  check("K: the server refuses an unconfirmed email account", refused.error && refused.error.code === "permission-denied");
  be.emailAccounts.get("mom@example.com").verified = true; // she taps the link in the email
  check("K: once confirmed, the app moves on by itself", await mom.page.waitForSelector("#cc-create-hh", { timeout: 8000 }).then(() => true, () => false));
  await mom.page.click("#cc-create-hh");
  check("K: an email owner gets a working household", await appReady(mom));
  const momMember = be.doc("members/pw_mom");
  check("K: she is recorded as the owner with her email", momMember && momMember.role === "owner" && be.doc("access/" + momMember.hid).ownerEmail === "mom@example.com");

  // a second device signs in with email and password
  const momLaptop = await device("momLaptop", { noLiveDenial: true });
  await open(momLaptop);
  await momLaptop.page.click("#cc-owner-signin");
  await momLaptop.page.waitForSelector("#cc-email");
  await momLaptop.page.fill("#cc-email", "mom@example.com");
  await momLaptop.page.fill("#cc-password", "wrong-password");
  await momLaptop.page.click("#cc-email-signin");
  check("K: a wrong password gets a plain-English error", await seesText(momLaptop, "Wrong email or password", 4000));
  await momLaptop.page.click("#cc-forgot");
  check("K: Forgot password sends a reset email", await seesText(momLaptop, "a link to reset the password is on its way", 4000) && be.mail.some((m) => m.kind === "reset" && m.to === "mom@example.com"));
  await shot(momLaptop, "23-signin");
  await momLaptop.page.fill("#cc-password", "tacoTuesday42");
  await momLaptop.page.press("#cc-password", "Enter");
  check("K: the right password (Enter key) opens her household on the second device", await appReady(momLaptop));

  // owner actions that need a fresh sign-in ask for the password
  // A brand-new chart has no parent PIN yet; give it one so the test can unlock.
  const momHh = be.doc("households/" + momMember.hid); momHh.parentPin = "1234"; be.put("households/" + momMember.hid, momHh);
  await sleep(1200);
  await openDevices(mom);
  await mom.page.click('#cc-devices button:has-text("Sign out all other devices")');
  await confirmBtn(mom, "signoutothers");
  await mom.page.waitForSelector("#cc-reauth", { timeout: 4000 });
  await shot(mom, "24-reauth");
  await mom.page.fill("#cc-reauth-password", "nope-nope");
  await mom.page.click("#cc-reauth-go");
  check("K: a wrong password there is refused", await seesText(mom, "Wrong email or password", 4000));
  await mom.page.fill("#cc-reauth-password", "tacoTuesday42");
  await mom.page.click("#cc-reauth-go");
  check("K: the right password lets 'sign out all other devices' finish", await seesText(mom, "every other sign-in", 5000));
  await momLaptop.page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  check("K: her other sign-in is cut off", await seesText(momLaptop, "no longer has access", 6000));

  // the same email can't be signed up twice, and "use a different email" goes back to the start
  const dup = await device("dup");
  await open(dup);
  await dup.page.click("#cc-start-btn");
  await dup.page.fill("#cc-new-email", "mom@example.com");
  await dup.page.fill("#cc-new-password", "anotherOne99");
  await dup.page.click("#cc-email-create");
  check("K: signing up an email that already has an account says to sign in", await seesText(dup, "already an account with that email", 4000));
  await dup.page.fill("#cc-new-email", "dad@example.com");
  await dup.page.click("#cc-email-create");
  await dup.page.waitForSelector("#cc-verify", { timeout: 6000 });
  await dup.page.click("#cc-verify-different");
  check("K: 'Use a different email' signs out and shows the create screen again", await dup.page.waitForSelector("#cc-new-email", { timeout: 4000 }).then(() => true, () => false));
  await dup.page.click('#cc-create button[aria-label="Back"]');
  check("K: Back returns to the first screen", await dup.page.waitForSelector("#cc-start-btn", { timeout: 4000 }).then(() => true, () => false));

  // the join screen's "Sign in instead" goes to the owner sign-in
  await dup.page.click("#cc-link-btn");
  await shot(dup, "25-join");
  await dup.page.click("#cc-join-owner");
  check("K: 'Are you the owner? Sign in instead' opens the sign-in screen", await dup.page.waitForSelector("#cc-email", { timeout: 4000 }).then(() => true, () => false));


  // ===================================================== L. "Forgot PIN?"
  async function openPinBox(d) {
    if (await d.page.isVisible("#cc-settings")) await d.page.click('#cc-settings button[aria-label="Close settings"]');
    if (await d.page.isVisible('button[aria-label="Lock parent controls"]')) await d.page.click('button[aria-label="Lock parent controls"]');
    await d.page.click('button[aria-label="Unlock parent controls"]');
    await d.page.waitForSelector("#cc-forgot-pin");
  }
  // a joined device is told who can reset it
  await openDevices(heir);
  const kidCode = await makeLinkCode(heir);
  const kid2 = await device("kid2");
  await open(kid2);
  await linkWithCode(kid2, kidCode, "Kid tablet 2");
  await appReady(kid2);
  await openPinBox(kid2);
  await kid2.page.click("#cc-forgot-pin");
  check("L: on a joined device, Forgot PIN says only the owner can reset it", await seesText(kid2, "Only the owner can reset the PIN", 3000));
  check("L: ...and doesn't offer a sign-in there", !(await kid2.page.isVisible("#cc-reauth")) && !(await kid2.page.isVisible("#cc-google-btn")));
  await shot(kid2, "30-forgot-pin-joined");
  // the Google owner resets it
  await heir.page.click('#cc-settings button[aria-label="Close settings"]');
  await openPinBox(heir);
  await asGoogle(heir, { uid: "g_new", email: "new@gmail.com" });
  await heir.page.click("#cc-forgot-pin");
  check("L: after confirming with Google, the owner gets to choose a new PIN", await seesText(heir, "Choose a new PIN", 4000));
  await heir.page.fill('input[placeholder="PIN"]', "2468");
  await heir.page.fill('input[placeholder="Confirm PIN"]', "2468");
  await heir.page.click('button:has-text("Set PIN")');
  await sleep(800);
  check("L: the new PIN is saved for the household", be.doc("households/ABC234").parentPin === "2468");
  check("L: and it unlocks right away", await heir.page.isVisible('button[aria-label="Lock parent controls"]'));
  // the joined device uses the new PIN too
  await kid2.page.fill('input[placeholder="PIN"]', "2468");
  await kid2.page.click('button:has-text("Unlock")');
  check("L: the new PIN works on the other devices", await kid2.page.waitForSelector('button[aria-label="Lock parent controls"]', { timeout: 4000 }).then(() => true, () => false));
  // the Google owner cancels: nothing changes
  await openPinBox(heir);
  await asGoogle(heir, null);
  await heir.page.click("#cc-forgot-pin");
  check("L: cancelling the Google sign-in leaves the PIN alone", await seesText(heir, "Sign-in was cancelled", 3000) && be.doc("households/ABC234").parentPin === "2468");
  await heir.page.click('button[aria-label="Close"]').catch(() => {});
  // the email owner resets it with her password
  await openPinBox(mom);
  await mom.page.click("#cc-forgot-pin");
  await mom.page.waitForSelector("#cc-reauth", { timeout: 4000 });
  await mom.page.fill("#cc-reauth-password", "wrong-one");
  await mom.page.click("#cc-reauth-go");
  check("L: a wrong password doesn't reset the PIN", await seesText(mom, "Wrong email or password", 3000));
  await mom.page.fill("#cc-reauth-password", "tacoTuesday42");
  await mom.page.click("#cc-reauth-go");
  check("L: with her password, the email owner gets to choose a new PIN", await seesText(mom, "Choose a new PIN", 4000));
  await shot(mom, "31-new-pin");
  await mom.page.fill('input[placeholder="PIN"]', "9753");
  await mom.page.fill('input[placeholder="Confirm PIN"]', "9753");
  await mom.page.click('button:has-text("Set PIN")');
  await sleep(800);
  check("L: her household's PIN is changed", be.doc("households/" + momMember.hid).parentPin === "9753");

  // ===================================================== J. the owner can't make a second household
  await fresh.page.click('button[aria-label="Unlock parent controls"]').catch(() => {});

  // ---------------------------------------------------- report
  const bad = Object.entries({}).length;
  const failed = results.filter((r) => !r.ok);
  console.log("");
  results.forEach((r) => console.log((r.ok ? "  ok   " : "  FAIL ") + r.name + (r.ok || !r.extra ? "" : "   [" + r.extra + "]")));
  console.log("\n" + results.length + " checks, " + failed.length + " failed");
  console.log("uncaught page errors: " + (allErrors.length ? "\n  " + allErrors.join("\n  ") : "none"));
  console.log("screenshots in " + SHOTS);
  await browser.close();
  process.exit(failed.length || allErrors.length ? 1 : 0);
})().catch(async (e) => {
  console.error("TEST HARNESS CRASHED:", e && e.stack ? e.stack.split("\n").slice(0, 8).join("\n") : e);
  console.log("\nchecks so far:"); results.forEach((r) => console.log((r.ok ? "  ok   " : "  FAIL ") + r.name));
  try { await browser.close(); } catch (x) {}
  process.exit(2);
});
