import { useState, useEffect, useMemo, useRef } from "react";
import { Check, Plus, X, Flame, Sun, Moon, Star, Pencil, Users, Trash2, Gift, Coins, PartyPopper, ChevronDown, ChevronUp, Lock, Unlock, BookOpen, Sparkles, Copy, Cloud, CloudRain, CloudSnow, CloudLightning, CloudSun, CloudMoon, GripVertical, Clock, HelpCircle, Smartphone, Settings } from "lucide-react";

const STORAGE_KEY = "household-chores-v6";
const LEGACY_KEY_V4 = "household-chores-v4";
const LEGACY_KEY_V3 = "household-chores-v3";
const LEGACY_KEY_V2 = "household-chores-v2";

const REWARD_MENU_STARTER = [
  { id: "rm1", name: "TV time", cost: 1 },
  { id: "rm2", name: "Ice cream", cost: 3 },
  { id: "rm3", name: "Pizza party", cost: 7 },
];

// Bright, playful palette for kid avatars — rotates by name hash
const KID_COLORS = ["#EF4444", "#FF6B9D", "#FF8C42", "#FFB03D", "#FFD43B", "#4ECB71", "#22B8A0", "#3B82F6", "#7B61FF"];

function colorForName(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return KID_COLORS[Math.abs(hash) % KID_COLORS.length];
}

// Uses a kid's explicitly chosen color if they have one, otherwise falls
// back to the automatic name-based color — keeps existing kids working
// exactly as before until someone actually picks a color for them.
function colorForKid(kid) {
  if (kid && kid.color) return kid.color;
  return colorForName(kid ? kid.name : "");
}

// Shows a kid's chosen emoji avatar if they have one, otherwise falls back
// to their name's first letter — same "pick one or get a sensible default"
// pattern as colorForKid.
function avatarContent(kid) {
  if (kid && kid.emoji) return kid.emoji;
  return kid && kid.name ? kid.name.charAt(0).toUpperCase() : "?";
}

const EMOJI_OPTIONS = [
  // Fantasy & space
  "🦄", "🐉", "🧚", "🧙", "🧜", "🦸", "🧑‍🚀", "🤖",
  // Vehicles & space
  "🚗", "🚀", "🛸",
  // Animals
  "🦁", "🐯", "🐶", "🐱", "🐰", "🦊", "🐼", "🦖",
  "🐬", "🦋", "🦉", "🐢", "🦜", "🐸", "🐨", "🐷",
  "🐙", "🦈", "🐳", "🦩", "🐧", "🦦", "🐝", "🦕",
  // Sports & hobbies
  "⚽", "🏀", "🏈", "⚾", "🎳", "🎯", "🎮", "🎸", "🎨", "🛹",
  // Food
  "🍕", "🍦", "🍩", "🍭", "🧁", "🍓",
  // Nature & symbols
  "⭐", "🌈", "❤️", "🔥", "💎", "👑", "🌙", "⚡", "🌊",
];

function todayKey() {
  return new Date().toDateString();
}

// The Devices screen (drawn by the account code, outside React) shown inside
// the Settings popup as an ordinary tab.
function DevicesTab() {
  const hostRef = useRef(null);
  useEffect(() => {
    const cleanup = window.CCAccount && window.CCAccount.mountDevices ? window.CCAccount.mountDevices(hostRef.current) : null;
    return () => {
      if (typeof cleanup === "function") cleanup();
    };
  }, []);
  return <div id="cc-devices" ref={hostRef} />;
}

// Settings > Household > Weather: pick the household's weather location by
// city or ZIP code (Open-Meteo's free place search), or from this device's
// location once. Saved for the whole household; null turns weather off.
function WeatherLocationSettings({ location, onSave, btnStyle }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");

  async function search(e) {
    if (e) e.preventDefault();
    const q = query.trim();
    if (q.length < 2) {
      setMsg("Type a city or ZIP code.");
      return;
    }
    setBusy("search");
    setMsg("");
    setResults(null);
    try {
      const res = await fetch("https://geocoding-api.open-meteo.com/v1/search?count=6&language=en&format=json&name=" + encodeURIComponent(q));
      const data = await res.json();
      const list = (data && data.results) || [];
      if (!list.length) setMsg("No places found. Try a nearby city, or a ZIP code.");
      setResults(list);
    } catch (err) {
      setMsg("Couldn't search right now. Check the connection and try again.");
    }
    setBusy("");
  }

  function pick(r) {
    onSave({ name: placeLabel(r), lat: r.latitude, lon: r.longitude, units: unitsForCountry(r.country_code) });
    setResults(null);
    setQuery("");
    setMsg("");
  }

  function useHere() {
    if (!navigator.geolocation) {
      setMsg("This device can't share its location. Type your city instead.");
      return;
    }
    setBusy("here");
    setMsg("");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBusy("");
        onSave({ name: "Home (from a device's location)", lat: pos.coords.latitude, lon: pos.coords.longitude, units: (location && location.units) || unitsForThisDevice() });
      },
      (err) => {
        setBusy("");
        setMsg(
          err && err.code === 1
            ? "Location access is turned off for this site. Type your city instead."
            : "Couldn't get this device's location. Type your city instead."
        );
      },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 10 * 60 * 1000 }
    );
  }

  return (
    <div id="cc-weather-settings" style={{ paddingBottom: 14, marginBottom: 14, borderBottom: "1.5px solid #F1EDFF" }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: "#7B61FF" }}>Weather</div>
      <div id="cc-weather-place" style={{ fontSize: 13, fontWeight: 700, color: "#2B2250", marginTop: 4 }}>
        {location ? "Showing weather for " + location.name : "No location set, so weather is hidden."}
      </div>
      <div style={{ fontSize: 12, color: "#8A82C0", fontWeight: 600, margin: "2px 0 10px", lineHeight: 1.5 }}>
        Used on every device in this household. Only the rough area (about a kilometer) is saved.
      </div>
      <form onSubmit={search} style={{ display: "flex", gap: 8 }}>
        <input
          id="cc-weather-query"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="City or ZIP code"
          autoComplete="off"
          aria-label="City or ZIP code"
          style={{ flex: 1, minWidth: 0, padding: "9px 12px", borderRadius: 10, border: "2px solid #E2DBFA", fontSize: 15, fontWeight: 600, color: "#2B2250", fontFamily: "inherit" }}
        />
        <button type="submit" disabled={busy === "search"} style={btnStyle}>
          {busy === "search" ? "Searching…" : "Search"}
        </button>
      </form>
      {results && results.length > 0 && (
        <div id="cc-weather-results" style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          {results.map((r) => (
            <button
              key={r.id || r.latitude + "," + r.longitude}
              onClick={() => pick(r)}
              style={{ ...btnStyle, textAlign: "left", width: "100%" }}
            >
              {placeLabel(r)}
            </button>
          ))}
        </div>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
        <button id="cc-weather-here" onClick={useHere} disabled={busy === "here"} style={btnStyle}>
          {busy === "here" ? "Finding you…" : "Use my current location"}
        </button>
        {location && (
          <button
            id="cc-weather-units"
            onClick={() => onSave({ ...location, units: location.units === "C" ? "F" : "C" })}
            style={btnStyle}
            aria-label={"Switch to " + (location.units === "C" ? "Fahrenheit" : "Celsius")}
          >
            {location.units === "C" ? "°C (switch to °F)" : "°F (switch to °C)"}
          </button>
        )}
        {location && (
          <button id="cc-weather-off" onClick={() => onSave(null)} style={btnStyle}>
            Turn weather off
          </button>
        )}
      </div>
      {msg && <div role="alert" style={{ marginTop: 8, fontSize: 12.5, color: "#C0392B", fontWeight: 700 }}>{msg}</div>}
    </div>
  );
}

// --- backup helpers (pure functions, unit-tested separately) ---
const BACKUP_APP_ID = "the-chore-chart";
const BACKUP_VERSION = 1;

// What goes into a backup file. The parent PIN and the household code are
// deliberately left out: backup files get emailed around and sit in Downloads
// folders, and neither should travel with them.
function makeBackup(state, buildLabel) {
  return {
    app: BACKUP_APP_ID,
    backupVersion: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    appBuild: buildLabel || "unknown",
    data: {
      kids: state.kids,
      chores: state.chores,
      rewards: state.rewards,
      rewardsMenu: state.rewardsMenu,
      dailyPointValue: state.dailyPointValue,
    },
  };
}

// Returns null if the parsed file is a usable backup, otherwise a plain-English
// reason it isn't. A restore replaces everything, so be strict.
function checkBackup(b) {
  if (!b || typeof b !== "object" || b.app !== BACKUP_APP_ID || !b.data || typeof b.data !== "object") {
    return "That doesn't look like a Chore Chart backup file.";
  }
  if (typeof b.backupVersion !== "number" || b.backupVersion > BACKUP_VERSION) {
    return "This backup comes from a newer version of the app. Update the app first.";
  }
  const d = b.data;
  if (!Array.isArray(d.kids) || !Array.isArray(d.chores) || !d.rewards || typeof d.rewards !== "object" || Array.isArray(d.rewards)) {
    return "The backup file is missing data.";
  }
  const kidIds = new Set();
  for (const k of d.kids) {
    if (!k || typeof k.id !== "string" || typeof k.name !== "string") return "The backup file has a damaged kid entry.";
    kidIds.add(k.id);
  }
  for (const c of d.chores) {
    if (!c || typeof c.id !== "string" || typeof c.name !== "string" || typeof c.category !== "string" || !kidIds.has(c.kidId)) {
      return "The backup file has a damaged chore entry.";
    }
  }
  if (d.rewardsMenu !== undefined && !Array.isArray(d.rewardsMenu)) return "The backup file has a damaged rewards menu.";
  return null;
}

function backupFilename() {
  return "chore-chart-backup-" + new Date().toISOString().slice(0, 10) + ".json";
}

function backupWhen(b) {
  const t = Date.parse(b && b.exportedAt);
  return isNaN(t) ? "an unknown date" : new Date(t).toLocaleString();
}
// --- end backup helpers ---

// Only offered where the browser can share files (phones and tablets): the
// dependable way to reach "Save to Files" from an installed home-screen app.
const CAN_SHARE_BACKUP_FILE = (() => {
  try {
    return (
      typeof navigator !== "undefined" &&
      !!navigator.share &&
      !!navigator.canShare &&
      navigator.canShare({ files: [new File(["{}"], "backup.json", { type: "application/json" })] })
    );
  } catch (e) {
    return false;
  }
})();

const BACKUP_BTN_STYLE = {
  padding: "8px 14px",
  borderRadius: 12,
  border: "2px solid #E2DBFA",
  background: "#FFFFFF",
  color: "#5D5490",
  fontSize: 13,
  fontWeight: 700,
  fontFamily: "inherit",
  cursor: "pointer",
};

function formatShortDate(dateStr) {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatLongDate(dateStr) {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString(undefined, { month: "long", day: "numeric" });
}

// Firestore doesn't guarantee object key order survives a round-trip, so
// plain JSON.stringify can report "different" for genuinely identical data —
// which, used as a change-detection check, causes an endless write loop.
// This sorts keys recursively first, making the comparison order-independent.
function stableStringify(value) {
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(value[k])).join(",") + "}";
  }
  return JSON.stringify(value);
}

function formatLogDate(dateStr) {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function daysSince(dateStr) {
  if (!dateStr) return Infinity;
  const ms = new Date(todayKey()).getTime() - new Date(dateStr).getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

// Monday = 0 ... Sunday = 6
function mondayIndex(date) {
  const d = date.getDay();
  return d === 0 ? 6 : d - 1;
}

function startOfWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - mondayIndex(d));
  return d;
}

const WEEKDAYS = [
  { value: 0, label: "Monday" },
  { value: 1, label: "Tuesday" },
  { value: 2, label: "Wednesday" },
  { value: 3, label: "Thursday" },
  { value: 4, label: "Friday" },
  { value: 5, label: "Saturday" },
  { value: 6, label: "Sunday" },
];

// Which weekdays each Morning/Evening schedule applies to (Monday = 0 ... Sunday = 6,
// matching mondayIndex/startOfWeek above).
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

// Maps Open-Meteo's WMO weather codes to a simple icon, day/night aware.
function weatherIconFor(code, isDay) {
  if (code === 0) return isDay ? Sun : Moon;
  if (code === 1 || code === 2) return isDay ? CloudSun : CloudMoon;
  if (code === 3 || code === 45 || code === 48) return Cloud;
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return CloudRain;
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return CloudSnow;
  if (code >= 95) return CloudLightning;
  return Cloud;
}

// ---- Weather: where, and what color the date card turns ----
// The household's weather location lives with the household's data, so every
// device shows the same place. null = none set: no weather is shown at all.
// Households from before this setting existed were always shown Los Angeles,
// so they start there (nothing changes for them until someone picks a place).
const LEGACY_LOCATION = { name: "Los Angeles, California", lat: 34.05, lon: -118.24, units: "F" };
const LOCATION_CACHE_KEY = "cc-location-cache";

// Only the rough spot is ever kept: two decimals is about a kilometer.
function roundCoord(n) {
  return Math.round(Number(n) * 100) / 100;
}
function cleanLocation(loc) {
  if (!loc || typeof loc !== "object") return null;
  const lat = Number(loc.lat);
  const lon = Number(loc.lon);
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return {
    name: String(loc.name || "Your location").slice(0, 80),
    lat: roundCoord(lat),
    lon: roundCoord(lon),
    units: loc.units === "C" ? "C" : "F",
  };
}
// Fahrenheit where people use it, Celsius everywhere else.
function unitsForCountry(cc) {
  return ["US", "PR", "GU", "VI", "AS", "MP", "LR", "BS", "BZ", "KY", "PW", "FM", "MH"].includes(String(cc || "").toUpperCase()) ? "F" : "C";
}
function unitsForThisDevice() {
  try {
    const loc = (navigator.language || "") + "";
    const region = loc.split("-")[1];
    return region ? unitsForCountry(region) : "F";
  } catch (e) {
    return "F";
  }
}
// One line per search result: "Pasadena, California" (US) or "Paris, Île-de-France, France".
function placeLabel(r) {
  const parts = [r.name];
  if (r.admin1 && r.admin1 !== r.name) parts.push(r.admin1);
  if (r.country && String(r.country_code || "").toUpperCase() !== "US") parts.push(r.country);
  return parts.join(", ");
}

// The date card's colors for each kind of weather. Snow is a light card, so its text is dark.
const WEATHER_THEMES = {
  none: { bg: "linear-gradient(135deg, #FF6B9D, #7B61FF)", fg: "#FFFFFF", shadow: "0 4px 14px rgba(123,97,255,0.35)", rule: "rgba(255,255,255,0.3)" },
  sunny: { bg: "linear-gradient(135deg, #F7A21B, #E35D12)", fg: "#FFFFFF", shadow: "0 4px 14px rgba(200,80,10,0.35)", rule: "rgba(255,255,255,0.35)" },
  cloudy: { bg: "linear-gradient(135deg, #8C98AE, #57637C)", fg: "#FFFFFF", shadow: "0 4px 14px rgba(40,50,70,0.3)", rule: "rgba(255,255,255,0.3)" },
  rain: { bg: "linear-gradient(135deg, #3E95DA, #2253B5)", fg: "#FFFFFF", shadow: "0 4px 14px rgba(30,70,160,0.35)", rule: "rgba(255,255,255,0.3)" },
  storm: { bg: "linear-gradient(135deg, #6A5C93, #312A4D)", fg: "#FFFFFF", shadow: "0 4px 14px rgba(40,30,80,0.4)", rule: "rgba(255,255,255,0.3)" },
  snow: { bg: "linear-gradient(135deg, #E4F2FC, #A9D2F0)", fg: "#1C3554", shadow: "0 4px 14px rgba(60,110,160,0.3)", rule: "rgba(28,53,84,0.25)" },
  night: { bg: "linear-gradient(135deg, #24325A, #0B1022)", fg: "#FFFFFF", shadow: "0 4px 14px rgba(5,10,30,0.45)", rule: "rgba(255,255,255,0.25)" },
};
// Which colors to use: night from sunset to sunrise whatever the weather,
// otherwise by Open-Meteo's weather code. No weather = the usual pink-purple.
function weatherThemeKey(weather) {
  if (!weather) return "none";
  if (!weather.isDay) return "night";
  const code = weather.code;
  if (code === 0 || code === 1 || code === 2) return "sunny";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 95) return "storm";
  return "cloudy";
}

// Quick-fill shortcuts for the day picker — clicking one just fills in the
// toggles below it. The actual chore only ever stores the day array itself,
// so any custom combination is just as valid as these presets.
const DAY_PRESETS = [
  { label: "Every day", days: [0, 1, 2, 3, 4, 5, 6] },
  { label: "Weekdays", days: [0, 1, 2, 3, 4] },
  { label: "Weekends", days: [5, 6] },
  { label: "School nights", days: [6, 0, 1, 2, 3] }, // Sunday through Thursday
];

const DAY_TOGGLES = [
  { value: 0, label: "Mo" },
  { value: 1, label: "Tu" },
  { value: 2, label: "We" },
  { value: 3, label: "Th" },
  { value: 4, label: "Fr" },
  { value: 5, label: "Sa" },
  { value: 6, label: "Su" },
];

function formatDayList(days) {
  if (!days || days.length === 0 || days.length === 7) return null;
  const sorted = [...days].sort((a, b) => a - b);
  return sorted.map((d) => DAY_TOGGLES.find((t) => t.value === d)?.label).join(", ");
}

// Walks backward from "today" to find the most recent earlier day this
// chore's day list applies to — used so a streak doesn't break just because
// a weekday-only chore skipped over a weekend, etc.
function mostRecentApplicableDay(days, today) {
  const list = days && days.length ? days : ALL_DAYS;
  const d = new Date(today);
  for (let i = 0; i < 8; i++) {
    d.setDate(d.getDate() - 1);
    if (list.includes(mondayIndex(d))) return d;
  }
  return null;
}

// Figures out whether a chore is currently "done" and/or "overdue" (blocking).
//   AM/PM chores: reset every day they apply — done means checked off today.
//     A schedule (everyday/weekdays/weekends/school nights) controls which
//     days it's even expected; on days it doesn't apply, it's hidden and
//     never blocks anything.
//   Anytime, one-time: done means ever completed; overdue only if a due date was set and passed.
//   Anytime, recurring: due weekly on a chosen weekday. Not blocking until that day arrives;
//     once it arrives, blocks every day until completed; completing it resets cleanly for the
//     following week regardless of when in the week it happened.
// Legacy mapping — briefly, chores stored a named "schedule" instead of an
// explicit day list. Kept only so any chore saved during that window still
// resolves correctly instead of silently reverting to "every day".
const LEGACY_SCHEDULE_DAYS = {
  everyday: [0, 1, 2, 3, 4, 5, 6],
  weekdays: [0, 1, 2, 3, 4],
  weekends: [5, 6],
  schoolnights: [6, 0, 1, 2, 3],
};

