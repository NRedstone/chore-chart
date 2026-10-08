"use strict";
// Thin wrapper that publishes handlers.js as callable Cloud Functions.
// All the real logic (and all the tests) live in handlers.js.
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const { makeHandlers, Fail } = require("./handlers");

admin.initializeApp();

const handlers = makeHandlers({
  db: admin.firestore(),
  auth: admin.auth(),
  FieldValue: admin.firestore.FieldValue,
  Timestamp: admin.firestore.Timestamp,
});

// maxInstances keeps a runaway caller from running up a bill.
const OPTIONS = { region: "us-central1", maxInstances: 5 };

function publish(name) {
  return onCall(OPTIONS, async (request) => {
    try {
      const fwd = request.rawRequest && request.rawRequest.headers && request.rawRequest.headers["x-forwarded-for"];
      const ip = String(fwd || (request.rawRequest && request.rawRequest.ip) || "").split(",")[0].trim();
      return await handlers[name]({ auth: request.auth, ip }, request.data);
    } catch (e) {
      if (e instanceof Fail) throw new HttpsError(e.code, e.message);
      console.error(name, e);
      throw new HttpsError("internal", "Something went wrong. Try again.");
    }
  });
}

for (const name of Object.keys(handlers)) exports[name] = publish(name);
