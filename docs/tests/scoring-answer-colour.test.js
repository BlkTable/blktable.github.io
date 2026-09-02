// The colour on the answer itself. A scored question is supposed to wear its result in
// place -- green earned it, yellow earned part of it, red earned none of it, dark red took
// a point off, grey was never asked -- in the review panel, in the record editor and in the
// New record panel.
//
// This existed already, but only for the *imported* scorecards, whose points arrive in a
// scorer column (`options.score`). A builder-made scorecard prices the question itself
// (`app_fields.scoring`) and had no scorer column to look up, so the lookup came back empty
// and every answer rendered plain. Shop Audit moved to the rules engine on 2026-09-01 and
// its 68 questions lost their colour that day -- while the breakdown panel underneath kept
// its own, because that one path had been taught both engines and this one had not.
//
// So the claim under test is: one vocabulary, both engines. The same answer is the same
// colour whether a column priced it or a rule did, and neither the review panel nor the
// editors are told which engine is behind the record.
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

// scoreMetaOf is the dispatcher; everything else is either what it calls or what its two
// engines call. They come along so the file fails on a real assertion rather than on a
// ReferenceError from halfway down a call chain.
const API = load('index.html',
  ['scoreMetaOf', 'scoreRuleMeta', 'scoreRowMeta', 'scoreMetaPack', 'scoreClassOf', 'scoreChipLabel',
   'scoreChipTitle', 'scorerMaxPoints', 'scoreRulePoints', 'choicePoints',
   'questionMaxPoints', 'naChoices', 'questionApplies', 'questionEarned', 'condMet', 'esc']);
const { scoreMetaOf, scoreRuleMeta, scoreRowMeta } = API;

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };

// ---- the questions, priced by rules (a builder-made scorecard) ----

// Yes earns all four, anything else earns none: the shape most of Shop Audit is.
const Q_YESNO = { id: 'q1', type: 'yesno', scoring: { rule: 'equals', earn: ['Yes'], points: 4 } };
// A priced choice list, which is the only shape that can earn *part* of what it is worth.
const Q_RATE = {
  id: 'q2', type: 'dropdown', scoring: { rule: 'choices' },
  options: [{ en: 'Excellent', points: 3 }, { en: 'Acceptable', points: 1 }, { en: 'Poor', points: 0 }]
};
// A choice marked N/A takes the question out of the record altogether.
const Q_NA = {
  id: 'q3', type: 'dropdown', scoring: { rule: 'choices' },
  options: [{ en: 'Clean', points: 2 }, { en: 'Dirty', points: 0 }, { en: 'No kitchen here', na: true }]
};
// Only asked of a branch that has a kitchen.
const Q_GATED = {
  id: 'q4', type: 'yesno', show_if: { field: 'q9', equals: 'Yes' },
  scoring: { rule: 'equals', earn: ['Yes'], points: 2 }
};
// A penalty: getting it wrong costs a point rather than merely withholding one.
const Q_PENALTY = {
  id: 'q5', type: 'dropdown', scoring: { rule: 'choices' },
  options: [{ en: 'Fine', points: 1 }, { en: 'Expired stock on shelf', points: -2 }]
};
const Q_PLAIN = { id: 'q6', type: 'short_text' };   // not scored at all

// ---- the traffic light, on a finished record ----

t('a right answer is green', () => {
  assert.strictEqual(scoreRuleMeta(Q_YESNO, { q1: 'Yes' }).cls, 'plus');
});
t('a wrong answer is red', () => {
  assert.strictEqual(scoreRuleMeta(Q_YESNO, { q1: 'No' }).cls, 'zero');
});
t('an answer worth some but not all of the points is yellow', () => {
  const m = scoreRuleMeta(Q_RATE, { q2: 'Acceptable' });
  assert.strictEqual(m.cls, 'part');
  assert.strictEqual(m.pts, 1);
  assert.strictEqual(m.maxP, 3);
});
t('the dearest choice is green, not merely yellow at the top of its range', () => {
  assert.strictEqual(scoreRuleMeta(Q_RATE, { q2: 'Excellent' }).cls, 'plus');
});
t('a priced choice worth zero is red rather than yellow', () => {
  assert.strictEqual(scoreRuleMeta(Q_RATE, { q2: 'Poor' }).cls, 'zero');
});
t('an answer that takes a point off gets its own red, not an ordinary zero', () => {
  const m = scoreRuleMeta(Q_PENALTY, { q5: 'Expired stock on shelf' });
  assert.strictEqual(m.cls, 'neg');
  assert.strictEqual(m.pts, -2);
});

