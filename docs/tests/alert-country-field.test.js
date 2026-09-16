// A table's Country question is deliberately left out of `fields` when the builder loads a
// table — it is not a designed question, see countryQuestionOf: it is rewritten from the
// countries ticked in table settings, not authored like a normal question, and showing it as
// an ordinary row would let someone untick every country and leave the question standing.
//
// But an alert still has to be able to fire on it — "email me when Country becomes Lebanon"
// is the only way to alert on a whole country's branches without hand-listing every shop.
// Before this fix, the Country field's id had no matching <option> in the alert editor's
// field picker (bldAlertFields was built from the very `fields` array the Country question
// had already been filtered out of), so a rule pointing at it hydrated with nothing selected,
// and the next unrelated settings save on that table wrote the rule back with no field and no
// equals — dropped, silently, the same way Customer Complaints lost its Slack channel on
// 2026-09-01 (see alert-round-trip.chrome.js). This guards that the Country question is put
// back for the alert picker specifically, without undoing why it is hidden everywhere else.
const fs = require('fs'), vm = require('vm'), assert = require('assert');

const src = fs.readFileSync('index.html', 'utf8');
const js = [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');

function grab(name) {
  const at = js.indexOf('function ' + name + '(');
  if (at === -1) throw new Error('could not find function ' + name);
  const open = js.indexOf('{', at);
  let d = 0;
  for (let i = open; i < js.length; i++) {
    if (js[i] === '{') d++;
    else if (js[i] === '}') { d--; if (!d) return js.slice(at, i + 1); }
  }
  throw new Error('unbalanced function ' + name);
}

const ctx = {};
vm.createContext(ctx);
new vm.Script(grab('countryQuestionOf') + '\nthis.countryQuestionOf = countryQuestionOf;')
  .runInContext(ctx);
const { countryQuestionOf } = ctx;

let n = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); n++; }
  catch (e) { fail++; console.log('FAIL: ' + name + ' -> ' + e.message); }
};

const COUNTRY = { id: 'f-country', label: 'Country', type: 'country', options: { only: ['jo', 'lebanon'] } };
const BRANCH = { id: 'f-branch', label: 'Branch - الفرع', type: 'branch', options: { list: 'jo, lebanon' } };
const NAME = { id: 'f-name', label: 'Customer Name', type: 'short_text' };

t('countryQuestionOf finds the Country question among ordinary ones', () => {
  assert.strictEqual(countryQuestionOf([NAME, BRANCH, COUNTRY]), COUNTRY);
});
t('a table with no Country question reports none', () => {
  assert.strictEqual(countryQuestionOf([NAME, BRANCH]), null);
});
// A `country`-typed field with no `options.only` is not one of these — a question somebody
// built by hand that happens to use the type, not the auto-managed one.
t('a country-typed field without options.only is not mistaken for it', () => {
  assert.strictEqual(countryQuestionOf([{ id: 'f-x', type: 'country', options: {} }]), null);
});

// ---- the fix itself: the load path must put the Country question back for the alert
// picker after taking it out of the designed-questions list. Asserted as source, the way
// several tests in this file already are, because the loader that assigns bldAlertFields
// lives inside a `db.from(...).then(...)` callback with no standalone name to extract and
// call directly.
t('the Country question is added back into the alert field picker after being filtered out', () => {
  const around = js.slice(js.indexOf('var cq = countryQuestionOf(fields);'), js.indexOf('renderAlertRows(table);'));
  assert.ok(/if \(cq\) fields = fields\.filter/.test(around),
    'the Country question must still be removed from the designed-questions list');
  assert.ok(/bldAlertFields\s*=\s*cq\s*\?\s*\[cq\]\.concat\(fields\)\s*:\s*fields\.slice\(\);/.test(around),
    'the alert field picker (bldAlertFields) must include the Country question when the table has one');
});

console.log('alert-country-field: ' + n + ' tests passed' + (fail ? ', ' + fail + ' FAILED' : ''));
if (fail) process.exitCode = 1;
