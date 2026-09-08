// Generates the two phone data tables and writes them into both pages, between the markers.
// Run it when the metadata needs refreshing; the output is committed, so the pages never
// fetch anything at runtime and the tests never need the network.
//
//   ELECTRON_RUN_AS_NODE=1 "C:/Users/ASUS/AppData/Local/Programs/Microsoft VS Code/Code.exe" \
//     tools/gen-phone-data.js
//
// Sources are pinned by version in the URLs below. Bumping a version is a deliberate act:
// re-run, read the diff, and check the tests before committing.
const fs = require("fs");

const LPN = "1.11.17";
const CAT = "3.6.0";
const SOURCES = {
  meta: "https://cdn.jsdelivr.net/npm/libphonenumber-js@" + LPN + "/metadata.min.json",
  examples: "https://cdn.jsdelivr.net/npm/libphonenumber-js@" + LPN + "/examples.mobile.json",
  zones: "https://cdn.jsdelivr.net/npm/countries-and-timezones@" + CAT + "/dist/index.js"
};
const BEGIN = "  // ---- BEGIN GENERATED phone data (tools/gen-phone-data.js) ----";
const END = "  // ---- END GENERATED phone data ----";

// Nine country names where the packages disagree with what the country question already
// stores, or where the zone package has no country at all. A changed name string is a
// country question whose stored answers stop resolving, so the page's vocabulary wins and
// this map is what makes it win. XK, AC and TA exist because libphonenumber knows a
// dialable territory that the zone package does not carry as a country in its own right
// (XK/Kosovo on +383; AC/Ascension Island and TA/Tristan da Cunha are folded into Saint
// Helena's entry there), so without an override each would emit its bare ISO code as its name.
const NAME_OVERRIDE = {
  CG: "Congo (Brazzaville)",
  CD: "Congo (Kinshasa)",
  CI: "Cote d'Ivoire",
  TR: "Turkey",
  US: "United States",
  VA: "Vatican City",
  XK: "Kosovo",         // libphonenumber knows XK on +383; the zone package has no such country
  AC: "Ascension Island",
  TA: "Tristan da Cunha"
};

function die(msg) { console.error("REFUSING TO WRITE: " + msg); process.exit(1); }

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) die("could not fetch " + url + " (" + r.status + ")");
  return r.json();
}
async function getText(url) {
  const r = await fetch(url);
  if (!r.ok) die("could not fetch " + url + " (" + r.status + ")");
  return r.text();
}

