// Recording the device's own timezone, so "how often would guessing the country be wrong?"
// becomes a number from real traffic instead of an estimate.
//
// Nothing reads what this records. The public form sends the zone as a request header,
// `capture_request_meta()` files it under `extra._tz` beside the branch the customer picked,
// and the branch is the ground truth — on a form where Branch is required it *proves* the
// country. After a couple of weeks the two columns can be compared.
//
// Three things make this worth pinning rather than eyeballing:
//
//   the name, not the offset  Amman and Beirut are both +03:00 from April to October, so for
//                             nine months of the year the offset cannot tell them apart. Only
//                             the IANA name can, and ICU renames some of them (Asia/Istanbul
//                             answers as Europe/Istanbul), so it has to be read back through
//                             Intl rather than trusted raw.
//   the header is optional    A browser that will not say — Firefox's resistFingerprinting,
//                             Tor, Brave's fingerprint blocking — must send no header at all
//                             and submit exactly as it does today. This is the same shape as
//                             the `p_device` rule in one-per-browser.test.js: an extra key
//                             that reaches a function which is not expecting it is a dead
//                             submit button on every form. A header avoids the argument
//                             entirely, which is the reason it is a header.
//   record, do not interpret  The client stores the raw zone and maps nothing to a country.
//                             The mapping is a guess we are trying to *measure*; baking it
//                             into the page would mean measuring the guess against itself,
//                             and would freeze it where a better one cannot be re-derived
//                             from the rows already collected.
const fs = require('fs'), vm = require('vm'), assert = require('assert');

function scripts(file) {
  const src = fs.readFileSync(file, 'utf8');
  return [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
}
function grab(js, name, file) {
  const re = new RegExp('\\n  function ' + name + '\\s*\\([\\s\\S]*?\\n  \\}', '');
  const m = js.match(re);
  if (!m) throw new Error('could not find function ' + name + ' in ' + file);
  return m[0];
}
// A top-level `var NAME = ...;` the functions close over, pulled out of the page rather than
// restated here — so the test cannot quietly use a different country list than the page does.
// Anchored to the end of the LINE, not to a following "\n": the working tree is CRLF, so a
// pattern ending `;\n` matches nothing here and the declaration reads as missing.
function grabVar(js, name, file) {
  const m = js.match(new RegExp('\\n  var ' + name + ' = [^\\n]*;'));
  if (!m) throw new Error('could not find var ' + name + ' in ' + file);
  return m[0];
}
// `setup` runs inside the closure, after the declarations, so a test can seed a page-level
// var (the country rows normally arrive from the database) without the page exporting a
// setter it would not otherwise have.
function load(file, names, extra, vars, setup) {
  const js = scripts(file);
  const ctx = Object.assign({ console }, extra || {});
  vm.createContext(ctx);
  new vm.Script('(function(){' + (vars || []).map(v => grabVar(js, v, file)).join('\n') + '\n' +
    names.map(n => grab(js, n, file)).join('\n') + '\n' + (setup || '') +
    '\n this.API={' + names.join(',') + '};}).call(this)').runInContext(ctx);
  return ctx.API;
}
// A browser whose Intl answers `zone`. `null` stands for one that throws, which is what a
// runtime with no ICU data does.
function browserIn(zone) {
  return {
    Intl: {
      DateTimeFormat: function () {
        return { resolvedOptions: function () {
          if (zone === null) throw new Error('no ICU');
          return { timeZone: zone };
        } };
      }
    }
  };
}
const NAMES = ['deviceZone', 'tzHeaders'];
const at = zone => load('f/index.html', NAMES, browserIn(zone));

const SRC = fs.readFileSync('f/index.html', 'utf8');

let n = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);

