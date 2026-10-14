

// Firestore-backed sync for The Chore Chart.
//
// Every device using a household sees the same data, live, within a second or
// two. Who is allowed in is decided by account-ui.js (Google or email sign-in for the
// owner, one-time link codes for other devices) and enforced by the Firestore
// security rules in firebase/firestore.rules.

const firebaseConfig = {
  apiKey: "AIzaSyA_krjo8I-OFxJxqhQuuRV2_Revwy5oTrc",
  authDomain: "chore-chart-nsr.firebaseapp.com",
  projectId: "chore-chart-nsr",
  storageBucket: "chore-chart-nsr.firebasestorage.app",
  messagingSenderId: "974093926063",
  appId: "1:974093926063:web:e49c1e0de62b3125869e5a",
};

const HOUSEHOLD_CODE_KEY = "choreChartHouseholdCode";
function getStoredCode() {
  try {
    return localStorage.getItem(HOUSEHOLD_CODE_KEY);
  } catch (e) {
    return null;
  }
}

// A condensed how-to-use guide, as one reusable overlay — shown
// automatically once per device right after first-time setup (so a parent
// never has to explain the app by hand to someone they share it with), and
// also exposed globally so the in-app help button can reopen the exact same
// content on demand later, with nothing duplicated between the two.
function showHelpModal() {
  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;background:rgba(43,34,80,0.45);" +
    "display:flex;align-items:center;justify-content:center;z-index:99999;" +
    "font-family:-apple-system,BlinkMacSystemFont,sans-serif;padding:20px;";

  const card = document.createElement("div");
  card.style.cssText =
    "background:#fff;border-radius:22px;padding:28px;max-width:420px;width:100%;" +
    "max-height:85vh;overflow-y:auto;box-shadow:0 20px 50px rgba(0,0,0,0.3);box-sizing:border-box;";

  const section = (title, body) =>
    '<div style="font-size:14px;font-weight:800;color:#7B61FF;margin:18px 0 6px;">' + title + "</div>" +
    '<div style="font-size:13.5px;color:#4A4470;font-weight:500;line-height:1.5;">' + body + "</div>";

  card.innerHTML =
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">' +
    '<div style="font-size:20px;font-weight:800;color:#2B2250;flex:1;">How The Chore Chart works</div>' +
    '<button id="cc-help-close" aria-label="Close" style="border:none;background:none;color:#B7ACE3;font-size:20px;cursor:pointer;padding:4px;line-height:1;">&times;</button>' +
    "</div>" +
    section("The five chore types",
      "<b>Morning / Evening</b> reset daily, on the days you pick. <b>Anytime</b> is either one-time or weekly with a due day. <b>Bonus</b> pays points instantly and runs on its own schedule. <b>Books</b> are one-time and stay in a permanent reading log.") +
    section("Earning points",
      "Any chore can carry its own point value, set when adding or editing it — Morning, Evening, and Anytime default to 0, while Bonus and Books default to a real value since that's usually the point of using them. Separately, finishing every Morning, Evening, and Anytime chore in a day earns a completion bonus too, on top of whatever individual chores paid.") +
    section("Redeeming rewards",
      "Tap <b>Redeem</b> next to a kid's points to spend them from the reward menu. Redemptions log automatically.") +
    section("The parent lock",
      "Most of the app is open for kids — checking off chores, adding their own tasks. The parent PIN unlocks editing or deleting any chore, renaming kids, manually adjusting a kid's point total, creating or managing the rewards menu, managing linked devices, and downloading or restoring a backup. All of that lives under Settings, which appears once you unlock. Settings also has a clock screen saver you can turn on for just one device, like a wall tablet. Adding a point-bearing chore while locked offers a choice: enter the PIN to approve it immediately, or skip to submit it for approval. The lock re-engages after 2 minutes of inactivity.") +
    section("Staying in sync",
      "The parent who sets it up signs in with Google or email and owns the household. Other devices, like the kids' tablet or the other parent's phone, join with a one-time code: unlock, tap Settings, then Devices, then Link a new device, then on the other device tap \u201cJoin a family's chart\u201d and type the code. No email needed. Everyone connected sees the same live data.") +
    '<div style="margin-top:20px;font-size:11.5px;font-weight:600;color:#A79ED1;">Version ' + (window.__ccBuild || "dev") + "</div>";

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  const close = () => document.body.removeChild(overlay);
  card.querySelector("#cc-help-close").onclick = close;
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
}
window.showChoreChartHelp = showHelpModal;