function resolveDays(c) {
  if (Array.isArray(c.days) && c.days.length > 0) return c.days;
  if (c.schedule && LEGACY_SCHEDULE_DAYS[c.schedule]) return LEGACY_SCHEDULE_DAYS[c.schedule];
  return ALL_DAYS;
}

function choreStatus(c, carriesOver) {
  // Bonus chores use the same day picker as Morning/Evening — hidden entirely
  // on days they don't apply, resetting fresh each day they do. Still never
  // overdue and never blocking, no matter how long one sits unchecked.
  if (c.category === "BONUS") {
    const days = resolveDays(c);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const applicableToday = days.includes(mondayIndex(today));
    if (!applicableToday) {
      return { done: true, overdue: false, applicable: false };
    }
    const done = daysSince(c.lastDone) === 0;
    return { done, overdue: false, applicable: true };
  }

  if (!carriesOver) {
    const days = resolveDays(c);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const applicableToday = days.includes(mondayIndex(today));
    if (!applicableToday) {
      return { done: true, overdue: false, applicable: false };
    }
    const done = daysSince(c.lastDone) === 0;
    return { done, overdue: false, applicable: true };
  }

  if (c.freq === "once") {
    const done = !!c.lastDone;
    if (done) {
      // Stays visible and checked through the rest of the day it was
      // completed — then quietly drops out of the main view once the day
      // rolls over, same reset timing as everything else. Books already
      // keep a permanent record in the "Books read" history regardless.
      const stillToday = daysSince(c.lastDone) === 0;
      return { done: true, overdue: false, applicable: stillToday };
    }
    if (c.dueDate) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const due = new Date(c.dueDate);
      const daysUntilDue = Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      return { done: false, overdue: today > due, applicable: true, daysUntilDue };
    }
    return { done: false, overdue: false, applicable: true };
  }

  // Recurring Anytime chore with a weekly deadline
  if (typeof c.dueDay === "number") {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekStart = startOfWeek(today);
    let deadline = new Date(weekStart);
    deadline.setDate(weekStart.getDate() + c.dueDay);

    // A chore whose computed deadline this week falls before it was even
    // created hasn't had a genuine chance to be late — e.g., adding a "due
    // Monday" chore on a Saturday would otherwise show it as already
    // overdue, for a Monday that passed before the chore existed at all.
    // The chore id embeds its creation time (Date.now()_index), so this
    // needs no extra stored field to detect.
    const createdAtMs = parseInt((c.id || "").split("_")[0], 10);
    if (!isNaN(createdAtMs)) {
      const createdDay = new Date(createdAtMs);
      createdDay.setHours(0, 0, 0, 0);
      if (deadline.getTime() < createdDay.getTime()) {
        deadline = new Date(deadline);
        deadline.setDate(deadline.getDate() + 7);
      }
    }

    const lastDone = c.lastDone ? new Date(c.lastDone) : null;
    if (lastDone) lastDone.setHours(0, 0, 0, 0);
    const doneThisWeek = !!lastDone && lastDone >= weekStart && lastDone <= today;

    const notYetDue = today <= deadline;
    const daysUntilDue = Math.round((deadline.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return { done: doneThisWeek, overdue: !notYetDue && !doneThisWeek, applicable: true, daysUntilDue };
  }

  // Legacy Anytime chores created before deadlines existed — fall back to the old rolling window
  const done = daysSince(c.lastDone) === 0;
  const overdue = !done && daysSince(c.lastDone) > (c.freq || 7);
  return { done, overdue, applicable: true };
}

const CATEGORIES = [
  { id: "AM", label: "Morning", icon: Sun, carriesOver: false, accent: "#F59B1E", tint: "#FFF4DE" },
  { id: "PM", label: "Evening", icon: Moon, carriesOver: false, accent: "#7B61FF", tint: "#F1EDFF" },
  { id: "ANY", label: "Anytime", icon: Star, carriesOver: true, accent: "#1FA98A", tint: "#E3FAF3" },
  { id: "BONUS", label: "Bonus", icon: Sparkles, carriesOver: false, accent: "#3B9EE0", tint: "#E3F3FC" },
  { id: "BOOK", label: "Books", icon: BookOpen, carriesOver: true, accent: "#C9639A", tint: "#FBEAF3" },
];

const STARTER_KIDS = [
  { id: "k1", name: "Emma" },
  { id: "k2", name: "Jack" },
];

const STARTER_CHORES = [
  { id: "1", name: "Brush teeth", kidId: "k1", category: "AM", freq: 1, lastDone: null, streak: 0 },
  { id: "2", name: "Make bed", kidId: "k1", category: "AM", freq: 1, lastDone: null, streak: 0 },
  { id: "3", name: "Brush teeth", kidId: "k1", category: "PM", freq: 1, lastDone: null, streak: 0 },
  { id: "4", name: "Pick up clothes", kidId: "k1", category: "PM", freq: 1, lastDone: null, streak: 0 },
  { id: "5", name: "Feed the dog", kidId: "k1", category: "ANY", freq: 1, dueDay: null, lastDone: null, streak: 0 },
  { id: "6", name: "Brush teeth", kidId: "k2", category: "AM", freq: 1, lastDone: null, streak: 0 },
  { id: "7", name: "Get dressed", kidId: "k2", category: "AM", freq: 1, lastDone: null, streak: 0 },
  { id: "8", name: "Brush teeth", kidId: "k2", category: "PM", freq: 1, lastDone: null, streak: 0 },
  { id: "9", name: "Pick up clothes", kidId: "k2", category: "PM", freq: 1, lastDone: null, streak: 0 },
  { id: "10", name: "Clean your room", kidId: "k2", category: "ANY", freq: 7, dueDay: 4, lastDone: null, streak: 0 },
  { id: "11", name: "Pack overnight bag for camp", kidId: "k2", category: "ANY", freq: "once", dueDate: null, lastDone: null, streak: 0 },
  { id: "12", name: "Charlotte's Web", kidId: "k1", category: "BOOK", freq: "once", points: 5, lastDone: null, streak: 0 },
  { id: "13", name: "Unload the dishwasher", kidId: "k1", category: "BONUS", freq: 1, points: 1, lastDone: null, streak: 0 },
  { id: "14", name: "Set the table", kidId: "k2", category: "BONUS", freq: 1, points: 1, lastDone: null, streak: 0 },
];

const emptyForm = (defaultKidId) => ({ name: "", kidId: defaultKidId || "", kidIds: defaultKidId ? [defaultKidId] : [], category: "AM", freq: 1, dueDay: 4, dueDate: "", points: 0, days: [0, 1, 2, 3, 4, 5, 6] });

const defaultReward = () => ({ points: 0, lastPunchDate: null, history: [], log: [] });

export default function ChoreTracker() {
  const [kids, setKids] = useState(null);
  const [chores, setChores] = useState(null);
  const [rewards, setRewards] = useState(null);
  const [rewardsMenu, setRewardsMenu] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [now, setNow] = useState(new Date());
  // TEMP: seeded with sample data so the widget is visible here — this preview's
  // sandbox blocks the real fetch below. Once deployed for real, the fetch
  // succeeds and immediately overwrites this with live data automatically.
  // Current weather for the household's location, or null (none set, or not loaded yet).
  const [weather, setWeather] = useState(null);
  // The household's weather location (see cleanLocation). undefined = still loading.
  const [location, setLocationState] = useState(undefined);
  const locationRef = useRef(undefined);
  // True when the saved data came back WITHOUT a location field at all, which
  // means an older copy of the app saved over it. We put it back.
  const locationMissingRef = useRef(false);
  const [locationFixTick, setLocationFixTick] = useState(0);
  function rememberLocation(loc) {
    locationRef.current = loc;
    setLocationState(loc);
    try {
      localStorage.setItem(LOCATION_CACHE_KEY, JSON.stringify(loc));
    } catch (e) {}
  }
  const [fireworks, setFireworks] = useState(null); // array of particles | null

  const FIREWORK_COLORS = ["#FF6B9D", "#7B61FF", "#FFB03D", "#4ECB71", "#22B8A0"];

  function triggerFireworks() {
    const bursts = [
      { left: 25, top: 30 },
      { left: 75, top: 25 },
      { left: 50, top: 45 },
    ];
    const particles = [];
    bursts.forEach((origin, bi) => {
      for (let i = 0; i < 18; i++) {
        const angle = (Math.PI * 2 * i) / 18 + Math.random() * 0.3;
        const distance = 60 + Math.random() * 90;
        particles.push({
          id: `${bi}_${i}`,
          left: origin.left,
          top: origin.top,
          tx: Math.cos(angle) * distance,
          ty: Math.sin(angle) * distance,
          color: FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)],
          delay: bi * 0.15,
        });
      }
    });
    setFireworks(particles);
    setTimeout(() => setFireworks(null), 1800);
  }

  // Keep the displayed date correct on an always-on tablet, without needing a reload.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  // Weather for the household's location: fetched when the location is set
  // or changed, then quietly refreshed every 20 minutes. No location, no weather.
  const weatherKey = location ? location.lat + "," + location.lon + "," + location.units : "";
  useEffect(() => {
    if (!location) {
      setWeather(null);
      window.__ccRefreshWeather = null;
      return;
    }
    let cancelled = false;
    const loc = location;
    async function fetchWeather() {
      try {
        const res = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=temperature_2m,weather_code,is_day` +
            (loc.units === "C" ? "" : "&temperature_unit=fahrenheit")
        );
        const data = await res.json();
        if (!cancelled && data && data.current) {
          setWeather({ temp: Math.round(data.current.temperature_2m), code: data.current.weather_code, isDay: data.current.is_day === 1 });
        }
      } catch (e) {
        // Weather is non-essential: on a failed check, keep whatever we last had.
      }
    }
    setWeather(null); // a new place: don't show the old place's weather meanwhile
    fetchWeather();
    window.__ccRefreshWeather = fetchWeather; // for tests
    const timer = setInterval(fetchWeather, 20 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weatherKey]);

  const [filter, setFilter] = useState("All");
  const [showForm, setShowForm] = useState(false);
  // Parent Settings popup: null when closed, otherwise the open tab ("kids", "rewards", "screensaver", "household").
  const [settingsTab, setSettingsTab] = useState(null);
  const [restoreCandidate, setRestoreCandidate] = useState(null);
  const [restoreError, setRestoreError] = useState("");
  const restoreFileRef = useRef(null);
  const [redeemModalKidId, setRedeemModalKidId] = useState(null);
  const [selectedRewardId, setSelectedRewardId] = useState(null);
  const [redeemFlash, setRedeemFlash] = useState(null);
  const [expandedHistory, setExpandedHistory] = useState({});
  const [historyModalKidId, setHistoryModalKidId] = useState(null);
  const [expandedLogDate, setExpandedLogDate] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [newKidName, setNewKidName] = useState("");
  const [newRewardName, setNewRewardName] = useState("");
  const [newRewardCost, setNewRewardCost] = useState(3);
  const [confirmDeleteKidId, setConfirmDeleteKidId] = useState(null);
  const [avatarPickerKidId, setAvatarPickerKidId] = useState(null);
  const [deletedKidSnapshot, setDeletedKidSnapshot] = useState(null);
  const [draggedChoreId, setDraggedChoreId] = useState(null);
  const [dragOverChoreId, setDragOverChoreId] = useState(null);
  const [dragOverPosition, setDragOverPosition] = useState("before");
  const [parentPin, setParentPin] = useState(undefined); // undefined = not loaded yet, null = no PIN set
  const [dailyPointValue, setDailyPointValue] = useState(1);
  const [unlocked, setUnlocked] = useState(false);
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinModalMode, setPinModalMode] = useState("unlock"); // "unlock" | "setup"
  const [pinInput, setPinInput] = useState("");
  const [pinConfirmInput, setPinConfirmInput] = useState("");
  const [pinError, setPinError] = useState("");
  const [form, setForm] = useState(emptyForm());
  const formRef = useRef(null);
  const lastToggleRef = useRef({});
  const lastWrittenLogRef = useRef({});
  const rewardsPanelRef = useRef(null);
  const kidsPanelRef = useRef(null);
  const avatarPopoverRef = useRef(null);

  // Close the self-serve avatar popover when clicking anywhere outside it
  // (the trigger button included, since it shares the same wrapper ref).
  useEffect(() => {
    if (!avatarPickerKidId) return;
    function handleClickOutside(e) {
      if (avatarPopoverRef.current && !avatarPopoverRef.current.contains(e.target)) {
        setAvatarPickerKidId(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [avatarPickerKidId]);

  const stickyHeaderRef = useRef(null);

  // Scrolls a given ref'd element into view, offset by the sticky header's
  // actual height so it doesn't end up hidden underneath it. Shared by the
  // chore form and both admin panels — anything that can auto-open (say,
  // right after an unlock) needs to actually be visible when it does.
  function scrollElementIntoView(ref) {
    if (!ref.current) return;
    const headerHeight = stickyHeaderRef.current ? stickyHeaderRef.current.offsetHeight : 0;
    const targetY = ref.current.getBoundingClientRect().top + window.scrollY - headerHeight - 16;
    window.scrollTo({ top: Math.max(0, targetY), behavior: "smooth" });
  }

  // The add/edit form is a popup over wherever you are, and Esc closes it.
  // (The page behind is deliberately NOT frozen: hiding the scrollbar to
  // freeze it made the page reflow and jump. The popup scrolls on its own
  // instead, without dragging the page along.)
  useEffect(() => {
    if (!showForm) return;
    const onKey = (e) => {
      if (e.key === "Escape") cancelForm();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showForm]);

  // "Check for updates" (Settings, Household): asks the server for a newer
  // version right now instead of waiting for the next automatic check.
  const [updateMsg, setUpdateMsg] = useState("");
  function checkForUpdate() {
    if (typeof window.__ccCheckForUpdate !== "function") {
      setUpdateMsg("Update checks aren't available here.");
      return;
    }
    setUpdateMsg("Checking\u2026");
    window.__ccCheckForUpdate().then(
      (r) => {
        if (r === "updating") setUpdateMsg("New version found. Updating\u2026");
        else if (r === "current") setUpdateMsg("You're on the latest version (" + (window.__ccBuild || "dev") + ").");
        else setUpdateMsg("Update checks aren't available here.");
      },
      () => setUpdateMsg("Couldn't check right now. Check the connection and try again.")
    );
  }

  // Esc closes Settings too.
  useEffect(() => {
    if (!settingsTab) return;
    const onKey = (e) => {
      if (e.key === "Escape") setSettingsTab(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [settingsTab]);

  // Applies a freshly loaded/synced data blob to state — shared by the
  // initial load and by the live-sync listener (standalone builds only).
  function applyLoadedData(parsed) {
    const loadedKids = parsed.kids || STARTER_KIDS;
    setKids(loadedKids);
    setChores(parsed.chores || STARTER_CHORES);
    const loadedRewards = parsed.rewards || {};
    loadedKids.forEach((k) => {
      if (!loadedRewards[k.id]) loadedRewards[k.id] = defaultReward();
      else if (!loadedRewards[k.id].log) loadedRewards[k.id] = { ...loadedRewards[k.id], log: [] };
    });
    setRewards(loadedRewards);
    setRewardsMenu(parsed.rewardsMenu || REWARD_MENU_STARTER);
    setParentPin(parsed.parentPin !== undefined ? parsed.parentPin : null);
    setDailyPointValue(typeof parsed.dailyPointValue === "number" ? parsed.dailyPointValue : 1);
    if (Object.prototype.hasOwnProperty.call(parsed, "location")) {
      locationMissingRef.current = false;
      rememberLocation(cleanLocation(parsed.location));
    } else {
      // No location field at all: either a household from before this setting
      // (it was always shown Los Angeles), or an older copy of the app just
      // saved over it. Use what this device last knew, else Los Angeles, and save it back.
      let known;
      try {
        const cached = localStorage.getItem(LOCATION_CACHE_KEY);
        if (cached !== null) known = cleanLocation(JSON.parse(cached));
      } catch (e) {}
      if (known === undefined) known = LEGACY_LOCATION;
      locationMissingRef.current = true;
      rememberLocation(known);
      setLocationFixTick((t) => t + 1);
    }
  }

  useEffect(() => {
    (async () => {
      try {
        const result = await window.storage.get(STORAGE_KEY, true);
        if (result) {
          applyLoadedData(JSON.parse(result.value));
        } else {
          // migrate from older storage versions if present
          let legacyKids = null;
          let legacyChores = null;
          let legacyRewards = null;
          try {
            const v4 = await window.storage.get(LEGACY_KEY_V4, true);
            if (v4) {
              const parsed = JSON.parse(v4.value);
              legacyKids = parsed.kids;
              legacyChores = parsed.chores;
              // old punch-card rewards don't map to points cleanly; start fresh but keep kids/chores
              legacyRewards = {};
            }
          } catch (e) {
            /* no v4 data */
          }
          if (!legacyKids) {
            try {
              const v3 = await window.storage.get(LEGACY_KEY_V3, true);
              if (v3) {
                const parsed = JSON.parse(v3.value);
                legacyKids = parsed.kids;
                legacyChores = parsed.chores;
                legacyRewards = {};
              }
            } catch (e) {
              /* no v3 data */
            }
          }
          if (!legacyKids) {
            try {
              const v2 = await window.storage.get(LEGACY_KEY_V2, true);
              if (v2) {
                const oldChores = JSON.parse(v2.value);
                const names = Array.from(new Set(oldChores.map((c) => c.kid)));
                legacyKids = names.map((name, i) => ({ id: `k${i}_${Date.now()}`, name }));
                const nameToId = Object.fromEntries(legacyKids.map((k) => [k.name, k.id]));
                legacyChores = oldChores.map(({ kid, ...rest }) => ({ ...rest, kidId: nameToId[kid] }));
                legacyRewards = {};
              }
            } catch (e) {
              /* no v2 data */
            }
          }
          if (legacyKids && legacyChores) {
            const nextRewards = legacyRewards || {};
            legacyKids.forEach((k) => {
              if (!nextRewards[k.id]) nextRewards[k.id] = defaultReward();
            });
            setKids(legacyKids);
            setChores(legacyChores);
            setRewards(nextRewards);
            setRewardsMenu(REWARD_MENU_STARTER);
            setParentPin(null);
            await window.storage.set(
              STORAGE_KEY,
              JSON.stringify({ kids: legacyKids, chores: legacyChores, rewards: nextRewards, rewardsMenu: REWARD_MENU_STARTER }),
              true
            );
          } else {
            setKids(STARTER_KIDS);
            setChores(STARTER_CHORES);
            setRewards(Object.fromEntries(STARTER_KIDS.map((k) => [k.id, defaultReward()])));
            setRewardsMenu(REWARD_MENU_STARTER);
            setParentPin(null);
          }
          rememberLocation(null); // a brand-new household: no weather until a place is chosen
        }
      } catch (e) {
        // A real failure (network, quota, permissions, anything) must never
        // look the same as "this household is just new and empty" — that
        // would silently show fake demo data with zero indication anything
        // is actually wrong, which is worse than an honest error screen.
        setLoadError(true);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Live sync — only active in the standalone build, where the exported
  // HTML injects window.subscribeToSync backed by Firestore. In this chat
  // preview, window.subscribeToSync doesn't exist, so this is a no-op and
  // nothing changes from how the app has always worked here.
  useEffect(() => {
    if (typeof window.subscribeToSync === "function") {
      const unsubscribe = window.subscribeToSync(applyLoadedData);
      return () => {
        if (typeof unsubscribe === "function") unsubscribe();
      };
    }
  }, []);

  // Put the location back if an older copy of the app saved over it.
  useEffect(() => {
    if (loading || !locationMissingRef.current) return;
    locationMissingRef.current = false;
    persist();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, locationFixTick]);

  // Settings > Household > Weather.
  function saveLocation(loc) {
    rememberLocation(loc ? cleanLocation(loc) : null);
    persist();
  }

  const pendingWriteTimerRef = useRef(null);
  const pendingPayloadRef = useRef(null);

  async function persist(nextChores, nextKids, nextRewards, nextRewardsMenu, nextParentPin, nextDailyPointValue) {
    const useChores = nextChores !== undefined ? nextChores : chores;
    const useKids = nextKids !== undefined ? nextKids : kids;
    const useRewards = nextRewards !== undefined ? nextRewards : rewards;
    const useRewardsMenu = nextRewardsMenu !== undefined ? nextRewardsMenu : rewardsMenu;
    const useParentPin = nextParentPin !== undefined ? nextParentPin : parentPin;
    const useDailyPointValue = nextDailyPointValue !== undefined ? nextDailyPointValue : dailyPointValue;
    setChores(useChores);
    setKids(useKids);
    setRewards(useRewards);
    setRewardsMenu(useRewardsMenu);
    setParentPin(useParentPin);
    setDailyPointValue(useDailyPointValue);

    const payload = JSON.stringify({
      kids: useKids,
      chores: useChores,
      rewards: useRewards,
      rewardsMenu: useRewardsMenu,
      parentPin: useParentPin,
      dailyPointValue: useDailyPointValue,
      location: locationRef.current === undefined ? null : locationRef.current,
    });

    // Local state above is already updated, so the UI feels instant either
    // way. The actual network write is debounced — if persist() gets called
    // several times in quick succession (rapid taps, or any accidental
    // feedback loop), only the *last* payload within a short window actually
    // gets sent, instead of flooding Firestore with one write per call.
    pendingPayloadRef.current = payload;
    setSaving(true);
    if (pendingWriteTimerRef.current) clearTimeout(pendingWriteTimerRef.current);
    pendingWriteTimerRef.current = setTimeout(() => {
      pendingWriteTimerRef.current = null;
      sendPendingWrite();
    }, 350);
  }

  async function sendPendingWrite() {
    const payload = pendingPayloadRef.current;
    if (payload === null) return;
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    // Races each save attempt against a timeout — Firestore can internally
    // queue a write and hang on it during backoff (rather than failing
    // fast), and without this, a single hung attempt blocks the whole retry
    // loop forever: the spinner never stops, and the error banner never
    // gets a chance to show, since we'd never reach the point of giving up.
    function withTimeout(promise, ms) {
      return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);
    }

    let ok = false;
    // A couple of delayed retries — enough to ride out a brief rate limit,
    // without waiting so long it feels stuck.
    const delays = [0, 800, 2000];
    for (let i = 0; i < delays.length; i++) {
      if (delays[i] > 0) await wait(delays[i]);
      try {
        const result = await withTimeout(window.storage.set(STORAGE_KEY, payload, true), 6000);
        if (result) {
          ok = true;
          break;
        }
      } catch (e) {
        // fall through to the next retry
      }
    }
    // Only clear "saving" if nothing newer has been queued in the meantime —
    // otherwise a fresh persist() call already owns the spinner.
    if (pendingWriteTimerRef.current === null) {
      setSaveError(!ok);
      setSaving(false);
    }
    pendingPayloadRef.current = null;
  }

  // Locked controls: check unlocked before proceeding, otherwise prompt for the PIN.
  const pendingActionRef = useRef(null);
  const [pinSkipAction, setPinSkipAction] = useState(null);

  function withUnlock(action) {
    return () => {
      if (unlocked) {
        action();
      } else {
        pendingActionRef.current = action;
        setPinModalMode(parentPin ? "unlock" : "setup");
        setPinInput("");
        setPinConfirmInput("");
        setPinError("");
        setShowPinModal(true);
      }
    };
  }

  // Unlike withUnlock, this always demands the PIN even if already unlocked —
  // reserved for irreversible actions like deleting a kid, since "unlocked"
  // can persist for up to 60 seconds and shouldn't be enough on its own.
  function requirePin(action) {
    return () => {
      pendingActionRef.current = action;
      setPinModalMode(parentPin ? "unlock" : "setup");
      setPinInput("");
      setPinConfirmInput("");
      setPinError("");
      setShowPinModal(true);
    };
  }

  function submitPin() {
    if (pinModalMode === "setup") {
      if (pinInput.length < 4) {
        setPinError("PIN needs at least 4 digits");
        return;
      }
      if (pinInput !== pinConfirmInput) {
        setPinError("PINs don't match");
        return;
      }
      persist(undefined, undefined, undefined, undefined, pinInput);
      setUnlocked(true);
      setShowPinModal(false);
      setPinSkipAction(null);
      if (pendingActionRef.current) {
        const action = pendingActionRef.current;
        pendingActionRef.current = null;
        setTimeout(action, 0);
      }
    } else {
      if (pinInput === parentPin) {
        setUnlocked(true);
        setShowPinModal(false);
        setPinSkipAction(null);
        if (pendingActionRef.current) {
          const action = pendingActionRef.current;
          pendingActionRef.current = null;
          setTimeout(action, 0);
        }
      } else {
        setPinError("Incorrect PIN");
        setPinInput("");
      }
    }
  }

  // For the add-chore approval shortcut specifically — lets someone skip
  // entering the PIN and proceed on the pending-approval path instead,
  // rather than being stuck unless they authenticate.
  function skipPin() {
    if (pinSkipAction) {
      const action = pinSkipAction;
      setPinSkipAction(null);
      pendingActionRef.current = null;
      setShowPinModal(false);
      setTimeout(action, 0);
    }
  }

  function toggleLock() {
    if (unlocked) {
      setUnlocked(false);
    } else {
      pendingActionRef.current = null;
      setPinModalMode(parentPin ? "unlock" : "setup");
      setPinInput("");
      setPinConfirmInput("");
      setPinError("");
      setShowPinModal(true);
    }
  }

  // Auto-relock after 2 minutes of genuine inactivity — not a flat timer
  // from the moment of unlocking, which used to log someone out mid-task
  // just for being slower than 60 seconds. Any click, tap, keypress, or
  // scroll while unlocked resets the clock; it only fires after real idle
  // time, so an actively-used session never gets interrupted.
  const lastActivityRef = useRef(Date.now());
  useEffect(() => {
    if (!unlocked) return;
    lastActivityRef.current = Date.now();
    const resetActivity = () => {
      lastActivityRef.current = Date.now();
    };
    const events = ["mousedown", "touchstart", "keydown", "scroll"];
    events.forEach((evt) => document.addEventListener(evt, resetActivity));

    const IDLE_LIMIT_MS = 2 * 60 * 1000;
    const interval = setInterval(() => {
      if (Date.now() - lastActivityRef.current >= IDLE_LIMIT_MS) {
        setUnlocked(false);
      }
    }, 5000);

    return () => {
      events.forEach((evt) => document.removeEventListener(evt, resetActivity));
      clearInterval(interval);
    };
  }, [unlocked]);

  // Screensaver: after 10 minutes with no taps, clicks or typing, the app turns
  // into a big dark clock. Changes arriving from other devices don't count as
  // activity. It never starts on top of something you're in the middle of
  // (the chore form, the PIN box, Devices, the help screen), and starting it
  // also locks parent controls. The tap that wakes it does nothing else.
  // On/off and the wait time are remembered on THIS device only (not synced),
  // so it can be on for a wall tablet and off on a parent's phone. Off by default.
  const [screensaverPref, setScreensaverPref] = useState(() => {
    try {
      const p = JSON.parse(localStorage.getItem("cc-screensaver") || "null");
      if (p && typeof p === "object") return { on: !!p.on, minutes: [5, 10, 30].includes(p.minutes) ? p.minutes : 10 };
    } catch (e) {}
    return { on: false, minutes: 10 };
  });
  function updateScreensaverPref(change) {
    setScreensaverPref((prev) => {
      const next = { ...prev, ...change };
      try {
        localStorage.setItem("cc-screensaver", JSON.stringify(next));
      } catch (e) {}
      return next;
    });
    lastInteractionRef.current = Date.now();
  }
  const screensaverPrefRef = useRef(screensaverPref);
  screensaverPrefRef.current = screensaverPref;
  const [screensaver, setScreensaver] = useState(false);
  const [clockNow, setClockNow] = useState(new Date());
  const [clockDrift, setClockDrift] = useState({ x: 0, y: 0 });
  const lastInteractionRef = useRef(Date.now());
  const showFormRef = useRef(false);
  const showPinModalRef = useRef(false);
  useEffect(() => {
    showFormRef.current = showForm;
    showPinModalRef.current = showPinModal;
  });
  useEffect(() => {
    const touched = () => {
      lastInteractionRef.current = Date.now();
    };
    const events = ["pointerdown", "touchstart", "keydown", "wheel", "mousemove"];
    events.forEach((evt) => document.addEventListener(evt, touched, { passive: true }));
    const interval = setInterval(() => {
      const pref = screensaverPrefRef.current;
      if (!pref.on) return;
      const waitMs = (typeof window !== "undefined" && window.__ccScreensaverMsForTests) || pref.minutes * 60 * 1000;
      if (Date.now() - lastInteractionRef.current < waitMs) return;
      const busy =
        showFormRef.current ||
        showPinModalRef.current ||
        !!document.getElementById("cc-settings") ||
        !!document.getElementById("cc-devices") ||
        !!document.getElementById("cc-help-close");
      if (busy) return;
      setUnlocked(false);
      setScreensaver(true);
    }, 1000);
    return () => {
      events.forEach((evt) => document.removeEventListener(evt, touched));
      clearInterval(interval);
    };
  }, []);
  useEffect(() => {
    if (!screensaver) return;
    setClockNow(new Date());
    const tick = setInterval(() => setClockNow(new Date()), 5000);
    // Drift slowly to a new spot every 5 minutes (a 30-second glide), so nothing sits still for hours.
    const move = () => setClockDrift({ x: Math.round((Math.random() - 0.5) * 14), y: Math.round((Math.random() - 0.5) * 30) });
    move();
    const drift = setInterval(move, 5 * 60 * 1000);
    const onKey = () => wakeScreensaver();
    document.addEventListener("keydown", onKey);
    return () => {
      clearInterval(tick);
      clearInterval(drift);
      document.removeEventListener("keydown", onKey);
    };
  }, [screensaver]);
  function wakeScreensaver(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    lastInteractionRef.current = Date.now();
    setScreensaver(false);
  }

  // Kids/Rewards panels are only reachable while unlocked (their trigger
  // buttons are hidden otherwise) — close them the moment the app re-locks,
  // whether that's manual or the 60-second auto-relock above.
  useEffect(() => {
    if (!unlocked) setSettingsTab(null);
  }, [unlocked]);

  // Each time chores change, record (or update) today's log entry for every kid —
  // whether they got a point, and the per-chore done/not-done snapshot behind it.
  // Also awards the day's point once, the first time a kid goes fully clear.
  useEffect(() => {
    if (loading || !kids || !chores || !rewards) return;
    let changed = false;
    const today = todayKey();
    const nextRewards = { ...rewards };
    kids.forEach((kid) => {
      const kidChores = chores.filter((c) => c.kidId === kid.id && c.category !== "BOOK" && c.category !== "BONUS");
      const kidBonusChores = chores.filter((c) => c.kidId === kid.id && c.category === "BONUS");
      if (kidChores.length === 0 && kidBonusChores.length === 0) return;

      const choreSnapshots = kidChores.map((c) => {
        const cat = CATEGORIES.find((cat) => cat.id === c.category);
        const status = choreStatus(c, cat ? cat.carriesOver : false);
        const snapshot = { name: c.name, category: c.category, done: status.done, overdue: status.overdue };
        if (c.points > 0) snapshot.points = c.points;
        return snapshot;
      });
      // A kid earns today's point if every chore is either done, or (for
      // Anytime chores) simply not yet due.
      const fullyClear =
        kidChores.length === 0 ||
        kidChores.every((c) => {
          const cat = CATEGORIES.find((cat) => cat.id === c.category);
          const carriesOver = cat ? cat.carriesOver : false;
          const status = choreStatus(c, carriesOver);
          if (!carriesOver) return status.done;
          return status.done || !status.overdue;
        });

      // Any Morning/Evening/Anytime chore with a real point value pays
      // directly when checked (handled in toggleDone) — this folds today's
      // earned amounts into the log's display tally, on top of the
      // all-or-nothing completion bonus below, not instead of it. Chores
      // left at the default of 0 simply contribute nothing here.
      let perChorePointsToday = 0;
      kidChores.forEach((c) => {
        if (!(c.points > 0)) return;
        const cat = CATEGORIES.find((cat) => cat.id === c.category);
        const status = choreStatus(c, cat ? cat.carriesOver : false);
        if (status.done) perChorePointsToday += c.points;
      });

      // Bonus chores pay their own points independently (handled entirely in
      // toggleDone) — this just folds today's applicable ones into the log's
      // display tally and breakdown, without touching how points get banked.
      let bonusPointsToday = 0;
      const bonusSnapshots = [];
      kidBonusChores.forEach((c) => {
        const status = choreStatus(c, true);
        if (status.applicable === false) return;
        if (status.done) bonusPointsToday += c.points || 0;
        bonusSnapshots.push({ name: c.name, category: c.category, done: status.done, overdue: false, points: c.points || 0 });
      });

      const pointsEarnedToday = (fullyClear && kidChores.length > 0 ? dailyPointValue : 0) + bonusPointsToday + perChorePointsToday;
      const combinedSnapshots = [...choreSnapshots, ...bonusSnapshots];

      const r = nextRewards[kid.id] || defaultReward();
      let rChanged = false;

      // Upsert today's log entry — but first check against what THIS device
      // itself last wrote for today, not just what state currently shows.
      // Without this, two synced tabs can ping-pong forever: each one sees
      // the other's echoed write, recomputes, finds a trivial mismatch
      // against its own in-flight state, and rewrites — which the other tab
      // then reacts to the same way, with nobody actually clicking anything.
      const freshSignature = stableStringify({ pointsEarned: pointsEarnedToday, chores: combinedSnapshots });
      const alreadyWrittenByThisDevice = lastWrittenLogRef.current[kid.id]?.date === today && lastWrittenLogRef.current[kid.id]?.signature === freshSignature;

      const existingIdx = (r.log || []).findIndex((e) => e.date === today);
      const existing = existingIdx >= 0 ? r.log[existingIdx] : null;
      const entryChanged =
        !alreadyWrittenByThisDevice &&
        (!existing || existing.pointsEarned !== pointsEarnedToday || stableStringify(existing.chores) !== stableStringify(combinedSnapshots));
      let nextLog = r.log || [];
      if (entryChanged) {
        const entry = { date: today, pointsEarned: pointsEarnedToday, chores: combinedSnapshots };
        nextLog = existingIdx >= 0 ? r.log.map((e, i) => (i === existingIdx ? entry : e)) : [entry, ...(r.log || [])].slice(0, 60);
        rChanged = true;
        lastWrittenLogRef.current[kid.id] = { date: today, signature: freshSignature };
      }

      // Today's daily-completion point is fully live — it can be awarded and
      // revoked as the day's status changes. Once the date rolls over,
      // lastPunchDate stops matching "today" and that day's point is locked
      // in for good. Bonus points are NOT touched here — they're awarded
      // directly by toggleDone the moment each one is checked.
      let nextPoints = r.points;
      let nextLastPunchDate = r.lastPunchDate;
      if (fullyClear && kidChores.length > 0 && r.lastPunchDate !== today) {
        nextPoints = r.points + dailyPointValue;
        nextLastPunchDate = today;
        rChanged = true;
        triggerFireworks();
      } else if (!fullyClear && r.lastPunchDate === today) {
        nextPoints = Math.max(0, r.points - dailyPointValue);
        nextLastPunchDate = null;
        rChanged = true;
      }

      if (rChanged) {
        nextRewards[kid.id] = { ...r, points: nextPoints, lastPunchDate: nextLastPunchDate, log: nextLog };
        changed = true;
      } else if (!nextRewards[kid.id]) {
        nextRewards[kid.id] = r;
        changed = true;
      }
    });
    if (changed) persist(undefined, undefined, nextRewards);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chores, kids, loading]);

  function toggleDone(id) {
    // Guards against "ghost" duplicate tap events some touchscreen browsers
    // fire from a single physical touch — without this, that shows up as
    // one tap checking a chore and immediately un-checking it again.
    const now = Date.now();
    if (now - (lastToggleRef.current[id] || 0) < 400) return;
    lastToggleRef.current[id] = now;

    const chore = chores.find((c) => c.id === id);
    if (!chore) return;
    if (chore.pending) return; // not approved yet — can't be checked off

    // Books award their own points directly, right when checked — separate
    // from the daily point mechanic entirely. Unchecking gives the points back.
    if (chore.category === "BOOK") {
      const nowDone = !chore.lastDone;
      const nextChores = chores.map((c) => (c.id === id ? { ...c, lastDone: nowDone ? todayKey() : null } : c));
      const r = rewards[chore.kidId] || defaultReward();
      const amount = chore.points || 0;
      const nextPoints = nowDone ? r.points + amount : Math.max(0, r.points - amount);
      const nextRewards = { ...rewards, [chore.kidId]: { ...r, points: nextPoints } };
      persist(nextChores, undefined, nextRewards);
      if (nowDone) triggerFireworks();
      return;
    }

    // Bonus chores also pay their own points directly, but — unlike Books — they
    // reset each day they apply — hidden entirely on days they don't, same
    // day-picker as Morning/Evening chores.
    if (chore.category === "BONUS") {
      const isDoneNow = daysSince(chore.lastDone) === 0;
      const nowDone = !isDoneNow;
      const nextChores = chores.map((c) => (c.id === id ? { ...c, lastDone: nowDone ? todayKey() : null } : c));
      const r = rewards[chore.kidId] || defaultReward();
      const amount = chore.points || 0;
      const nextPoints = nowDone ? r.points + amount : Math.max(0, r.points - amount);
      const nextRewards = { ...rewards, [chore.kidId]: { ...r, points: nextPoints } };
      persist(nextChores, undefined, nextRewards);
      if (nowDone) triggerFireworks();
      return;
    }

    const next = chores.map((c) => {
      if (c.id !== id) return c;
      if (c.freq === "once") {
        return { ...c, lastDone: c.lastDone ? null : todayKey() };
      }

      // "Currently done" has to match how this is actually displayed —
      // for a weekly Anytime chore (has a dueDay) that's "done ANY day this
      // week," not literally today. Using a same-day-only check here meant
      // a chore completed earlier in the week could never be unchecked: the
      // click would fall into the "not done yet" branch instead, silently
      // re-stamping it and bumping the streak again, while the box never
      // visibly unchecked since it still counted as done either way.
      let isCurrentlyDone;
      if (typeof c.dueDay === "number") {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const weekStart = startOfWeek(today);
        const lastDoneDate = c.lastDone ? new Date(c.lastDone) : null;
        if (lastDoneDate) lastDoneDate.setHours(0, 0, 0, 0);
        isCurrentlyDone = !!lastDoneDate && lastDoneDate >= weekStart && lastDoneDate <= today;
      } else {
        isCurrentlyDone = daysSince(c.lastDone) === 0;
      }

      if (isCurrentlyDone) {
        // Restore the real prior completion date instead of blanking it to
        // null — otherwise a check-uncheck-check cycle looks identical to
        // "never done before" and wipes an existing streak down to 1.
        return { ...c, lastDone: c.previousLastDone || null, streak: Math.max(0, c.streak - 1) };
      }
      let wasOnTime;
      if (c.category === "AM" || c.category === "PM") {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const expected = mostRecentApplicableDay(resolveDays(c), today);
        const lastDone = c.lastDone ? new Date(c.lastDone) : null;
        if (lastDone) lastDone.setHours(0, 0, 0, 0);
        wasOnTime = !expected || (lastDone && lastDone >= expected);
      } else {
        wasOnTime = daysSince(c.lastDone) <= (typeof c.dueDay === "number" ? 7 : c.freq);
      }
      return { ...c, previousLastDone: c.lastDone, lastDone: todayKey(), streak: c.lastDone ? (wasOnTime ? c.streak + 1 : 1) : 1 };
    });

    // Any Morning/Evening/Anytime chore with a real point value pays
    // directly, the same way Bonus already does — on top of, not instead
    // of, the all-or-nothing completion bonus, which the daily-log effect
    // still awards separately. Chores left at the default of 0 simply have
    // no effect here. Computed by comparing done-state before and after, so
    // it works the same for both one-time and recurring chores without
    // touching the logic above.
    let nextRewards;
    const original = chores.find((c) => c.id === id);
    const updated = next.find((c) => c.id === id);
    if (original && updated && updated.points > 0) {
      const cat = CATEGORIES.find((cat) => cat.id === updated.category);
      const carriesOver = cat ? cat.carriesOver : false;
      const wasDone = choreStatus(original, carriesOver).done;
      const nowDone = choreStatus(updated, carriesOver).done;
      if (wasDone !== nowDone) {
        const amount = updated.points || 0;
        const r = rewards[updated.kidId] || defaultReward();
        const points = nowDone ? r.points + amount : Math.max(0, r.points - amount);
        nextRewards = { ...rewards, [updated.kidId]: { ...r, points } };
        if (nowDone) triggerFireworks();
      }
    }
    persist(next, undefined, nextRewards);
  }

  function startAdd() {
    setForm(emptyForm(filter !== "All" ? filter : kids[0]?.id));
    setEditingId(null);
    setShowForm(true);
  }

  // Opens the same add form, but already filled in with a specific kid and
  // category — used by the "+" inside each category box. Applies the same
  // per-category defaults the category dropdown does (Anytime weekly, Books
  // one-time and worth 3, Bonus worth 1, everything else 0 points).
  function startAddFor(kidId, category) {
    const freq = category === "ANY" ? 7 : category === "BOOK" ? "once" : 1;
    const points = category === "BOOK" ? 3 : category === "BONUS" ? 1 : 0;
    setForm({ ...emptyForm(kidId), category, freq, points });
    setEditingId(null);
    setShowForm(true);
  }

  // ---- Backup / restore (parent-only: lives in the Kids panel) ----
  function currentBackupJson() {
    return JSON.stringify(makeBackup({ kids, chores, rewards, rewardsMenu, dailyPointValue }, window.__ccBuild), null, 2);
  }

  function downloadBackup() {
    const blob = new Blob([currentBackupJson()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = backupFilename();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  async function shareBackup() {
    try {
      const file = new File([currentBackupJson()], backupFilename(), { type: "application/json" });
      await navigator.share({ files: [file], title: "Chore Chart backup" });
    } catch (e) {
      // Cancelled, or the browser said no — nothing to do either way.
    }
  }

  function onRestoreFileChosen(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const problem = checkBackup(parsed);
        if (problem) {
          setRestoreError(problem);
          setRestoreCandidate(null);
        } else {
          setRestoreError("");
          setRestoreCandidate(parsed);
        }
      } catch (err) {
        setRestoreError("That file couldn't be read as a backup.");
        setRestoreCandidate(null);
      }
    };
    reader.onerror = () => setRestoreError("That file couldn't be read.");
    reader.readAsText(file);
  }

  function confirmRestore() {
    if (!restoreCandidate) return;
    const d = restoreCandidate.data;
    // The parent PIN is left alone (undefined = keep the current one).
    persist(
      d.chores,
      d.kids,
      d.rewards,
      Array.isArray(d.rewardsMenu) ? d.rewardsMenu : undefined,
      undefined,
      typeof d.dailyPointValue === "number" ? d.dailyPointValue : undefined
    );
    setFilter("All");
    setRestoreCandidate(null);
    setRestoreError("");
  }

  function startEdit(c) {
    setForm({
      name: c.name,
      kidId: c.kidId,
      category: c.category,
      freq: c.freq,
      dueDay: typeof c.dueDay === "number" ? c.dueDay : null,
      dueDate: c.dueDate || "",
      points: typeof c.points === "number" ? c.points : 5,
      days: c.category === "AM" || c.category === "PM" || c.category === "BONUS" ? resolveDays(c) : [0, 1, 2, 3, 4, 5, 6],
    });
    setEditingId(c.id);
    setShowForm(true);
  }

  function cancelForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm());
  }

  // Returns null if the current form isn't valid to save/clone yet, otherwise
  // the chore fields derived from it (everything except id/kidId/lastDone/streak).
  function buildChorePayload() {
    if (!form.name.trim()) return null;
    if (form.category === "ANY" && form.freq !== "once" && form.dueDay === null) return null;
    if ((form.category === "AM" || form.category === "PM" || form.category === "BONUS") && (!form.days || form.days.length === 0)) return null;

    let payload;
    if (form.category === "ANY") {
      // Always store the value, regardless of which mode is currently
      // Always stored regardless of value — startEdit already carries a
      // chore's existing points forward into form.points, so editing never
      // wipes out a previously-set value. Harmless to store even at 0:
      // nothing reads or displays it unless it's actually above 0.
      // Always stored regardless of value — 0 is the meaningful default
      // (no points), not an edge case to avoid. Unlike Books/Bonus, which
      // always pay directly and so require a real positive value, these
      // categories only pay when a real point value is actually set.
      const anyPoints = Math.max(0, Number(form.points) || 0);
      if (form.freq === "once") {
        payload = { freq: "once", dueDay: null, dueDate: form.dueDate || null, points: anyPoints, days: null };
      } else {
        payload = { freq: 7, dueDay: Number(form.dueDay), dueDate: null, points: anyPoints, days: null };
      }
    } else if (form.category === "BOOK") {
      payload = { freq: "once", dueDay: null, dueDate: null, points: Math.max(0, Number(form.points) || 3), days: null };
    } else if (form.category === "BONUS") {
      payload = { freq: 1, dueDay: null, dueDate: null, points: Math.max(0, Number(form.points) || 1), days: form.days || ALL_DAYS };
    } else {
      const amPmPoints = Math.max(0, Number(form.points) || 0);
      payload = { freq: 1, dueDay: null, dueDate: null, points: amPmPoints, days: form.days || ALL_DAYS };
    }
    return { name: form.name.trim(), category: form.category, ...payload };
  }

  function saveChore(e) {
    e.preventDefault();
    const payload = buildChorePayload();
    if (!payload) return;

    if (editingId) {
      if (!form.kidId) return;
      const next = chores.map((c) => (c.id === editingId ? { ...c, kidId: form.kidId, ...payload } : c));
      persist(next);
      setForm(emptyForm(form.kidId));
      setEditingId(null);
      setShowForm(false);
      return;
    }

    const targetIds = form.kidIds && form.kidIds.length ? form.kidIds : [];
    if (targetIds.length === 0) return;

    const createChores = (pending) => {
      const newChores = targetIds.map((kidId, i) => ({
        id: `${Date.now()}_${i}`,
        kidId,
        ...payload,
        lastDone: null,
        streak: 0,
        pending,
      }));
      persist([...chores, ...newChores]);
      setForm(emptyForm(targetIds[0]));
      setEditingId(null);
      setShowForm(false);
    };

    // Any chore with a real point value needs approval when added while
    // locked — not just Books/Bonus. Since Morning/Evening/Anytime chores
    // can now also carry points, a category-only check here would let a
    // kid add a real point-bearing chore of those types and have it go
    // live immediately, skipping approval entirely.
    const isPointBearing = payload.points > 0;

    if (unlocked || !isPointBearing) {
      // Already unlocked, or not a point-bearing category — never needs
      // approval either way.
      createChores(false);
      return;
    }

    if (!parentPin) {
      // No PIN set up yet to offer the unlock-now shortcut through — falls
      // back to the original default of submitting for approval.
      createChores(true);
      return;
    }

    // Locked, point-bearing, and a PIN exists — offer the choice right here
    // instead of always defaulting to pending: unlock now to approve
    // immediately, or skip to submit for approval like before. This avoids
    // a parent needing a separate unlock-then-approve trip right after
    // adding something themselves.
    pendingActionRef.current = () => createChores(false);
    setPinSkipAction(() => () => createChores(true));
    setPinModalMode("unlock");
    setPinInput("");
    setPinConfirmInput("");
    setPinError("");
    setShowPinModal(true);
  }

  function removeChore(id) {
    persist(chores.filter((c) => c.id !== id));
    if (editingId === id) cancelForm();
  }

  // A kid-added Books/Bonus chore goes live once approved — just clears the
  // pending flag, nothing else about it changes.
  function approveChore(id) {
    persist(chores.map((c) => (c.id === id ? { ...c, pending: false } : c)));
  }

  // Rejecting a pending chore just discards it — there's nothing worth
  // keeping around once a parent's decided it shouldn't have been added.
  function rejectChore(id) {
    persist(chores.filter((c) => c.id !== id));
  }

  // Moves draggedId to just before or just after targetId, within the same
  // kid+category group only — every other chore's relative order is untouched.
  function reorderChore(kidId, category, draggedId, targetId, insertAfter) {
    if (draggedId === targetId) return;
    const subgroup = chores.filter((c) => c.kidId === kidId && c.category === category);
    const others = chores.filter((c) => !(c.kidId === kidId && c.category === category));
    const draggedIdx = subgroup.findIndex((c) => c.id === draggedId);
    if (draggedIdx === -1) return;
    const [moved] = subgroup.splice(draggedIdx, 1);
    const targetIdx = subgroup.findIndex((c) => c.id === targetId);
    const insertAt = targetIdx === -1 ? subgroup.length : insertAfter ? targetIdx + 1 : targetIdx;
    subgroup.splice(insertAt, 0, moved);
    persist([...others, ...subgroup]);
  }

  // Duplicates whatever's currently in the form for another kid — a fresh
  // copy with no completion history, independent of the chore being edited.
  function cloneChoreToKid(targetKidId) {
    const payload = buildChorePayload();
    if (!payload) return;
    const next = [...chores, { id: `${Date.now()}_${targetKidId}`, kidId: targetKidId, ...payload, lastDone: null, streak: 0 }];
    persist(next);
  }

  function cloneChoreToAll() {
    const payload = buildChorePayload();
    if (!payload) return;
    const others = kids.filter((k) => k.id !== form.kidId);
    const clones = others.map((k) => ({ id: `${Date.now()}_${k.id}`, kidId: k.id, ...payload, lastDone: null, streak: 0 }));
    persist([...chores, ...clones]);
  }

  function addKid() {
    const trimmed = newKidName.trim();
    if (!trimmed) return;
    const id = `k_${Date.now()}`;
    const next = [...kids, { id, name: trimmed }];
    const nextRewards = { ...rewards, [id]: defaultReward() };
    persist(undefined, next, nextRewards);
    setNewKidName("");
  }

  function renameKid(id, name) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const next = kids.map((k) => (k.id === id ? { ...k, name: trimmed } : k));
    persist(undefined, next);
  }

  function updateKidColor(id, color) {
    const next = kids.map((k) => (k.id === id ? { ...k, color } : k));
    persist(undefined, next);
  }

  function updateKidEmoji(id, emoji) {
    const next = kids.map((k) => (k.id === id ? { ...k, emoji: k.emoji === emoji ? null : emoji } : k));
    persist(undefined, next);
  }

  function setPoints(kidId, value) {
    const points = Math.max(0, Math.round(Number(value)) || 0);
    const r = rewards[kidId] || defaultReward();
    const nextRewards = { ...rewards, [kidId]: { ...r, points } };
    persist(undefined, undefined, nextRewards);
  }

  function deleteKid(id) {
    const kidToDelete = kids.find((k) => k.id === id);
    const choresToDelete = chores.filter((c) => c.kidId === id);
    const rewardsToDelete = rewards[id];

    const nextKids = kids.filter((k) => k.id !== id);
    const nextChores = chores.filter((c) => c.kidId !== id);
    const nextRewards = { ...rewards };
    delete nextRewards[id];
    persist(nextChores, nextKids, nextRewards);
    if (filter === id) setFilter("All");
    setConfirmDeleteKidId(null);

    setDeletedKidSnapshot({ kid: kidToDelete, chores: choresToDelete, rewards: rewardsToDelete });
    setTimeout(() => {
      setDeletedKidSnapshot((current) => (current && current.kid.id === id ? null : current));
    }, 10000);
  }

  function undoDeleteKid() {
    if (!deletedKidSnapshot) return;
    const { kid, chores: kidChores, rewards: kidRewards } = deletedKidSnapshot;
    const nextKids = [...kids, kid];
    const nextChores = [...chores, ...kidChores];
    const nextRewards = { ...rewards, [kid.id]: kidRewards || defaultReward() };
    persist(nextChores, nextKids, nextRewards);
    setDeletedKidSnapshot(null);
  }

  function redeemReward(kidId, rewardItem) {
    const r = rewards[kidId] || defaultReward();
    if (r.points < rewardItem.cost) return;
    const entry = { name: rewardItem.name, cost: rewardItem.cost, date: todayKey(), paid: false };
    // A 60-day window, not a fixed count — matches the daily log's own
    // effective cap, and scales naturally with how often a kid actually
    // redeems rather than reserving space for a fixed number up front.
    const nextHistory = [entry, ...(r.history || [])].filter((h) => daysSince(h.date) < 60);
    const nextRewards = { ...rewards, [kidId]: { ...r, points: r.points - rewardItem.cost, history: nextHistory } };
    persist(undefined, undefined, nextRewards);
    setRedeemFlash(`${rewardItem.name} redeemed!`);
    setTimeout(() => setRedeemFlash(null), 2000);
  }

  // Marks an entry as paid out — it stays in the log with a celebration icon
  // rather than disappearing, so there's a record it was actually handed over.
  function markPaidOut(kidId, index) {
    const r = rewards[kidId] || defaultReward();
    const nextHistory = (r.history || []).map((h, i) => (i === index ? { ...h, paid: true } : h));
    const nextRewards = { ...rewards, [kidId]: { ...r, history: nextHistory } };
    persist(undefined, undefined, nextRewards);
  }

  // Deletes the log entry outright. If it hadn't been paid out yet, the
  // points are refunded — if it had already been paid, they aren't.
  function deleteHistoryEntry(kidId, index) {
    const r = rewards[kidId] || defaultReward();
    const entry = (r.history || [])[index];
    if (!entry) return;
    const refund = entry.paid ? 0 : entry.cost;
    const nextHistory = r.history.filter((_, i) => i !== index);
    const nextRewards = { ...rewards, [kidId]: { ...r, points: r.points + refund, history: nextHistory } };
    persist(undefined, undefined, nextRewards);
  }

  // TEST-ONLY HELPER: backfills the past week with plausible fake log entries
  // so the history popup has something to show. Safe to remove for real use —
  // it never touches today's entry and skips any date already logged.
  function seedSampleHistory(kidId) {
    const kidChores = chores.filter((c) => c.kidId === kidId && c.category !== "BOOK" && c.category !== "BONUS");
    if (kidChores.length === 0) return;
    const r = rewards[kidId] || defaultReward();
    const existingDates = new Set((r.log || []).map((e) => e.date));
    const newEntries = [];
    let bonusPoints = 0;

    for (let i = 1; i <= 7; i++) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const dateKey = d.toDateString();
      if (existingDates.has(dateKey)) continue;

      const gotPoint = Math.random() < 0.7;
      const snapshots = kidChores.map((c) => {
        const cat = CATEGORIES.find((cat) => cat.id === c.category);
        const done = gotPoint ? true : Math.random() < 0.6;
        return { name: c.name, category: c.category, done, overdue: !done && !!(cat && cat.carriesOver) };
      });
      if (!gotPoint && snapshots.every((s) => s.done)) snapshots[0].done = false;

      newEntries.push({ date: dateKey, pointsEarned: gotPoint ? dailyPointValue : 0, chores: snapshots });
      if (gotPoint) bonusPoints += dailyPointValue;
    }

    if (newEntries.length === 0) return;
    const nextLog = [...newEntries, ...(r.log || [])].slice(0, 60);
    const nextRewards = { ...rewards, [kidId]: { ...r, points: r.points + bonusPoints, log: nextLog } };
    persist(undefined, undefined, nextRewards);
  }

  function openRedeemModal(kidId) {
    setRedeemModalKidId(kidId);
    setSelectedRewardId(rewardsMenu[0]?.id || null);
    setRedeemFlash(null);
  }

  function closeRedeemModal() {
    setRedeemModalKidId(null);
    setSelectedRewardId(null);
    setRedeemFlash(null);
  }

  function addRewardItem() {
    const trimmed = newRewardName.trim();
    const cost = Math.max(1, Number(newRewardCost) || 1);
    if (!trimmed) return;
    const next = [...rewardsMenu, { id: `rm_${Date.now()}`, name: trimmed, cost }].sort((a, b) => a.cost - b.cost);
    persist(undefined, undefined, undefined, next);
    setNewRewardName("");
    setNewRewardCost(3);
  }

  function updateRewardItem(id, name, cost) {
    const trimmedName = name.trim();
    const safeCost = Math.max(1, Number(cost) || 1);
    if (!trimmedName) return;
    const next = rewardsMenu
      .map((item) => (item.id === id ? { ...item, name: trimmedName, cost: safeCost } : item))
      .sort((a, b) => a.cost - b.cost);
    persist(undefined, undefined, undefined, next);
  }

  function deleteRewardItem(id) {
    persist(undefined, undefined, undefined, rewardsMenu.filter((item) => item.id !== id));
  }

  const visibleKids = filter === "All" ? kids || [] : (kids || []).filter((k) => k.id === filter);
  const visibleKidIds = new Set(visibleKids.map((k) => k.id));
  const visibleChoreStatuses = chores
    ? chores
        .filter((c) => visibleKidIds.has(c.kidId) && c.category !== "BOOK" && c.category !== "BONUS")
        .map((c) => {
          const cat = CATEGORIES.find((cat) => cat.id === c.category);
          return choreStatus(c, cat ? cat.carriesOver : false);
        })
        .filter((status) => status.applicable !== false)
    : [];

  const doneTodayCount = visibleChoreStatuses.filter((status) => status.done).length;
  const totalCount = visibleChoreStatuses.length;

  if (loadError) {
    return (
      <div style={{ padding: 40, fontFamily: "'Nunito', -apple-system, sans-serif", color: "#2B2250", textAlign: "center", maxWidth: 420, margin: "0 auto" }}>
        <div style={{ fontFamily: "'Baloo 2', system-ui, sans-serif", fontSize: 20, fontWeight: 800, marginBottom: 10 }}>
          Couldn't load your household data
        </div>
        <div style={{ fontSize: 14.5, color: "#8A82C0", fontWeight: 600, marginBottom: 20 }}>
          This is usually temporary — a connection hiccup or a brief service issue. Your data hasn't been lost; this device just couldn't reach it right now.
        </div>
        <button
          onClick={() => window.location.reload()}
          style={{ padding: "11px 24px", borderRadius: 14, border: "none", background: "linear-gradient(135deg, #FF6B9D, #7B61FF)", color: "#fff", fontSize: 14.5, fontWeight: 700, cursor: "pointer" }}
        >
          Try again
        </button>
      </div>
    );
  }

  if (loading || !kids || !chores || !rewards || !rewardsMenu || parentPin === undefined) {
    return (
      <div style={{ padding: 40, fontFamily: "'Baloo 2', system-ui, sans-serif", color: "#2B2250" }}>
        Loading the chore chart…
      </div>
    );
  }

  return (
    <div
      style={{
        background:
          "#FFFFFF",
        minHeight: "100%",
        padding: "24px 20px 32px",
        fontFamily: "'Nunito', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        color: "#2B2250",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Baloo+2:wght@600;700;800&family=Nunito:wght@400;600;700;800&display=swap');
        .cc-check { transition: transform 0.12s ease; }
        .cc-check:active { transform: scale(0.82); }
        .cc-btn { transition: transform 0.1s ease, box-shadow 0.15s ease; }
        .cc-btn:active { transform: scale(0.96); }
        .cc-input:focus { outline: none; border-color: #7B61FF !important; }
        @keyframes cc-spin { to { transform: rotate(360deg); } }
        @keyframes cc-firework {
          0% { transform: translate(0, 0) scale(0.4); opacity: 1; }
          70% { opacity: 1; }
          100% { transform: translate(var(--tx), var(--ty)) scale(1); opacity: 0; }
        }
      `}</style>

      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <div
          ref={stickyHeaderRef}
          style={{
            position: "sticky",
            top: 0,
            zIndex: 100,
            background: "rgba(255,255,255,0.5)",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
            width: "100vw",
            marginLeft: "calc(50% - 50vw)",
            boxSizing: "border-box",
            paddingLeft: 20,
            paddingRight: 20,
            paddingTop: 24,
            marginTop: -24,
            paddingBottom: 8,
            marginBottom: 16,
          }}
        >
          <div style={{ maxWidth: 900, margin: "0 auto" }}>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: "clamp(14px, 4vw, 26px)" }}>
            {/* Title and date card always share one row; both shrink a little on narrow phones instead of the card wrapping onto its own line. */}
            <div style={{ minWidth: 0 }}>
              <h1 style={{ fontFamily: "'Baloo 2', system-ui, sans-serif", fontSize: "clamp(20px, 6vw, 30px)", fontWeight: 800, margin: 0, color: "#2B2250", lineHeight: 1.1 }}>
                The Chore Chart
              </h1>
            <div style={{ fontSize: "clamp(12px, 3.4vw, 14px)", fontWeight: 700, color: "#A79ED1", marginTop: 2 }}>
              {doneTodayCount} of {totalCount} done today
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginLeft: "auto", flexShrink: 0 }}>
            {(() => {
              // The date card takes the weather's colors. Every color is drawn as its
              // own layer and only the current one is visible, so a change fades
              // smoothly instead of snapping (gradients can't be animated directly).
              const themeKey = weatherThemeKey(weather);
              const theme = WEATHER_THEMES[themeKey];
              return (
                <div
                  id="cc-date-card"
                  data-weather={themeKey}
                  style={{
                    position: "relative",
                    overflow: "hidden",
                    color: theme.fg,
                    textAlign: "right",
                    padding: "clamp(7px, 2vw, 10px) clamp(12px, 3.6vw, 24px)",
                    borderRadius: "clamp(14px, 3.6vw, 18px)",
                    whiteSpace: "nowrap",
                    boxShadow: theme.shadow,
                    transition: "color 2s ease, box-shadow 2s ease",
                  }}
                >
                  {Object.keys(WEATHER_THEMES).map((k) => (
                    <div key={k} aria-hidden="true" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: WEATHER_THEMES[k].bg, opacity: k === themeKey ? 1 : 0, transition: "opacity 2s ease" }} />
                  ))}
                  <div style={{ position: "relative" }}>
                    <div style={{ fontFamily: "'Baloo 2', system-ui, sans-serif", fontSize: "clamp(17px, 4.8vw, 23px)", fontWeight: 800, lineHeight: 1.05 }}>
                      {now.toLocaleDateString(undefined, { weekday: "long" })}
                    </div>
                    <div style={{ fontSize: "clamp(13px, 3.6vw, 17px)", fontWeight: 700, opacity: 0.9, lineHeight: 1.1 }}>
                      {now.toLocaleDateString(undefined, { month: "long", day: "numeric" })}
                    </div>
                    <div id="cc-date-card-line" style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4, fontSize: "clamp(11px, 3vw, 13px)", fontWeight: 700, opacity: 0.9, marginTop: 4, paddingTop: 4, borderTop: "1px solid " + theme.rule, transition: "border-color 2s ease" }}>
                      {weather && (
                        <>
                          {(() => {
                            const WeatherIcon = weatherIconFor(weather.code, weather.isDay);
                            return <WeatherIcon size={14} color={theme.fg} />;
                          })()}
                          <span id="cc-weather-temp">{weather.temp}°</span>
                          <span style={{ opacity: 0.7 }}>·</span>
                        </>
                      )}
                      {now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>

        {/* Filter pills */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 2, alignItems: "center" }}>
          <button
            className="cc-btn"
            onClick={() => setFilter("All")}
            style={{
              padding: "8px 18px",
              borderRadius: 999,
              border: filter === "All" ? "none" : "2px solid #E2DBFA",
              background: filter === "All" ? "#2B2250" : "#FFFFFF",
              color: filter === "All" ? "#F8F5FF" : "#5D5490",
              fontSize: 14,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            All kids
          </button>
          {kids.map((k) => (
            <button
              key={k.id}
              className="cc-btn"
              onClick={() => setFilter(k.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                padding: "8px 18px",
                borderRadius: 999,
                border: filter === k.id ? "none" : "2px solid #E2DBFA",
                background: filter === k.id ? colorForKid(k) : "#FFFFFF",
                color: filter === k.id ? "#FFFFFF" : "#5D5490",
                fontSize: 14,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: filter === k.id ? "#fff" : colorForKid(k), display: "inline-block" }} />
              {k.name}
            </button>
          ))}
          {unlocked && (
            <button
              className="cc-btn"
              onClick={() => {
                setSettingsTab((t) => (t ? null : "kids"));
                setShowForm(false);
              }}
              aria-label="Settings"
              title="Settings"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 16px",
                borderRadius: 999,
                border: settingsTab ? "none" : "2px solid #E2DBFA",
                background: settingsTab ? "#2B2250" : "#FFFFFF",
                color: settingsTab ? "#F8F5FF" : "#5D5490",
                fontSize: 14,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              <Settings size={15} />
              Settings
            </button>
          )}
          <button
            className="cc-btn"
            onClick={toggleLock}
            aria-label={unlocked ? "Lock parent controls" : "Unlock parent controls"}
            title={unlocked ? "Parent controls unlocked — tap to lock" : "Parent controls locked — tap to unlock"}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 36,
              height: 36,
              borderRadius: "50%",
              border: unlocked ? "none" : "2px solid #E2DBFA",
              background: unlocked ? "#4ECB71" : "#FFFFFF",
              color: unlocked ? "#fff" : "#8A82C0",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            {unlocked ? <Unlock size={16} /> : <Lock size={16} />}
          </button>
          <button
            className="cc-btn"
            onClick={() => window.showChoreChartHelp && window.showChoreChartHelp()}
            aria-label="How this app works"
            title="How this app works"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 36,
              height: 36,
              borderRadius: "50%",
              border: "2px solid #E2DBFA",
              background: "#FFFFFF",
              color: "#8A82C0",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            <HelpCircle size={17} />
          </button>
          <div style={{ width: 14, height: 14, flexShrink: 0 }}>
            {saving && (
              <div
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: "50%",
                  border: "2.5px solid #E2DBFA",
                  borderTopColor: "#7B61FF",
                  animation: "cc-spin 0.7s linear infinite",
                }}
              />
            )}
          </div>
          <button
            className="cc-btn"
            onClick={() => {
              if (showForm) {
                cancelForm();
                return;
              }
              startAdd();
              setSettingsTab(null);
            }}
            style={{
              marginLeft: "auto",
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 18px",
              borderRadius: 999,
              border: "none",
              background: showForm ? "#2B2250" : "linear-gradient(135deg, #FFB03D, #FF6B9D)",
              color: "#fff",
              fontSize: 14,
              fontWeight: 700,
              cursor: "pointer",
              boxShadow: showForm ? "none" : "0 4px 14px rgba(255,107,157,0.35)",
            }}
          >
            {showForm ? <X size={15} /> : <Plus size={15} />}
            {showForm ? "Cancel" : "Add chore"}
          </button>
        </div>
        </div>
        </div>

        {/* Screensaver clock */}
        {screensaver && (
          <div
            id="cc-screensaver"
            role="button"
            tabIndex={0}
            aria-label="Clock. Tap anywhere to return to the chore chart."
            onClick={wakeScreensaver}
            style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 99985, background: "#0B0C16", color: "#E9E7F7", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", userSelect: "none", WebkitUserSelect: "none", WebkitTapHighlightColor: "transparent", overflow: "hidden" }}
          >
            <div
              style={{ textAlign: "center", transform: `translate(${clockDrift.x}vw, ${clockDrift.y}vh)`, transition: "transform 30s ease-in-out", fontFamily: "'Nunito', -apple-system, BlinkMacSystemFont, sans-serif" }}
            >
              <div id="cc-screensaver-time" style={{ fontSize: "clamp(56px, 14vw, 170px)", fontWeight: 700, lineHeight: 1, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>
                {clockNow.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
              </div>
              <div style={{ fontSize: "clamp(18px, 4.4vw, 40px)", fontWeight: 600, color: "#A9A4CF", marginTop: "clamp(8px, 2vw, 18px)" }}>
                {clockNow.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
              </div>
              {weather && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, fontSize: "clamp(18px, 4.4vw, 40px)", fontWeight: 600, color: "#A9A4CF", marginTop: "clamp(6px, 1.4vw, 12px)" }}>
                  {(() => {
                    const WeatherIcon = weatherIconFor(weather.code, weather.isDay);
                    return <WeatherIcon size={32} color="#A9A4CF" />;
                  })()}
                  {weather.temp}°
                </div>
              )}
              <div style={{ fontSize: 13, fontWeight: 600, color: "#5E5986", marginTop: "clamp(24px, 5vw, 48px)" }}>Tap anywhere to return</div>
            </div>
          </div>
        )}

        {/* PIN prompt / setup */}
        {showPinModal && (
          <div
            onClick={() => {
              setShowPinModal(false);
              pendingActionRef.current = null;
              setPinSkipAction(null);
            }}
            style={{ position: "fixed", inset: 0, background: "rgba(43,34,80,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{ background: "#FFFFFF", borderRadius: 22, padding: 24, width: "100%", maxWidth: 320, boxShadow: "0 20px 50px rgba(43,34,80,0.3)", fontFamily: "'Nunito', -apple-system, sans-serif" }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <Lock size={17} color="#7B61FF" />
                <div style={{ fontFamily: "'Baloo 2', system-ui, sans-serif", fontSize: 18, fontWeight: 700, flex: 1 }}>
                  {pinModalMode === "setup" ? "Set up a parent PIN" : "Enter parent PIN"}
                </div>
                <button
                  onClick={() => {
                    setShowPinModal(false);
                    pendingActionRef.current = null;
                    setPinSkipAction(null);
                  }}
                  aria-label="Close"
                  style={{ border: "none", background: "none", color: "#B7ACE3", cursor: "pointer", padding: 4 }}
                >
                  <X size={16} />
                </button>
              </div>
              <div style={{ fontSize: 12.5, color: "#8A82C0", fontWeight: 600, marginBottom: 16 }}>
                {pinModalMode === "setup"
                  ? "This protects the Kids panel, Rewards menu, and adding/editing chores."
                  : "Needed to manage kids, rewards, or chores."}
              </div>

              <input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                name="cc-household-lock"
                data-lpignore="true"
                data-1p-ignore="true"
                data-form-type="other"
                placeholder="PIN"
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value.replace(/\D/g, "").slice(0, 8))}
                onKeyDown={(e) => e.key === "Enter" && submitPin()}
                autoFocus
                style={{ width: "100%", boxSizing: "border-box", padding: "11px 14px", borderRadius: 12, border: "2px solid #E2DBFA", fontSize: 18, letterSpacing: 4, textAlign: "center", fontFamily: "inherit", fontWeight: 700, WebkitTextSecurity: "disc", marginBottom: pinModalMode === "setup" ? 10 : 14 }}
              />

              {pinModalMode === "setup" && (
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  name="cc-household-lock"
                  data-lpignore="true"
                  data-1p-ignore="true"
                  data-form-type="other"
                  placeholder="Confirm PIN"
                  value={pinConfirmInput}
                  onChange={(e) => setPinConfirmInput(e.target.value.replace(/\D/g, "").slice(0, 8))}
                  onKeyDown={(e) => e.key === "Enter" && submitPin()}
                  style={{ width: "100%", boxSizing: "border-box", padding: "11px 14px", borderRadius: 12, border: "2px solid #E2DBFA", fontSize: 18, letterSpacing: 4, textAlign: "center", fontFamily: "inherit", fontWeight: 700, WebkitTextSecurity: "disc", marginBottom: 14 }}
                />
              )}

              {pinError && <div style={{ fontSize: 12.5, color: "#FF5A5F", fontWeight: 700, marginBottom: 10 }}>{pinError}</div>}

              <button
                className="cc-btn"
                onClick={submitPin}
                style={{ width: "100%", padding: "11px 0", borderRadius: 14, border: "none", background: "linear-gradient(135deg, #FF6B9D, #7B61FF)", color: "#fff", fontSize: 14.5, fontWeight: 700, cursor: "pointer" }}
              >
                {pinModalMode === "setup" ? "Set PIN" : "Unlock"}
              </button>
              {pinSkipAction && (
                <button
                  className="cc-btn"
                  onClick={skipPin}
                  style={{ width: "100%", padding: "11px 0", borderRadius: 14, border: "none", background: "none", color: "#8A82C0", fontSize: 13, fontWeight: 700, cursor: "pointer", marginTop: 6 }}
                >
                  Skip — submit for approval instead
                </button>
              )}
            </div>
          </div>
        )}

        {saveError && (
          <div
            style={{
              position: "fixed",
              top: 18,
              left: "50%",
              transform: "translateX(-50%)",
              background: "#FFE3E3",
              color: "#C0392B",
              padding: "10px 18px",
              borderRadius: 999,
              fontSize: 13,
              fontWeight: 700,
              boxShadow: "0 8px 20px rgba(192,57,43,0.25)",
              zIndex: 1200,
              whiteSpace: "nowrap",
            }}
          >
            Changes aren't saving right now — your edits may not persist.
          </div>
        )}

        {deletedKidSnapshot && (
          <div
            style={{
              position: "fixed",
              bottom: 18,
              left: "50%",
              transform: "translateX(-50%)",
              background: "#2B2250",
              color: "#F8F5FF",
              padding: "10px 12px 10px 18px",
              borderRadius: 999,
              fontSize: 13,
              fontWeight: 700,
              boxShadow: "0 8px 20px rgba(43,34,80,0.35)",
              zIndex: 1200,
              whiteSpace: "nowrap",
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            {deletedKidSnapshot.kid.name} removed
            <button
              className="cc-btn"
              onClick={undoDeleteKid}
              style={{ padding: "6px 14px", borderRadius: 999, border: "none", background: "linear-gradient(135deg, #FF6B9D, #7B61FF)", color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}
            >
              Undo
            </button>
          </div>
        )}

        {/* Manage rewards menu panel */}
        {/* Parent Settings: one popup with tabs (only reachable while unlocked) */}
        {settingsTab && (
          <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 900, background: "rgba(43,34,80,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, boxSizing: "border-box" }}>
            <div
              id="cc-settings"
              role="dialog"
              aria-modal="true"
              aria-label="Settings"
              style={{ background: "#FFFFFF", borderRadius: 20, padding: 20, width: "100%", maxWidth: 600, maxHeight: "90vh", overflowY: "auto", overscrollBehavior: "contain", boxSizing: "border-box", boxShadow: "0 20px 50px rgba(43,34,80,0.3)", border: "2px solid #F1EDFF" }}
            >
              <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
                <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, fontSize: 18, fontWeight: 800, color: "#2B2250" }}>
                  <Settings size={18} color="#7B61FF" />
                  Settings
                </div>
                <button className="cc-btn" onClick={() => setSettingsTab(null)} aria-label="Close settings" style={{ border: "none", background: "none", color: "#B7ACE3", cursor: "pointer", padding: 4, display: "flex" }}>
                  <X size={20} />
                </button>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, paddingBottom: 14, marginBottom: 16, borderBottom: "1.5px solid #F1EDFF" }}>
                <button
                  className="cc-btn"
                  onClick={() => setSettingsTab("kids")}
                  aria-pressed={settingsTab === "kids"}
                  style={{ padding: "8px 14px", borderRadius: 999, border: settingsTab === "kids" ? "none" : "2px solid #E2DBFA", background: settingsTab === "kids" ? "#2B2250" : "#FFFFFF", color: settingsTab === "kids" ? "#F8F5FF" : "#5D5490", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}
                >
                  Kids
                </button>
                <button
                  className="cc-btn"
                  onClick={() => setSettingsTab("rewards")}
                  aria-pressed={settingsTab === "rewards"}
                  style={{ padding: "8px 14px", borderRadius: 999, border: settingsTab === "rewards" ? "none" : "2px solid #E2DBFA", background: settingsTab === "rewards" ? "#2B2250" : "#FFFFFF", color: settingsTab === "rewards" ? "#F8F5FF" : "#5D5490", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}
                >
                  Rewards
                </button>
                <button
                  className="cc-btn"
                  onClick={() => setSettingsTab("screensaver")}
                  aria-pressed={settingsTab === "screensaver"}
                  style={{ padding: "8px 14px", borderRadius: 999, border: settingsTab === "screensaver" ? "none" : "2px solid #E2DBFA", background: settingsTab === "screensaver" ? "#2B2250" : "#FFFFFF", color: settingsTab === "screensaver" ? "#F8F5FF" : "#5D5490", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}
                >
                  Screen saver
                </button>
                <button
                  className="cc-btn"
                  onClick={() => setSettingsTab("household")}
                  aria-pressed={settingsTab === "household"}
                  style={{ padding: "8px 14px", borderRadius: 999, border: settingsTab === "household" ? "none" : "2px solid #E2DBFA", background: settingsTab === "household" ? "#2B2250" : "#FFFFFF", color: settingsTab === "household" ? "#F8F5FF" : "#5D5490", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}
                >
                  Household
                </button>
                {window.CCAccount && (
                  <button
                    className="cc-btn"
                    onClick={() => setSettingsTab("devices")}
                    aria-pressed={settingsTab === "devices"}
                    style={{ display: "flex", alignItems: "center", gap: 5, padding: "8px 14px", borderRadius: 999, border: settingsTab === "devices" ? "none" : "2px solid #E2DBFA", background: settingsTab === "devices" ? "#2B2250" : "#FFFFFF", color: settingsTab === "devices" ? "#F8F5FF" : "#5D5490", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}
                  >
                    <Smartphone size={14} />
                    Devices
                  </button>
                )}
              </div>

              {settingsTab === "kids" && (
                <>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
              {kids.map((k) => {
                const choreCount = chores.filter((c) => c.kidId === k.id).length;
                const confirming = confirmDeleteKidId === k.id;
                return (
                  <div key={k.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: "50%",
                        background: colorForKid(k),
                        color: "#fff",
                        fontWeight: 800,
                        fontSize: 19,
                        lineHeight: 1,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontFamily: "'Baloo 2', system-ui, sans-serif",
                        flexShrink: 0,
                      }}
                    >
                      {avatarContent(k)}
                    </div>
                    {confirming ? (
                      <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 13.5, color: "#C0392B", fontWeight: 700 }}>
                          Remove {k.name}{choreCount > 0 ? ` and ${choreCount} chore${choreCount === 1 ? "" : "s"}` : ""}?
                        </span>
                        <button
                          className="cc-btn"
                          onClick={requirePin(() => deleteKid(k.id))}
                          style={{ padding: "6px 14px", borderRadius: 10, border: "none", background: "#FF5A5F", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
                        >
                          Remove
                        </button>
                        <button
                          className="cc-btn"
                          onClick={() => setConfirmDeleteKidId(null)}
                          style={{ padding: "6px 14px", borderRadius: 10, border: "2px solid #E2DBFA", background: "#fff", color: "#5D5490", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <>
                        <input
                          className="cc-input"
                          defaultValue={k.name}
                          key={k.id + k.name}
                          onBlur={(e) => renameKid(k.id, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.target.blur();
                          }}
                          style={{ flex: 1, padding: "9px 14px", borderRadius: 12, border: "2px solid #E2DBFA", fontSize: 14, fontFamily: "inherit", fontWeight: 600 }}
                        />
                        <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                          <Coins size={14} color="#B7ACE3" />
                          <input
                            className="cc-input"
                            type="number"
                            min={0}
                            defaultValue={(rewards[k.id] || defaultReward()).points}
                            key={k.id + "-pts-" + (rewards[k.id] || defaultReward()).points}
                            onBlur={(e) => setPoints(k.id, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") e.target.blur();
                            }}
                            style={{ width: 60, padding: "9px 8px", borderRadius: 12, border: "2px solid #E2DBFA", fontSize: 14, fontFamily: "inherit", fontWeight: 700, textAlign: "center" }}
                          />
                        </div>
                        <button
                          onClick={() => setConfirmDeleteKidId(k.id)}
                          aria-label={`Remove ${k.name}`}
                          style={{ border: "none", background: "none", color: "#C9C0EE", cursor: "pointer", padding: 6, flexShrink: 0 }}
                        >
                          <Trash2 size={16} />
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <input
                className="cc-input"
                placeholder="New kid's name"
                value={newKidName}
                onChange={(e) => setNewKidName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addKid();
                }}
                style={{ flex: 1, padding: "9px 14px", borderRadius: 12, border: "2px solid #E2DBFA", fontSize: 14, fontFamily: "inherit" }}
              />
              <button
                className="cc-btn"
                onClick={addKid}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 18px", borderRadius: 12, border: "none", background: "linear-gradient(135deg, #FFB03D, #FF6B9D)", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
              >
                <Plus size={15} />
                Add kid
              </button>
            </div>

                </>
              )}

              {settingsTab === "rewards" && (
                <>
            <div style={{ display: "flex", alignItems: "center", gap: 10, paddingBottom: 16, marginBottom: 16, borderBottom: "1.5px solid #F1EDFF" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#7B61FF" }}>Daily completion value</div>
                <div style={{ fontSize: 12, color: "#8A82C0", fontWeight: 600 }}>
                  Bonus for a fully clear day — Morning, Evening, and Anytime chores all done. Any of those chores can also carry their own point value, editable when adding or editing it — this bonus is separate and always applies on top.
                </div>
              </div>
              <input
                type="number"
                min={1}
                value={dailyPointValue}
                onChange={(e) => persist(undefined, undefined, undefined, undefined, undefined, Math.max(1, Number(e.target.value) || 1))}
                style={{ width: 60, padding: "8px 10px", borderRadius: 10, border: "2px solid #E2DBFA", fontSize: 15, fontFamily: "inherit", fontWeight: 700, textAlign: "center", flexShrink: 0 }}
              />
            </div>

            <div style={{ fontSize: 14, fontWeight: 700, color: "#7B61FF", marginBottom: 4 }}>Rewards menu</div>
            <div style={{ fontSize: 12.5, color: "#8A82C0", fontWeight: 600, marginBottom: 14 }}>
              Set what's available and how many points each one costs. Every kid shops from this same list.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
              {rewardsMenu.map((item) => (
                <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <input
                    className="cc-input"
                    defaultValue={item.name}
                    key={item.id + item.name}
                    onBlur={(e) => updateRewardItem(item.id, e.target.value, item.cost)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.target.blur();
                    }}
                    style={{ flex: 1, padding: "9px 14px", borderRadius: 12, border: "2px solid #E2DBFA", fontSize: 14, fontFamily: "inherit", fontWeight: 600 }}
                  />
                  <input
                    className="cc-input"
                    type="number"
                    min={1}
                    defaultValue={item.cost}
                    key={item.id + "-cost-" + item.cost}
                    onBlur={(e) => updateRewardItem(item.id, item.name, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.target.blur();
                    }}
                    style={{ width: 76, padding: "9px 10px", borderRadius: 12, border: "2px solid #E2DBFA", fontSize: 14, fontFamily: "inherit", fontWeight: 700, textAlign: "center" }}
                  />
                  <span style={{ fontSize: 12.5, color: "#A79ED1", fontWeight: 700, flexShrink: 0 }}>pts</span>
                  <button
                    onClick={() => deleteRewardItem(item.id)}
                    aria-label={`Remove ${item.name}`}
                    style={{ border: "none", background: "none", color: "#C9C0EE", cursor: "pointer", padding: 6, flexShrink: 0 }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              {rewardsMenu.length === 0 && (
                <div style={{ fontSize: 13, color: "#A79ED1", fontWeight: 600 }}>No rewards yet — add one below.</div>
              )}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <input
                className="cc-input"
                placeholder="New reward name"
                value={newRewardName}
                onChange={(e) => setNewRewardName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addRewardItem();
                }}
                style={{ flex: 1, padding: "9px 14px", borderRadius: 12, border: "2px solid #E2DBFA", fontSize: 14, fontFamily: "inherit" }}
              />
              <input
                className="cc-input"
                type="number"
                min={1}
                value={newRewardCost}
                onChange={(e) => setNewRewardCost(e.target.value)}
                style={{ width: 76, padding: "9px 10px", borderRadius: 12, border: "2px solid #E2DBFA", fontSize: 14, fontFamily: "inherit", fontWeight: 700, textAlign: "center" }}
              />
              <button
                className="cc-btn"
                onClick={addRewardItem}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 18px", borderRadius: 12, border: "none", background: "linear-gradient(135deg, #FFB03D, #FF6B9D)", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
              >
                <Plus size={15} />
                Add
              </button>
            </div>
                </>
              )}

              {settingsTab === "screensaver" && (
                <div id="cc-screensaver-settings">
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 800, color: "#2B2250" }}>Clock screen saver</div>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: "#8A82C0", lineHeight: 1.5, marginTop: 2 }}>
                        After a while with no taps, show a big clock with the date and weather. Tap anywhere to come back.
                      </div>
                    </div>
                    <button
                      className="cc-btn"
                      role="switch"
                      aria-checked={screensaverPref.on}
                      aria-label="Clock screen saver on this device"
                      onClick={() => updateScreensaverPref({ on: !screensaverPref.on })}
                      style={{ width: 52, height: 30, borderRadius: 999, border: "none", background: screensaverPref.on ? "#4ECB71" : "#D9D3F2", position: "relative", cursor: "pointer", flexShrink: 0, padding: 0 }}
                    >
                      <span style={{ position: "absolute", top: 3, left: screensaverPref.on ? 25 : 3, width: 24, height: 24, borderRadius: "50%", background: "#FFFFFF", boxShadow: "0 1px 3px rgba(0,0,0,0.25)", transition: "left 0.15s" }} />
                    </button>
                  </div>
                  {screensaverPref.on && (
                    <>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#5D5490", margin: "16px 0 8px" }}>Start after</div>
                      <div style={{ display: "flex", gap: 8 }}>
                        {[5, 10, 30].map((m) => (
                          <button
                            key={m}
                            className="cc-btn"
                            aria-pressed={screensaverPref.minutes === m}
                            onClick={() => updateScreensaverPref({ minutes: m })}
                            style={{ flex: 1, padding: "10px 0", borderRadius: 12, border: screensaverPref.minutes === m ? "none" : "2px solid #E2DBFA", background: screensaverPref.minutes === m ? "#2B2250" : "#FFFFFF", color: screensaverPref.minutes === m ? "#F8F5FF" : "#5D5490", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
                          >
                            {m} min
                          </button>
                        ))}
                      </div>
                      <button
                        className="cc-btn"
                        onClick={() => {
                          setSettingsTab(null);
                          setUnlocked(false);
                          setScreensaver(true);
                        }}
                        style={{ marginTop: 14, padding: "9px 16px", borderRadius: 12, border: "2px solid #E2DBFA", background: "#FFFFFF", color: "#5D5490", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}
                      >
                        Show it now
                      </button>
                    </>
                  )}
                  <div style={{ marginTop: 16, padding: "10px 12px", borderRadius: 12, background: "#F6F3FF", fontSize: 12.5, fontWeight: 600, color: "#5D5490", lineHeight: 1.5 }}>
                    This setting is just for this device, so you can turn it on for a wall tablet and leave phones alone. On an iPad, set Settings, Display &amp; Brightness, Auto-Lock to Never, or the screen will switch off before the clock appears.
                  </div>
                </div>
              )}

              {settingsTab === "devices" && window.CCAccount && <DevicesTab />}

              {settingsTab === "household" && (
                <>
                  <WeatherLocationSettings location={location} onSave={saveLocation} btnStyle={BACKUP_BTN_STYLE} />
                  <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10, paddingBottom: 14, marginBottom: 14, borderBottom: "1.5px solid #F1EDFF" }}>
                    <div style={{ flex: 1, minWidth: 160 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: "#7B61FF" }}>App version</div>
                      <div id="cc-version-line" style={{ fontSize: 12.5, fontWeight: 600, color: "#8A82C0", marginTop: 2 }}>
                        {updateMsg || "Version " + (window.__ccBuild || "dev")}
                      </div>
                    </div>
                    <button className="cc-btn" onClick={checkForUpdate} style={BACKUP_BTN_STYLE}>
                      Check for updates
                    </button>
                  </div>
            <button
              onClick={() => {
                setPinModalMode("setup");
                setPinInput("");
                setPinConfirmInput("");
                setPinError("");
                setShowPinModal(true);
              }}
              style={{ marginTop: 0, border: "none", background: "none", color: "#B7ACE3", fontSize: 12, fontWeight: 700, cursor: "pointer", padding: 0, display: "flex", alignItems: "center", gap: 5 }}
            >
              <Lock size={12} />
              {parentPin ? "Change parent PIN" : "Set a parent PIN"}
            </button>

            {typeof window.migrateToFreshHousehold === "function" && (
              <button
                onClick={() => window.migrateToFreshHousehold()}
                style={{ marginTop: 10, border: "none", background: "none", color: "#B7ACE3", fontSize: 12, fontWeight: 700, cursor: "pointer", padding: 0, display: "flex", alignItems: "center", gap: 5 }}
              >
                <Copy size={12} />
                Migrate to a fresh household (sync troubleshooting)
              </button>
            )}

            <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1.5px solid #F1EDFF" }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#7B61FF" }}>Backup</div>
              <div style={{ fontSize: 12, color: "#8A82C0", fontWeight: 600, margin: "4px 0 10px", lineHeight: 1.5 }}>
                A copy of your kids, chores, points, history, and rewards. It leaves out the parent PIN and household code, but it does contain your kids' names, so keep it somewhere private.
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <button onClick={downloadBackup} style={BACKUP_BTN_STYLE}>Download backup</button>
                {CAN_SHARE_BACKUP_FILE && (
                  <button onClick={shareBackup} style={BACKUP_BTN_STYLE}>Share…</button>
                )}
                <button onClick={() => restoreFileRef.current && restoreFileRef.current.click()} style={BACKUP_BTN_STYLE}>
                  Restore from file…
                </button>
                <input
                  ref={restoreFileRef}
                  type="file"
                  accept="application/json,.json"
                  onChange={onRestoreFileChosen}
                  style={{ display: "none" }}
                />
              </div>

              {restoreError && (
                <div style={{ marginTop: 10, fontSize: 12.5, color: "#C0392B", fontWeight: 700 }}>{restoreError}</div>
              )}

              {restoreCandidate && (
                <div style={{ marginTop: 12, padding: 14, borderRadius: 14, background: "#FFF7F0", border: "2px solid #F5C9A8" }}>
                  <div style={{ fontSize: 13.5, fontWeight: 800, color: "#2B2250" }}>Replace everything with this backup?</div>
                  <div style={{ fontSize: 12.5, color: "#5D5490", fontWeight: 600, marginTop: 4, lineHeight: 1.55 }}>
                    Backup from {backupWhen(restoreCandidate)}: {restoreCandidate.data.kids.length} kids, {restoreCandidate.data.chores.length} chores.
                    <br />
                    Right now: {kids.length} kids, {chores.length} chores.
                    <br />
                    Restoring replaces all chores, points, history, and rewards. The parent PIN stays as it is.
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                    <button onClick={downloadBackup} style={BACKUP_BTN_STYLE}>Save a copy of current data first</button>
                    <button onClick={confirmRestore} style={{ ...BACKUP_BTN_STYLE, background: "#C0392B", borderColor: "#C0392B", color: "#FFFFFF" }}>
                      Replace with backup
                    </button>
                    <button onClick={() => setRestoreCandidate(null)} style={BACKUP_BTN_STYLE}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Add / edit chore form */}
        {showForm && (
          <div
            style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 900, background: "rgba(43,34,80,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, boxSizing: "border-box" }}
          >
          <div
            ref={formRef}
            role="dialog"
            aria-modal="true"
            aria-label={editingId ? "Edit chore" : "New chore"}
            style={{ background: "#FFFFFF", borderRadius: 20, padding: 20, width: "100%", maxWidth: 560, maxHeight: "90vh", overflowY: "auto", overscrollBehavior: "contain", boxSizing: "border-box", boxShadow: "0 20px 50px rgba(43,34,80,0.3)", border: "2px solid #F1EDFF" }}
          >
            <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
              <div style={{ flex: 1, fontSize: 16, fontWeight: 800, color: "#7B61FF" }}>
                {editingId ? "Edit chore" : "New chore"}
              </div>
              <button className="cc-btn" onClick={cancelForm} aria-label="Close" style={{ border: "none", background: "none", color: "#B7ACE3", cursor: "pointer", padding: 4, display: "flex" }}>
                <X size={18} />
              </button>
            </div>
            {kids.length === 0 ? (
              <div style={{ fontSize: 13.5, color: "#8A82C0", fontWeight: 600 }}>Add a kid first using the "Kids" button above.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <input
                    placeholder="Chore name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    style={{ flex: "2 1 160px", padding: "10px 14px", borderRadius: 12, border: "2px solid #E2DBFA", fontSize: 14, fontFamily: "inherit" }}
                  />
                  {editingId ? (
                    <select
                      value={form.kidId}
                      onChange={(e) => setForm({ ...form, kidId: e.target.value })}
                      style={{ padding: "10px 14px", borderRadius: 12, border: "2px solid #E2DBFA", fontSize: 14, fontFamily: "inherit" }}
                    >
                      {kids.map((k) => (
                        <option key={k.id} value={k.id}>
                          {k.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                      {kids.map((k) => {
                        const active = (form.kidIds || []).includes(k.id);
                        return (
                          <button
                            key={k.id}
                            type="button"
                            onClick={() => {
                              const current = form.kidIds || [];
                              const next = active ? current.filter((id) => id !== k.id) : [...current, k.id];
                              setForm({ ...form, kidIds: next });
                            }}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                              padding: "8px 14px",
                              borderRadius: 999,
                              border: active ? "none" : "2px solid #E2DBFA",
                              background: active ? colorForKid(k) : "#FFFFFF",
                              color: active ? "#fff" : "#5D5490",
                              fontSize: 13.5,
                              fontWeight: 700,
                              cursor: "pointer",
                            }}
                          >
                            {active && <Check size={12} strokeWidth={3} />}
                            {k.name}
                          </button>
                        );
                      })}
                      {(!form.kidIds || form.kidIds.length === 0) && (
                        <span style={{ fontSize: 12, color: "#FF5A5F", fontWeight: 700 }}>Pick at least one kid</span>
                      )}
                    </div>
                  )}
                  <select
                    value={form.category}
                    onChange={(e) => {
                      const category = e.target.value;
                      const freq = category === "ANY" ? 7 : category === "BOOK" ? "once" : 1;
                      const points = category === "BOOK" ? 3 : category === "BONUS" ? 1 : form.points;
                      setForm({ ...form, category, freq, points });
                    }}
                    style={{ padding: "10px 14px", borderRadius: 12, border: "2px solid #E2DBFA", fontSize: 14, fontFamily: "inherit" }}
                  >
                    <option value="AM">Morning</option>
                    <option value="PM">Evening</option>
                    <option value="ANY">Anytime</option>
                    <option value="BONUS">Bonus</option>
                    <option value="BOOK">Books</option>
                  </select>

                  {form.category === "BOOK" || form.category === "BONUS" ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <input
                        type="number"
                        min={0}
                        value={form.points}
                        onChange={(e) => setForm({ ...form, points: e.target.value })}
                        style={{ width: 70, padding: "10px 10px", borderRadius: 12, border: "2px solid #E2DBFA", fontSize: 14, fontFamily: "inherit", fontWeight: 700, textAlign: "center" }}
                      />
                      <span style={{ fontSize: 13, color: "#8A82C0", fontWeight: 700 }}>pts</span>
                    </div>
                  ) : form.category === "ANY" ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <select
                        value={form.freq === "once" ? "once" : "weekly"}
                        onChange={(e) => setForm({ ...form, freq: e.target.value === "once" ? "once" : 7 })}
                        style={{ padding: "10px 14px", borderRadius: 12, border: "2px solid #E2DBFA", fontSize: 14, fontFamily: "inherit" }}
                      >
                        <option value="weekly">Every week</option>
                        <option value="once">One time</option>
                      </select>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <input
                          type="number"
                          min={0}
                          value={form.points}
                          onChange={(e) => setForm({ ...form, points: e.target.value })}
                          style={{ width: 70, padding: "10px 10px", borderRadius: 12, border: "2px solid #E2DBFA", fontSize: 14, fontFamily: "inherit", fontWeight: 700, textAlign: "center" }}
                        />
                        <span style={{ fontSize: 13, color: "#8A82C0", fontWeight: 700 }}>pts</span>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <input
                        type="number"
                        min={0}
                        value={form.points}
                        onChange={(e) => setForm({ ...form, points: e.target.value })}
                        style={{ width: 70, padding: "10px 10px", borderRadius: 12, border: "2px solid #E2DBFA", fontSize: 14, fontFamily: "inherit", fontWeight: 700, textAlign: "center" }}
                      />
                      <span style={{ fontSize: 13, color: "#8A82C0", fontWeight: 700 }}>pts</span>
                    </div>
                  )}

                  <button
                    className="cc-btn"
                    onClick={saveChore}
                    style={{ padding: "10px 22px", borderRadius: 12, border: "none", background: "linear-gradient(135deg, #FF6B9D, #7B61FF)", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
                  >
                    {editingId ? "Save changes" : "Add"}
                  </button>

                  <button
                    className="cc-btn"
                    onClick={cancelForm}
                    style={{ padding: "10px 18px", borderRadius: 12, border: "2px solid #E2DBFA", background: "#FFFFFF", color: "#5D5490", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
                  >
                    Cancel
                  </button>

                  {editingId && (
                    <button
                      className="cc-btn"
                      onClick={() => removeChore(editingId)}
                      style={{ padding: "10px 18px", borderRadius: 12, border: "2px solid #FFD3D6", background: "#FFF5F5", color: "#C0392B", fontSize: 14, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
                    >
                      <Trash2 size={14} />
                      Delete chore
                    </button>
                  )}
                </div>

                {editingId && kids.filter((k) => k.id !== form.kidId).length > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12.5, color: "#8A82C0", fontWeight: 700, display: "flex", alignItems: "center", gap: 5 }}>
                      <Copy size={13} />
                      Clone to:
                    </span>
                    {kids
                      .filter((k) => k.id !== form.kidId)
                      .map((k) => (
                        <button
                          key={k.id}
                          className="cc-btn"
                          onClick={() => cloneChoreToKid(k.id)}
                          style={{ padding: "5px 12px", borderRadius: 999, border: "1.5px solid #E2DBFA", background: "#FFFFFF", color: "#5D5490", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}
                        >
                          {k.name}
                        </button>
                      ))}
                    {kids.filter((k) => k.id !== form.kidId).length > 1 && (
                      <button
                        className="cc-btn"
                        onClick={cloneChoreToAll}
                        style={{ padding: "5px 12px", borderRadius: 999, border: "none", background: "linear-gradient(135deg, #FFB03D, #FF6B9D)", color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}
                      >
                        All
                      </button>
                    )}
                  </div>
                )}

                {(form.category === "AM" || form.category === "PM" || form.category === "BONUS") && (
                  <div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                      {DAY_PRESETS.map((preset) => (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => setForm({ ...form, days: preset.days })}
                          style={{
                            padding: "5px 12px",
                            borderRadius: 999,
                            border: "1.5px solid #E2DBFA",
                            background: "#FFFFFF",
                            color: "#8A82C0",
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 13.5, color: "#8A82C0", fontWeight: 700 }}>Repeats on:</span>
                      <div style={{ display: "flex", gap: 4 }}>
                        {DAY_TOGGLES.map((d) => {
                          const active = (form.days || ALL_DAYS).includes(d.value);
                          return (
                            <button
                              key={d.value}
                              type="button"
                              onClick={() => {
                                const current = form.days || ALL_DAYS;
                                const next = active ? current.filter((v) => v !== d.value) : [...current, d.value];
                                setForm({ ...form, days: next });
                              }}
                              style={{
                                width: 34,
                                height: 34,
                                borderRadius: "50%",
                                border: active ? "none" : "2px solid #E2DBFA",
                                background: active ? "linear-gradient(135deg, #FF6B9D, #7B61FF)" : "#FFFFFF",
                                color: active ? "#fff" : "#8A82C0",
                                fontSize: 12,
                                fontWeight: 700,
                                cursor: "pointer",
                              }}
                            >
                              {d.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    {(!form.days || form.days.length === 0) && (
                      <div style={{ fontSize: 12, color: "#FF5A5F", fontWeight: 700, marginTop: 6 }}>Pick at least one day to save</div>
                    )}
                  </div>
                )}

                {form.category === "ANY" && form.freq !== "once" && (
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 13.5, color: "#8A82C0", fontWeight: 700 }}>Due by:</span>
                    <select
                      value={form.dueDay === null ? "" : form.dueDay}
                      onChange={(e) => setForm({ ...form, dueDay: e.target.value === "" ? null : Number(e.target.value) })}
                      style={{ padding: "8px 12px", borderRadius: 10, border: `2px solid ${form.dueDay === null ? "#FF5A5F" : "#E2DBFA"}`, fontSize: 13.5, fontFamily: "inherit" }}
                    >
                      <option value="" disabled>
                        Choose a day…
                      </option>
                      {WEEKDAYS.map((d) => (
                        <option key={d.value} value={d.value}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                    {form.dueDay === null && (
                      <span style={{ fontSize: 12, color: "#FF5A5F", fontWeight: 700 }}>Pick a day to save</span>
                    )}
                  </div>
                )}

                {form.category === "ANY" && form.freq === "once" && (
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 13.5, color: "#8A82C0", fontWeight: 700 }}>Due by (optional):</span>
                    <input
                      type="date"
                      value={form.dueDate}
                      onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                      style={{ padding: "8px 12px", borderRadius: 10, border: "2px solid #E2DBFA", fontSize: 13.5, fontFamily: "inherit" }}
                    />
                  </div>
                )}
              </div>
            )}
            <div style={{ fontSize: 12.5, color: "#8A82C0", marginTop: 12, fontWeight: 600 }}>
              Morning, evening, and bonus chores reset fresh on whatever days you pick, and simply don't appear on the days you don't. Weekly anytime chores don't block the point until their due day passes undone. One-time chores stay checked once completed. Books and bonus chores never block anything — they just pay out their own points the moment they're checked off.
            </div>
          </div>
          </div>
        )}

        {/* Kid sections */}
        {visibleKids.map((kid) => {
          const kidChores = chores.filter((c) => c.kidId === kid.id);
          const kidStatuses = kidChores.map((c) => {
            const cat = CATEGORIES.find((cat) => cat.id === c.category);
            return { c, cat, status: choreStatus(c, cat ? cat.carriesOver : false) };
          });
          // Books don't count toward the daily "done today" progress — they're
          // a separate bonus tracker, not part of the daily gate.
          const progressStatuses = kidStatuses.filter((x) => x.c.category !== "BOOK" && x.c.category !== "BONUS" && x.status.applicable !== false);
          const kidDone = progressStatuses.filter((x) => x.status.done).length;
          const color = colorForKid(kid);
          const pct = progressStatuses.length ? Math.round((kidDone / progressStatuses.length) * 100) : 0;
          const r = rewards[kid.id] || defaultReward();

          return (
            <div key={kid.id} style={{ marginBottom: 30 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
                <div ref={avatarPickerKidId === kid.id ? avatarPopoverRef : null} style={{ position: "relative", flexShrink: 0 }}>
                  <button
                    onClick={() => setAvatarPickerKidId(avatarPickerKidId === kid.id ? null : kid.id)}
                    aria-label={`Change ${kid.name}'s avatar`}
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: "50%",
                      background: color,
                      color: "#fff",
                      fontSize: 21, lineHeight: 1,
                      fontWeight: 800,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontFamily: "'Baloo 2', system-ui, sans-serif",
                      border: "none",
                      cursor: "pointer",
                      padding: 0,
                    }}
                  >
                    {avatarContent(kid)}
                  </button>
                  {avatarPickerKidId === kid.id && (
                    <div
                      style={{
                        position: "absolute",
                        top: 40,
                        left: 0,
                        zIndex: 50,
                        background: "#FFFFFF",
                        borderRadius: 16,
                        padding: 14,
                        width: 232,
                        boxShadow: "0 10px 28px rgba(43,34,80,0.28)",
                        border: "2px solid #F1EDFF",
                      }}
                    >
                      <div style={{ fontSize: 11.5, color: "#8A82C0", fontWeight: 700, marginBottom: 6 }}>Color</div>
                      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
                        {KID_COLORS.map((c) => (
                          <button
                            key={c}
                            onClick={() => updateKidColor(kid.id, c)}
                            aria-label={`Choose color ${c}`}
                            style={{
                              width: 24,
                              height: 24,
                              borderRadius: "50%",
                              background: c,
                              border: colorForKid(kid) === c ? "2.5px solid #2B2250" : "2px solid #FFFFFF",
                              boxShadow: "0 1px 3px rgba(43,34,80,0.2)",
                              cursor: "pointer",
                              padding: 0,
                            }}
                          />
                        ))}
                      </div>
                      <div style={{ fontSize: 11.5, color: "#8A82C0", fontWeight: 700, marginBottom: 6 }}>Avatar</div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 4, maxHeight: 200, overflowY: "auto" }}>
                        {EMOJI_OPTIONS.map((e) => (
                          <button
                            key={e}
                            onClick={() => updateKidEmoji(kid.id, e)}
                            aria-label={`Choose avatar ${e}`}
                            style={{
                              width: 32,
                              height: 32,
                              borderRadius: 8,
                              background: kid.emoji === e ? "#F1EDFF" : "transparent",
                              border: kid.emoji === e ? "2px solid #7B61FF" : "2px solid transparent",
                              fontSize: 17,
                              cursor: "pointer",
                              padding: 0,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            {e}
                          </button>
                        ))}
                      </div>
                      {kid.emoji && (
                        <button
                          onClick={() => updateKidEmoji(kid.id, kid.emoji)}
                          style={{ marginTop: 10, border: "none", background: "none", color: "#B7ACE3", fontSize: 11.5, fontWeight: 700, cursor: "pointer", padding: 0 }}
                        >
                          Use initial instead
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <h2 style={{ fontFamily: "'Baloo 2', system-ui, sans-serif", fontSize: 22, fontWeight: 700, margin: 0 }}>{kid.name}</h2>
                {progressStatuses.length > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 60, height: 8, borderRadius: 999, background: "#EDE9FB", overflow: "hidden" }}>
                      <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 999, transition: "width 0.2s ease" }} />
                    </div>
                    <span style={{ fontSize: 13, color: "#8A82C0", fontWeight: 700 }}>
                      {kidDone}/{progressStatuses.length}
                    </span>
                  </div>
                )}

                <button
                  className="cc-btn"
                  onClick={() => {
                    setHistoryModalKidId(kid.id);
                    setExpandedLogDate(null);
                  }}
                  aria-label={`View ${kid.name}'s point history`}
                  style={{ display: "flex", alignItems: "center", gap: 6, border: "none", background: "none", cursor: "pointer", padding: 0, marginLeft: "auto" }}
                >
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: "50%",
                      background: `linear-gradient(135deg, ${color}, #7B61FF)`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <Coins size={14} color="#fff" />
                  </div>
                  <span style={{ fontSize: 16, fontWeight: 800, fontFamily: "'Baloo 2', system-ui, sans-serif", color: "#2B2250" }}>
                    {r.points} <span style={{ fontSize: 12, color: "#8A82C0", fontWeight: 700 }}>pts</span>
                  </span>
                </button>

                <button
                  className="cc-btn"
                  onClick={() => openRedeemModal(kid.id)}
                  disabled={rewardsMenu.length === 0}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    padding: "7px 14px",
                    borderRadius: 999,
                    border: "none",
                    background: rewardsMenu.length === 0 ? "#EDE9FB" : `linear-gradient(135deg, ${color}, #7B61FF)`,
                    color: rewardsMenu.length === 0 ? "#B7ACE3" : "#fff",
                    fontSize: 12.5,
                    fontWeight: 700,
                    cursor: rewardsMenu.length === 0 ? "not-allowed" : "pointer",
                    flexShrink: 0,
                  }}
                >
                  <Gift size={13} />
                  Redeem
                </button>
              </div>

              {r.history.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <button
                    onClick={() => setExpandedHistory((s) => ({ ...s, [kid.id]: !s[kid.id] }))}
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                        border: "none",
                        background: "none",
                        color: "#8A82C0",
                        fontSize: 12.5,
                        fontWeight: 700,
                        cursor: "pointer",
                        padding: 0,
                        marginBottom: expandedHistory[kid.id] ? 8 : 0,
                      }}
                    >
                      {expandedHistory[kid.id] ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      {r.history.length} redemption{r.history.length === 1 ? "" : "s"}
                    </button>

                    {expandedHistory[kid.id] &&
                      r.history.map((h, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "#8A82C0", fontWeight: 600, padding: "3px 0" }}>
                          {h.paid && <PartyPopper size={13} color="#F5A623" />}
                          <span style={{ flex: 1 }}>
                            {h.name} <span style={{ color: "#C9C0EE" }}>· {formatShortDate(h.date)}</span>
                          </span>
                          <span>−{h.cost} pts</span>
                          {!h.paid && (
                            <button
                              onClick={() => markPaidOut(kid.id, i)}
                              aria-label={`Mark ${h.name} as paid out`}
                              title="Paid out"
                              style={{ border: "none", background: "none", color: "#4ECB71", cursor: "pointer", padding: 2, display: "flex" }}
                            >
                              <Check size={13} />
                            </button>
                          )}
                          <button
                            onClick={() => deleteHistoryEntry(kid.id, i)}
                            aria-label={h.paid ? `Delete ${h.name} record` : `Delete ${h.name} and refund points`}
                            title={h.paid ? "Delete record" : "Delete and refund points"}
                            style={{ border: "none", background: "none", color: "#C9C0EE", cursor: "pointer", padding: 2, display: "flex" }}
                          >
                            <X size={13} />
                          </button>
                        </div>
                      ))}
                  </div>
                )}

              {kidChores.length === 0 ? (
                <div style={{ fontSize: 13.5, color: "#A79ED1", fontWeight: 600, paddingLeft: 46 }}>
                  No chores yet — tap a category below to add one.
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14 }}>
                  {CATEGORIES.map((cat) => {
                    const items = kidStatuses.filter((x) => x.c.category === cat.id && x.status.applicable !== false);
                    if (items.length === 0) return null;
                    const Icon = cat.icon;
                    return (
                      <div key={cat.id} style={{ background: cat.tint, border: "2px solid #B7ACE3", borderRadius: 18, padding: 16, boxShadow: "0 2px 8px rgba(43,34,80,0.06)" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 14, fontWeight: 800, color: cat.accent, marginBottom: 12 }}>
                          <Icon size={15} fill={cat.id === "ANY" ? cat.accent : "none"} />
                          {cat.label}
                          <button
                            className="cc-btn"
                            onClick={() => startAddFor(kid.id, cat.id)}
                            aria-label={`Add ${/^[aeiou]/i.test(cat.label) ? "an" : "a"} ${cat.label} chore for ${kid.name}`}
                            title={`Add ${/^[aeiou]/i.test(cat.label) ? "an" : "a"} ${cat.label} chore`}
                            style={{
                              marginLeft: "auto",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              width: 24,
                              height: 24,
                              borderRadius: "50%",
                              border: `2px solid ${cat.accent}`,
                              background: "transparent",
                              color: cat.accent,
                              cursor: "pointer",
                              padding: 0,
                              opacity: 0.8,
                            }}
                          >
                            <Plus size={13} strokeWidth={3} />
                          </button>
                        </div>

                        {items.map(({ c, status }) => {
                          if (c.pending) {
                            return (
                              <div
                                key={c.id}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 7,
                                  padding: "7px 0",
                                  borderBottom: "1.5px solid rgba(43,34,80,0.06)",
                                }}
                              >
                                <div
                                  style={{
                                    width: 22,
                                    height: 22,
                                    borderRadius: "50%",
                                    flexShrink: 0,
                                    border: "2px dashed #B7ACE3",
                                  }}
                                />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: 15.5, fontWeight: 600, color: "#2B2250" }}>{c.name}</div>
                                  <div style={{ fontSize: 12, color: "#F5A623", fontWeight: 700 }}>
                                    Pending approval · {c.points || 0} pts
                                  </div>
                                </div>
                                {unlocked && (
                                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                                    <button
                                      onClick={() => approveChore(c.id)}
                                      aria-label={`Approve ${c.name}`}
                                      title="Approve"
                                      style={{
                                        width: 26,
                                        height: 26,
                                        borderRadius: "50%",
                                        border: "none",
                                        background: "#4ECB71",
                                        color: "#fff",
                                        cursor: "pointer",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        padding: 0,
                                      }}
                                    >
                                      <Check size={13} strokeWidth={3} />
                                    </button>
                                    <button
                                      onClick={() => rejectChore(c.id)}
                                      aria-label={`Reject ${c.name}`}
                                      title="Reject"
                                      style={{
                                        width: 26,
                                        height: 26,
                                        borderRadius: "50%",
                                        border: "2px solid #E2DBFA",
                                        background: "#FFFFFF",
                                        color: "#C0392B",
                                        cursor: "pointer",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        padding: 0,
                                      }}
                                    >
                                      <X size={13} strokeWidth={3} />
                                    </button>
                                  </div>
                                )}
                              </div>
                            );
                          }
                          const dueDayLabel = typeof c.dueDay === "number" ? WEEKDAYS.find((d) => d.value === c.dueDay)?.label : null;
                          const dueDateLabel = c.dueDate ? formatLongDate(c.dueDate) : null;
                          const dayListLabel = c.category === "AM" || c.category === "PM" || c.category === "BONUS" ? formatDayList(resolveDays(c)) : null;
                          const isDragging = draggedChoreId === c.id;
                          const isDragOver = dragOverChoreId === c.id && draggedChoreId && draggedChoreId !== c.id;
                          return (
                            <div
                              key={c.id}
                              draggable={unlocked}
                              onDragStart={() => setDraggedChoreId(c.id)}
                              onDragOver={(e) => {
                                if (!unlocked) return;
                                e.preventDefault();
                                const rect = e.currentTarget.getBoundingClientRect();
                                const position = e.clientY - rect.top < rect.height / 2 ? "before" : "after";
                                if (dragOverChoreId !== c.id) setDragOverChoreId(c.id);
                                if (dragOverPosition !== position) setDragOverPosition(position);
                              }}
                              onDrop={(e) => {
                                e.preventDefault();
                                if (draggedChoreId) reorderChore(kid.id, cat.id, draggedChoreId, c.id, dragOverPosition === "after");
                                setDraggedChoreId(null);
                                setDragOverChoreId(null);
                              }}
                              onDragEnd={() => {
                                setDraggedChoreId(null);
                                setDragOverChoreId(null);
                              }}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 7,
                                padding: "7px 0",
                                borderBottom: isDragOver && dragOverPosition === "after" ? "2px solid #7B61FF" : "1.5px solid rgba(43,34,80,0.06)",
                                opacity: isDragging ? 0.4 : 1,
                                borderTop: isDragOver && dragOverPosition === "before" ? "2px solid #7B61FF" : "1.5px solid transparent",
                              }}
                            >
                              {unlocked && (
                                <span style={{ display: "flex", cursor: "grab", flexShrink: 0, color: "#C9C0EE", touchAction: "none" }}>
                                  <GripVertical size={14} />
                                </span>
                              )}
                              <button
                                className="cc-check"
                                onClick={() => toggleDone(c.id)}
                                aria-label={status.done ? "Mark not done" : "Mark done"}
                                style={{
                                  width: 22,
                                  height: 22,
                                  borderRadius: "50%",
                                  flexShrink: 0,
                                  border: status.done ? "none" : `2.5px solid ${status.overdue ? "#FF5A5F" : "#FFFFFF"}`,
                                  background: status.done ? cat.accent : "#FFFFFF",
                                  boxShadow: status.done ? "none" : "0 1px 3px rgba(43,34,80,0.15)",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  cursor: "pointer",
                                  padding: 0,
                                }}
                              >
                                {status.done && <Check size={13} color="#fff" strokeWidth={3} />}
                              </button>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 15.5, fontWeight: 600, color: status.done ? "#A79ED1" : "#2B2250", textDecoration: status.done ? "line-through" : "none" }}>
                                  {c.name}
                                </div>
                                {(dueDayLabel || dueDateLabel) && !status.done && (
                                  <div style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 12.5, color: "#A79ED1", fontWeight: 700 }}>
                                    {(status.overdue || status.daysUntilDue === 0) && <Clock size={12} color="#FF5A5F" />}
                                    {status.overdue ? `Overdue — was due ${dueDayLabel || dueDateLabel}` : `Due by ${dueDayLabel || dueDateLabel}`}
                                  </div>
                                )}
                                {dayListLabel && (
                                  <div style={{ fontSize: 12.5, color: "#A79ED1", fontWeight: 700 }}>{dayListLabel}</div>
                                )}
                              </div>
                              {c.points > 0 && (
                                <span style={{ display: "flex", alignItems: "center", gap: 1, fontSize: 12.5, fontWeight: 700, color: cat.accent, flexShrink: 0 }}>
                                  <Coins size={11} />
                                  {c.points || 0}
                                </span>
                              )}
                              {c.streak > 1 && (
                                <span style={{ display: "flex", alignItems: "center", gap: 1, fontSize: 12.5, fontWeight: 700, color: "#F5A623", flexShrink: 0 }}>
                                  <Flame size={12} fill="#F5A623" />
                                  {c.streak}
                                </span>
                              )}
                              {unlocked && (
                                <>
                                  <button onClick={withUnlock(() => startEdit(c))} aria-label="Edit chore" style={{ border: "none", background: "none", color: "#B7ACE3", cursor: "pointer", padding: 2, flexShrink: 0 }}>
                                    <Pencil size={12} />
                                  </button>
                                  <button onClick={withUnlock(() => removeChore(c.id))} aria-label="Remove chore" style={{ border: "none", background: "none", color: "#C9C0EE", cursor: "pointer", padding: 2, flexShrink: 0 }}>
                                    <X size={12} />
                                  </button>
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Categories with no visible box for this kid (none yet, or none
                  scheduled today) can't host a "+" of their own, so they get
                  a small dashed pill here instead — nothing is unreachable. */}
              {(() => {
                const shown = new Set(kidStatuses.filter((x) => x.status.applicable !== false).map((x) => x.c.category));
                const missing = CATEGORIES.filter((cat) => !shown.has(cat.id));
                if (missing.length === 0) return null;
                return (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14, paddingLeft: 46 }}>
                    {missing.map((cat) => (
                      <button
                        key={cat.id}
                        className="cc-btn"
                        onClick={() => startAddFor(kid.id, cat.id)}
                        aria-label={`Add ${/^[aeiou]/i.test(cat.label) ? "an" : "a"} ${cat.label} chore for ${kid.name}`}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 5,
                          padding: "6px 12px",
                          borderRadius: 999,
                          border: "2px dashed #D6CEF5",
                          background: "transparent",
                          color: "#8A82C0",
                          fontSize: 12.5,
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        <Plus size={12} strokeWidth={3} />
                        {cat.label}
                      </button>
                    ))}
                  </div>
                );
              })()}
            </div>
          );
        })}

        {kids.length === 0 && (
          <div style={{ textAlign: "center", color: "#9C93C9", padding: "40px 0", fontWeight: 600 }}>
            No kids yet. Click "Kids" above to add one.
          </div>
        )}
      </div>

      {/* Redeem popup */}
      {redeemModalKidId &&
        (() => {
          const kid = kids.find((k) => k.id === redeemModalKidId);
          if (!kid) return null;
          const r = rewards[redeemModalKidId] || defaultReward();
          const color = colorForKid(kid);
          const selected = rewardsMenu.find((item) => item.id === selectedRewardId) || rewardsMenu[0];
          const affordable = selected && r.points >= selected.cost;

          return (
            <div
              onClick={closeRedeemModal}
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(43,34,80,0.45)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 1000,
                padding: 20,
              }}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  background: "#FFFFFF",
                  borderRadius: 22,
                  padding: 24,
                  width: "100%",
                  maxWidth: 380,
                  boxShadow: "0 20px 50px rgba(43,34,80,0.3)",
                  fontFamily: "'Nunito', -apple-system, sans-serif",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: "50%",
                      background: color,
                      color: "#fff",
                      fontWeight: 800,
                      fontSize: 20, lineHeight: 1,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontFamily: "'Baloo 2', system-ui, sans-serif",
                      flexShrink: 0,
                    }}
                  >
                    {avatarContent(kid)}
                  </div>
                  <div style={{ fontFamily: "'Baloo 2', system-ui, sans-serif", fontSize: 19, fontWeight: 700, flex: 1 }}>{kid.name}'s rewards</div>
                  <button onClick={closeRedeemModal} aria-label="Close" style={{ border: "none", background: "none", color: "#B7ACE3", cursor: "pointer", padding: 4 }}>
                    <X size={18} />
                  </button>
                </div>

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    background: "#F8F6FE",
                    borderRadius: 14,
                    padding: "12px 16px",
                    margin: "14px 0",
                  }}
                >
                  <Coins size={20} color={color} />
                  <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "'Baloo 2', system-ui, sans-serif" }}>{r.points}</div>
                  <div style={{ fontSize: 13, color: "#8A82C0", fontWeight: 700 }}>points banked</div>
                </div>

                {rewardsMenu.length === 0 ? (
                  <div style={{ fontSize: 13.5, color: "#A79ED1", fontWeight: 600, textAlign: "center", padding: "12px 0" }}>
                    No rewards set up yet. Add some from the Rewards panel.
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize: 13, color: "#8A82C0", fontWeight: 700, marginBottom: 6 }}>Choose a reward</div>
                    <select
                      value={selected?.id}
                      onChange={(e) => setSelectedRewardId(e.target.value)}
                      style={{ width: "100%", padding: "11px 14px", borderRadius: 12, border: "2px solid #E2DBFA", fontSize: 15, fontFamily: "inherit", fontWeight: 600, marginBottom: 14 }}
                    >
                      {rewardsMenu.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} — {item.cost} pts
                        </option>
                      ))}
                    </select>

                    {selected && (
                      <div style={{ fontSize: 13, color: affordable ? "#4ECB71" : "#FF5A5F", fontWeight: 700, marginBottom: 14 }}>
                        {affordable
                          ? `Leaves ${r.points - selected.cost} points after redeeming`
                          : `Needs ${selected.cost - r.points} more point${selected.cost - r.points === 1 ? "" : "s"}`}
                      </div>
                    )}

                    <button
                      className="cc-btn"
                      onClick={() => selected && affordable && redeemReward(kid.id, selected)}
                      disabled={!affordable}
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 8,
                        padding: "12px 0",
                        borderRadius: 14,
                        border: "none",
                        background: affordable ? `linear-gradient(135deg, ${color}, #7B61FF)` : "#EDE9FB",
                        color: affordable ? "#fff" : "#B7ACE3",
                        fontSize: 15,
                        fontWeight: 700,
                        cursor: affordable ? "pointer" : "not-allowed",
                      }}
                    >
                      <Gift size={16} />
                      Redeem
                    </button>

                    {redeemFlash && (
                      <div style={{ textAlign: "center", fontSize: 13.5, color: "#4ECB71", fontWeight: 700, marginTop: 10 }}>{redeemFlash} 🎉</div>
                    )}
                  </>
                )}

                {r.history.length > 0 && (
                  <div style={{ marginTop: 18, borderTop: "1.5px solid #F1EDFB", paddingTop: 12 }}>
                    <button
                      onClick={() => setExpandedHistory((s) => ({ ...s, [kid.id + "-modal"]: !s[kid.id + "-modal"] }))}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                        border: "none",
                        background: "none",
                        color: "#8A82C0",
                        fontSize: 12.5,
                        fontWeight: 700,
                        cursor: "pointer",
                        padding: 0,
                        marginBottom: expandedHistory[kid.id + "-modal"] ? 8 : 0,
                      }}
                    >
                      {expandedHistory[kid.id + "-modal"] ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      Recent redemptions ({r.history.length})
                    </button>

                    {expandedHistory[kid.id + "-modal"] &&
                      r.history.map((h, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "#A79ED1", fontWeight: 600, padding: "3px 0" }}>
                          {h.paid && <PartyPopper size={13} color="#F5A623" />}
                          <span style={{ flex: 1 }}>
                            {h.name} <span style={{ color: "#C9C0EE" }}>· {formatShortDate(h.date)}</span>
                          </span>
                          <span>−{h.cost} pts</span>
                          {!h.paid && (
                            <button
                              onClick={() => markPaidOut(kid.id, i)}
                              aria-label={`Mark ${h.name} as paid out`}
                              title="Paid out"
                              style={{ border: "none", background: "none", color: "#4ECB71", cursor: "pointer", padding: 2, display: "flex" }}
                            >
                              <Check size={13} />
                            </button>
                          )}
                          <button
                            onClick={() => deleteHistoryEntry(kid.id, i)}
                            aria-label={h.paid ? `Delete ${h.name} record` : `Delete ${h.name} and refund points`}
                            title={h.paid ? "Delete record" : "Delete and refund points"}
                            style={{ border: "none", background: "none", color: "#C9C0EE", cursor: "pointer", padding: 2, display: "flex" }}
                          >
                            <X size={13} />
                          </button>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>
          );
        })()}

      {/* Fireworks celebration — fires once when a kid earns a point */}
      {fireworks && (
        <div style={{ position: "fixed", inset: 0, zIndex: 2000, pointerEvents: "none", overflow: "hidden" }}>
          {fireworks.map((p) => (
            <div
              key={p.id}
              style={{
                position: "absolute",
                left: `${p.left}%`,
                top: `${p.top}%`,
                width: 9,
                height: 9,
                borderRadius: "50%",
                background: p.color,
                boxShadow: `0 0 6px ${p.color}`,
                "--tx": `${p.tx}px`,
                "--ty": `${p.ty}px`,
                animation: `cc-firework 1.1s ease-out ${p.delay}s forwards`,
              }}
            />
          ))}
        </div>
      )}

      {/* Point history popup */}
      {historyModalKidId &&
        (() => {
          const kid = kids.find((k) => k.id === historyModalKidId);
          if (!kid) return null;
          const r = rewards[historyModalKidId] || defaultReward();
          const color = colorForKid(kid);
          const booksRead = chores
            .filter((c) => c.kidId === historyModalKidId && c.category === "BOOK" && c.lastDone)
            .sort((a, b) => new Date(b.lastDone) - new Date(a.lastDone));
          const closeHistoryModal = () => {
            setHistoryModalKidId(null);
            setExpandedLogDate(null);
          };

          return (
            <div
              onClick={closeHistoryModal}
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(43,34,80,0.45)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 1000,
                padding: 20,
              }}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  background: "#FFFFFF",
                  borderRadius: 22,
                  padding: 24,
                  width: "100%",
                  maxWidth: 420,
                  maxHeight: "80vh",
                  overflowY: "auto",
                  boxShadow: "0 20px 50px rgba(43,34,80,0.3)",
                  fontFamily: "'Nunito', -apple-system, sans-serif",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: "50%",
                      background: color,
                      color: "#fff",
                      fontWeight: 800,
                      fontSize: 20, lineHeight: 1,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontFamily: "'Baloo 2', system-ui, sans-serif",
                      flexShrink: 0,
                    }}
                  >
                    {avatarContent(kid)}
                  </div>
                  <div style={{ fontFamily: "'Baloo 2', system-ui, sans-serif", fontSize: 19, fontWeight: 700, flex: 1 }}>{kid.name}'s history</div>
                  <button onClick={closeHistoryModal} aria-label="Close" style={{ border: "none", background: "none", color: "#B7ACE3", cursor: "pointer", padding: 4 }}>
                    <X size={18} />
                  </button>
                </div>
                <div style={{ fontSize: 12.5, color: "#8A82C0", fontWeight: 600, marginBottom: 14 }}>
                  A point either came in that day or it didn't — tap a day to see which chores made the difference.
                </div>

                {booksRead.length > 0 && (
                  <div style={{ marginBottom: 18, paddingBottom: 14, borderBottom: "1.5px solid #F1EDFB" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "#C9639A", fontWeight: 800, marginBottom: 8 }}>
                      <BookOpen size={13} />
                      Books read
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {booksRead.map((c) => (
                        <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: "#2B2250" }}>
                          <span style={{ flex: 1 }}>
                            {c.name} <span style={{ color: "#C9C0EE", fontWeight: 600 }}>- {formatLongDate(c.lastDone)}</span>
                          </span>
                          <span style={{ display: "flex", alignItems: "center", gap: 2, color: "#C9639A", fontWeight: 700, fontSize: 12 }}>
                            <Coins size={11} />
                            {c.points || 0}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {(r.log || []).length === 0 ? (
                  <div style={{ textAlign: "center", padding: "20px 0" }}>
                    <div style={{ fontSize: 13.5, color: "#A79ED1", fontWeight: 600, marginBottom: 14 }}>
                      No history yet — check back once today's chores have been marked.
                    </div>
                    <button
                      className="cc-btn"
                      onClick={() => seedSampleHistory(kid.id)}
                      style={{
                        padding: "9px 18px",
                        borderRadius: 999,
                        border: "2px dashed #E2DBFA",
                        background: "#FAFAFC",
                        color: "#8A82C0",
                        fontSize: 13,
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      Generate sample week (for testing)
                    </button>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {(r.log || []).map((entry) => {
                      const isOpen = expandedLogDate === entry.date;
                      // Backward-compatible: older entries only had a gotPoint boolean.
                      const pointsEarned = typeof entry.pointsEarned === "number" ? entry.pointsEarned : entry.gotPoint ? 1 : 0;
                      const earned = pointsEarned > 0;
                      return (
                        <div key={entry.date} style={{ border: "2px solid #F1EDFB", borderRadius: 14, overflow: "hidden" }}>
                          <button
                            onClick={() => setExpandedLogDate(isOpen ? null : entry.date)}
                            style={{
                              width: "100%",
                              display: "flex",
                              alignItems: "center",
                              gap: 10,
                              padding: "10px 14px",
                              border: "none",
                              background: earned ? `${color}14` : "#FAFAFC",
                              cursor: "pointer",
                              fontFamily: "inherit",
                            }}
                          >
                            <div
                              style={{
                                width: 22,
                                height: 22,
                                borderRadius: "50%",
                                flexShrink: 0,
                                background: earned ? color : "#EDE9FB",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              {earned ? <Check size={12} color="#fff" strokeWidth={3} /> : <X size={12} color="#B7ACE3" strokeWidth={3} />}
                            </div>
                            <span style={{ fontSize: 13.5, fontWeight: 700, color: "#2B2250", flex: 1, textAlign: "left" }}>{formatLogDate(entry.date)}</span>
                            <span style={{ fontSize: 12, fontWeight: 700, color: earned ? color : "#B7ACE3" }}>
                              {earned ? `+${pointsEarned} point${pointsEarned === 1 ? "" : "s"}` : "0 points"}
                            </span>
                            {isOpen ? <ChevronUp size={15} color="#B7ACE3" /> : <ChevronDown size={15} color="#B7ACE3" />}
                          </button>

                          {isOpen && (
                            <div style={{ padding: "8px 14px 12px 46px", background: "#FDFDFF" }}>
                              {entry.chores.map((c, i) => (
                                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0" }}>
                                  {c.done ? <Check size={13} color="#4ECB71" strokeWidth={3} /> : <X size={13} color={c.overdue ? "#FF5A5F" : "#C9C0EE"} strokeWidth={3} />}
                                  <span style={{ fontSize: 13, fontWeight: 600, color: c.done ? "#8A82C0" : "#2B2250", flex: 1 }}>{c.name}</span>
                                  {typeof c.points === "number" && (
                                    <span style={{ fontSize: 11, fontWeight: 700, color: "#3B9EE0" }}>{c.done ? `+${c.points} pts` : `${c.points} pts`}</span>
                                  )}
                                  <span style={{ fontSize: 11, fontWeight: 700, color: "#C9C0EE" }}>
                                    {CATEGORIES.find((cat) => cat.id === c.category)?.label}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {(r.log || []).length > 0 && (
                  <button
                    onClick={() => seedSampleHistory(kid.id)}
                    style={{ marginTop: 10, border: "none", background: "none", color: "#C9C0EE", fontSize: 11.5, fontWeight: 700, cursor: "pointer", padding: 0 }}
                  >
                    + generate more sample days (testing)
                  </button>
                )}
              </div>
            </div>
          );
        })()}
    </div>
  );
}
