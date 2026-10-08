// ===========================================================================
// Accounts for The Chore Chart (client side).
//
//   * A parent signs in (Google, or email and password) and owns the household.
//     Email accounts must confirm their address before they can own one.
//   * Other devices (the kids' tablet) link with a one-time code. They have
//     no email: Firebase just gives them an anonymous identity, and the
//     server function adds that identity to the household's device list.
//   * Households that existed before accounts keep working the old way (just
//     the household code) until claimed, and for 14 days after.
//
// Everything is plain JavaScript on purpose (no `?.`, no `??`) so it also
// runs on older tablets. All state lives inside this closure; the rest of the
// page talks to it through window.CCAcct and window.CCAccount.
// ===========================================================================
(function () {
  var S = { db: null, auth: null, fns: null, session: null };
  var NOTICE_KEY = "cc-notice";
  var SESSION_KEY = "cc-session";

  var FONT = "'Nunito',-apple-system,BlinkMacSystemFont,sans-serif";
  var HEAD_FONT = "'Baloo 2',system-ui,sans-serif";
  var GRADIENT = "linear-gradient(135deg,#FF6B9D,#7B61FF)";

  // ------------------------------------------------------------------ pure helpers
  // Which screen should this device be looking at? (unit-tested)
  function decideBoot(i) {
    if (i.user && i.member) return { mode: "account" };
    if (i.user && !i.user.isAnonymous) return i.user.emailVerified === false ? { mode: "verify-email" } : { mode: "needs-household" };
    if (i.user && i.user.isAnonymous) return i.legacyCode ? { mode: "legacy" } : { mode: "welcome" };
    if (i.legacyCode) return { mode: "legacy" };
    return { mode: "welcome" };
  }
  function cleanTypedCode(raw, len) {
    return String(raw == null ? "" : raw).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, len);
  }
  function formatCode(c) {
    c = String(c || "");
    return c.length === 8 ? c.slice(0, 4) + "-" + c.slice(4) : c;
  }
  function guessDeviceName() {
    var ua = (typeof navigator !== "undefined" && navigator.userAgent) || "";
    var touch = (typeof navigator !== "undefined" && navigator.maxTouchPoints) || 0;
    if (/iPad/.test(ua) || (/Macintosh/.test(ua) && touch > 1)) return "iPad";
    if (/iPhone/.test(ua)) return "iPhone";
    if (/Android/.test(ua)) return /Mobile/.test(ua) ? "Android phone" : "Android tablet";
    if (/Windows/.test(ua)) return "Windows computer";
    if (/CrOS/.test(ua)) return "Chromebook";
    if (/Macintosh/.test(ua)) return "Mac";
    return "This device";
  }
  function tsMs(v) {
    if (!v) return null;
    if (typeof v.toMillis === "function") return v.toMillis();
    return typeof v === "number" ? v : null;
  }
  function fmtDate(ms) {
    return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  function fmtDateTime(ms) {
    return new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }
  // iPhone/iPad in the browser (not opened from a Home Screen icon). On those,
  // the browser and the Home Screen icon keep completely separate data, so a
  // device linked in the browser is NOT linked when opened from the icon.
  function isAppleBrowserTab(ua, touchPoints, standalone) {
    var apple = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1);
    return apple && !standalone;
  }
  function currentlyAppleBrowserTab() {
    var standalone = false;
    try {
      standalone = navigator.standalone === true || (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
    } catch (e) {}
    return isAppleBrowserTab((navigator && navigator.userAgent) || "", (navigator && navigator.maxTouchPoints) || 0, standalone);
  }
  function homeScreenTip() {
    return h("div", { id: "cc-homescreen-tip", style: "background:#EEF4FF;border:2px solid #C9DAFF;color:#24427A;border-radius:12px;padding:10px 12px;font-size:12.5px;font-weight:700;line-height:1.5;margin-bottom:14px;" }, [
      "Using this as an app on your iPad or iPhone? Add it to your Home Screen first (Share button, then \u201cAdd to Home Screen\u201d), open it from that icon, and sign in or join from there. The browser and the icon are kept separate, so doing it here won't carry over.",
    ]);
  }
  function fmtCountdown(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    return Math.floor(s / 60) + ":" + (s % 60 < 10 ? "0" : "") + (s % 60);
  }
  function friendlyError(e) {
    var code = (e && e.code) || "";
    var msg = (e && e.message) || "";
    if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return "Sign-in was cancelled.";
    if (code === "auth/popup-blocked") return "The sign-in window was blocked. Allow pop-ups for this site and try again.";
    if (code === "auth/unauthorized-domain") return "This web address isn't authorized for Google sign-in yet (Firebase, Authentication, Settings, Authorized domains).";
    if (code === "auth/operation-not-allowed") return "That sign-in method isn't turned on in Firebase yet (Authentication, Sign-in method).";
    if (code === "auth/invalid-email") return "That doesn't look like an email address.";
    if (code === "auth/invalid-credential" || code === "auth/invalid-login-credentials" || code === "auth/wrong-password" || code === "auth/user-not-found")
      return "Wrong email or password. If you set up with Google, use Continue with Google instead.";
    if (code === "auth/missing-password") return "Type your password.";
    if (code === "auth/email-already-in-use") return "There's already an account with that email. Sign in instead, or use Continue with Google if that's how you set it up.";
    if (code === "auth/weak-password") return "Use a password with at least 8 characters.";
    if (code === "auth/too-many-requests") return "Too many tries. Wait a few minutes and try again.";
    if (code === "auth/account-exists-with-different-credential") return "That email already has an account with a password. Sign in with your email and password instead.";
    if (code === "auth/user-disabled") return "This account has been turned off.";
    if (code === "auth/network-request-failed" || code === "unavailable" || code === "functions/unavailable") return "Couldn't reach the server. Check the connection and try again.";
    return msg || "Something went wrong. Please try again.";
  }

  // ------------------------------------------------------------------ tiny DOM kit
  function h(tag, props, kids) {
    var el = document.createElement(tag);
    props = props || {};
    Object.keys(props).forEach(function (k) {
      if (k === "style") el.style.cssText = props[k];
      else if (k === "text") el.textContent = props[k];
      else if (k.slice(0, 2) === "on") el[k.toLowerCase()] = props[k];
      else el.setAttribute(k, props[k]);
    });
    (kids || []).forEach(function (c) {
      if (c != null) el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return el;
  }
  function openOverlay(kind) {
    if (kind === "setup") {
      // Sign-in and setup screens: a full white page with one centered column.
      var page = h("div", { role: "dialog", "aria-modal": "true",
        style: "position:fixed;top:0;left:0;right:0;bottom:0;z-index:99999;background:#fff;overflow-y:auto;-webkit-overflow-scrolling:touch;font-family:" + FONT + ";color:#2B2250;" });
      var col = h("div", { style: "max-width:420px;min-height:100%;margin:0 auto;box-sizing:border-box;display:flex;flex-direction:column;" +
        "padding:28px 24px 28px;padding-top:max(28px, env(safe-area-inset-top));padding-bottom:max(28px, env(safe-area-inset-bottom));" });
      page.appendChild(col);
      document.body.appendChild(page);
      return { root: page, card: col, close: function () { if (page.parentNode) page.parentNode.removeChild(page); } };
    }
    var root = h("div", {
      style: "position:fixed;top:0;left:0;right:0;bottom:0;z-index:99999;display:flex;align-items:center;justify-content:center;" +
        "padding:20px;box-sizing:border-box;font-family:" + FONT + ";background:" + (kind === "setup" ? GRADIENT : "rgba(43,34,80,0.45)") + ";",
    });
    var card = h("div", {
      style: "background:#fff;border-radius:22px;padding:26px;max-width:400px;width:100%;box-shadow:0 20px 50px rgba(0,0,0,0.3);" +
        "box-sizing:border-box;max-height:92vh;overflow-y:auto;font-family:" + FONT + ";color:#2B2250;",
    });
    root.appendChild(card);
    document.body.appendChild(root);
    return { root: root, card: card, close: function () { if (root.parentNode) root.parentNode.removeChild(root); } };
  }
  function title(text) { return h("div", { text: text, style: "font-family:" + HEAD_FONT + ";font-size:24px;font-weight:800;color:#2B2250;text-align:center;margin-bottom:4px;" }); }
  function sub(text) { return h("div", { text: text, style: "font-size:13px;color:#8A82C0;font-weight:600;text-align:center;margin-bottom:18px;line-height:1.5;" }); }
  function para(text, extra) { return h("div", { text: text, style: "font-size:13px;color:#5D5490;font-weight:600;line-height:1.55;" + (extra || "") }); }
  function primaryBtn(text, onClick) {
    return h("button", { type: "button", text: text, onClick: onClick, style: "width:100%;min-height:50px;padding:12px 16px;border:none;border-radius:999px;background:" + GRADIENT + ";color:#fff;font-weight:800;font-size:16px;box-shadow:0 8px 20px rgba(123,97,255,0.22);cursor:pointer;font-family:inherit;margin-top:10px;" });
  }
  function secondaryBtn(text, onClick) {
    return h("button", { type: "button", text: text, onClick: onClick, style: "width:100%;min-height:48px;padding:11px 16px;border:2px solid #E2DBFA;border-radius:999px;background:#fff;color:#5B45E0;font-weight:800;font-size:15px;cursor:pointer;font-family:inherit;margin-top:10px;" });
  }
  function smallBtn(text, onClick, danger) {
    return h("button", { type: "button", text: text, onClick: onClick, style: "padding:7px 12px;border:2px solid " + (danger ? "#F5B7B1" : "#E2DBFA") + ";border-radius:10px;background:#fff;color:" + (danger ? "#C0392B" : "#5D5490") + ";font-weight:700;font-size:12.5px;cursor:pointer;font-family:inherit;" });
  }
  function textLink(text, onClick) {
    return h("button", { type: "button", text: text, onClick: onClick, style: "display:block;margin:14px auto 0;border:none;background:none;color:#8A82C0;font-weight:700;font-size:12.5px;cursor:pointer;font-family:inherit;text-decoration:underline;" });
  }
  function textInput(placeholder, maxlen, value, big) {
    return h("input", {
      placeholder: placeholder, maxlength: String(maxlen), value: value || "", autocomplete: "off", autocapitalize: big ? "characters" : "words", spellcheck: "false",
      style: "width:100%;box-sizing:border-box;padding:12px;border-radius:12px;border:2px solid #E2DBFA;font-size:" + (big ? "18px" : "15px") + ";font-weight:700;color:#2B2250;font-family:inherit;" +
        (big ? "text-align:center;letter-spacing:3px;text-transform:uppercase;" : ""),
    });
  }
  function errorLine() {
    var el = h("div", { role: "alert", style: "font-size:12.5px;color:#C0392B;font-weight:700;margin-top:12px;text-align:center;display:none;line-height:1.45;" });
    el.show = function (m) { el.textContent = m; el.style.display = "block"; };
    el.clear = function () { el.textContent = ""; el.style.display = "none"; };
    return el;
  }
  // Runs fn when the button is clicked. fn is called synchronously, which
  // matters: browsers only allow a sign-in pop-up straight from a tap.
  function withBusy(btn, err, fn) {
    return function () {
      if (btn.disabled) return;
      var label = btn.textContent;
      btn.disabled = true;
      btn.textContent = "Working\u2026";
      btn.style.opacity = "0.7";
      err.clear();
      var p;
      try { p = fn(); } catch (e) { p = Promise.reject(e); }
      Promise.resolve(p)
        .catch(function (e) { err.show(friendlyError(e)); })
        .then(function () { btn.disabled = false; btn.textContent = label; btn.style.opacity = "1"; });
    };
  }
  function toast(text) {
    var t = h("div", { text: text, role: "status", style: "position:fixed;top:16px;left:50%;-webkit-transform:translateX(-50%);transform:translateX(-50%);z-index:99998;background:#2B2250;color:#fff;font:700 13px " + FONT + ";padding:10px 16px;border-radius:999px;box-shadow:0 8px 24px rgba(0,0,0,0.3);max-width:90%;text-align:center;" });
    document.body.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 6000);
  }

  // ------------------------------------------------------------------ firebase wrappers
  function call(name, data) {
    return S.fns.httpsCallable(name)(data || {}).then(function (r) { return r.data; });
  }
  function signInGoogle() {
    var p = new firebase.auth.GoogleAuthProvider();
    if (p.setCustomParameters) p.setCustomParameters({ prompt: "select_account" });
    return S.auth.signInWithPopup(p);
  }
  // Asks an email-account owner to type their password again. Resolves once
  // Firebase accepts it; rejects with "Cancelled." if they back out.
  function passwordAgain(u) {
    return new Promise(function (resolve, reject) {
      var ov = openOverlay("dim");
      ov.card.id = "cc-reauth";
      var err = errorLine();
      ov.card.appendChild(title("Confirm it's you"));
      ov.card.appendChild(sub("Type the password for " + ((u && u.email) || "your account") + "."));
      var pw = passwordField("cc-reauth-password", "current-password");
      ov.card.appendChild(pw.wrap);
      var go = primaryBtn("Confirm", null);
      go.id = "cc-reauth-go";
      go.style.marginTop = "14px";
      go.onclick = withBusy(go, err, function () {
        if (!pw.input.value) throw { message: "Type your password." };
        var cred = firebase.auth.EmailAuthProvider.credential(u.email, pw.input.value);
        return u.reauthenticateWithCredential(cred).then(function () { ov.close(); resolve(); });
      });
      submitOnEnter([pw.input], go);
      ov.card.appendChild(go);
      ov.card.appendChild(err);
      ov.card.appendChild(textLink("Cancel", function () { ov.close(); reject({ message: "Cancelled." }); }));
      setTimeout(function () { try { pw.input.focus(); } catch (e) {} }, 50);
    });
  }
  // The owner proves it's them again: Google opens its pop-up (so this must
  // be called straight from a tap), an email account types its password.
  // Used by Devices (sign out others, transfer) and by "Forgot PIN?".
  function confirmOwnerIdentity() {
    var s = S.session;
    var u = S.auth && S.auth.currentUser;
    if (!s || s.mode !== "account" || s.role !== "owner" || !u) return Promise.reject({ message: "Only the owner can do that." });
    var viaGoogle = (u.providerData || []).some(function (p) { return p && p.providerId === "google.com"; });
    if (viaGoogle) {
      return signInGoogle().then(function (r) {
        if (r.user.uid !== s.user.uid) { window.location.reload(); throw { message: "That's a different Google account." }; }
        return S.auth.currentUser.getIdToken(true);
      });
    }
    return passwordAgain(u).then(function () { return S.auth.currentUser.getIdToken(true); });
  }
  function ensureAnonymous() {
    if (S.auth.currentUser) return Promise.resolve(S.auth.currentUser);
    return S.auth.signInAnonymously().then(function (r) { return r.user; });
  }
  function restoredUser() {
    return new Promise(function (resolve) {
      var off = S.auth.onAuthStateChanged(function (u) { off(); resolve(u); });
    });
  }
  function readMember(uid) {
    return S.db.collection("members").doc(uid).get().then(function (s) { return s.exists ? s.data() : null; });
  }
  function readStatus(code) {
    return S.db.collection("status").doc(code).get().then(function (s) {
      if (!s.exists) return { claimed: false, graceActive: false };
      var d = s.data();
      var until = tsMs(d.graceUntil);
      return { claimed: !!d.claimed, graceUntil: until, graceActive: until != null && until > Date.now() };
    }).catch(function () { return null; }); // unknown (offline): carry on, the app shows its own error if it must
  }
  function clearStoredCode() {
    try { localStorage.removeItem(HOUSEHOLD_CODE_KEY); } catch (e) {}
  }
  function takeNotice() {
    try {
      var n = sessionStorage.getItem(NOTICE_KEY);
      if (n) sessionStorage.removeItem(NOTICE_KEY);
      return n;
    } catch (e) { return null; }
  }

  // ------------------------------------------------------------------ screens
  function noticeBox(text) {
    return h("div", { text: text, style: "background:#FFF7E6;border:2px solid #FFD98A;color:#7A5200;border-radius:12px;padding:10px 12px;font-size:12.5px;font-weight:700;line-height:1.5;margin-bottom:14px;" });
  }
  function goodNote() {
    var el = h("div", { role: "status", style: "display:none;background:#E8F8EF;color:#1E7B4B;border-radius:12px;padding:10px 12px;font-size:13px;font-weight:700;line-height:1.5;margin-top:12px;" });
    el.show = function (m) { el.textContent = m; el.style.display = "block"; };
    el.clear = function () { el.textContent = ""; el.style.display = "none"; };
    return el;
  }

  // ---- building blocks for the full-page sign-in screens
  var G_LOGO = '<svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true" style="flex:none;"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';
  var ICON_CHECK = '<svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  var ICON_PLUS = '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
  var ICON_PEOPLE = '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.2"/><path d="M3 19.5c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M16.5 14c2.6.2 4.5 2.1 4.5 4.8"/></svg>';
  var ICON_CHEVRON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#A79ED1" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex:none;"><path d="M9 5l7 7-7 7"/></svg>';
  var ICON_BACK = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
  var ICON_EYE = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  var ICON_EYE_OFF = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 5.1A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2"/><path d="M6.6 6.6C3.7 8.5 2 12 2 12s3.5 7 10 7c1.9 0 3.5-.6 4.9-1.4"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
  var ICON_MAIL = '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M3 6.5l9 6.5 9-6.5"/></svg>';

  function withHtml(el, html) { el.innerHTML = html; return el; }
  function logoBlock() {
    return h("div", { style: "display:flex;flex-direction:column;align-items:center;text-align:center;" }, [
      withHtml(h("div", { style: "width:72px;height:72px;border-radius:22px;background:" + GRADIENT + ";display:flex;align-items:center;justify-content:center;box-shadow:0 10px 24px rgba(123,97,255,0.28);" }), ICON_CHECK),
      h("h1", { text: "The Chore Chart", style: "margin:18px 0 0;font-family:" + HEAD_FONT + ";font-size:32px;font-weight:800;line-height:1.1;color:#2B2250;" }),
      h("p", { text: "Chores and rewards for the whole family", style: "margin:6px 0 0;font-size:15px;font-weight:700;color:#6F66AD;" }),
    ]);
  }
  function pageTitle(text, center) {
    return h("h1", { text: text, style: "margin:14px 0 0;font-family:" + HEAD_FONT + ";font-size:30px;font-weight:800;line-height:1.1;color:#2B2250;" + (center ? "text-align:center;" : "") });
  }
  function pageSub(text, center) {
    return h("p", { text: text, style: "margin:8px 0 0;font-size:15px;font-weight:700;color:#6F66AD;line-height:1.45;" + (center ? "text-align:center;" : "") });
  }
  function backBtn(onClick) {
    return withHtml(h("button", { type: "button", "aria-label": "Back", onClick: onClick, style: "align-self:flex-start;margin-left:-12px;width:44px;height:44px;border:none;background:none;display:flex;align-items:center;justify-content:center;color:#5D5490;cursor:pointer;padding:0;" }), ICON_BACK);
  }
  function googleBtn(label) {
    var b = withHtml(h("button", { type: "button", id: "cc-google-btn", style: "height:48px;width:100%;display:flex;align-items:center;justify-content:center;gap:12px;background:#fff;border:1px solid #747775;border-radius:999px;font-family:'Roboto',Arial,sans-serif;font-size:15px;font-weight:500;color:#1F1F1F;cursor:pointer;padding:0 16px;" }), G_LOGO);
    b.appendChild(document.createTextNode(label));
    return b;
  }
  function orDivider() {
    return h("div", { style: "display:flex;align-items:center;gap:12px;margin:18px 0 4px;" }, [
      h("div", { style: "flex:1;height:1px;background:#E2DBFA;" }),
      h("span", { text: "or use email", style: "font-size:13px;font-weight:700;color:#6F66AD;" }),
      h("div", { style: "flex:1;height:1px;background:#E2DBFA;" }),
    ]);
  }
  var FIELD_STYLE = "width:100%;box-sizing:border-box;height:48px;padding:0 16px;border:2px solid #E2DBFA;border-radius:14px;font-family:inherit;font-size:16px;font-weight:600;color:#2B2250;background:#fff;";
  function fieldLabel(text, forId) {
    return h("label", { for: forId, text: text, style: "display:block;font-size:14px;font-weight:800;color:#2B2250;margin:14px 0 6px;" });
  }
  function emailField(id) {
    return h("input", { id: id, type: "email", autocomplete: "email", autocapitalize: "none", spellcheck: "false", placeholder: "you@example.com", style: FIELD_STYLE });
  }
  // A password box with a show/hide eye. Unlike the parent PIN, password
  // managers are welcome to fill this one.
  function passwordField(id, kind) {
    var input = h("input", { id: id, type: "password", autocomplete: kind, autocapitalize: "none", spellcheck: "false", style: FIELD_STYLE + "padding-right:52px;" });
    var eye = withHtml(h("button", { type: "button", "aria-label": "Show password", style: "position:absolute;right:2px;top:2px;width:44px;height:44px;border:none;background:none;display:flex;align-items:center;justify-content:center;color:#6F66AD;cursor:pointer;padding:0;" }), ICON_EYE);
    eye.onclick = function () {
      var showing = input.type === "text";
      input.type = showing ? "password" : "text";
      eye.innerHTML = showing ? ICON_EYE : ICON_EYE_OFF;
      eye.setAttribute("aria-label", showing ? "Show password" : "Hide password");
    };
    return { wrap: h("div", { style: "position:relative;" }, [input, eye]), input: input };
  }
  function submitOnEnter(inputs, btn) {
    inputs.forEach(function (i) { i.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); btn.click(); } }); });
  }
  function linkLine(prefix, label, onClick, id) {
    var a = h("button", { type: "button", text: label, onClick: onClick, style: "border:none;background:none;padding:0;color:#5B45E0;font:inherit;font-weight:800;cursor:pointer;" });
    if (id) a.id = id;
    return h("p", { style: "margin:0;padding-top:24px;text-align:center;font-size:14.5px;font-weight:700;color:#6F66AD;" }, [prefix + " ", a]);
  }
  function spacer() { return h("div", { style: "flex:1;min-height:12px;" }); }
  function choiceCard(id, iconHtml, iconStyle, heading, desc, onClick) {
    var b = h("button", { type: "button", id: id, onClick: onClick, style: "width:100%;min-height:118px;padding:18px;border:2px solid #E2DBFA;border-radius:24px;background:#fff;display:flex;align-items:center;gap:16px;text-align:left;box-shadow:0 6px 18px rgba(43,34,80,0.06);cursor:pointer;font-family:inherit;" });
    b.appendChild(withHtml(h("span", { style: "flex:none;width:58px;height:58px;border-radius:18px;display:flex;align-items:center;justify-content:center;" + iconStyle }), iconHtml));
    b.appendChild(h("span", { style: "flex:1;display:flex;flex-direction:column;gap:4px;" }, [
      h("span", { text: heading, style: "font-family:" + HEAD_FONT + ";font-size:21px;font-weight:800;color:#2B2250;line-height:1.15;" }),
      h("span", { text: desc, style: "font-size:14px;font-weight:700;color:#5D5490;line-height:1.4;" }),
    ]));
    b.appendChild(withHtml(h("span", { style: "display:flex;" }), ICON_CHEVRON));
    return b;
  }
  function looksLikeEmail(v) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v || "").trim()); }
  // Links in emails bring people back to the app. If Firebase doesn't know
  // this web address yet, send the email without the link back rather than fail.
  function withReturnLink(send) {
    var url = location.origin + location.pathname;
    return send({ url: url }).catch(function (e) {
      var c = (e && e.code) || "";
      if (c === "auth/unauthorized-continue-uri" || c === "auth/invalid-continue-uri" || c === "auth/missing-continue-uri") return send(undefined);
      throw e;
    });
  }
  function sendVerification(user) {
    return withReturnLink(function (s) { return s ? user.sendEmailVerification(s) : user.sendEmailVerification(); });
  }

  // ---- 1. The first screen: start a new chart, or join one.
  function welcomeScreen(message) {
    return new Promise(function (resolve) {
      var ov = openOverlay("setup");
      ov.card.id = "cc-welcome";
      if (message) ov.card.appendChild(noticeBox(message));
      ov.card.appendChild(logoBlock());
      ov.card.appendChild(h("h2", { text: "How are you getting started?", style: "margin:40px 0 16px;text-align:center;font-family:" + HEAD_FONT + ";font-size:22px;font-weight:800;color:#2B2250;" }));
      if (currentlyAppleBrowserTab()) ov.card.appendChild(homeScreenTip());
      function again() { return welcomeScreen(message).then(resolve); }
      function owner(which) {
        ov.close();
        ownerAuth(which).then(function (r) { if (r === "done") resolve(); else again(); });
      }
      ov.card.appendChild(choiceCard("cc-start-btn", ICON_PLUS, "background:" + GRADIENT + ";color:#fff;", "Start a new chart", "Sign in with Google or email. You'll be the owner.", function () { owner("create"); }));
      ov.card.appendChild(h("div", { style: "height:14px;" }));
      ov.card.appendChild(choiceCard("cc-link-btn", ICON_PEOPLE, "background:#EDE8FF;color:#6A4FF0;", "Join a family's chart", "Use a code from the owner. No email needed.", function () {
        ov.close();
        linkScreen({ allowOld: true }).then(function (r) {
          if (r === "linked" || r === "legacy") resolve();
          else if (r === "owner") ownerAuth("signin").then(function (r2) { if (r2 === "done") resolve(); else again(); });
          else again();
        });
      }));
      ov.card.appendChild(spacer());
      ov.card.appendChild(linkLine("Already the owner?", "Sign in", function () { owner("signin"); }, "cc-owner-signin"));
    });
  }

  // ---- 2. Owner sign-in (Google or email), then a confirmed email if needed.
  // Resolves "done" once signed in, or "back".
  function ownerAuth(which) {
    var screen = which === "create" ? createAccountScreen : signInScreen;
    return screen().then(function (r) {
      if (r === "back") return "back";
      if (r === "create" || r === "signin") return ownerAuth(r);
      return ensureVerified().then(function (ok) { return ok ? "done" : ownerAuth(which); });
    });
  }
  function needsVerifying(u) { return !!(u && !u.isAnonymous && u.emailVerified === false); }
  function ensureVerified() {
    var u = S.auth.currentUser;
    if (!needsVerifying(u)) return Promise.resolve(true);
    return verifyEmailScreen(u).then(function (r) {
      if (r === "verified") return true;
      return S.auth.signOut().catch(function () {}).then(function () { return false; });
    });
  }

  function signInScreen() {
    return new Promise(function (resolve) {
      var ov = openOverlay("setup");
      ov.card.id = "cc-signin";
      var err = errorLine();
      var note = goodNote();
      function done(r) { ov.close(); resolve(r); }
      ov.card.appendChild(backBtn(function () { done("back"); }));
      ov.card.appendChild(pageTitle("Welcome back"));
      ov.card.appendChild(pageSub("Sign in to your family's chart."));
      ov.card.appendChild(h("div", { style: "height:22px;" }));
      var google = googleBtn("Continue with Google");
      google.onclick = withBusy(google, err, function () { return signInGoogle().then(function () { done("authed"); }); });
      ov.card.appendChild(google);
      ov.card.appendChild(orDivider());
      var email = emailField("cc-email");
      var pw = passwordField("cc-password", "current-password");
      var forgot = h("button", { type: "button", id: "cc-forgot", text: "Forgot password?", style: "border:none;background:none;padding:0;color:#5B45E0;font:inherit;font-size:13px;font-weight:700;cursor:pointer;" });
      ov.card.appendChild(fieldLabel("Email", "cc-email"));
      ov.card.appendChild(email);
      ov.card.appendChild(h("div", { style: "display:flex;align-items:baseline;justify-content:space-between;margin:14px 0 6px;" }, [
        h("label", { for: "cc-password", text: "Password", style: "font-size:14px;font-weight:800;color:#2B2250;" }), forgot,
      ]));
      ov.card.appendChild(pw.wrap);
      var go = primaryBtn("Sign in", null);
      go.id = "cc-email-signin";
      go.style.marginTop = "18px";
      go.onclick = withBusy(go, err, function () {
        note.clear();
        if (!looksLikeEmail(email.value)) throw { message: "Type your email address." };
        if (!pw.input.value) throw { message: "Type your password." };
        return S.auth.signInWithEmailAndPassword(email.value.trim(), pw.input.value).then(function () { done("authed"); });
      });
      forgot.onclick = withBusy(forgot, err, function () {
        note.clear();
        if (!looksLikeEmail(email.value)) throw { message: "Type your email address above first, then tap Forgot password." };
        var addr = email.value.trim();
        return withReturnLink(function (s) { return s ? S.auth.sendPasswordResetEmail(addr, s) : S.auth.sendPasswordResetEmail(addr); })
          .catch(function (e) { if (!(e && e.code === "auth/user-not-found")) throw e; })
          .then(function () { note.show("If there's an account for " + addr + ", a link to reset the password is on its way. Check spam too."); });
      });
      submitOnEnter([email, pw.input], go);
      [email, pw.input].forEach(function (i) { i.addEventListener("input", function () { err.clear(); }); });
      ov.card.appendChild(go);
      ov.card.appendChild(err);
      ov.card.appendChild(note);
      ov.card.appendChild(spacer());
      ov.card.appendChild(linkLine("New here?", "Create an account", function () { done("create"); }, "cc-to-create"));
    });
  }

  function createAccountScreen() {
    return new Promise(function (resolve) {
      var ov = openOverlay("setup");
      ov.card.id = "cc-create";
      var err = errorLine();
      function done(r) { ov.close(); resolve(r); }
      ov.card.appendChild(backBtn(function () { done("back"); }));
      ov.card.appendChild(pageTitle("Create your account"));
      ov.card.appendChild(pageSub("You'll own your family's chart. Other devices join it later with a code, so they never need an email."));
      ov.card.appendChild(h("div", { style: "height:22px;" }));
      var google = googleBtn("Sign up with Google");
      google.onclick = withBusy(google, err, function () { return signInGoogle().then(function () { done("authed"); }); });
      ov.card.appendChild(google);
      ov.card.appendChild(orDivider());
      var email = emailField("cc-new-email");
      var pw = passwordField("cc-new-password", "new-password");
      var hint = h("div", { id: "cc-pw-hint", text: "At least 8 characters", style: "margin-top:8px;font-size:13px;font-weight:700;color:#6F66AD;" });
      pw.input.addEventListener("input", function () {
        var ok = pw.input.value.length >= 8;
        hint.textContent = (ok ? "✓ " : "") + "At least 8 characters";
        hint.style.color = ok ? "#2E7D5B" : "#6F66AD";
      });
      ov.card.appendChild(fieldLabel("Email", "cc-new-email"));
      ov.card.appendChild(email);
      ov.card.appendChild(fieldLabel("Choose a password", "cc-new-password"));
      ov.card.appendChild(pw.wrap);
      ov.card.appendChild(hint);
      var go = primaryBtn("Create account", null);
      go.id = "cc-email-create";
      go.style.marginTop = "18px";
      go.onclick = withBusy(go, err, function () {
        if (!looksLikeEmail(email.value)) throw { message: "Type your email address." };
        if (pw.input.value.length < 8) throw { message: "Use a password with at least 8 characters." };
        return S.auth.createUserWithEmailAndPassword(email.value.trim(), pw.input.value).then(function (cred) {
          // If the email doesn't go out now, the next screen has a "send it again" button.
          return sendVerification(cred.user).catch(function () {}).then(function () { done("authed"); });
        });
      });
      submitOnEnter([email, pw.input], go);
      [email, pw.input].forEach(function (i) { i.addEventListener("input", function () { err.clear(); }); });
      ov.card.appendChild(go);
      ov.card.appendChild(h("p", { text: "We'll email you a link to confirm it's really your address.", style: "margin:12px 0 0;text-align:center;font-size:13px;font-weight:700;color:#6F66AD;line-height:1.45;" }));
      ov.card.appendChild(err);
      ov.card.appendChild(spacer());
      ov.card.appendChild(linkLine("Already have an account?", "Sign in", function () { done("signin"); }, "cc-to-signin"));
    });
  }

  // ---- 3. Confirm the email address. Moves on by itself once the link in
  // the email has been tapped (checked every few seconds, and whenever the
  // app comes back into view), or with the button.
  function verifyEmailScreen(user) {
    return new Promise(function (resolve) {
      var ov = openOverlay("setup");
      ov.card.id = "cc-verify";
      ov.card.style.textAlign = "center";
      var err = errorLine();
      var note = goodNote();
      var finished = false;
      var timer = null;
      function finish(r) {
        if (finished) return;
        finished = true;
        clearInterval(timer);
        document.removeEventListener("visibilitychange", onVisible);
        ov.close();
        resolve(r);
      }
      function isVerified() {
        return user.reload().then(function () {
          var u = S.auth.currentUser;
          if (!u || !u.emailVerified) return false;
          // A fresh token carries "email confirmed" to the server.
          return u.getIdToken(true).then(function () { return true; });
        });
      }
      function quietCheck() {
        if (finished) return;
        isVerified().then(function (ok) { if (ok) finish("verified"); }).catch(function () {});
      }
      function onVisible() { if (document.visibilityState === "visible") quietCheck(); }
      document.addEventListener("visibilitychange", onVisible);
      timer = setInterval(quietCheck, 4000);

      ov.card.appendChild(h("div", { style: "height:40px;" }));
      ov.card.appendChild(withHtml(h("div", { style: "width:96px;height:96px;margin:0 auto;border-radius:30px;background:#F6F3FF;display:flex;align-items:center;justify-content:center;color:#7B61FF;" }), ICON_MAIL));
      ov.card.appendChild(pageTitle("Check your email", true));
      ov.card.appendChild(h("p", { style: "margin:12px 0 0;font-size:16px;font-weight:700;color:#5D5490;line-height:1.5;" }, [
        "We sent a link to", h("br"), h("span", { id: "cc-verify-email", text: user.email || "your email", style: "color:#2B2250;font-weight:800;word-break:break-all;" }),
      ]));
      ov.card.appendChild(pageSub("Tap it, then come back here.", true));
      var ok = primaryBtn("I've confirmed it", null);
      ok.id = "cc-verified-btn";
      ok.style.marginTop = "28px";
      ok.onclick = withBusy(ok, err, function () {
        note.clear();
        return isVerified().then(function (yes) {
          if (yes) finish("verified");
          else throw { message: "Not confirmed yet. Tap the link in the email first, then try again." };
        });
      });
      var again = secondaryBtn("Send the link again", null);
      again.id = "cc-resend-btn";
      again.onclick = withBusy(again, err, function () {
        note.clear();
        return sendVerification(user).then(function () { note.show("Sent. It can take a minute to arrive."); });
      });
      ov.card.appendChild(ok);
      ov.card.appendChild(again);
      ov.card.appendChild(err);
      ov.card.appendChild(note);
      ov.card.appendChild(h("div", { style: "margin-top:24px;padding:14px 16px;border-radius:16px;background:#FFF7E8;text-align:left;font-size:13px;font-weight:700;color:#6B4E12;line-height:1.5;" }, [
        "Can't find it? Check spam or promotions. It comes from ", h("span", { text: "noreply@" + (S.authDomain || "firebaseapp.com"), style: "font-weight:800;word-break:break-all;" }), ".",
      ]));
      ov.card.appendChild(spacer());
      ov.card.appendChild(linkLine("Wrong address?", "Use a different email", function () { finish("different"); }, "cc-verify-different"));
    });
  }

  // ---- 4. Join with a one-time code (no email needed).
  // Resolves "linked", "legacy" (joined with an old household code), "owner"
  // (they're the owner after all) or "back".
  function linkScreen(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var ov = openOverlay("setup");
      ov.card.id = "cc-join";
      var err = errorLine();
      function done(r) { ov.close(); resolve(r); }
      ov.card.appendChild(backBtn(function () { done("back"); }));
      ov.card.appendChild(pageTitle("Join a family's chart"));
      ov.card.appendChild(pageSub("Ask the owner for a code. It works once and lasts 10 minutes."));
      if (opts.note) { ov.card.appendChild(h("div", { style: "height:14px;" })); ov.card.appendChild(noticeBox(opts.note)); }
      function step(n, text) {
        return h("div", { style: "display:flex;align-items:center;gap:10px;font-size:14px;font-weight:700;color:#2B2250;margin-top:8px;" }, [
          h("span", { text: String(n), style: "flex:none;width:24px;height:24px;border-radius:50%;background:#fff;color:#6A4FF0;font-size:13px;font-weight:800;display:flex;align-items:center;justify-content:center;" }), text,
        ]);
      }
      ov.card.appendChild(h("div", { style: "margin-top:18px;padding:14px 16px 16px;border-radius:18px;background:#F6F3FF;" }, [
        h("div", { text: "On the owner's phone", style: "font-size:12.5px;font-weight:800;color:#5D5490;letter-spacing:0.04em;text-transform:uppercase;" }),
        step(1, "Unlock with the PIN, then tap Settings"),
        step(2, "Devices, then Link a new device"),
      ]));
      if (currentlyAppleBrowserTab()) { ov.card.appendChild(h("div", { style: "height:14px;" })); ov.card.appendChild(homeScreenTip()); }
      var code = h("input", { id: "cc-link-code", placeholder: "ABCD-EFGH", maxlength: "9", autocomplete: "off", autocapitalize: "characters", spellcheck: "false",
        style: "width:100%;box-sizing:border-box;height:64px;padding:0 16px;border:2px solid #7B61FF;border-radius:16px;font-family:" + HEAD_FONT + ";font-size:28px;font-weight:800;letter-spacing:0.14em;text-align:center;text-transform:uppercase;color:#2B2250;background:#fff;" });
      code.oninput = function () { code.value = formatCode(cleanTypedCode(code.value, 8)); };
      var name = h("input", { id: "cc-link-name", value: guessDeviceName(), maxlength: "40", autocomplete: "off", style: FIELD_STYLE });
      ov.card.appendChild(fieldLabel("Code", "cc-link-code"));
      ov.card.appendChild(code);
      ov.card.appendChild(fieldLabel("Name this device", "cc-link-name"));
      ov.card.appendChild(name);
      ov.card.appendChild(h("div", { text: "So the owner can tell it apart in Devices.", style: "margin-top:6px;font-size:13px;font-weight:700;color:#6F66AD;" }));
      var go = primaryBtn("Join", null);
      go.id = "cc-link-go";
      go.style.marginTop = "20px";
      go.onclick = withBusy(go, err, function () {
        var c = cleanTypedCode(code.value, 8);
        if (c.length !== 8) throw { message: "Enter the 8-character code shown on the owner's phone." };
        return ensureAnonymous()
          .then(function () { return call("redeemLinkCode", { code: c, deviceName: name.value }); })
          .then(function () { clearStoredCode(); done("linked"); });
      });
      submitOnEnter([code, name], go);
      ov.card.appendChild(go);
      ov.card.appendChild(err);

      if (opts.allowOld) {
        var oldBox = h("div", { style: "display:none;margin-top:14px;" });
        var oldIn = textInput("Household code", 6, "", true);
        oldIn.id = "cc-old-code";
        var oldGo = secondaryBtn("Join with the old code", function () {
          var c = cleanTypedCode(oldIn.value, 6);
          if (c.length !== 6) { err.show("Enter the 6-character household code."); return; }
          try { localStorage.setItem(HOUSEHOLD_CODE_KEY, c); } catch (e) {}
          done("legacy");
        });
        oldGo.id = "cc-old-go";
        oldBox.appendChild(oldIn);
        oldBox.appendChild(oldGo);
        var oldToggle = textLink("Have an old 6-letter household code?", function () { oldBox.style.display = "block"; oldToggle.style.display = "none"; });
        oldToggle.id = "cc-old-toggle";
        ov.card.appendChild(oldToggle);
        ov.card.appendChild(oldBox);
      }
      ov.card.appendChild(spacer());
      ov.card.appendChild(linkLine("Are you the owner?", "Sign in instead", function () { done("owner"); }, "cc-join-owner"));
    });
  }

  // Signed in, but not yet part of a household.
  function setupHouseholdScreen(user, legacyCode) {
    return new Promise(function (resolve) {
      var ov = openOverlay("setup");
      var err = errorLine();
      ov.card.appendChild(h("div", { style: "height:24px;" }));
      ov.card.appendChild(title("Welcome"));
      ov.card.appendChild(sub("Signed in as " + (user.email || "your account")));

      function section(heading, desc) {
        var box = h("div", { style: "border-top:1.5px solid #F1EDFF;padding:14px 0 4px;" });
        box.appendChild(h("div", { text: heading, style: "font-size:14px;font-weight:800;color:#7B61FF;" }));
        if (desc) box.appendChild(para(desc, "margin-top:2px;"));
        return box;
      }

      var s1 = section("Start a new household", "Create a fresh chore chart.");
      var b1 = primaryBtn("Create a new household", null);
      b1.id = "cc-create-hh";
      b1.onclick = withBusy(b1, err, function () {
        return call("createHousehold").then(function () { ov.close(); resolve(); });
      });
      s1.appendChild(b1);

      var s2 = section("I already use this app", "Secure the household you already have. Type its 6-character code.");
      var claimIn = textInput("Household code", 6, legacyCode || "", true);
      claimIn.id = "cc-claim-code";
      claimIn.style.marginTop = "8px";
      var b2 = secondaryBtn("Secure my household", null);
      b2.id = "cc-claim-btn";
      b2.onclick = withBusy(b2, err, function () {
        var c = cleanTypedCode(claimIn.value, 6);
        if (c.length !== 6) throw { message: "Enter the 6-character household code." };
        return call("claimHousehold", { code: c }).then(function (r) {
          clearStoredCode();
          ov.close();
          return claimedScreen(r.graceUntil).then(resolve);
        });
      });
      s2.appendChild(claimIn);
      s2.appendChild(b2);

      var s3 = section("I'm taking over a household", "Someone offered you ownership. Type the 8-character code they gave you.");
      var xferIn = textInput("ABCD-EFGH", 9, "", true);
      xferIn.id = "cc-transfer-code";
      xferIn.style.marginTop = "8px";
      xferIn.oninput = function () { xferIn.value = formatCode(cleanTypedCode(xferIn.value, 8)); };
      var b3 = secondaryBtn("Accept ownership", null);
      b3.id = "cc-accept-btn";
      b3.onclick = withBusy(b3, err, function () {
        var c = cleanTypedCode(xferIn.value, 8);
        if (c.length !== 8) throw { message: "Enter the 8-character code." };
        return call("acceptTransfer", { code: c }).then(function () { ov.close(); resolve(); });
      });
      s3.appendChild(xferIn);
      s3.appendChild(b3);

      ov.card.appendChild(s1);
      ov.card.appendChild(s2);
      ov.card.appendChild(s3);
      ov.card.appendChild(err);
      var other = textLink("Use a different account", function () {
        S.auth.signOut().catch(function () {}).then(function () { ov.close(); resolve(); });
      });
      other.id = "cc-different-account";
      ov.card.appendChild(other);
    });
  }

  function claimedScreen(graceUntil) {
    return new Promise(function (resolve) {
      var ov = openOverlay("setup");
      ov.card.appendChild(h("div", { style: "height:24px;" }));
      ov.card.appendChild(title("Your household is secured"));
      ov.card.appendChild(sub("You're now the owner."));
      ov.card.appendChild(para("Your other devices keep working the old way until " + (graceUntil ? fmtDate(graceUntil) : "the end of the grace period") + ". To link each one: on that device open the app, tap “Join a family's chart”, and type a code from Devices (unlock, then Settings, then Devices, then Link a new device).", "margin-bottom:6px;"));
      var go = primaryBtn("Continue", function () { ov.close(); resolve(); });
      go.id = "cc-claimed-continue";
      ov.card.appendChild(go);
    });
  }

  // An old-style device after its household was claimed and the grace window ended.
  function protectedScreen() {
    return new Promise(function (resolve) {
      var ov = openOverlay("setup");
      ov.card.appendChild(h("div", { style: "height:24px;" }));
      ov.card.appendChild(title("This household is protected"));
      ov.card.appendChild(sub("It now has an owner. Join with a code from the owner, or sign in if that's you."));
      function again() { protectedScreen().then(resolve); }
      var link = primaryBtn("Join with a code", function () {
        ov.close();
        linkScreen().then(function (r) {
          if (r === "linked") resolve();
          else if (r === "owner") ownerAuth("signin").then(function (r2) { if (r2 === "done") resolve(); else again(); });
          else again();
        });
      });
      link.id = "cc-link-btn";
      var owner = secondaryBtn("I'm the owner: sign in", function () {
        ov.close();
        ownerAuth("signin").then(function (r) { if (r === "done") resolve(); else again(); });
      });
      owner.id = "cc-owner-signin";
      ov.card.appendChild(link);
      ov.card.appendChild(owner);
    });
  }

  // ------------------------------------------------------------------ boot
  // Loops until this device has a way into a household, showing whichever
  // screen is needed. Resolves with the session.
  function start(env) {
    S.db = env.db; S.auth = env.auth; S.fns = env.fns; S.authDomain = env.authDomain || null;
    function loop() {
      return restoredUser().then(function (user) {
        var memberP = user
          ? readMember(user.uid).catch(function (e) {
              // Offline start: trust what we knew last time rather than locking the family out.
              try {
                var cached = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
                if (cached && cached.uid === user.uid && e && e.code === "unavailable") return { hid: cached.hid, role: cached.role };
              } catch (x) {}
              throw e;
            })
          : Promise.resolve(null);
        return memberP.then(function (member) {
          var legacyCode = getStoredCode();
          var d = decideBoot({ user: user, member: member, legacyCode: legacyCode });
          if (d.mode === "account") {
            return { mode: "account", hid: member.hid, role: member.role, user: user };
          }
          if (d.mode === "legacy") {
            return readStatus(legacyCode).then(function (st) {
              if (st && st.claimed && !st.graceActive) return protectedScreen().then(loop);
              return { mode: "legacy", hid: legacyCode, status: st };
            });
          }
          if (d.mode === "verify-email") return ensureVerified().then(loop);
          if (d.mode === "needs-household") return setupHouseholdScreen(user, legacyCode).then(loop);
          return welcomeScreen(takeNotice()).then(loop);
        });
      });
    }
    return loop();
  }

  // ------------------------------------------------------------------ losing access
  var lostHandled = false;
  function handleAccessLost() {
    if (lostHandled) return Promise.resolve();
    lostHandled = true;
    var n = 0;
    try { n = Number(sessionStorage.getItem("cc-lost-n") || 0) + 1; sessionStorage.setItem("cc-lost-n", String(n)); } catch (e) {}
    if (n > 3) { toast("Can't reach the household right now. Try again in a few minutes."); return Promise.resolve(); }
    var account = S.session && S.session.mode === "account";
    try {
      localStorage.removeItem(SESSION_KEY);
      sessionStorage.setItem(NOTICE_KEY, account
        ? "This device no longer has access to the household. If that's a surprise, ask the owner for a new link code."
        : "This household is now protected. Link this device with a code from the owner.");
    } catch (e) {}
    var out = account ? S.auth.signOut() : Promise.resolve();
    return Promise.resolve(out).catch(function () {}).then(function () { window.location.reload(); });
  }
  function checkAccess() {
    if (!S.session || S.session.mode !== "account") return Promise.resolve();
    return readMember(S.session.user.uid).then(function (m) {
      if (!m || m.hid !== S.session.hid) return handleAccessLost();
      // A small read the rules only allow for a session that's still welcome:
      // it also catches a sign-in that was cut off by "sign out all other devices".
      return S.db.collection("access").doc(S.session.hid).get();
    }).catch(function (e) {
      if (e && e.code === "permission-denied") return handleAccessLost();
    });
  }

  // ------------------------------------------------------------------ legacy (pre-accounts) devices
  function secureThisHousehold() {
    var ov = openOverlay("dim");
    var err = errorLine();
    ov.card.appendChild(title("Secure this household"));
    ov.card.appendChild(sub("Sign in with Google or email to become its owner. Nothing about your chores changes."));
    var go = primaryBtn("Continue", null);
    go.id = "cc-secure-go";
    go.onclick = function () {
      var code = getStoredCode();
      ov.close();
      ownerAuth("create").then(function (r) {
        if (r !== "done") return;
        return call("claimHousehold", { code: code }).then(function (res) {
          clearStoredCode();
          return claimedScreen(res.graceUntil).then(function () { window.location.reload(); });
        }, function (e) {
          // Signed in but couldn't claim: the setup screen after the reload offers it again.
          toast(friendlyError(e));
          setTimeout(function () { window.location.reload(); }, 2500);
        });
      });
    };
    ov.card.appendChild(go);
    ov.card.appendChild(err);
    ov.card.appendChild(textLink("Not now", ov.close));
  }
  function linkThisDevice() {
    linkScreen().then(function (r) {
      if (r === "linked") window.location.reload();
      else if (r === "owner") ownerAuth("signin").then(function (r2) { if (r2 === "done") window.location.reload(); });
    });
  }

  function showLegacyBanner(status) {
    try { if (sessionStorage.getItem("cc-banner-off")) return; } catch (e) {}
    var text, label, action;
    if (status && !status.claimed) { text = "Secure this household with a sign-in"; label = "Secure"; action = secureThisHousehold; }
    else if (status && status.claimed && status.graceActive) { text = "Link this device before " + fmtDate(status.graceUntil); label = "Link"; action = linkThisDevice; }
    else return;
    var bar = h("div", { id: "cc-legacy-banner", role: "status", style: "position:fixed;left:12px;bottom:84px;z-index:99980;max-width:calc(100% - 24px);box-sizing:border-box;display:flex;align-items:center;padding:6px 8px 6px 16px;background:#fff;border:2px solid #E2DBFA;border-radius:999px;box-shadow:0 10px 28px rgba(43,34,80,0.22);font-family:" + FONT + ";" });
    bar.appendChild(h("span", { text: text, style: "font-size:13px;font-weight:800;color:#2B2250;margin-right:8px;" }));
    bar.appendChild(h("button", { type: "button", text: "Later", onClick: function () { try { sessionStorage.setItem("cc-banner-off", "1"); } catch (e) {} if (bar.parentNode) bar.parentNode.removeChild(bar); }, style: "min-height:40px;padding:0 10px;border:none;background:none;cursor:pointer;font:700 13px " + FONT + ";color:#6F66AD;" }));
    var go = h("button", { type: "button", text: label, onClick: action, style: "min-height:40px;padding:0 18px;border:none;border-radius:999px;cursor:pointer;background:" + GRADIENT + ";color:#fff;font:800 13px " + FONT + ";" });
    go.id = "cc-legacy-banner-go";
    bar.appendChild(go);
    document.body.appendChild(bar);
  }

  // ------------------------------------------------------------------ Devices screen
  // The Devices screen. With no argument it opens as its own popup; given an
  // element (the Devices tab inside Settings), it draws itself in there
  // instead, and returns a function that cleans it up when the tab closes.
  function openDevicesModal(host) {
    var s = S.session;
    if (!s) return null;
    var embedded = !!host;
    var ov;
    if (embedded) {
      ov = { root: host, card: host, close: function () { while (host.firstChild) host.removeChild(host.firstChild); } };
    } else {
      ov = openOverlay("dim");
      ov.card.id = "cc-devices";
    }
    var unsub = null;
    var timers = [];
    var closed = false;
    function closeAll() {
      if (closed) return;
      closed = true;
      timers.forEach(clearInterval);
      timers = [];
      if (unsub) unsub();
      ov.close();
    }
    var body = h("div");
    if (!embedded) {
      ov.root.onclick = function (e) { if (e.target === ov.root) closeAll(); };
      var head = h("div", { style: "display:flex;align-items:center;margin-bottom:12px;" });
      head.appendChild(h("div", { text: "Devices", style: "flex:1;font-size:20px;font-weight:800;color:#2B2250;" }));
      head.appendChild(h("button", { type: "button", "aria-label": "Close", text: "\u00d7", onClick: closeAll, style: "border:none;background:none;color:#B7ACE3;font-size:26px;cursor:pointer;line-height:1;padding:0 4px;" }));
      ov.card.appendChild(head);
    }
    ov.card.appendChild(body);

    // ---- legacy (not yet on accounts) view
    if (s.mode === "legacy") {
      body.appendChild(para("Right now this household is opened only with its code, so anyone who learns the code can get in. Signing in (Google or email) makes you its owner and lets you link devices one at a time.", "margin-bottom:6px;"));
      var st = s.status;
      if (st && st.claimed && st.graceActive) {
        body.appendChild(para("It already has an owner. This device keeps working the old way until " + fmtDate(st.graceUntil) + ". Link it with a code from the owner's Devices screen.", "margin:10px 0;"));
        var lb = primaryBtn("Link this device", function () { closeAll(); linkThisDevice(); });
        lb.id = "cc-devices-link-this";
        body.appendChild(lb);
      } else {
        var sb = primaryBtn("Secure this household", function () { closeAll(); secureThisHousehold(); });
        sb.id = "cc-devices-secure";
        body.appendChild(sb);
      }
      return closeAll;
    }

    // ---- account view
    var isOwner = s.role === "owner";
    var uiState = { acc: null, status: null, msg: "", note: "", link: null, renaming: null, pending: null, emailDraft: "", renameDraft: "" };
    var redrawLater = false;
    // Changes made on other devices redraw this screen. Never do that while
    // someone is typing in a field here: wait until they click away.
    function typingHere() {
      var a = document.activeElement;
      return !!(a && a.tagName === "INPUT" && ov.card.contains(a));
    }
    function softRender() {
      if (typingHere()) { redrawLater = true; return; }
      render();
    }
    ov.card.addEventListener("focusout", function () {
      if (!redrawLater) return;
      setTimeout(function () { if (!typingHere()) { redrawLater = false; render(); } }, 0);
    });
    function say(m) { uiState.msg = m || ""; softRender(); }
    function fail(e) { say(friendlyError(e)); }

    // Some owner actions need a fresh sign-in: Google opens its pop-up
    // (straight from the tap), an email account types its password again.
    function reauth() { return confirmOwnerIdentity(); }
    function loadStatus() {
      return readStatus(s.hid).then(function (st) { uiState.status = st; render(); });
    }

    function confirmable(key, label, confirmLabel, run, danger) {
      if (uiState.pending !== key) return smallBtn(label, function () { uiState.pending = key; render(); }, danger);
      var wrap = h("span", { style: "display:inline-flex;gap:6px;align-items:center;" });
      wrap.appendChild(h("span", { text: "Sure?", style: "font-size:12px;font-weight:700;color:#C0392B;" }));
      var yes = smallBtn(confirmLabel, function () { uiState.pending = null; run(); }, true);
      yes.setAttribute("data-confirm", key);
      wrap.appendChild(yes);
      wrap.appendChild(smallBtn("Cancel", function () { uiState.pending = null; render(); }));
      return wrap;
    }

    function startLinkCode() {
      uiState.msg = "";
      uiState.note = "";
      call("createLinkCode").then(function (r) { uiState.link = { code: r.code, expiresAt: r.expiresAt, seen: false }; render(); }).catch(fail);
    }

    function render() {
      timers.forEach(clearInterval);
      timers = [];
      while (body.firstChild) body.removeChild(body.firstChild);
      var acc = uiState.acc;
      if (!acc) { body.appendChild(para("Loading\u2026")); return; }

      // A code we've shown that has since vanished from the household's list was used.
      var L = uiState.link;
      if (L) {
        var present = !!(acc.linkCodes && acc.linkCodes[L.code]);
        if (present) L.seen = true;
        else if (L.seen) { uiState.link = null; uiState.note = "That code was used. The device is now linked."; }
      }
      if (uiState.note) body.appendChild(h("div", { id: "cc-devices-note", role: "status", text: uiState.note, style: "background:#E8F8EF;color:#1E7B4B;border-radius:10px;padding:9px 12px;font-size:12.5px;font-weight:700;margin-bottom:10px;" }));
      if (uiState.msg) body.appendChild(h("div", { id: "cc-devices-msg", role: "alert", text: uiState.msg, style: "background:#FDECEA;color:#C0392B;border-radius:10px;padding:9px 12px;font-size:12.5px;font-weight:700;margin-bottom:10px;" }));

      var me = acc.devices && acc.devices[s.user.uid];
      body.appendChild(para(isOwner
        ? "You're signed in as the owner (" + (acc.ownerEmail || "your account") + ")."
        : "This is a linked device" + (me ? " (\u201c" + me.name + "\u201d)." : "."), "margin-bottom:12px;"));

      // grace window
      var st = uiState.status;
      if (isOwner && st && st.graceActive) {
        var g = h("div", { id: "cc-grace", style: "background:#F4F0FF;border-radius:12px;padding:10px 12px;margin-bottom:12px;" });
        g.appendChild(para("Devices that haven't been linked yet still work with the old household code until " + fmtDate(st.graceUntil) + ". Once everything is linked, you can end that now."));
        var endBtn = confirmable("endgrace", "End it now", "End now", function () { call("endGrace").then(loadStatus).catch(fail); }, true);
        endBtn.style.marginTop = "8px";
        g.appendChild(h("div", { style: "margin-top:8px;" }, [endBtn]));
        body.appendChild(g);
      }

      // device list
      var list = h("div", { id: "cc-device-list", style: "border-top:1.5px solid #F1EDFF;" });
      var ids = Object.keys(acc.devices || {}).sort(function (a, b) { return (acc.devices[a].linkedAt || 0) - (acc.devices[b].linkedAt || 0); });
      if (!ids.length) list.appendChild(para("No devices linked yet.", "padding:12px 0;color:#8A82C0;"));
      ids.forEach(function (uid) {
        var d = acc.devices[uid];
        var row = h("div", { "data-uid": uid, style: "display:flex;align-items:center;gap:8px;padding:11px 0;border-bottom:1.5px solid #F1EDFF;flex-wrap:wrap;" });
        var info = h("div", { style: "flex:1;min-width:120px;" });
        if (isOwner && uiState.renaming === uid) {
          var inp = textInput("Device name", 40, uiState.renameDraft || d.name, false);
          inp.setAttribute("data-rename", uid);
          inp.oninput = function () { uiState.renameDraft = inp.value; };
          info.appendChild(inp);
        } else {
          info.appendChild(h("div", { text: d.name + (uid === s.user.uid ? "  (this device)" : ""), style: "font-size:14px;font-weight:800;color:#2B2250;" }));
          info.appendChild(h("div", { text: "Linked " + fmtDateTime(d.linkedAt), style: "font-size:12px;font-weight:600;color:#8A82C0;" }));
        }
        row.appendChild(info);
        if (isOwner) {
          var acts = h("div", { style: "display:flex;gap:6px;align-items:center;flex-wrap:wrap;" });
          if (uiState.renaming === uid) {
            acts.appendChild(smallBtn("Save", function () {
              var v = row.querySelector("input").value;
              uiState.renaming = null; uiState.renameDraft = "";
              call("renameDevice", { uid: uid, name: v }).catch(fail);
            }));
            acts.appendChild(smallBtn("Cancel", function () { uiState.renaming = null; render(); }));
          } else {
            acts.appendChild(smallBtn("Rename", function () { uiState.renaming = uid; uiState.renameDraft = d.name; render(); }));
            acts.appendChild(confirmable("remove:" + uid, "Remove", "Remove", function () { call("removeDevice", { uid: uid }).catch(fail); }, true));
          }
          row.appendChild(acts);
        }
        list.appendChild(row);
      });
      body.appendChild(list);

      if (!isOwner) {
        body.appendChild(para("Only the owner can add or remove devices.", "margin:12px 0 4px;color:#8A82C0;"));
        body.appendChild(h("div", { style: "margin-top:10px;" }, [confirmable("unlink", "Unlink this device", "Unlink", function () {
          call("unlinkSelf").then(function () { return S.auth.signOut(); }).catch(function () {}).then(function () { try { localStorage.removeItem(SESSION_KEY); } catch (e) {} window.location.reload(); });
        }, true)]));
        return;
      }

      // link a new device
      if (uiState.link && uiState.link.expiresAt > Date.now()) {
        var box = h("div", { id: "cc-link-box", style: "text-align:center;background:#F4F0FF;border-radius:14px;padding:14px;margin-top:14px;" });
        box.appendChild(h("div", { id: "cc-link-code-shown", text: formatCode(uiState.link.code), style: "font:800 30px monospace;letter-spacing:3px;color:#2B2250;" }));
        var cd = h("div", { style: "font-size:12.5px;font-weight:700;color:#8A82C0;margin-top:4px;" });
        box.appendChild(cd);
        box.appendChild(para("On the other device, open the app and tap \u201cLink this device\u201d, then type this code. It works once.", "margin-top:8px;"));
        body.appendChild(box);
        var tick = function () {
          var left = uiState.link.expiresAt - Date.now();
          if (left <= 0) { softRender(); return; }
          cd.textContent = "Expires in " + fmtCountdown(left);
        };
        tick();
        timers.push(setInterval(tick, 1000));
      } else {
        uiState.link = null;
        var lb2 = primaryBtn("Link a new device", startLinkCode);
        lb2.id = "cc-new-link";
        lb2.style.marginTop = "14px";
        body.appendChild(lb2);
      }

      // sign out other devices
      var so = confirmable("signoutothers", "Sign out all other devices", "Sign out others", function () {
        // Needs a fresh sign-in, so the pop-up opens straight from this tap.
        reauth().then(function () { return call("signOutOthers"); }).then(function () { say("Done. Every other sign-in of your account has been signed out."); }).catch(fail);
      }, false);
      body.appendChild(h("div", { style: "margin-top:16px;" }, [so]));

      // transfer ownership
      var tr = h("div", { id: "cc-transfer", style: "border-top:1.5px solid #F1EDFF;margin-top:16px;padding-top:12px;" });
      tr.appendChild(h("div", { text: "Transfer ownership", style: "font-size:14px;font-weight:800;color:#7B61FF;" }));
      var pt = acc.pendingTransfer;
      if (pt && pt.expiresAt > Date.now()) {
        tr.appendChild(para("Offered to " + pt.toEmail + ". Give them this code. They sign in with that email (Google or email and password), choose \u201cI'm taking over a household\u201d, and type it.", "margin:4px 0 8px;"));
        tr.appendChild(h("div", { id: "cc-transfer-code-shown", text: formatCode(pt.code), style: "text-align:center;font:800 26px monospace;letter-spacing:3px;color:#2B2250;" }));
        var cd2 = h("div", { style: "text-align:center;font-size:12.5px;font-weight:700;color:#8A82C0;margin:4px 0 8px;" });
        tr.appendChild(cd2);
        var tick2 = function () {
          var left = pt.expiresAt - Date.now();
          if (left <= 0) { softRender(); return; }
          cd2.textContent = "Expires in " + fmtCountdown(left);
        };
        tick2();
        timers.push(setInterval(tick2, 1000));
        tr.appendChild(smallBtn("Cancel offer", function () { call("cancelTransfer").catch(fail); }, true));
      } else {
        tr.appendChild(para("Hand the household to someone else's account (Google or email). You lose owner access the moment they accept. Linked devices keep working.", "margin:4px 0 8px;"));
        var em = textInput("their.email@example.com", 80, "", false);
        em.id = "cc-transfer-email";
        em.value = uiState.emailDraft;
        em.oninput = function () { uiState.emailDraft = em.value; };
        em.setAttribute("autocapitalize", "none");
        tr.appendChild(em);
        var startBtn = smallBtn("Start transfer", function () {
          var v = em.value;
          reauth().then(function () { return call("startTransfer", { toEmail: v }); }).catch(fail);
        });
        startBtn.id = "cc-transfer-start";
        startBtn.style.marginTop = "8px";
        tr.appendChild(startBtn);
      }
      body.appendChild(tr);

      body.appendChild(h("div", { style: "border-top:1.5px solid #F1EDFF;margin-top:16px;padding-top:12px;" }, [
        confirmable("signout", "Sign out of this device", "Sign out", function () {
          S.auth.signOut().catch(function () {}).then(function () { try { localStorage.removeItem(SESSION_KEY); } catch (e) {} window.location.reload(); });
        }, false),
      ]));
    }

    render();
    unsub = S.db.collection("access").doc(s.hid).onSnapshot(function (snap) {
      if (snap.exists) { uiState.acc = snap.data(); softRender(); }
    }, function (e) {
      if (e && e.code === "permission-denied") { closeAll(); handleAccessLost(); }
    });
    loadStatus();
    return closeAll;
  }

  // ------------------------------------------------------------------ after boot
  function finish(session) {
    S.session = session;
    try { sessionStorage.setItem("cc-lost-n", "0"); } catch (e) {}
    window.CCAccount = {
      mode: session.mode,
      role: session.role || null,
      email: session.user && session.user.email ? session.user.email : null,
      openDevicesModal: openDevicesModal,
      mountDevices: function (el) { return openDevicesModal(el); },
      checkAccess: checkAccess,
      // "Forgot PIN?": only the owner's own sign-in can reset the PIN.
      confirmOwner: function () {
        return confirmOwnerIdentity().catch(function (e) { throw { message: friendlyError(e) }; });
      },
    };
    if (session.mode === "account") {
      try { localStorage.setItem(SESSION_KEY, JSON.stringify({ uid: session.user.uid, hid: session.hid, role: session.role })); } catch (e) {}
      document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") checkAccess(); });
      setInterval(checkAccess, 5 * 60 * 1000);
    } else {
      showLegacyBanner(session.status);
    }
  }

  window.CCAcct = {
    start: start,
    finish: finish,
    handleAccessLost: handleAccessLost,
    _test: { isAppleBrowserTab: isAppleBrowserTab, decideBoot: decideBoot, cleanTypedCode: cleanTypedCode, formatCode: formatCode, guessDeviceName: guessDeviceName, friendlyError: friendlyError, tsMs: tsMs },
  };
})();
