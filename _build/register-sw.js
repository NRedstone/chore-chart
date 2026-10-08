// Registers the service worker and shows a small "new version" banner when a
// newer build takes over. Written in plain old-style JavaScript on purpose so
// it also runs on older tablets.
(function () {
  function showUpdateBanner() {
    if (document.getElementById("cc-update-banner")) return;

    // A full-width, click-through wrapper that just centres the card —
    // sizing the card itself off "left: 50%" would squeeze it to half the
    // screen and wrap the text.
    var bar = document.createElement("div");
    bar.id = "cc-update-banner";
    bar.setAttribute("role", "status");
    bar.style.cssText =
      "position:fixed;left:0;right:0;bottom:20px;bottom:calc(env(safe-area-inset-bottom, 0px) + 14px);" +
      "z-index:99990;box-sizing:border-box;padding:0 12px;pointer-events:none;" +
      "display:-webkit-flex;display:flex;-webkit-justify-content:center;justify-content:center;";

    var card = document.createElement("div");
    card.style.cssText =
      "pointer-events:auto;box-sizing:border-box;max-width:100%;display:-webkit-flex;display:flex;" +
      "-webkit-align-items:center;align-items:center;padding:6px 8px 6px 18px;" +
      "background:#ffffff;border:2px solid #E2DBFA;border-radius:999px;" +
      "box-shadow:0 10px 28px rgba(43,34,80,0.22);" +
      "font-family:'Nunito',-apple-system,BlinkMacSystemFont,sans-serif;";

    var msg = document.createElement("span");
    msg.textContent = "A new version is ready";
    msg.style.cssText = "font-size:14px;font-weight:800;color:#2B2250;margin-right:6px;";

    var later = document.createElement("button");
    later.type = "button";
    later.textContent = "Later";
    later.style.cssText =
      "min-height:44px;padding:0 12px;margin-right:4px;border:none;background:none;cursor:pointer;" +
      "font-family:inherit;font-size:14px;font-weight:700;color:#6F66AD;";
    later.onclick = function () {
      if (bar.parentNode) bar.parentNode.removeChild(bar);
    };

    var update = document.createElement("button");
    update.type = "button";
    update.textContent = "Update";
    update.style.cssText =
      "min-height:44px;padding:0 20px;border:none;border-radius:999px;cursor:pointer;" +
      "background:linear-gradient(135deg,#FF6B9D,#7B61FF);color:#ffffff;" +
      "font-family:inherit;font-size:14px;font-weight:800;";
    update.onclick = function () {
      window.location.reload();
    };

    card.appendChild(msg);
    card.appendChild(later);
    card.appendChild(update);
    bar.appendChild(card);
    document.body.appendChild(bar);
  }

  // Handy for checking the look from the browser console: __ccShowUpdateBanner()
  window.__ccShowUpdateBanner = showUpdateBanner;

  // ---- Updating without anyone tapping (for kiosk tablets in Guided Access,
  // where nobody can reload the page). Once a new version is ready, reload by
  // itself as soon as the tablet is idle or showing the clock screen saver,
  // but never while someone is in the middle of something.
  var lastTouch = Date.now();
  ["pointerdown", "touchstart", "keydown", "wheel", "mousemove"].forEach(function (evt) {
    document.addEventListener(evt, function () { lastTouch = Date.now(); }, { passive: true });
  });
  function busy() {
    if (document.querySelector('[role="dialog"], #cc-settings, #cc-devices, #cc-help-close')) return true;
    var a = document.activeElement;
    return !!(a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA") && a.value);
  }
  var idleWatch = null;
  function updateReady() {
    showUpdateBanner();
    if (idleWatch) return;
    var idleMs = window.__ccAutoUpdateIdleMsForTests || 2 * 60 * 1000;
    idleWatch = setInterval(function () {
      var clockShowing = !!document.getElementById("cc-screensaver");
      if (clockShowing || (Date.now() - lastTouch >= idleMs && !busy())) {
        clearInterval(idleWatch);
        window.location.reload();
      }
    }, 1000);
  }
  window.__ccSimulateUpdateReady = updateReady; // for tests

  if (!("serviceWorker" in navigator)) return;

  // Only a *replacement* counts as an update — the very first install, when
  // nothing was in charge before, shouldn't nag anyone.
  var hadController = !!navigator.serviceWorker.controller;
  var reloadOnUpdate = false;
  navigator.serviceWorker.addEventListener("controllerchange", function () {
    if (reloadOnUpdate) {
      window.location.reload();
      return;
    }
    if (hadController) updateReady();
    hadController = true;
  });

  // "Check for updates" in Settings: resolves "updating" (the page reloads by
  // itself in a moment), "current", or rejects if it couldn't check.
  window.__ccCheckForUpdate = function () {
    return navigator.serviceWorker.getRegistration().then(function (reg) {
      if (!reg) return "unavailable";
      reloadOnUpdate = true;
      return reg.update().then(function () {
        if (reg.installing || reg.waiting) return "updating";
        reloadOnUpdate = false;
        return "current";
      }, function (e) {
        reloadOnUpdate = false;
        throw e;
      });
    });
  };

  window.addEventListener("load", function () {
    navigator.serviceWorker
      .register("./sw.js")
      .then(function (reg) {
        // A tablet that sits on one screen all day never "navigates", so
        // ask for updates ourselves: when the app comes back to the
        // foreground, when the network returns, and every 10 minutes.
        function check() {
          try {
            reg.update().catch(function () {});
          } catch (e) {}
        }
        document.addEventListener("visibilitychange", function () {
          if (document.visibilityState === "visible") check();
        });
        window.addEventListener("online", check);
        setInterval(check, 10 * 60 * 1000);
      })
      .catch(function () {});
  });
})();