// The rule that matters most, and the one a colour can get wrong in a way that accuses
// somebody: a question this record never asked is outside the traffic light entirely.
t('a question answered "not applicable here" is grey, never red', () => {
  assert.strictEqual(scoreRuleMeta(Q_NA, { q3: 'No kitchen here' }).cls, 'na');
});
t('a question hidden by "ask only if" is grey, never red', () => {
  assert.strictEqual(scoreRuleMeta(Q_GATED, { q9: 'No' }).cls, 'na');
});
t('the same question is scored normally once its condition is met', () => {
  assert.strictEqual(scoreRuleMeta(Q_GATED, { q9: 'Yes', q4: 'Yes' }).cls, 'plus');
});

// Asked and skipped is a different thing from never asked, and the breakdown panel already
// counts it against the record. The colour has to say the same or the two disagree on one
// screen -- which is the drift this whole file exists to prevent.
t('a scored question left blank on a finished record is red, not grey', () => {
  const m = scoreRuleMeta(Q_YESNO, {});
  assert.strictEqual(m.cls, 'zero');
  assert.strictEqual(m.answered, false);
});

t('an unscored question has no colour at all', () => {
  assert.strictEqual(scoreRuleMeta(Q_PLAIN, { q6: 'anything' }), null);
});

// ---- the editors, where the record is still being filled in ----
// Same arithmetic, but a question nobody has reached yet must not already be accusing them.
// Without this a fresh Shop Audit opens as sixty-eight red rows.

t('an unanswered question carries no colour while the form is being filled in', () => {
  assert.strictEqual(scoreRuleMeta(Q_YESNO, {}).editorCls, 'na');
});
t('and no chip either, so a new record does not open as a wall of marks', () => {
  assert.ok(/display:\s*none/.test(scoreRuleMeta(Q_YESNO, {}).chipEditor),
    'the editor chip should be hidden until the question is answered');
});
t('the colour arrives the moment the answer does', () => {
  assert.strictEqual(scoreRuleMeta(Q_YESNO, { q1: 'Yes' }).editorCls, 'plus');
  assert.ok(!/display:\s*none/.test(scoreRuleMeta(Q_YESNO, { q1: 'Yes' }).chipEditor));
});
t('a wrong answer shows its red in the editor too, not only after the save', () => {
  assert.strictEqual(scoreRuleMeta(Q_YESNO, { q1: 'No' }).editorCls, 'zero');
});
t('reviewing and editing differ only for the unanswered', () => {
  const answered = scoreRuleMeta(Q_RATE, { q2: 'Acceptable' });
  assert.strictEqual(answered.cls, answered.editorCls);
});

// ---- the chip beside the label ----

t('the chip carries the points, signed', () => {
  assert.ok(scoreRuleMeta(Q_YESNO, { q1: 'Yes' }).chip.indexOf('+4') !== -1);
  assert.ok(scoreRuleMeta(Q_YESNO, { q1: 'No' }).chip.indexOf('>0<') !== -1);
  assert.ok(scoreRuleMeta(Q_PENALTY, { q5: 'Expired stock on shelf' }).chip.indexOf('2') !== -1);
});
t('the chip wears the same class as the row, so the two cannot disagree', () => {
  const m = scoreRuleMeta(Q_RATE, { q2: 'Acceptable' });
  assert.ok(m.chip.indexOf('qp ' + m.cls) !== -1, 'chip should carry class ' + m.cls);
});
t('the chip says in words what the colour says in colour', () => {
  assert.ok(/Partly right/.test(scoreRuleMeta(Q_RATE, { q2: 'Acceptable' }).chip));
  assert.ok(/never asked|Not asked/i.test(scoreRuleMeta(Q_NA, { q3: 'No kitchen here' }).chip));
});

// ---- one vocabulary, both engines ----
// An imported scorecard's question, priced by a scorer column rather than by a rule.
const SCORER = { id: 's1', options: { score: { source: 'i1', kind: 'match', expect: 'Yes', points: 3, else: 0 } } };
const Q_IMPORTED = { id: 'i1', type: 'yesno' };

t('a question with a scorer column is still read from the column', () => {
  const m = scoreMetaOf(Q_IMPORTED, SCORER, { i1: 'Yes' });
  assert.strictEqual(m.cls, 'plus');
});
t('a question priced by a rule needs no scorer column', () => {
  assert.strictEqual(scoreMetaOf(Q_YESNO, null, { q1: 'Yes' }).cls, 'plus');
});
t('the dispatcher returns nothing for a question neither engine prices', () => {
  assert.strictEqual(scoreMetaOf(Q_PLAIN, null, { q6: 'x' }), null);
});
t('the two engines agree on the same answer', () => {
  const byColumn = scoreMetaOf(Q_IMPORTED, SCORER, { i1: 'No' });
  const byRule = scoreMetaOf({ id: 'i1', type: 'yesno', scoring: { rule: 'equals', earn: ['Yes'], points: 3 } },
                             null, { i1: 'No' });
  assert.strictEqual(byColumn.cls, byRule.cls);
  assert.strictEqual(byColumn.pts, byRule.pts);
  assert.strictEqual(byColumn.maxP, byRule.maxP);
});
t('both engines hand back the same shape, or the panels have to branch on which one ran', () => {
  const keys = m => Object.keys(m).sort().join(',');
  assert.strictEqual(keys(scoreMetaOf(Q_IMPORTED, SCORER, { i1: 'Yes' })),
                     keys(scoreMetaOf(Q_YESNO, null, { q1: 'Yes' })));
});
// The column wins where a question somehow carries both, because on an imported record the
// column is what the database stored and the colour must not contradict it.
t('a scorer column outranks a rule where a question carries both', () => {
  const both = { id: 'i1', type: 'yesno', scoring: { rule: 'equals', earn: ['No'], points: 9 } };
  assert.strictEqual(scoreMetaOf(both, SCORER, { i1: 'Yes' }).cls, 'plus');
});