(async function main() {
  const meta = await getJson(SOURCES.meta);
  const examples = await getJson(SOURCES.examples);
  const catSrc = await getText(SOURCES.zones);
  const mod = { exports: {} };
  new Function("module", "exports", "require", catSrc)(mod, mod.exports, require);
  const ct = mod.exports.default || mod.exports;

  const C = meta.countries;
  const b36 = function (n) { return n.toString(36); };

  // The primary country of a dial code is the FIRST one listed against it, which is why this
  // is read from country_calling_codes rather than worked out from the country list. Twelve
  // codes are shared, +1 by 25 countries, and alphabetical order would put an Antigua flag
  // on every American number.
  const primary = {};
  Object.keys(meta.country_calling_codes).forEach(function (dial) {
    primary[meta.country_calling_codes[dial][0]] = 1;
  });

  const isos = Object.keys(C).sort();
  const rows = isos.map(function (iso) {
    const c = ct.getCountry(iso);
    const name = NAME_OVERRIDE[iso] || (c && c.name) || iso;
    const lens = (C[iso][3] || []).map(b36).join("");
    const fields = [iso, C[iso][0], lens, examples[iso] || "", C[iso][2] || "", name, primary[iso] ? "1" : ""];
    fields.forEach(function (f, i) {
      if (String(f).indexOf("~") !== -1 || String(f).indexOf(";") !== -1) {
        die(iso + " field " + i + " contains a separator: " + f);
      }
    });
    if (!lens) die(iso + " has no possible lengths");
    if (!examples[iso]) die(iso + " has no example number");
    if (!C[iso][2]) die(iso + " has no pattern");
    return fields.join("~");
  });
  const phoneRows = rows.join(";");

  // Deprecated zone names are included deliberately: browsers still report Asia/Calcutta and
  // Europe/Kiev, and ICU treats several of them as canonical. Without them India, Ukraine,
  // Myanmar and Argentina never pre-fill. getCountryForTimezone returns the country the zone
  // is NAMED for, which is the only reading that survives the 109 zones tzdata shares between
  // countries.
  const zonePairs = Object.keys(ct.getAllTimezones({ deprecated: true })).sort().map(function (z) {
    const c = ct.getCountryForTimezone(z);
    if (!c) return null;                      // Etc/UTC, Antarctica: safe non-answers
    if (z.indexOf("~") !== -1 || z.indexOf(";") !== -1) die("zone contains a separator: " + z);
    return z + "~" + c.id;
  }).filter(Boolean);
  const tzIso = zonePairs.join(";");

  // ---- assertions that must hold before anything is written ----------------------------
  rows.forEach(function (r) {
    const p = r.split("~");
    const lens = p[2].split("").map(function (ch) { return parseInt(ch, 36); });
    const ex = p[3];
    if (lens.indexOf(ex.length) === -1) die(p[0] + " example " + ex + " is not a valid length");
    if (!new RegExp("^(?:" + p[4] + ")$").test(ex)) die(p[0] + " example " + ex + " fails its own pattern");
    // A name that equals its own ISO code means the zone package does not know this territory
    // as a country (AC and TA were the two found this way) and NAME_OVERRIDE needs an entry,
    // the same way XK did. Left unchecked, the picker would show a bare two-letter code where
    // every other row shows a country name.
    if (p[5] === p[0]) die(p[0] + " has no real name, only its own ISO code, add it to NAME_OVERRIDE");
  });
  if (!/JO~962~89~/.test(phoneRows)) die("Jordan is not where it should be in the table");
  if (!/Asia\/Amman~JO;/.test(tzIso + ";")) die("Asia/Amman does not map to JO");

  // The page's own country vocabulary is the authority. Read it out of f/index.html rather
  // than restated here, so this cannot quietly diverge from the list the question offers.
  const fsrc = fs.readFileSync("f/index.html", "utf8");
  const m = fsrc.match(/\n  var COUNTRY_NAMES_ALL = \[[^\n]*\];/);
  if (!m) die("could not find COUNTRY_NAMES_ALL in f/index.html");
  const ours = JSON.parse(m[0].match(/\[.*\]/)[0]);
  const emitted = {};
  rows.forEach(function (r) { const nm = r.split("~")[5]; emitted[nm] = (emitted[nm] || 0) + 1; });
  const missing = ours.filter(function (nm) { return !emitted[nm]; });
  if (missing.length) die("these country names have no dial row, add them to NAME_OVERRIDE: " + JSON.stringify(missing));

  // ---- write the block into both pages -------------------------------------------------
  // Emitted through JSON.stringify so the 779 backslashes in the patterns survive as \d
  // rather than becoming d, and each table is ONE line because the test harness's grabVar
  // matches `var NAME = [^\n]*;`.
  const block = [
    BEGIN,
    "  // libphonenumber-js " + LPN + " and countries-and-timezones " + CAT + ". Do not edit by hand:",
    "  // re-run tools/gen-phone-data.js instead. " + rows.length + " countries, " + zonePairs.length + " zones.",
    "  var PHONE_ROWS = " + JSON.stringify(phoneRows) + ";",
    "  var TZ_ISO = " + JSON.stringify(tzIso) + ";",
    END
  ];

  ["index.html", "f/index.html"].forEach(function (file) {
    const src = fs.readFileSync(file, "utf8");
    const eol = src.indexOf("\r\n") !== -1 ? "\r\n" : "\n";   // the tree is CRLF; keep it
    const lines = src.split(/\r?\n/);
    const from = lines.indexOf(BEGIN), to = lines.indexOf(END);
    if (from === -1 || to === -1 || to < from) die("markers not found in " + file + " (add them by hand first)");
    const out = lines.slice(0, from).concat(block, lines.slice(to + 1));
    fs.writeFileSync(file, out.join(eol));
    console.log("wrote " + (to - from + 1) + " lines -> " + block.length + " into " + file);
  });
  console.log("PHONE_ROWS " + Buffer.byteLength(JSON.stringify(phoneRows)) + " bytes, TZ_ISO " +
              Buffer.byteLength(JSON.stringify(tzIso)) + " bytes");
})();
