// Whether the guess is made, and whether it is allowed to overwrite anything. The DOM half is
// in phone-picker.chrome.js; this is the rule on its own, which is the half that can be got
// wrong in a way no screenshot shows.
//
// The zone is stubbed rather than read, deliberately: on a machine in Amman, hardcoding
// "Asia/Amman" passes every comparison in this file, so the only proof the zone is read at
// all is handing the page a different one.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
function scripts(file) {
  const src = fs.readFileSync(file, 'utf8');
  return [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
}
function grab(js, name) {
  const at = js.search(new RegExp('\\bfunction\\s+' + name + '\\s*\\('));
  if (at === -1) throw new Error('no fn ' + name);
  const open = js.indexOf('{', at);
  let d = 0;
  for (let i = open; i < js.length; i++) {
    if (js[i] === '{') d++;
    else if (js[i] === '}') { d--; if (!d) return js.slice(at, i + 1); }
  }
  throw new Error('unbalanced ' + name);
}
function grabVar(js, name) {
  const m = js.match(new RegExp('\\n  var ' + name + ' = [^\\n]*;'));
  if (!m) throw new Error('could not find var ' + name);
  return m[0];
}
const js = scripts('f/index.html');
const ctx = { console };
vm.createContext(ctx);
new vm.Script('(function(){' +
  [grabVar(js, 'PHONE_ROWS'), grabVar(js, 'TZ_ISO'), grabVar(js, 'PHONE_PINNED')].join('\n') +
  '\n  var PHONE_LIST = null, PHONE_BY_ISO = null, PHONE_BY_DIAL = null, TZ_MAP = null;\n' +
  ['phoneTable', 'phoneRow', 'phoneByDial', 'tzIsoOf', 'phoneRowForZone', 'prefillPhoneRow'].map(n => grab(js, n)).join('\n') +
  '\nthis.API={phoneRowForZone,prefillPhoneRow,phoneRow};}).call(this)').runInContext(ctx);
const API = ctx.API;
let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };
const q = {};                                  // a phone question with no options
const optedOut = { options: { prefill: false } };

t('the device zone decides the country code', () => {
  assert.strictEqual(API.prefillPhoneRow(q, '', 'Europe/Berlin').iso, 'DE');
  assert.strictEqual(API.prefillPhoneRow(q, '', 'Asia/Dubai').iso, 'AE');
  assert.strictEqual(API.prefillPhoneRow(q, '', 'Asia/Beirut').iso, 'LB');
});
t('an answer that already exists always wins', () => {
  // A restored draft is an answer. Putting the guess back over it is the one way this could
  // destroy real work, which is the same rule prefillCountryName states for the country box.
  assert.strictEqual(API.prefillPhoneRow(q, '+962791234567', 'Europe/Berlin'), null);
  assert.strictEqual(API.prefillPhoneRow(q, '+49123', 'Asia/Amman'), null);
});
t('a question can opt out', () => {
  // Opt OUT only: absent, or anything other than an explicit false, still pre-fills.
  assert.strictEqual(API.prefillPhoneRow(optedOut, '', 'Europe/Berlin'), null);
  assert.strictEqual(API.prefillPhoneRow({ options: { prefill: true } }, '', 'Europe/Berlin').iso, 'DE');
  assert.strictEqual(API.prefillPhoneRow({ options: {} }, '', 'Europe/Berlin').iso, 'DE');
});
t('a non-answer changes nothing and is announced to nobody', () => {
  // Jordan is what everybody gets today. Landing there is not a guess worth a note, whether
  // the device said Amman or said nothing at all.
  assert.strictEqual(API.prefillPhoneRow(q, '', 'Asia/Amman'), null);
  assert.strictEqual(API.prefillPhoneRow(q, '', 'UTC'), null);
  assert.strictEqual(API.prefillPhoneRow(q, '', 'Not/AZone'), null);
  assert.strictEqual(API.prefillPhoneRow(q, '', ''), null);
  assert.strictEqual(API.prefillPhoneRow(q, '', null), null);
});
console.log(n + ' passed');