// ---- reading the zone ----
t('a device in Jordan reports its zone by name', () => {
  assert.strictEqual(at('Asia/Amman').deviceZone(), 'Asia/Amman');
});
t('a device in Lebanon is a different name, not a different offset', () => {
  // The whole reason this is name-based. If these two ever compare equal the measurement
  // is worthless, because Jordan and Lebanon are the two countries being told apart.
  assert.notStrictEqual(at('Asia/Beirut').deviceZone(), at('Asia/Amman').deviceZone());
});
t('the other two countries on file report too', () => {
  assert.strictEqual(at('Asia/Baghdad').deviceZone(), 'Asia/Baghdad');
  assert.strictEqual(at('Asia/Damascus').deviceZone(), 'Asia/Damascus');
});
t('a zone that is none of ours is still recorded, not discarded', () => {
  // Asia/Riyadh is +03:00, exactly Amman's offset, and a real device carries it. Recording
  // it is how we find out how much of the traffic is unclassifiable rather than wrong.
  assert.strictEqual(at('Asia/Riyadh').deviceZone(), 'Asia/Riyadh');
});
t('a hardened browser answering UTC is recorded as UTC, not as nothing', () => {
  // resistFingerprinting / Tor / Brave all say UTC. That is a non-answer, but the SIZE of
  // that slice is one of the things worth learning, so it must not be thrown away here.
  assert.strictEqual(at('UTC').deviceZone(), 'UTC');
});
t('a browser whose Intl throws yields nothing instead of taking the form down', () => {
  assert.strictEqual(at(null).deviceZone(), null);
});
t('a browser with Intl but no DateTimeFormat yields nothing too', () => {
  // A hardened or cut-down runtime can have the namespace and not the constructor. `new
  // undefined()` is a TypeError, and an uncaught one here would stop the page building.
  assert.strictEqual(load('f/index.html', NAMES, { Intl: {} }).deviceZone(), null);
});

// ---- what may cross into the database ----
t('a zone that is not shaped like a zone is refused', () => {
  // This value leaves the browser in a header and is written into a jsonb column, so the
  // page is the first place it has to stop being arbitrary text.
  assert.strictEqual(at('Asia/Amman; drop table').deviceZone(), null);
  assert.strictEqual(at('<script>x</script>').deviceZone(), null);
  assert.strictEqual(at('{"a":1}').deviceZone(), null);
  assert.strictEqual(at('Asia Amman').deviceZone(), null);   // a space is not in the charset
});
t('an absurdly long value is refused rather than truncated', () => {
  // Truncating would file a zone that looks real and is not.
  assert.strictEqual(at('Asia/' + 'A'.repeat(200)).deviceZone(), null);
});
t('an empty or blank answer is nothing', () => {
  assert.strictEqual(at('').deviceZone(), null);
  assert.strictEqual(at('   ').deviceZone(), null);
  assert.strictEqual(at(undefined).deviceZone(), null);
});

