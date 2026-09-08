// The rules under the phone box, loaded from BOTH pages and asserted against each. The
// public form collects the number and the record panel edits it, and each page carries its
// own copy of the block, so a rule right on one and wrong on the other is a number that
// changes when somebody opens the record. That is not hypothetical: parsePhone used to fall
// back to Jordan for anything it could not read, so opening a UAE number and saving it wrote
// a Jordanian one.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
// phoneTable() builds its arrays inside the vm context, so they carry that realm's
// Array.prototype and deepStrictEqual fails on prototype identity with "same structure but
// not reference-equal". Same helper, same reason, as form-country.test.js.
const asW = o => JSON.parse(JSON.stringify(o));
function scripts(file) {
  const src = fs.readFileSync(file, 'utf8');
  return [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
}
function grab(js, name, file) {
  const at = js.search(new RegExp('\\bfunction\\s+' + name + '\\s*\\('));
  if (at === -1) throw new Error('no fn ' + name + ' in ' + file);
  const open = js.indexOf('{', at);
  let d = 0;
  for (let i = open; i < js.length; i++) {
    if (js[i] === '{') d++;
    else if (js[i] === '}') { d--; if (!d) return js.slice(at, i + 1); }
  }
  throw new Error('unbalanced ' + name);
}
function grabVar(js, name, file) {
  const m = js.match(new RegExp('\\n  var ' + name + ' = [^\\n]*;'));
  if (!m) throw new Error('could not find var ' + name + ' in ' + file);
  return m[0];
}
const FNS = ['phoneTable', 'phoneRow', 'phoneByDial', 'phoneMenuRows', 'phoneMatch',
             'splitPhone', 'phoneValid', 'phoneValidOnDial', 'tzIsoOf', 'phoneRowForZone'];
const VARS = ['PHONE_ROWS', 'TZ_ISO', 'PHONE_PINNED'];
function load(file) {
  const js = scripts(file);
  const body = VARS.map(v => grabVar(js, v, file)).join('\n') + '\n' +
               '  var PHONE_LIST = null, PHONE_BY_ISO = null, PHONE_BY_DIAL = null, TZ_MAP = null;\n' +
               FNS.map(n => grab(js, n, file)).join('\n');
  const ctx = { console };
  vm.createContext(ctx);
  new vm.Script('(function(){' + body + '\nthis.API={' + FNS.join(',') + '};}).call(this)').runInContext(ctx);
  return ctx.API;
}
const A = load('index.html'), B = load('f/index.html');
let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };
// Every rule is asserted on both pages, so `each` is how the file is written.
const each = fn => { fn(A, 'index.html'); fn(B, 'f/index.html'); };

// ---- splitting a stored answer -------------------------------------------------------
t('a stored number splits into its country and its local part', () => {
  each((API, where) => {
    const jo = API.splitPhone('+962791234567');
    assert.strictEqual(jo.iso, 'JO', where);
    assert.strictEqual(jo.local, '791234567', where);
    const ae = API.splitPhone('+971501234567');
    assert.strictEqual(ae.iso, 'AE', where);
    assert.strictEqual(ae.local, '501234567', where);
  });
});
t('the longest dial code wins, so +1 is not read as +1 something', () => {
  each((API, where) => {
    // 962 begins with 9; several codes begin with 96. A short code matching first would read
    // a Jordanian number as Yemeni and hand back a local part with a digit missing.
    assert.strictEqual(API.splitPhone('+96791234567').iso, 'YE', where);
    assert.strictEqual(API.splitPhone('+962791234567').iso, 'JO', where);
  });
});
t('a shared dial code resolves to its primary country', () => {
  each((API, where) => {
    assert.strictEqual(API.splitPhone('+14165551234').iso, 'US', where);
    assert.strictEqual(API.splitPhone('+447911123456').iso, 'GB', where);
    // A value can be splittable without being valid. "+170123" is 26 rows in the live
    // database and it is NOT junk to the parser: +1 is a real dial code, so it resolves to
    // the United States with 70123 as the local part. phoneValid then refuses it, because
    // NANP numbers are 10 digits. Splitting and validating are separate jobs.
    var one = API.splitPhone('+170123');
    assert.strictEqual(one.iso, 'US', where);
    assert.strictEqual(one.local, '70123', where);
    assert.strictEqual(API.phoneValid(one.row, one.local), false, where);
  });
});
t('an unsplittable value returns null rather than guessing at Jordan', () => {
  // This IS the corruption fix. Returning a Jordanian row for these is what wrote
  // +962971501234567 over a UAE number on save.
  each((API, where) => {
    assert.strictEqual(API.splitPhone('0791234567'), null, where);      // 33,795 legacy rows
    assert.strictEqual(API.splitPhone('791234567'), null, where);
    assert.strictEqual(API.splitPhone('+0091234'), null, where);        // no dial code begins with 0, 11 rows
    assert.strictEqual(API.splitPhone(''), null, where);
    assert.strictEqual(API.splitPhone(null), null, where);
    assert.strictEqual(API.splitPhone(undefined), null, where);
  });
});
t('a number round trips for every one of the 245 countries', () => {
  each((API, where) => {
    API.phoneTable().forEach(r => {
      const back = API.splitPhone('+' + r.cc + r.ph);
      assert.ok(back, r.iso + ' does not split at all on ' + where);
      // A shared dial code legitimately resolves to its primary country, so compare the
      // number rather than the flag: the digits must survive, the flag is a guess.
      assert.strictEqual('+' + back.row.cc + back.local, '+' + r.cc + r.ph, r.iso + ' on ' + where);
    });
  });
});

