# Putting accounts live: step by step

Everything in this folder is the server side of accounts for The Chore Chart.
The app side is the new `index.html` / `sw.js` you already have.

**What's here**

| File | What it is |
|---|---|
| `functions/handlers.js` | All the account logic (claim, link codes, devices, transfer) |
| `functions/index.js`, `package.json` | Publishes that logic as Cloud Functions |
| `functions/test/handlers.test.js` | 39 tests of the logic. Run: `cd functions && node test/handlers.test.js` |
| `firestore.rules` | Security rules: only the owner and linked devices can reach a household |
| `firestore.rules.no-signout-others` | Safety net, see "If owners are locked out" |
| `firebase.json`, `.firebaserc` | Tells the Firebase tool which project to use |

---

## 0. Before anything: protect what exists
- In the **current** app: Kids menu, then **Download backup**, for every household you can reach.
- Keep a copy of the `index.html`, `sw.js` and `manifest.json` that are live right now, so you can put them back.
- To rehearse the "I already have a household" path later, make a throwaway household in the **current** app now (any code works) and note its code.

## 1. Firebase console (about 10 minutes)
Project: **chore-chart-nsr** (console.firebase.google.com)

1. **Authentication, Sign-in method.** Turn on both:
   - **Google.** It asks for a *public-facing project name* and a *support email*. People see both on the Google sign-in screen, so use a dedicated address if you don't want your personal one shown.
   - **Anonymous.** This is what linked devices (the kids' tablet) use. They get an ID but no email.
2. **Authentication, Settings, Authorized domains.** Add your Cloudflare address (the `...workers.dev` one, without `https://`). Without this, the Google sign-in window refuses to open and the app says so.
3. Confirm the project is on the **Blaze** plan (it is). Cloud Functions need it. Expect effectively no cost at this scale.

## 2. Deploy the server side (one time, about 15 minutes)
You need Node.js installed (version 22 is ideal). In a terminal, from this `firebase` folder:

```
npm install -g firebase-tools
firebase login
cd functions
npm install
node test/handlers.test.js        # should end with: 39 tests, 0 failed
cd ..
firebase deploy --only functions,firestore:rules
```

- This publishes 12 small functions and the security rules together.
- If the tool complains about the Node version, send me the exact message.

## 3. Check the rules (5 minutes)
Firebase console, Firestore, Rules, **Rules playground**. Each should give the answer on the right:

| Request | Expected |
|---|---|
| `get /databases/(default)/documents/households/<a household code>`, not signed in | **Allow** (not claimed yet) |
| `get .../access/<anything>`, not signed in | **Deny** |
| `get .../status/<anything>`, not signed in | **Allow** |
| any write to `.../access/<anything>` or `.../status/<anything>` | **Deny** |
| `get .../members/<uid>` signed in as a *different* uid | **Deny** |

The playground can't fully imitate a signed-in owner, so the real check is step 5.

## 4. Deploy the new app
Upload the new `index.html`, `sw.js`, `manifest.json` to Cloudflare as usual.
Devices running the old version need the usual **two reloads** (iPad: close and reopen the app twice) to pick it up. After that, updates show an "A new version is ready" banner.

## 5. The 15-minute rehearsal (use a throwaway, not your real household)

**Use a different Google account for the rehearsal than the one you'll use for your real household.** A Google account can own only one household, and there is no delete button yet, so practising with your real account would stop you claiming your real household afterwards. A free throwaway Google account is fine.
1. On a computer, open the app: **Sign in with Google**, then **Create a new household**. You land in a fresh chart.
2. Unlock, **Devices**, **Link a new device**. A code appears.
3. On a second browser or phone: **Link this device with a code**, type it, name it. The same chart should open. Check off a chore on one and watch it appear on the other.
4. Back on the first: **Remove** the second device. Within a minute of switching back to it, it should return to the start screen with an explanation.
5. Rehearse claiming: open the app with the throwaway *old-style* household code (older setup, or a device that already has it), tap **Secure**, sign in. You should see "Your household is secured" and the 14-day note.
6. Try **Transfer ownership** to a second Google account you control, accept it there, and confirm the first account is shut out.

**If step 3 shows "permission denied" or the chart won't load for the owner**, see the next section.

## If owners are locked out
Symptom: signed in as the owner, but the chart won't load and the browser console says *Missing or insufficient permissions*.
The most likely cause is the one rules line that checks when the sign-in happened (`auth_time`), which I couldn't test here.
Fix: `firebase deploy --only firestore:rules` using `firestore.rules.no-signout-others` instead (copy it over `firestore.rules` first). Everything keeps working; only "Sign out all other devices" becomes weaker. Tell me, and I'll adjust.

## 6. Your real household, then friends
1. On a device that already has your household: the banner says **Secure this household with Google**. Tap it and sign in. You are now the owner.
2. For each of your other devices: **Devices, Link a new device**, then on that device **Link this device** and type the code. They keep working the old way for 14 days, so there's no rush.
3. When everything is linked: **Devices, End it now**.
4. Do one friend next, then the rest. Each one: open the app, tap the banner, sign in.

## 7. Old codes switched off (done October 2026)
The old way in, a 6-letter household code alone, has been switched off: `firestore.rules` now allows only owners and linked devices, and the app tells a device with an old code to ask the owner for a join code. To publish rules changes: `firebase deploy --only firestore:rules`.

## Rolling back
- **Rules:** deploy `firestore.rules` again (or `firestore.rules.no-signout-others` if the owner is ever locked out), or in an emergency paste this into the console's Rules tab and Publish (fully open, like before):
  ```
  rules_version = '2';
  service cloud.firestore { match /databases/{database}/documents { match /{document=**} { allow read, write: if true; } } }
  ```
- **App:** upload the previous `index.html`, `sw.js`, `manifest.json` you saved in step 0.
- Household data is never restructured by any of this, so rolling back doesn't lose chores or points.

## What was and wasn't tested
**Tested** (automated, in this folder's repo): the server logic (34 tests, plus deliberate breakages to make sure the tests notice); the app's screens and flows in a real browser against a stand-in for Firebase (50 checks across 8 simulated devices, plus deliberate breakages); the backup, restore and update-prompt logic.

**Not testable from where I built it, so please watch for these in the rehearsal:**
- The real security rules (I tested my reading of them, not Firebase's rules engine).
- The real Google sign-in window, especially inside an installed home-screen app on a phone or iPad. Pop-ups can be fussy there.
- Whether Firestore tells an already-open screen immediately when its access is removed. The app also re-checks every time it returns to the foreground and every 5 minutes, so the worst case is a short delay.
- "Last active" times for devices (not built; the list shows when each was linked).
