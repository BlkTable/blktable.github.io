// A question that hands the person on, and what it does to the Submit button.
//
// Contact Us asks one question — Topic — and three of its six answers are not dealt with on
// that form at all: a job application, a complaint and a franchise enquiry each reveal a link
// to the form that handles it. The link appeared and the Submit button stayed, so the person
// could press Submit instead of following the link, and 39 people did exactly that between
// 2026-08-18 and 2026-09-06: a name, an email and "Job Application" filed against no
// application, while the applicant believed they had applied.
//
// So the rule this file pins: while a hand-off link is on screen the form has nothing of its
// own left to collect, and the link is the only way on.
//
// `handoffCtl` lives only in `f/index.html`. Unlike `condMet` or the date rules it has no twin
// in `index.html` on purpose — the review panel has no Submit button to take away, and a
// staff member editing the stored row is not being handed anywhere.
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
function load(file, names) {
  const js = scripts(file);
  const ctx = { console };
  vm.createContext(ctx);
  new vm.Script('(function(){' + names.map(n => grab(js, n, file)).join('\n') +
    '\n this.API={' + names.join(',') + '};}).call(this)').runInContext(ctx);
  return ctx.API;
}

const FORM_SRC = fs.readFileSync('f/index.html', 'utf8');
const { handoffCtl, condMet } = load('f/index.html', ['handoffCtl', 'condMet']);

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };

// A control as the page builds it: the field, and whatever the widget hung off it.
const ctl = f => ({ f: f, wrap: {}, el: {} });
const GATE = 'f-topic';
const linkField = (extra) => Object.assign({
  id: 'f-link', type: 'link', options: { url: 'https://blktable.blk.jo/apply/' },
  show_if: { field: GATE, equals: ['Job Application'] }
}, extra || {});

// ---- the case that was reported ----
t('a revealed link with a URL is a hand-off', () => {
  const c = ctl(linkField());
  assert.strictEqual(handoffCtl([c], { 'f-link': true }), c);
});
t('the same link hidden by its own condition is not', () =>
  assert.strictEqual(handoffCtl([ctl(linkField())], { 'f-link': false }), null));
t('with no visibility worked out yet it counts as on screen', () => {
  // applyConditions has not run on the first paint; a form must not flash a Submit button
  // that is about to be taken away.
  const c = ctl(linkField());
  assert.strictEqual(handoffCtl([c], null), c);
});

// ---- what must NOT lose its Submit button ----
// 196 link fields exist that the Airtable import left behind: they were record links, they
// carry no URL, and they are on live forms. Every one of them must still submit.
t('an imported record link carries no URL and is not a hand-off', () =>
  // given a condition as well, so this tests the URL check and not the condition check
  assert.strictEqual(handoffCtl([ctl(linkField({ options: null }))], null), null));
t('nor one with no options object at all', () =>
  assert.strictEqual(handoffCtl([ctl({ id: 'f-link', type: 'link' })], null), null));
t('an empty URL is not a hand-off', () =>
  assert.strictEqual(handoffCtl([ctl(linkField({ options: { url: '' } }))], null), null));
t('a link shown to everybody is a footnote, not a hand-off', () =>
  // "read the policy", "see the menu" — the form still has its own questions to collect
  assert.strictEqual(handoffCtl([ctl(linkField({ show_if: null }))], null), null));
t('a condition naming no field is not a hand-off either', () =>
  assert.strictEqual(handoffCtl([ctl(linkField({ show_if: { equals: ['Yes'] } }))], null), null));
t('keep_submit overrides the rule', () =>
  // the escape hatch for a form that reveals a link AND still wants an answer
  assert.strictEqual(handoffCtl([ctl(linkField({ options: { url: 'https://x.jo/', keep_submit: true } }))], null), null));
t('an ordinary question is never a hand-off', () =>
  assert.strictEqual(handoffCtl([ctl({ id: 'f-msg', type: 'long_text', show_if: { field: GATE, equals: ['Other'] } })], null), null));

// ---- nothing here may throw on a form that has none of this ----
t('no controls at all', () => assert.strictEqual(handoffCtl([], {}), null));
t('an undefined control list', () => assert.strictEqual(handoffCtl(undefined, undefined), null));
t('a control with no field', () => assert.strictEqual(handoffCtl([{ wrap: {} }], null), null));

// ---- found among the others, wherever it sits ----
t('found after the questions that precede it', () => {
  const before = [ctl({ id: 'f-name', type: 'short_text' }), ctl({ id: 'f-topic', type: 'dropdown' })];
  const c = ctl(linkField());
  assert.strictEqual(handoffCtl(before.concat([c]), null), c);
});
t('one hidden link does not mask a visible one', () => {
  const hidden = ctl(linkField({ id: 'f-l1' }));
  const shown = ctl(linkField({ id: 'f-l2' }));
  assert.strictEqual(handoffCtl([hidden, shown], { 'f-l1': false, 'f-l2': true }), shown);
});