// ---- the header ----
t('a zone becomes exactly one header', () => {
  const h = at('Asia/Beirut').tzHeaders();
  assert.deepStrictEqual(Object.keys(h), ['x-blk-tz']);
  assert.strictEqual(h['x-blk-tz'], 'Asia/Beirut');
});
t('a browser that will not say sends NO header', () => {
  // Not an empty-string header: absent. An empty value would land in extra._tz as "" and
  // read as a device that answered, which is the one lie the measurement cannot afford.
  // Compared by key rather than by object: the page runs in its own vm realm, so its `{}`
  // is never reference-equal to one built here and deepStrictEqual compares prototypes.
  assert.deepStrictEqual(Object.keys(at(null).tzHeaders()), []);
  assert.deepStrictEqual(Object.keys(at('nonsense value').tzHeaders()), []);
});
t('the header name matches the one the trigger reads', () => {
  // capture_request_meta() reads hdrs->>'x-blk-tz'. The SQL cannot live in this repo
  // (*.sql is gitignored here because the repo is public and served), so this is the
  // only place the two sides can be held together — change one, change both.
  assert.strictEqual(Object.keys(at('Asia/Amman').tzHeaders())[0], 'x-blk-tz');
  assert.ok(/Kong forwards/.test(SRC), 'the page should say why a header is safe to add here');
});
t('the header rides on the client, so every form sends it and none had to change', () => {
  assert.ok(/createClient\(SUPABASE_URL, SUPABASE_KEY, \{\s*global: \{ headers: tzHeaders\(\) \}/.test(SRC),
    'the zone should be attached once at createClient, not added per call');
});

// ---- the map lives in the database, not in the page ----
t('the page names no timezone of its own', () => {
  // Still a real constraint, and now for a second reason. The zone-to-country map moved into
  // `countries.timezones` (migration 66) so that adding a country, or a second zone for one,
  // is an admin edit rather than a deploy — exactly as `dial` and `aliases` already are. The
  // moment somebody writes the obvious Asia/Amman -> jo table into the page instead, that
  // property is gone and nobody notices until a country needs changing.
  //
  // One deliberate exception: the generated `var TZ_ISO = "...";` line (541 zones, packed by
  // tools/gen-phone-data.js) is a hand-written fallback for the countries countries.timezones
  // does not carry at all, used only inside zoneCountryName's fallback path when the database
  // rows come up empty. It is a single generated declaration, not a hand-written zone-to-country
  // table growing in the page, so it is stripped out here before the check runs. Anything else
  // in the page still has to name no zone: this does not reopen the door for a second,
  // hand-maintained map to grow next to it.
  const withoutGeneratedTzMap = SRC.replace(/\n  var TZ_ISO = "[^\n]*";/, '\n');
  assert.ok(!/Asia\/[A-Za-z_]+/.test(withoutGeneratedTzMap),
    'f/index.html should name no specific timezone outside the generated TZ_ISO fallback, the map belongs to countries.timezones');
  assert.ok(!/getTimezoneOffset/.test(SRC),
    'the offset cannot tell Amman from Beirut for nine months of the year; read the name');
});
t('the country rows are fetched WITH their timezones', () => {
  // The whole feature is inert if the column is not selected — and inert silently: no error,
  // no zone, no pre-fill, on every form.
  const sel = (SRC.match(/from\("countries"\)\s*\.select\("([^"]*)"\)/) || [])[1];
  assert.ok(sel, 'could not find the countries select');
  assert.ok(/\btimezones\b/.test(sel), 'countries select is missing timezones: ' + sel);
});

// ---- which country a zone implies ----
// Seeded with the four countries as they actually are on file, so a test cannot pass against
// a country list the app does not have.
const ROWS = JSON.stringify([
  { code: 'jo', name_en: 'Jordan', name_ar: 'الأردن', timezones: ['Asia/Amman'] },
  { code: 'lebanon', name_en: 'Lebanon', name_ar: 'لبنان', timezones: ['Asia/Beirut'] },
  { code: 'iraq', name_en: 'Iraq', name_ar: 'العراق', timezones: ['Asia/Baghdad'] },
  { code: 'syria', name_en: 'Syria', name_ar: 'سوريا', timezones: ['Asia/Damascus'] },
]);
// zoneCountryName now falls through to the embedded 541-zone map (tzIsoOf / phoneRow) for any
// zone the four database rows do not cover, so those functions and the tables behind them have
// to be in scope here too, or every call below throws a ReferenceError.
const MAP = load('f/index.html',
  ['zoneCountryName', 'countryChoiceNames', 'prefillCountryName', 'tzIsoOf', 'phoneRow', 'phoneTable'],
  {}, ['COUNTRY_ROWS', 'COUNTRY_NAMES_ALL', 'PHONE_ROWS', 'TZ_ISO', 'PHONE_LIST'], 'COUNTRY_ROWS = ' + ROWS + ';');

const TWO = { type: 'country', options: { only: ['jo', 'lebanon'] } };   // Customer Complaints
const FOUR = { type: 'country', options: { only: ['jo', 'lebanon', 'iraq', 'syria'] } };
const ANY = { type: 'country', options: {} };                             // no `only` at all

t('a zone the countries table knows becomes that country', () => {
  assert.strictEqual(MAP.zoneCountryName('Asia/Amman', TWO), 'Jordan');
  assert.strictEqual(MAP.zoneCountryName('Asia/Beirut', TWO), 'Lebanon');
});
t('a country the question does not offer is NOT pre-filled', () => {
  // Opening the two-country complaints form in Baghdad must not fill in Iraq: the box cannot
  // show a choice that is not on its list, and the branch box could not scope to it either.
  assert.strictEqual(MAP.zoneCountryName('Asia/Baghdad', TWO), null);
  assert.strictEqual(MAP.zoneCountryName('Asia/Baghdad', FOUR), 'Iraq');
});
t('a question with no country limit still only offers real countries', () => {
  assert.strictEqual(MAP.zoneCountryName('Asia/Amman', ANY), 'Jordan');
});
t('a zone that is none of ours fills nothing', () => {
  // Asia/Riyadh shares Amman's offset exactly, which is why this must be decided by name.
  assert.strictEqual(MAP.zoneCountryName('Asia/Riyadh', FOUR), null);
  assert.strictEqual(MAP.zoneCountryName('Europe/Istanbul', FOUR), null);
});
t('a hardened browser saying UTC fills nothing', () => {
  assert.strictEqual(MAP.zoneCountryName('UTC', FOUR), null);
});
t('no zone at all fills nothing', () => {
  assert.strictEqual(MAP.zoneCountryName(null, FOUR), null);
  assert.strictEqual(MAP.zoneCountryName('', FOUR), null);
  assert.strictEqual(MAP.zoneCountryName(undefined, FOUR), null);
});
t('a zone outside the four in the database still names a country', () => {
  // countries.timezones holds four zones, so before this a Berlin visitor got +49 on the phone
  // question and nothing at all on Country, on a form offering all 197 names.
  const f = {};                                       // no options.only: offers everything
  assert.strictEqual(MAP.zoneCountryName('Europe/Berlin', f), 'Germany');
  assert.strictEqual(MAP.zoneCountryName('Asia/Dubai', f), 'United Arab Emirates');
  // The database still wins for the four it knows.
  assert.strictEqual(MAP.zoneCountryName('Asia/Amman', f), 'Jordan');
  // And a form scoped to two countries still fills in nothing for a visitor in a third.
  assert.strictEqual(MAP.zoneCountryName('Europe/Berlin', TWO), null);
});
t('a country with no zones on file does not match the row directly, but the embedded map still names it', () => {
  // The column defaults to '{}', so every country starts this way. An empty `timezones` array
  // must never match on its own: indexOf on [] is always -1, so a half-configured row cannot
  // match the first row by accident. Before this task that meant the visitor got nothing; now
  // the embedded map answers it instead, same as it would for a country the database has never
  // heard of at all. (Was: both asserted null, back when there was no fallback to catch them.)
  const bare = load('f/index.html',
    ['zoneCountryName', 'countryChoiceNames', 'prefillCountryName', 'tzIsoOf', 'phoneRow', 'phoneTable'], {},
    ['COUNTRY_ROWS', 'COUNTRY_NAMES_ALL', 'PHONE_ROWS', 'TZ_ISO', 'PHONE_LIST'],
    'COUNTRY_ROWS = [{code:"jo",name_en:"Jordan",timezones:[]},{code:"lebanon",name_en:"Lebanon"}];');
  // This assertion alone does not prove the empty-array guard still holds: `jo` is both the
  // first row in COUNTRY_ROWS and the correct fallback answer for Asia/Amman, so a bug that
  // wrongly matched the first row on empty timezones would return "Jordan" here too. The
  // Asia/Beirut assertion below is the one that discriminates: `lebanon` is the SECOND row, so
  // a wrong first-row match would say "Jordan" while the correct answer is "Lebanon".
  assert.strictEqual(bare.zoneCountryName('Asia/Amman', TWO), 'Jordan');
  assert.strictEqual(bare.zoneCountryName('Asia/Beirut', TWO), 'Lebanon');
});

// ---- what actually gets pre-filled ----
t('an empty country question takes the guess', () => {
  assert.strictEqual(MAP.prefillCountryName(TWO, '', 'Asia/Beirut'), 'Lebanon');
  assert.strictEqual(MAP.prefillCountryName(TWO, null, 'Asia/Beirut'), 'Lebanon');
});
t('AN ANSWER ALREADY THERE ALWAYS WINS', () => {
  // The one that would lose real work: somebody comes back to a draft in which they had
  // already corrected the guess, and the guess must not be put back over their correction.
  assert.strictEqual(MAP.prefillCountryName(TWO, 'Lebanon', 'Asia/Amman'), null);
  // even when the existing answer agrees, there is nothing to fill
  assert.strictEqual(MAP.prefillCountryName(TWO, 'Jordan', 'Asia/Amman'), null);
});
t('nothing to guess from means nothing is filled', () => {
  assert.strictEqual(MAP.prefillCountryName(TWO, '', null), null);
  assert.strictEqual(MAP.prefillCountryName(TWO, '', 'Asia/Riyadh'), null);
});
t('a question that is not asking where you ARE can opt out', () => {
  // Franchise asks "which country are you interested in Franchising IN?" — intent, not
  // location. Pre-filling that from the applicant's own clock is a wrong answer given
  // confidently, and it shipped that way once. `options.prefill: false` is the opt-out, set
  // per question in the table so it works for the next such question without a code change.
  const OPTED_OUT = { type: 'country', options: { only: ['jo', 'lebanon'], prefill: false } };
  assert.strictEqual(MAP.prefillCountryName(OPTED_OUT, '', 'Asia/Amman'), null);
  // and the flag is opt-OUT only: absent, true, or anything else still pre-fills
  assert.strictEqual(MAP.prefillCountryName({ type: 'country', options: { prefill: true } }, '', 'Asia/Amman'), 'Jordan');
  assert.strictEqual(MAP.prefillCountryName({ type: 'country', options: {} }, '', 'Asia/Amman'), 'Jordan');
  assert.strictEqual(MAP.prefillCountryName({ type: 'country' }, '', 'Asia/Amman'), 'Jordan');
});

// ---- the pre-fill must not become a silent default ----
t('a pre-filled answer is marked as a guess in the page', () => {
  // The hazard this feature introduces: an empty required question forces a decision, a
  // pre-filled one gets accepted by default. So the page has to say the value was guessed
  // and can be changed, or a wrong guess becomes a silently mislabelled record.
  assert.ok(/change it if/i.test(SRC) || /if that is not right/i.test(SRC),
    'the pre-filled country should carry a visible "change it if wrong" note');
});
t('the note goes away once the answer stops being the guess', () => {
  assert.ok(/syncPrefillNote/.test(SRC),
    'a note still reading "filled in from your location" after a correction is a lie');
  assert.ok(/function answerChanged\(\)[^\n]*syncPrefillNote/.test(SRC),
    'the note should be re-checked on the same beat as the branch scope');
});
t('pre-filling runs AFTER the draft is restored', () => {
  const init = (SRC.match(/function init\(table, fields\)[\s\S]*?\n  \}/) || [''])[0];
  const draftAt = init.indexOf('restoreAnswers(');
  const fillAt = init.indexOf('prefillCountry(');
  assert.ok(draftAt !== -1, 'could not find the draft restore in init');
  assert.ok(fillAt !== -1, 'could not find the pre-fill in init');
  assert.ok(draftAt < fillAt, 'the pre-fill must come after the draft, or it overwrites it');
});
t('pre-filling re-scopes the branch box', () => {
  // The reason this feature is small: a pre-filled country IS an answer, so the existing
  // applyBranchScope path narrows the shops with no new plumbing. If answerChanged does not
  // run, the country reads as chosen while the branch box still lists both countries.
  //
  // Checked by following the actual variable rather than by looking for the two names near
  // each other — measured: "prefillCountry() … answerChanged()" within 400 characters stays
  // true when the pre-fill is dropped OUT of the condition, so that version of this test
  // passed while the bug was present.
  const init = (SRC.match(/function init\(table, fields\)[\s\S]*?\n  \}/) || [''])[0];
  const v = (init.match(/var\s+(\w+)\s*=\s*prefillCountry\(\)/) || [])[1];
  assert.ok(v, 'the pre-fill result should be held in a variable so it can be acted on');
  const guard = new RegExp('if\\s*\\([^)]*\\b' + v + '\\b[^)]*\\)\\s*answerChanged\\(\\)');
  assert.ok(guard.test(init),
    'answerChanged() must run when the pre-fill filled something in; ' + v + ' is not in its condition');
});
t('nothing on the submit path depends on the zone', () => {
  // The measurement must be invisible. If a submit ever reads deviceZone, a browser that
  // answers nothing has a different submit path from one that answers, and the form that
  // matters most is the one that breaks quietly.
  const submit = (SRC.match(/function submitForm[\s\S]*?\n  \}/) || [''])[0];
  assert.ok(submit.length > 0, 'expected to find the submit path to check it');
  assert.ok(!/deviceZone|tzHeaders|x-blk-tz/.test(submit),
    'the submit path should not know the zone exists');
});

(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; }
  }
  console.log(n + '/' + tests.length + ' device-timezone tests passed');
})();