// Resolves once this device has a way into a household and Firestore is wired
// up. window.storage and window.subscribeToSync aren't safe to call before then.
// (Skipped entirely in demo mode, which never touches Firebase: see demo.js.)
if (!window.__ccDemo) window.__syncReady = (async () => {
  firebase.initializeApp(firebaseConfig);
  const db = firebase.firestore();
  // Long-lived connections on iPads (a wall tablet that never closes the app)
  // can go quietly stale. This lets Firestore fall back to a sturdier way of
  // talking to the server when the usual one misbehaves.
  try {
    db.settings({ experimentalAutoDetectLongPolling: true });
  } catch (e) {}
  const auth = firebase.auth();
  const fns = firebase.functions(); // us-central1, where the functions are published

  // Works out how this device gets in (showing the sign-in, link-code or setup
  // screens as needed) and resolves once it has a way in.
  const session = await CCAcct.start({ db, auth, fns, authDomain: firebaseConfig.authDomain });
  CCAcct.finish(session);

  // First time THIS DEVICE has ever set up the app: show the how-to-use guide
  // once, so a parent never has to walk a new person through it by hand.
  // Purely local to this device, never synced.
  try {
    if (!localStorage.getItem("cc-seen-help")) {
      localStorage.setItem("cc-seen-help", "1");
      showHelpModal();
    }
  } catch (e) {
    // Private browsing or storage disabled: not worth blocking setup over.
  }

  const docRef = db.collection("households").doc(session.hid);
  // If the rules start refusing us, this device was removed (or the old-style
  // access was cut off): hand over to the account code, which shows the right screen.
  const lost = (e) => {
    if (e && e.code === "permission-denied") CCAcct.handleAccessLost();
  };

  // ---- Saving: merged, never blindly overwritten (see merge.js) ----
  // uiBase: the saved household the app's screen is built on (the last copy
  // received from the server, or the last copy this device saved).
  // editBase: what the next save's changes are measured against.
  // The versions tell whether a newer copy from the server replaced the
  // screen in between, in which case the bases are left alone.
  let uiBase;
  let uiVersion = 0;
  let uiBaseSeq = 0; // the newest save of THIS device that uiBase already includes
  let editBase;
  let editVersion = 0;
  let editBaseSeq = 0;
  let queue = Promise.resolve();
  let inFlight = 0;
  const strip = (d) => {
    const out = {};
    Object.keys(d || {}).forEach((k) => {
      if (k.charAt(0) !== "_") out[k] = d[k];
    });
    return out;
  };

  // Every save from this device gets a number that only ever goes up (it's
  // based on the clock, so it keeps going up across reloads). The saved
  // household remembers the newest number it has applied from each device
  // (_applied). That makes a save that finishes late, after the app gave up
  // on it and moved on, harmless: it's never applied twice, and newer saves
  // measure their changes from it instead of counting them again.
  const deviceKey = (session.user && session.user.uid) || "device";
  let lastSeq = 0;
  let lastValue = null;
  let lastValueSeq = 0;
  const sent = {}; // seq -> what that save contained
  const sentBase = {}; // seq -> the copy it was measured against
  // The newest change handed to set() that isn't confirmed saved yet. While
  // there is one, copies arriving from other devices are shown with it
  // merged in, so an unsaved tap never looks undone.
  let unconfirmed = null;
  // A change's number and the copy it was made to are fixed the first time
  // it's handed over; a retry of the same change reuses both (measuring an
  // old change against a newer copy would make it undo things).
  let lastMeta = null;
  function metaFor(value) {
    if (value === lastValue && lastMeta) return lastMeta;
    lastSeq = Math.max(Date.now(), lastSeq + 1);
    lastValue = value;
    lastValueSeq = lastSeq;
    lastMeta = { seq: lastSeq, base: editBase, baseSeq: editBaseSeq, version: editVersion };
    return lastMeta;
  }
  const lastValueSeqFor = (value) => (value === lastValue ? lastValueSeq : Infinity);
  const appliedFrom = (d) => (d && d._applied && d._applied[deviceKey]) || 0;

  // One save, done as a transaction: read what's saved now, merge this
  // device's changes into it, write the result. It needs the server, so it
  // fails instead of queueing a stale copy to go out later.
  async function saveMerged(value, meta) {
    const local = JSON.parse(value);
    const seq = meta.seq;
    sent[seq] = local;
    sentBase[seq] = meta.base;
    Object.keys(sent).map(Number).sort((x, y) => y - x).slice(20).forEach((k) => {
      delete sent[k];
      delete sentBase[k];
    });
    const base = meta.base;
    const baseSeq = meta.baseSeq;
    const usedVersion = meta.version;
    const uiVersionAtStart = uiVersion;
    const merged = await db.runTransaction(async (tx) => {
      const snap = await tx.get(docRef);
      const remote = snap.exists ? snap.data() : undefined;
      const applied = appliedFrom(remote);
      if (applied >= seq) return remote; // already saved (an earlier attempt finished late)
      // A save of ours that went through after this change's starting copy
      // (one that finished late, say) is part of what this change builds on:
      // measure from "starting copy + that save's changes", so nothing in it
      // is counted twice.
      let effBase = base;
      if (applied > baseSeq && sent[applied]) {
        effBase = window.CCMerge.mergeHousehold(strip(sentBase[applied] || {}), sent[applied], strip(base || {}));
      }
      const result = window.CCMerge.mergeHousehold(effBase ? strip(effBase) : undefined, local, remote ? strip(remote) : undefined);
      result._applied = Object.assign({}, (remote && remote._applied) || {});
      result._applied[deviceKey] = seq;
      tx.set(docRef, result);
      return result;
    });
    // The screen now matches what was just saved, unless a newer copy arrived meanwhile.
    // (A save that finished late, after a newer one, doesn't move the bases back.)
    if (editVersion === usedVersion && seq > editBaseSeq) { editBase = local; editBaseSeq = seq; }
    if (uiVersion === uiVersionAtStart && seq > uiBaseSeq) { uiBase = local; uiBaseSeq = seq; }
    return merged;
  }

  window.storage = {
    async get(key) {
      // Only a genuinely-missing document should be treated as "no data yet"
      // (falls back to starter/demo data). A failed fetch (quota, network,
      // anything) must NOT look the same, or a real outage silently
      // masquerades as an empty new household.
      let snap;
      try {
        snap = await docRef.get();
      } catch (e) {
        lost(e);
        throw e;
      }
      if (!snap.exists) return null;
      uiBase = strip(snap.data());
      uiBaseSeq = appliedFrom(snap.data());
      uiVersion++;
      return { key, value: JSON.stringify(uiBase), shared: true };
    },
    // Called by the app at the moment it makes a change, so the save knows
    // which copy the change was made to.
    beginEdit() {
      editBase = uiBase;
      editBaseSeq = uiBaseSeq;
      editVersion = uiVersion;
    },
    // Saves run one at a time, in order. Each one gets at most 15 seconds:
    // a save stuck on a bad connection (it may never finish) must not hold up
    // the ones after it. If it does finish later, _applied keeps it from
    // being counted twice.
    set(key, value) {
      const meta = metaFor(value);
      unconfirmed = { value, base: meta.base };
      const attempt = queue.then(() => {
        inFlight++;
        const run = saveMerged(value, meta);
        run.then(() => inFlight--, () => inFlight--);
        return Promise.race([
          run,
          new Promise((_, reject) => setTimeout(() => reject({ code: "timeout" }), 15000)),
        ]);
      });
      queue = attempt.catch(() => {});
      return attempt.then(
        (merged) => {
          if (unconfirmed && unconfirmed.value === value) unconfirmed = null;
          window.__ccLastSaveError = null;
          return { key, value: JSON.stringify(strip(merged)), shared: true };
        },
        (e) => {
          window.__ccLastSaveError = (e && e.code) || "error";
          lost(e);
          return null;
        }
      );
    },
    async delete(key) {
      try {
        await docRef.delete();
        return { key, deleted: true, shared: true };
      } catch (e) {
        lost(e);
        return null;
      }
    },
    async list() {
      return { keys: [], shared: true };
    },
  };

  // ---- Connection watchdog ----
  // A tablet that stays open for days can end up with a connection that looks
  // fine but is dead. Every few minutes (and whenever the app comes back into
  // view, the network returns, or the screen saver is dismissed) ask the
  // server directly. If it doesn't answer, tear the connection down and
  // reconnect, then let the app retry anything that didn't save.
  let checking = false;
  async function checkConnection() {
    if (checking || document.visibilityState === "hidden") return;
    checking = true;
    try {
      const ok = await Promise.race([
        docRef.get({ source: "server" }).then(() => true, (e) => {
          lost(e);
          return false;
        }),
        new Promise((resolve) => setTimeout(() => resolve(false), 8000)),
      ]);
      // Don't tear the connection down in the middle of a save (that can leave it stuck).
      if (!ok && inFlight === 0) {
        await db.disableNetwork().catch(() => {});
        await db.enableNetwork().catch(() => {});
        window.__ccReconnects = (window.__ccReconnects || 0) + 1;
      }
      window.dispatchEvent(new Event("cc-connection-checked"));
    } finally {
      checking = false;
    }
  }
  window.__ccCheckConnection = checkConnection;
  setInterval(checkConnection, 3 * 60 * 1000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkConnection();
  });
  window.addEventListener("online", checkConnection);

  // Live sync: fires whenever the document changes, from this device or any
  // other one connected to the same household.
  window.subscribeToSync = function (callback) {
    return docRef.onSnapshot(
      (snap) => {
        if (!snap.exists) return;
        uiBase = strip(snap.data());
        uiBaseSeq = appliedFrom(snap.data());
        uiVersion++;
        if (unconfirmed && appliedFrom(snap.data()) < lastValueSeqFor(unconfirmed.value)) {
          // Show the arriving copy with this device's unsaved change merged in.
          const pending = JSON.parse(unconfirmed.value);
          callback(window.CCMerge.mergeHousehold(strip(unconfirmed.base || {}), pending, JSON.parse(JSON.stringify(uiBase))));
        } else {
          if (unconfirmed) unconfirmed = null; // it's already in there
          callback(JSON.parse(JSON.stringify(uiBase)));
        }
      },
      (err) => {
        console.error("Sync error:", err);
        lost(err);
      }
    );
  };

})();