// ---- per country validation ----------------------------------------------------------
t('every country accepts its own example number', () => {
  each((API, where) => {
    API.phoneTable().forEach(r => {
      assert.ok(API.phoneValid(r, r.ph), r.iso + ' rejects its own example on ' + where);
    });
  });
});
t('Jordan takes 8 or 9 digits now, and refuses nonsense of the right length', () => {
  each((API, where) => {
    const jo = API.phoneRow('JO');
    assert.ok(API.phoneValid(jo, '791234567'), 'a real mobile, ' + where);
    assert.ok(API.phoneValid(jo, '65001234'), 'an Amman landline, 8 digits, ' + where);
    assert.ok(!API.phoneValid(jo, '79123456'), 'one digit short must fail, ' + where);
    // Length alone would accept this. It is the pattern that refuses it, which is the whole
    // reason the pattern is in the table.
    assert.ok(!API.phoneValid(jo, '999999999'), '999999999 must fail, ' + where);
  });
});
t('a country with a wide length set is still validated', () => {
  each((API, where) => {
    // The UAE accepts 5 to 12 digits and Germany 4 to 15, so for 29 countries a length rule
    // is barely a rule.
    assert.ok(API.phoneValid(API.phoneRow('AE'), '501234567'), where);
    assert.ok(!API.phoneValid(API.phoneRow('AE'), '111111111'), where);
  });
});
t('an empty or absent number is not valid on its own', () => {
  each((API, where) => {
    assert.strictEqual(API.phoneValid(API.phoneRow('JO'), ''), false, where);
    assert.strictEqual(API.phoneValid(null, '791234567'), false, where);
  });
});
t('a shared dial code accepts a number valid for any country on it', () => {
  each((API, where) => {
    // Somebody who picked the United States and typed a Canadian number has not made a
    // mistake worth refusing a submission over.
    assert.ok(API.phoneValidOnDial(API.phoneRow('US'), '4165551234'), where);
    assert.ok(!API.phoneValidOnDial(API.phoneRow('US'), '1234'), where);
  });
});

