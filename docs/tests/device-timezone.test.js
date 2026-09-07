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
function load(file, names, extra) {
  const js = scripts(file);
  const ctx = Object.assign({ console }, extra || {});
  vm.createContext(ctx);
  new vm.Script('(function(){' + names.map(n => grab(js, n, file)).join('\n') +
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

// ---- record, do not interpret ----
t('the page maps no zone to a country', () => {
  // A real constraint, not a vacuous absence check: the moment someone adds the obvious
  // Asia/Amman -> jo table, the page is interpreting rather than recording, and the
  // measurement is being compared against itself.
  assert.ok(!/Asia\/[A-Za-z_]+/.test(SRC),
    'f/index.html should not name a specific timezone — it records whatever the device says');
  assert.ok(!/getTimezoneOffset/.test(SRC),
    'the offset cannot tell Amman from Beirut for nine months of the year; read the name');
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