// ---- the colours actually exist ----
// A class name that no rule matches is an answer with no colour, and nothing else in the
// suite would notice: the JS would keep returning "part" happily forever.
const STYLE = (fs.readFileSync('index.html', 'utf8').match(/<style[^>]*>([\s\S]*?)<\/style>/g) || []).join('\n');

t('every class the row painter can emit has a rule in the stylesheet', () => {
  ['plus', 'part', 'zero', 'neg', 'na'].forEach(c => {
    assert.ok(STYLE.indexOf('.m-field.sc-' + c) !== -1, 'no .m-field.sc-' + c + ' rule');
    assert.ok(new RegExp('\\.qp\\.' + c + '\\b').test(STYLE), 'no .qp.' + c + ' rule');
  });
});
t('the answer is boxed in, not merely banded down one edge', () => {
  const rule = STYLE.match(/\.m-field\.sc-plus\s*\{[^}]*\}/);
  assert.ok(rule, 'no .m-field.sc-plus rule found');
  assert.ok(/border-color\s*:/.test(rule[0]) || /border\s*:/.test(rule[0]),
    'the scored answer should carry a full border: ' + rule[0]);
  assert.ok(!/border-inline-start-color/.test(rule[0]),
    'still banded down the leading edge only: ' + rule[0]);
});
t('green, yellow and red are three visibly different borders', () => {
  const colourOf = c => {
    const m = STYLE.match(new RegExp('\\.m-field\\.sc-' + c + '\\s*\\{[^}]*\\}'));
    const b = m && m[0].match(/border-color\s*:\s*([^;]+)/);
    return b ? b[1].trim() : null;
  };
  const [g, y, r] = ['plus', 'part', 'zero'].map(colourOf);
  assert.ok(g && y && r, 'each of plus/part/zero needs its own border colour');
  assert.strictEqual(new Set([g, y, r]).size, 3, 'three states sharing a colour: ' + [g, y, r]);
});

// ---- the wiring ----
// The arithmetic above was never what was broken. scoreRowMeta had been right about an
// imported scorecard all along; what was missing was that the four surfaces asked it a
// question only a scorer column could answer, so a rules scorecard got a null back and
// rendered plain. Every one of them has to go through the dispatcher, or this whole file
// passes while Shop Audit stays grey.
const APP = fs.readFileSync('index.html', 'utf8');

t('the review grid asks the dispatcher, not one engine', () => {
  assert.ok(/var sm = scoreMetaOf\(f, qsMap\[f\.id\], d\);/.test(APP),
    'the review grid must pass the question as well as the scorer column');
});
t('the editor row asks the dispatcher too', () => {
  assert.ok(/var sm = scoreMetaOf\(f, opts\.scored, opts\.answers \|\| d\);/.test(APP),
    'edFieldRowHtml must not gate on opts.scored: a rules scorecard has none');
});
t('the live repaint walks the questions, not the scorer map', () => {
  // Walking the map painted nothing on a rules scorecard, because the map is empty there.
  assert.ok(/\(fields \|\| \[\]\)\.forEach\(function \(f\) \{\s*\n\s*var m = scoreMetaOf\(f, \(map \|\| \{\}\)\[f\.id\], answers\);/.test(APP),
    'paintScoreRows must iterate the fields');
  assert.ok(!/Object\.keys\(map \|\| \{\}\)\.forEach/.test(APP),
    'the old scorer-map walk must be gone, or an empty map paints nothing');
});
t('the running total knows a builder-made scorecard has no roll-up rule', () => {
  assert.ok(/table\.config\.scorecard\)[\s\S]{0,160}scorecardTotals\(fields, answers\)/.test(APP),
    'scoreLiveTotal must fall back to scorecardTotals, or the live figure stays blank');
});
t('the row and the chip both use the editor colour in the editors', () => {
  assert.ok(/row\.classList\.add\("sc-" \+ m\.editorCls\)/.test(APP));
  assert.ok(/sm \? "sc-" \+ sm\.editorCls : ""/.test(APP),
    'a half-filled row must not open red before it is answered');
});

if (!process.exitCode) console.log(n + ' passed');
