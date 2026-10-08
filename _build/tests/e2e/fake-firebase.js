// Injected into the page BEFORE the app's scripts run (browser tests only).
// Replaces the Firebase web SDK with a stand-in that talks to backend.js
// through window.__be. Sessions persist across reloads, like the real SDK.
(function () {
  var USER_KEY = "fake_user";
  var listeners = [];
  function load() { try { return JSON.parse(localStorage.getItem(USER_KEY) || "null"); } catch (e) { return null; } }
  function save(u) { if (u) localStorage.setItem(USER_KEY, JSON.stringify(u)); else localStorage.removeItem(USER_KEY); }
  function fail(code) { var e = new Error(code); e.code = code; return e; }
  function wrapUser(u) {
    if (!u) return null;
    var provider = u.isAnonymous ? null : (u.provider || "google.com");
    return {
      uid: u.uid, email: u.email || null, isAnonymous: !!u.isAnonymous, auth_time: u.auth_time,
      emailVerified: u.isAnonymous ? false : provider === "google.com" ? true : !!u.emailVerified,
      providerData: provider ? [{ providerId: provider }] : [],
      getIdToken: function () { return Promise.resolve("token"); },
      reload: function () {
        return window.__be("auth.info", { uid: u.uid }).then(function (info) {
          var cur = load();
          if (cur && cur.uid === u.uid && info) { cur.emailVerified = !!info.verified; save(cur); }
        });
      },
      sendEmailVerification: function () { return window.__be("auth.sendVerify", { uid: u.uid }); },
      reauthenticateWithCredential: function (cred) {
        return window.__be("auth.signInEmail", { email: cred.email, password: cred.password }).then(function (r) {
          if (r.error) throw fail(r.error);
          var cur = load(); cur.auth_time = Math.floor(r.now / 1000); save(cur);
        });
      },
    };
  }
  function plain(u) { return u ? { uid: u.uid, email: u.email, isAnonymous: u.isAnonymous, auth_time: u.auth_time, provider: u.provider || null } : null; }
  function notify() { var u = wrapUser(load()); listeners.slice().forEach(function (cb) { setTimeout(function () { cb(u); }, 0); }); }

  var authApi = {
    get currentUser() { return wrapUser(load()); },
    onAuthStateChanged: function (cb) {
      listeners.push(cb);
      setTimeout(function () { cb(wrapUser(load())); }, 0);
      return function () { listeners = listeners.filter(function (x) { return x !== cb; }); };
    },
    signInAnonymously: function () {
      return window.__be("auth.newAnon").then(function (uid) {
        var u = { uid: uid, isAnonymous: true };
        save(u); notify();
        return { user: wrapUser(u) };
      });
    },
    signInWithPopup: function () {
      var who = window.__nextGoogle;
      if (!who) return Promise.reject({ code: "auth/popup-closed-by-user", message: "closed" });
      return window.__be("now").then(function (now) {
        var u = { uid: who.uid, email: who.email, isAnonymous: false, auth_time: Math.floor(now / 1000) };
        save(u); notify();
        return { user: wrapUser(u) };
      });
    },
    createUserWithEmailAndPassword: function (email, password) {
      return window.__be("auth.createEmail", { email: email, password: password }).then(function (r) {
        if (r.error) throw fail(r.error);
        var u = { uid: r.uid, email: email.toLowerCase(), isAnonymous: false, provider: "password", emailVerified: false, auth_time: Math.floor(r.now / 1000) };
        save(u); notify();
        return { user: wrapUser(u) };
      });
    },
    signInWithEmailAndPassword: function (email, password) {
      return window.__be("auth.signInEmail", { email: email, password: password }).then(function (r) {
        if (r.error) throw fail(r.error);
        var u = { uid: r.uid, email: email.toLowerCase(), isAnonymous: false, provider: "password", emailVerified: !!r.verified, auth_time: Math.floor(r.now / 1000) };
        save(u); notify();
        return { user: wrapUser(u) };
      });
    },
    sendPasswordResetEmail: function (email) { return window.__be("auth.reset", { email: email }); },
    signOut: function () { save(null); notify(); return Promise.resolve(); },
  };

  function revive(v) {
    if (v && typeof v === "object") {
      if (typeof v.__ts === "number") { var ms = v.__ts; return { toMillis: function () { return ms; }, toDate: function () { return new Date(ms); } }; }
      if (Array.isArray(v)) return v.map(revive);
      var o = {}; Object.keys(v).forEach(function (k) { o[k] = revive(v[k]); }); return o;
    }
    return v;
  }
  function fsCall(method, path, data) {
    return window.__be("fs", { method: method, path: path, data: data, user: plain(load()) }).then(function (r) {
      if (r && r.error) { var e = new Error(r.error.code); e.code = r.error.code; throw e; }
      return r;
    });
  }
  function docRef(col, id) {
    var path = col + "/" + id;
    return {
      id: id,
      get: function () { return fsCall("get", path).then(function (r) { return { exists: !!r.exists, id: id, data: function () { return revive(r.data); } }; }); },
      set: function (d) { return fsCall("set", path, JSON.parse(JSON.stringify(d))); },
      delete: function () { return fsCall("delete", path); },
      onSnapshot: function (cb, errCb) {
        var last, stopped = false;
        function poll() {
          if (stopped) return;
          fsCall("get", path).then(function (r) {
            var key = JSON.stringify(r);
            if (key !== last) { last = key; cb({ exists: !!r.exists, id: id, data: function () { return revive(r.data); } }); }
          }, function (e) {
            // Real Firestore may not tell an already-open listener that its access was
            // cut off. Tests can switch that off to prove the app notices on its own.
            if (window.__noLiveDenial && last !== undefined) return;
            stopped = true; if (errCb) errCb(e);
          });
        }
        poll();
        var timer = setInterval(poll, 250);
        return function () { stopped = true; clearInterval(timer); };
      },
    };
  }

  window.firebase = {
    initializeApp: function () {},
    firestore: function () { return { collection: function (name) { return { doc: function (id) { return docRef(name, id); } }; } }; },
    auth: Object.assign(function () { return authApi; }, {
      GoogleAuthProvider: function () { this.setCustomParameters = function () {}; },
      EmailAuthProvider: { credential: function (email, password) { return { email: email, password: password }; } },
    }),
    functions: function () {
      return {
        httpsCallable: function (name) {
          return function (data) {
            return window.__be("fn", { name: name, data: data, user: plain(load()) }).then(function (r) {
              if (r.error) { var e = new Error(r.error.message || r.error.code); e.code = "functions/" + r.error.code; throw e; }
              return { data: r.result };
            });
          };
        },
      };
    },
  };
})();
