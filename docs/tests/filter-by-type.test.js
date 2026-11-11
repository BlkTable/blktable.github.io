// The filter panel offers a value control that fits the question: a branch or country question
// gets a list, a rating gets its own range, a yes/no gets Yes/No. Runs the real functions from index.html.
const fs = require('fs'), assert = require('assert');
const APP = fs.readFileSync('index.html', 'utf8').replace(/\r\n/g, '\n');
function grab(name) {
  const start = APP.indexOf('  function ' + name + '(');
  assert(start !== -1, name + ' not found');
  return APP.slice(start, APP.indexOf('\n  }\n', start) + 4);
}
const src = ['filterType', 'opsFor', 'valueKind', 'fvDropdownValues', 'branchListKeys', 'valControlHtml']
  .map(n => n === 'filterType' ? APP.slice(APP.indexOf('  function filterType('), APP.indexOf('\n', APP.indexOf('  function filterType('))) : grab(n)).join('\n');
const allBranches = [{ name: 'Abdoun', list_key: 'jo' }, { name: 'Mar Mikhael', list_key: 'lebanon' }, { name: 'Sweifieh', list_key: 'jo' }];
const allStaff = ['Ali Najjar', 'Sara Haddad'];
const esc = s => String(s), dateFieldHtml = () => '';
const fns = eval(src + '\n;({ opsFor, valueKind, fvDropdownValues, valControlHtml })');
const fv = { records: () => [{ data: { b: 'Abdoun' } }], getVal: (r, id) => r.data[id] };
let n = 0;
function t(name, fn) { fn(); n++; console.log('ok - ' + name); }

t('a branch question filters as a list of its own countries\' shops', () => {
  const f = { id: 'b', type: 'branch', options: { list: 'jo' } };
  assert.strictEqual(fns.valueKind('branch', 'is'), 'select');
  assert.deepStrictEqual(fns.fvDropdownValues(fv, f), ['Abdoun', 'Sweifieh']);
  assert(/<select/.test(fns.valControlHtml(fv, { op: 'is', val: '' }, f)));
});
t('a country question filters as a list, not free text', () => {
  assert.strictEqual(fns.opsFor('country')[0][0], 'is');
  assert.strictEqual(fns.valueKind('country', 'is'), 'select');
});
t('a rating filters with number operators and offers its own range', () => {
  assert(fns.opsFor('rating').some(o => o[0] === 'lte'));
  const html = fns.valControlHtml(fv, { op: 'lte', val: '3' }, { id: 'r', type: 'rating', options: { min: 0, max: 10 } });
  assert(/<select/.test(html) && /value="0"/.test(html) && /value="10"/.test(html) && /value="3" selected/.test(html));
});
t('a yes/no question still gets Yes / No', () => {
  assert(/Yes.*No/.test(fns.valControlHtml(fv, { op: 'is', val: '' }, { id: 'y', type: 'yesno' })));
});
t('a Name (internal) question filters as a list of staff, keeping names already answered', () => {
  const f = { id: 'b', type: 'staff' };
  assert.strictEqual(fns.valueKind('staff', 'is'), 'select');
  // 'Abdoun' stands in for a name stored before its owner left: still filterable
  assert.deepStrictEqual(fns.fvDropdownValues(fv, f), ['Ali Najjar', 'Sara Haddad', 'Abdoun']);
});
t('builder, editor and public form all know the staff type', () => {
  const PUB = fs.readFileSync('f/index.html', 'utf8');
  assert(APP.includes('{ v: "staff", label: "Name (internal)" }'));
  assert(/f\.type === "staff"[\s\S]{0,200}stOpts\.push\(v\)/.test(APP));
  assert(/f\.type === "staff"[\s\S]{0,300}buildCombo\(f, STAFF\.map/.test(PUB));
  assert(PUB.includes('from("staff_names")') && APP.includes('from("staff_names")'));
});
console.log(n + ' passed');