// ---- the zone map --------------------------------------------------------------------
t('a zone resolves to the country it is named for', () => {
  each((API, where) => {
    assert.strictEqual(API.tzIsoOf('Asia/Amman'), 'JO', where);
    assert.strictEqual(API.tzIsoOf('Asia/Dubai'), 'AE', where);
    assert.strictEqual(API.tzIsoOf('Africa/Abidjan'), 'CI', where);
    assert.strictEqual(API.tzIsoOf('Asia/Calcutta'), 'IN', where);
  });
});
t('an unknown zone, and a browser that will not say, both fall back to Jordan', () => {
  each((API, where) => {
    // A hardened browser reports UTC and a research station reports Antarctica/Troll. Both
    // are non-answers, and today's behaviour for everybody is Jordan, so that is what a
    // non-answer must produce: no change, no note, nothing to correct.
    assert.strictEqual(API.tzIsoOf('UTC'), null, where);
    assert.strictEqual(API.phoneRowForZone('UTC').iso, 'JO', where);
    assert.strictEqual(API.phoneRowForZone('Not/AZone').iso, 'JO', where);
    assert.strictEqual(API.phoneRowForZone(null).iso, 'JO', where);
    assert.strictEqual(API.phoneRowForZone('').iso, 'JO', where);
  });
});
t('a zone whose country has no dial code falls back too', () => {
  each((API, where) => {
    // AQ, GS, TF, UM and PN are in the zone map and not in libphonenumber.
    assert.strictEqual(API.phoneRowForZone('Antarctica/McMurdo').iso, 'JO', where);
  });
});
t('a real foreign zone lands on the right dial code', () => {
  each((API, where) => {
    assert.strictEqual(API.phoneRowForZone('Europe/Berlin').cc, '49', where);
    assert.strictEqual(API.phoneRowForZone('Asia/Dubai').cc, '971', where);
    assert.strictEqual(API.phoneRowForZone('Asia/Beirut').cc, '961', where);
  });
});

// ---- the menu ------------------------------------------------------------------------
t('the four house countries are pinned first, the rest sorted by name', () => {
  each((API, where) => {
    const m = API.phoneMenuRows();
    assert.deepStrictEqual(asW(m.pinned.map(r => r.iso)), ['JO', 'LB', 'IQ', 'SY'], where);
    assert.strictEqual(m.pinned.length + m.rest.length, 245, where);
    assert.ok(m.rest.every(r => ['JO', 'LB', 'IQ', 'SY'].indexOf(r.iso) === -1), 'a pinned country is also in the rest, ' + where);
    const names = m.rest.map(r => r.name);
    assert.deepStrictEqual(names, names.slice().sort(), 'the rest is not sorted by name, ' + where);
  });
});
t('search finds a country by name, code or dial, with or without a plus', () => {
  each((API, where) => {
    const de = API.phoneRow('DE');
    assert.ok(API.phoneMatch(de, 'ger'), 'by name, ' + where);
    assert.ok(API.phoneMatch(de, 'germany'), where);
    assert.ok(API.phoneMatch(de, 'de'), 'by iso, ' + where);
    assert.ok(API.phoneMatch(de, '49'), 'by dial, ' + where);
    assert.ok(API.phoneMatch(de, '+49'), 'by dial with a plus, ' + where);
    assert.ok(API.phoneMatch(de, ''), 'an empty query matches everything, ' + where);
    assert.ok(!API.phoneMatch(de, 'jordan'), where);
    assert.ok(!API.phoneMatch(de, '962'), where);
  });
});

// ---- one block, two pages ------------------------------------------------------------
t('the shared block is character for character identical in both pages', () => {
  // The stronger claim, and the one that catches a rule nobody thought to test being right
  // on one page and wrong on the other.
  const a = scripts('index.html'), b = scripts('f/index.html');
  const cut = js => {
    const from = js.indexOf('// ---- BEGIN GENERATED phone data');
    const to = js.indexOf('// ---- END SHARED phone helpers');
    assert.ok(from !== -1 && to !== -1 && to > from, 'the block markers are missing');
    return js.slice(from, to);
  };
  assert.strictEqual(cut(a), cut(b), 'the phone block differs between index.html and f/index.html');
});

// ---- no shadow copy left behind --------------------------------------------------------
t('each page declares splitPhone exactly once', () => {
  // Two declarations of one name in a script raise no error: the LAST one silently wins,
  // and a test harness that grabs the FIRST match would keep passing while an old, unused
  // copy shadows the shared one at runtime. This is what stops that coming back.
  [['index.html', scripts('index.html')], ['f/index.html', scripts('f/index.html')]].forEach(([file, js]) => {
    const count = (js.match(/\bfunction\s+splitPhone\s*\(/g) || []).length;
    assert.strictEqual(count, 1, file + ' declares splitPhone ' + count + ' times');
  });
});

console.log(n + ' passed');
