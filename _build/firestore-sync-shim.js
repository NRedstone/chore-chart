

// Firestore-backed sync for The Chore Chart.
//
// Every device using a household sees the same data, live, within a second or
// two. Who is allowed in is decided by account-ui.js (Google or email sign-in for the
// owner, one-time link codes for other devices) and enforced by the Firestore
// security rules in firebase/firestore.rules. Households created before
// accounts existed keep working the old way (just their code) until claimed.

const firebaseConfig = {
  apiKey: "AIzaSyA_krjo8I-OFxJxqhQuuRV2_Revwy5oTrc",
  authDomain: "chore-chart-nsr.firebaseapp.com",
  projectId: "chore-chart-nsr",
  storageBucket: "chore-chart-nsr.firebasestorage.app",
  messagingSenderId: "974093926063",
  appId: "1:974093926063:web:e49c1e0de62b3125869e5a",
};

const HOUSEHOLD_CODE_KEY = "choreChartHouseholdCode";
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L — easy to read and type

function generateHouseholdCode() {
  let code = "";
  for (let i = 0; i < 6; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return code;
}

function getStoredCode() {
  try {
    return localStorage.getItem(HOUSEHOLD_CODE_KEY);
  } catch (e) {
    return null;
  }
}

function saveCode(code) {
  try {
    localStorage.setItem(HOUSEHOLD_CODE_KEY, code);
  } catch (e) {
    /* ignore — worst case, asks again next load */
  }
}

function showCodeBadge(code) {
  const badge = document.createElement("div");
  badge.textContent = "Household: " + code;
  badge.style.cssText =
    "position:fixed;bottom:10px;right:10px;background:#2B2250;color:#F8F5FF;" +
    "font:700 11px -apple-system,sans-serif;padding:6px 12px;border-radius:999px;" +
    "z-index:9999;opacity:0.85;box-shadow:0 2px 8px rgba(0,0,0,0.2);";
  document.body.appendChild(badge);
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
window.__syncReady = (async () => {
  firebase.initializeApp(firebaseConfig);
  const db = firebase.firestore();
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
  // grace period ended): hand over to the account code, which shows the right screen.
  const lost = (e) => {
    if (e && e.code === "permission-denied") CCAcct.handleAccessLost();
  };

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
      return { key, value: JSON.stringify(snap.data()), shared: true };
    },
    async set(key, value) {
      try {
        await docRef.set(JSON.parse(value));
        return { key, value, shared: true };
      } catch (e) {
        lost(e);
        return null;
      }
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

  // Live sync: fires whenever the document changes, from this device or any
  // other one connected to the same household.
  window.subscribeToSync = function (callback) {
    return docRef.onSnapshot(
      (snap) => {
        if (snap.exists) callback(snap.data());
      },
      (err) => {
        console.error("Sync error:", err);
        lost(err);
      }
    );
  };

  // Old-style households only (accounts don't use a code as the key).
  if (session.mode === "legacy") {
    // Migration: copies the current household's data into a brand-new,
    // never-touched document and switches this device over to it. Exists as
    // an escape hatch for when the shared document itself gets rate-limited
    // by Firestore (independent of daily quota) — moving the data to a fresh
    // document sidesteps that without losing anything or starting over.
    function showMigrateConfirm() {
      return new Promise((resolve) => {
        const overlay = document.createElement("div");
        overlay.style.cssText =
          "position:fixed;inset:0;background:rgba(43,34,80,0.45);display:flex;align-items:center;justify-content:center;z-index:99999;" +
          "font-family:-apple-system,BlinkMacSystemFont,sans-serif;padding:20px;";
        const card = document.createElement("div");
        card.style.cssText =
          "background:#fff;border-radius:22px;padding:26px;max-width:360px;width:100%;box-shadow:0 20px 50px rgba(0,0,0,0.3);" +
          "text-align:center;box-sizing:border-box;";
        card.innerHTML =
          '<div style="font-size:17px;font-weight:800;color:#2B2250;margin-bottom:10px;">Migrate to a fresh household?</div>' +
          '<div style="font-size:13px;color:#8A82C0;font-weight:600;margin-bottom:20px;">Copies everything \u2014 kids, chores, points \u2014 into a brand-new household. ' +
          "You'll need to enter the new code on your other devices afterward.</div>" +
          '<button id="mig-confirm" style="width:100%;padding:12px;border:none;border-radius:12px;' +
          'background:linear-gradient(135deg,#FF6B9D,#7B61FF);color:#fff;font-weight:700;font-size:14.5px;cursor:pointer;margin-bottom:10px;">Migrate</button>' +
          '<button id="mig-cancel" style="width:100%;padding:12px;border:2px solid #E2DBFA;border-radius:12px;' +
          'background:#fff;color:#5D5490;font-weight:700;font-size:14.5px;cursor:pointer;">Cancel</button>';
        overlay.appendChild(card);
        document.body.appendChild(overlay);
        card.querySelector("#mig-confirm").onclick = () => {
          document.body.removeChild(overlay);
          resolve(true);
        };
        card.querySelector("#mig-cancel").onclick = () => {
          document.body.removeChild(overlay);
          resolve(false);
        };
      });
    }

    function showMigratedScreen(newCode) {
      return new Promise((resolve) => {
        const overlay = document.createElement("div");
        overlay.style.cssText =
          "position:fixed;inset:0;background:linear-gradient(135deg,#FF6B9D,#7B61FF);display:flex;align-items:center;justify-content:center;z-index:99999;" +
          "font-family:-apple-system,BlinkMacSystemFont,sans-serif;padding:20px;";
        const card = document.createElement("div");
        card.style.cssText =
          "background:#fff;border-radius:22px;padding:28px;max-width:380px;width:100%;box-shadow:0 20px 50px rgba(0,0,0,0.3);" +
          "text-align:center;box-sizing:border-box;";
        card.innerHTML =
          '<div style="font-size:15px;font-weight:700;color:#8A82C0;margin-bottom:10px;">Migration complete \u2014 new household code</div>' +
          '<div style="font-size:38px;font-weight:800;letter-spacing:6px;color:#2B2250;margin-bottom:16px;font-family:monospace;">' +
          newCode +
          "</div>" +
          '<div style="font-size:13px;color:#8A82C0;font-weight:600;margin-bottom:22px;">Enter this exact code on your other devices (Join household) to reconnect them. This device will reload now.</div>' +
          '<button id="mig-continue" style="width:100%;padding:13px;border:none;border-radius:12px;' +
          'background:linear-gradient(135deg,#FF6B9D,#7B61FF);color:#fff;font-weight:700;font-size:15px;cursor:pointer;">Continue</button>';
        overlay.appendChild(card);
        document.body.appendChild(overlay);
        card.querySelector("#mig-continue").onclick = () => {
          document.body.removeChild(overlay);
          resolve();
        };
      });
    }

    window.migrateToFreshHousehold = async function () {
      const confirmed = await showMigrateConfirm();
      if (!confirmed) return;

      try {
        const snap = await docRef.get();
        if (!snap.exists) {
          alert("No data found to migrate.");
          return;
        }
        const data = snap.data();
        const newCode = generateHouseholdCode();
        const newDocRef = db.collection("households").doc(newCode);
        await newDocRef.set(data);
        saveCode(newCode);
        await showMigratedScreen(newCode);
        window.location.reload();
      } catch (e) {
        alert("Migration failed: " + (e && e.message ? e.message : "unknown error") + "\n\nYour original data is untouched — safe to try again.");
      }
    };

    showCodeBadge(session.hid);
  }
})();