// ---- Contact Us as it is actually built, answer by answer ----
// The real field ids and the real dropdown text, read out of the live table on 2026-09-07.
// Three of the six topics hand off; the other three are answered on the form and must keep
// their Submit button. This is the test that says the feature works, rather than that the
// function returns something.
const TOPIC = '1ca4ef3e-a730-51c8-8de0-747c3f63025a';
const CONTACT = [
  { id: 'f-country', type: 'country', required: true },
  { id: 'f-name', type: 'short_text', required: true },
  { id: 'f-email', type: 'email', required: true },
  { id: 'f-phone', type: 'phone', required: true },
  { id: TOPIC, type: 'dropdown', required: true },
  { id: 'f-link-franchise', type: 'link', options: { url: 'https://blktable.blk.jo/f/?t=franchise-apply' },
    show_if: { field: TOPIC, equals: ['Franchise Opportunity - فرصة شراكة'] } },
  { id: 'f-link-complaint', type: 'link', options: { url: 'https://blktable.blk.jo/f/?t=customer-complaints' },
    show_if: { field: TOPIC, equals: ['Complaint/Note - شكوى او ملاحظة'] } },
  { id: 'f-message', type: 'long_text', required: true,
    show_if: { field: TOPIC, equals: ['Events Opportunity - مشاركة في ايفنت', 'Other Topic - موضوع آخر'] } },
  { id: 'f-where', type: 'short_text', required: true,
    show_if: { field: TOPIC, equals: ['Rental Location - موقع للإيجار/التملك'] } },
  { id: 'f-sqm', type: 'short_text', required: true,
    show_if: { field: TOPIC, equals: ['Rental Location - موقع للإيجار/التملك'] } },
  { id: 'f-about', type: 'long_text', required: true,
    show_if: { field: TOPIC, equals: ['Rental Location - موقع للإيجار/التملك'] } },
  { id: 'f-link-job', type: 'link', options: { url: 'https://blktable.blk.jo/apply/' },
    show_if: { field: TOPIC, equals: ['Job Application - طلب توظيف'] } }
];
// what the page decides, using the visibility rule the page itself uses
function contactState(topic) {
  const ctls = CONTACT.map(ctl);
  const data = {};
  CONTACT.forEach(f => { data[f.id] = f.id === TOPIC ? topic : null; });
  const vis = {};
  CONTACT.forEach(f => { vis[f.id] = condMet(f, data); });
  const h = handoffCtl(ctls, vis);
  return { handoff: h ? h.f.id : null, asked: CONTACT.filter(f => vis[f.id]).map(f => f.id) };
}

t('Job Application hands off to the application form', () => {
  const s = contactState('Job Application - طلب توظيف');
  assert.strictEqual(s.handoff, 'f-link-job');
  // and nothing else was revealed to collect, which is why Submit had nothing to do
  assert.deepStrictEqual(s.asked.filter(id => id.indexOf('f-link') !== 0 && id !== TOPIC),
    ['f-country', 'f-name', 'f-email', 'f-phone']);
});
t('a complaint hands off to the complaint form', () =>
  assert.strictEqual(contactState('Complaint/Note - شكوى او ملاحظة').handoff, 'f-link-complaint'));
t('a franchise enquiry hands off to the franchise form', () =>
  assert.strictEqual(contactState('Franchise Opportunity - فرصة شراكة').handoff, 'f-link-franchise'));
t('an events opportunity is answered here and keeps Submit', () => {
  const s = contactState('Events Opportunity - مشاركة في ايفنت');
  assert.strictEqual(s.handoff, null);
  assert.ok(s.asked.indexOf('f-message') !== -1, 'the Message question is asked');
});
t('other topic is answered here and keeps Submit', () =>
  assert.strictEqual(contactState('Other Topic - موضوع آخر').handoff, null));
t('a rental location is answered here and keeps Submit', () => {
  const s = contactState('Rental Location - موقع للإيجار/التملك');
  assert.strictEqual(s.handoff, null);
  assert.ok(s.asked.indexOf('f-sqm') !== -1, 'the size question is asked');
});
t('no topic chosen yet keeps Submit', () =>
  assert.strictEqual(contactState('').handoff, null));
t('a topic nobody configured keeps Submit', () =>
  assert.strictEqual(contactState('Something else entirely').handoff, null));

// ---- the shape of the page, not just the rule ----
// A rule that returns the right answer while nothing calls it is the failure mode this whole
// repo keeps hitting, so these read the source.
t('the Submit button is toggled where conditions are applied', () => {
  const m = FORM_SRC.match(/\n  function applyConditions\s*\([\s\S]*?\n  \}/);
  assert.ok(m, 'applyConditions exists');
  assert.ok(/handoffCtl\s*\(/.test(m[0]), 'applyConditions asks whether the form hands off');
  assert.ok(/submit-btn/.test(m[0]), 'applyConditions reaches the Submit button');
});
t('submitForm refuses while the form hands off', () => {
  const m = FORM_SRC.match(/\n  function submitForm\s*\([\s\S]*?\n  \}/);
  assert.ok(m, 'submitForm exists');
  assert.ok(/handoffCtl\s*\(/.test(m[0]), 'submitForm checks for a hand-off before it files anything');
  // and it must check AFTER applyConditions has settled which questions are being asked
  assert.ok(m[0].indexOf('applyConditions()') < m[0].indexOf('handoffCtl('),
    'the check comes after applyConditions, so it reads settled visibility');
  // nothing may be uploaded or written on the way out
  assert.ok(m[0].indexOf('handoffCtl(') < m[0].indexOf('uploadAll('),
    'the refusal happens before any upload starts');
});
t('the link is the only thing a hand-off leaves behind', () => {
  // the rule is expressed once. A second hand-written copy is how one page keeps its button.
  const hits = FORM_SRC.match(/function handoffCtl/g) || [];
  assert.strictEqual(hits.length, 1, 'handoffCtl is declared exactly once');
});

console.log(n + ' tests passed');
