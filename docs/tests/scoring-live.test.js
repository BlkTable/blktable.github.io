// What an answer is worth, computed in the browser so a chip can go green as soon as the
// choice is made instead of after a round trip to the database.
//
// There are three copies of this rule: compute_scores() in the database (the deployed one,
// whose five shapes are in blktable-migration/selfhost/16_scoring_patterns.sql), and a JS
// mirror in each of index.html and f/index.html, because the two pages share no module
// system. That is a real risk and this file is the thing that makes it survivable: every
// case below runs through BOTH JS copies and must give the same answer, so a change made to
// one page and not the other fails here rather than in front of somebody filling in a form.
//
// The SQL cannot be executed from here, so the figures were taken from it directly instead:
// on 2026-08-26 all 21 shapes below were fed to the deployed compute_scores() against QC's
// real rules -- it is a pure function, so synthetic answers can be scored without writing
// anything -- and every one agreed with the JS. The quirks are therefore confirmed, not
// assumed: a blank number clears "< 5" and EARNS, contains_all is case-INsensitive while
// match is case-SENSITIVE, and an unanswered penalty question still charges its -2.
// If one of these ever changes, the database changed too and both copies have to move.
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
function load(file, names, stubs) {
  const js = scripts(file);
  const ctx = { console };
  vm.createContext(ctx);
  new vm.Script('(function(){' + (stubs || '') + '\n' + names.map(n => grab(js, n, file)).join('\n') +
    '\n this.API={' + names.join(',') + '};}).call(this)').runInContext(ctx);
  return ctx.API;
}

const CORE = ['scoreRulePoints', 'scorerMaxPoints', 'scoreClassOf', 'scoreChipLabel',
              'scoreChipTitle', 'scoreRollup'];
const DASH = load('index.html', CORE);
const FORM = load('f/index.html', CORE);

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };
// the same answer must be worth the same on the form and in the panel
const both = (name, spec, val, expected) => {
  t(name + ' (panel)', () => assert.strictEqual(DASH.scoreRulePoints(spec, val), expected));
  t(name + ' (form)', () => assert.strictEqual(FORM.scoreRulePoints(spec, val), expected));
};

// ---- the two copies are actually the same code ----
// Newlines are normalised before comparing. They have to be: core.autocrlf rewrites line
// endings on checkout, so whether these two files agree byte-for-byte depends on how the
// clone was made rather than on the code — this asserted the stricter thing at first and
// failed on a worktree where one file came back CRLF and the other LF, with six functions
// character-for-character identical apart from the \r. Any real drift still fails, because
// only \r is ignored and nothing else is.
t('both pages carry the same scoring functions', () => {
  const nl = (s) => String(s).replace(/\r\n/g, '\n');
  const a = scripts('index.html'), b = scripts('f/index.html');
  for (const fn of CORE) {
    assert.strictEqual(nl(grab(b, fn, 'f/index.html')), nl(grab(a, fn, 'index.html')),
      fn + ' has drifted between index.html and f/index.html');
  }
});

// ---- match: the shape 63 of QC's 70 rules use ----
const MATCH = { kind: 'match', source: 'q', expect: 'Clean', points: 1, else: 0 };
both('the expected answer earns', MATCH, 'Clean', 1);
both('a different answer earns the else', MATCH, 'Dirty', 0);
both('surrounding space is trimmed both sides (mirrors SQL btrim)', MATCH, '  Clean  ', 1);
both('an unanswered question earns the else, not the point', MATCH, null, 0);
both('an empty answer earns the else', MATCH, '', 0);
both('matching is case SENSITIVE, as = is in SQL', MATCH, 'clean', 0);

// ---- the three rules that take points OFF ----
const PENALTY = { kind: 'match', source: 'q', expect: 'Yes', points: 1, else: -2 };
both('a penalty question pays when right', PENALTY, 'Yes', 1);
both('and charges when wrong', PENALTY, 'No', -2);
both('an unanswered penalty question still charges', PENALTY, null, -2);

// ---- contains_all: a multi-select, in any order ----
const ALL = { kind: 'contains_all', source: 'q', tokens: ['Clean', 'Organized'], points: 1, else: 0 };
both('both tokens present earns', ALL, 'Clean, Organized', 1);
both('the same two the other way round also earns', ALL, 'Organized, Clean', 1);
both('one of the two is not enough', ALL, 'Clean', 0);
both('neither earns nothing', ALL, 'Dirty, Messy', 0);
both('a blank multi-select earns nothing', ALL, '', 0);
both('the test is case-insensitive, as FIND is', ALL, 'clean, ORGANIZED', 1);
t('a substring inside a longer choice still counts, as Airtable FIND does (panel)', () => {
  // "Not Fully Stocked" contains "Fully Stocked". Reproduced rather than fixed: the years of
  // history were scored this way, and the breakdown has to agree with the stored figures.
  const spec = { kind: 'contains_all', source: 'q', tokens: ['Clean', 'Fully Stocked with Beans'], points: 1, else: 0 };
  assert.strictEqual(DASH.scoreRulePoints(spec, 'Clean, Not Fully Stocked with Beans'), 1);
  assert.strictEqual(FORM.scoreRulePoints(spec, 'Clean, Not Fully Stocked with Beans'), 1);
});

// ---- match_any: several acceptable answers ----
const ANY = { kind: 'match_any', source: 'q', expect_any: ['Yes / نعم', 'Not 24 HR / المحل مش ٢٤ ساعة'], points: 1, else: 0 };
both('the first acceptable answer earns', ANY, 'Yes / نعم', 1);
both('so does the second — a shop with no 24h sign is not penalised', ANY, 'Not 24 HR / المحل مش ٢٤ ساعة', 1);
both('anything else does not', ANY, 'No / لا', 0);
both('unanswered does not', ANY, null, 0);

// ---- compare: a numeric threshold ----
const CMP = { kind: 'compare', source: 'q', op: '<', threshold: 5, points: 1, else: 0 };
both('under the line earns', CMP, '4.9', 1);
both('on the line does not, for a strict <', CMP, '5', 0);
both('over the line does not', CMP, '321.1', 0);
both('a blank number reads as 0 and EARNS (mirrors SQL, an Airtable quirk)', CMP, '', 1);
both('so does a missing answer, for the same reason', CMP, null, 1);
both('a number that is not a number earns the else', CMP, 'warm', 0);
t('every operator (panel and form agree)', () => {
  const ops = [['<', 4, 1], ['<', 5, 0], ['<=', 5, 1], ['>', 6, 1], ['>', 5, 0], ['>=', 5, 1], ['=', 5, 1], ['=', 4, 0]];
  for (const [op, val, want] of ops) {
    const spec = { kind: 'compare', source: 'q', op, threshold: 5, points: 1, else: 0 };
    assert.strictEqual(DASH.scoreRulePoints(spec, String(val)), want, 'panel ' + op + ' ' + val);
    assert.strictEqual(FORM.scoreRulePoints(spec, String(val)), want, 'form ' + op + ' ' + val);
  }
});
t('an unknown operator earns nothing rather than throwing', () => {
  const spec = { kind: 'compare', source: 'q', op: '~', threshold: 5, points: 1, else: 0 };
  assert.strictEqual(DASH.scoreRulePoints(spec, '5'), 0);
  assert.strictEqual(FORM.scoreRulePoints(spec, '5'), 0);
});

// ---- truthy: Mystery Shopper's checkbox shape ----
const TRUTHY = { kind: 'truthy', source: 'q', points: 1, else: 0 };
both('any real answer is true', TRUTHY, 'anything', 1);
both('blank is not', TRUTHY, '', 0);
both('and neither are the words SQL treats as false', TRUTHY, 'No', 0);
both('nor "false"', TRUTHY, 'FALSE', 0);
both('nor "0"', TRUTHY, '0', 0);

// ---- no rule at all ----
t('no spec is not a score of zero', () => {
  assert.strictEqual(DASH.scoreRulePoints(null, 'Clean'), null);
  assert.strictEqual(FORM.scoreRulePoints(undefined, 'Clean'), null);
});
t('a spec with no numbers on it scores zero rather than NaN', () => {
  assert.strictEqual(DASH.scoreRulePoints({ kind: 'match', expect: 'x' }, 'x'), 0);
  assert.strictEqual(DASH.scoreRulePoints({ kind: 'match', expect: 'x' }, 'y'), 0);
});

// ---- what the colour is ----
t('the colour vocabulary', () => {
  for (const API of [DASH, FORM]) {
    assert.strictEqual(API.scoreClassOf(1, 1, true), 'plus', 'full marks are green');
    assert.strictEqual(API.scoreClassOf(1, 2, true), 'part', 'some marks are yellow');
    assert.strictEqual(API.scoreClassOf(0, 1, true), 'zero', 'no marks are red');
    assert.strictEqual(API.scoreClassOf(-2, 1, true), 'neg', 'a penalty is its own red');
    assert.strictEqual(API.scoreClassOf(1, 1, false), 'na', 'unanswered is grey whatever the rule says');
    assert.strictEqual(API.scoreClassOf(null, 1, true), 'na', 'and so is a question with no rule');
  }
});
t('the chip label', () => {
  for (const API of [DASH, FORM]) {
    assert.strictEqual(API.scoreChipLabel('plus', 1), '+1');
    assert.strictEqual(API.scoreChipLabel('part', 1), '+1');
    assert.strictEqual(API.scoreChipLabel('zero', 0), '0');
    assert.strictEqual(API.scoreChipLabel('neg', -2), '−2', 'a real minus sign, not a hyphen');
    assert.strictEqual(API.scoreChipLabel('na', 0), 'n/a');
  }
});

// ---- what a question is worth at most ----
t('score_weight wins when it is set', () => {
  assert.strictEqual(DASH.scorerMaxPoints({ options: { score_weight: 3, score: { points: 1 } } }), 3);
});
t('otherwise the rule says, and a penalty does not make the question worth -2', () => {
  assert.strictEqual(DASH.scorerMaxPoints({ options: { score: { points: 1, else: -2 } } }), 1);
  assert.strictEqual(DASH.scorerMaxPoints({ options: { score: { points: 2, else: 0 } } }), 2);
});
t('a question priced at nothing is still worth 1, so nothing divides by zero', () => {
  assert.strictEqual(DASH.scorerMaxPoints({ options: { score: { points: 0, else: 0 } } }), 1);
  assert.strictEqual(DASH.scorerMaxPoints({}), 1);
  assert.strictEqual(DASH.scorerMaxPoints(null), 1);
});

// ---- the roll-up behind the headline ----
t('the roll-up is the one whose target is the score field', () => {
  const tbl = { config: { score_field: 'pct', scoring: [
    { target: 'raw', of: ['a', 'b'], divisor: null },
    { target: 'pct', of: ['a'], divisor: 68 },
  ] } };
  for (const API of [DASH, FORM]) {
    assert.strictEqual(API.scoreRollup(tbl).divisor, 68);
    assert.strictEqual(API.scoreRollup({ config: {} }), null);
    assert.strictEqual(API.scoreRollup({ config: { score_field: 'pct' } }), null, 'no scoring, no roll-up');
    assert.strictEqual(API.scoreRollup(null), null);
  }
});

// ---- the form paints as it is filled in ----
// paintScores reads the live controls and writes the chips, so it is exercised against a
// stub page rather than by eye: the thing that matters is that nothing is coloured before it
// is answered, and that the running total is the same arithmetic the database will apply.
function loadForm() {
  const js = scripts('f/index.html');
  const ctx = { console };
  vm.createContext(ctx);
  const els = {};
  const stub = `
    var controls = [], scorerMap = null, scoreCounts = null, scoreTotalOf = 0;
    var __els = {};
    function __el(id) {
      if (!__els[id]) __els[id] = { id: id, className: "", textContent: "", title: "",
                                    innerHTML: "", style: { display: "" } };
      return __els[id];
    }
    var document = { getElementById: function (id) { return __els[id] || null; } };
  `;
  new vm.Script('(function(){' + stub + '\n' +
    ['scoreRulePoints', 'scorerMaxPoints', 'scoreClassOf', 'scoreChipLabel', 'scoreChipTitle',
     'scoreRollup', 'buildScorerMap', 'paintScores'].map(x => grab(js, x, 'f/index.html')).join('\n') +
    '\n this.API = { paintScores: paintScores, buildScorerMap: buildScorerMap, el: __el,' +
    ' set: function (c, m, t) { controls = c; scorerMap = m; scoreCounts = t.counts; scoreTotalOf = t.of; } };' +
    '}).call(this)').runInContext(ctx);
  return ctx.API;
}

const RULES = [
  { id: 's1', options: { score: { kind: 'match', source: 'q1', expect: 'Clean', points: 1, else: 0 } } },
  { id: 's2', options: { score: { kind: 'match', source: 'q2', expect: 'Yes', points: 1, else: -2 } } },
];
t('nothing is coloured until it is answered', () => {
  const F = loadForm();
  const c1 = F.el('sc-q1'), c2 = F.el('sc-q2'), live = F.el('sc-live');
  F.set([{ f: { id: 'q1' }, value: () => null }, { f: { id: 'q2' }, value: () => null }],
        F.buildScorerMap(RULES), { counts: { s1: true, s2: true }, of: 2 });
  F.paintScores();
  assert.strictEqual(c1.style.display, 'none', 'an unanswered question shows no chip');
  assert.strictEqual(c2.style.display, 'none');
  assert.strictEqual(live.style.display, 'none', 'and no running total either');
});
t('answering right turns that one green and starts the total', () => {
  const F = loadForm();
  const c1 = F.el('sc-q1'), c2 = F.el('sc-q2'), live = F.el('sc-live');
  F.set([{ f: { id: 'q1' }, value: () => 'Clean' }, { f: { id: 'q2' }, value: () => null }],
        F.buildScorerMap(RULES), { counts: { s1: true, s2: true }, of: 2 });
  F.paintScores();
  assert.strictEqual(c1.className, 'qp plus');
  assert.strictEqual(c1.textContent, '+1');
  assert.strictEqual(c2.style.display, 'none', 'the unanswered one stays blank');
  assert.strictEqual(live.style.display, '', 'the total appears once something is answered');
  assert.ok(/1 \/ 2 points/.test(live.innerHTML), 'got: ' + live.innerHTML);
  assert.ok(/50%/.test(live.innerHTML));
});
t('a penalty answer goes its own red and takes the total down', () => {
  const F = loadForm();
  const c2 = F.el('sc-q2'), live = F.el('sc-live');
  F.set([{ f: { id: 'q1' }, value: () => 'Clean' }, { f: { id: 'q2' }, value: () => 'No' }],
        F.buildScorerMap(RULES), { counts: { s1: true, s2: true }, of: 2 });
  F.paintScores();
  assert.strictEqual(c2.className, 'qp neg');
  assert.strictEqual(c2.textContent, '−2');
  assert.ok(/-1 \/ 2 points/.test(live.innerHTML), '1 + (-2) = -1; got: ' + live.innerHTML);
});
t('a wrong answer that is merely wrong goes red without the penalty colour', () => {
  const F = loadForm();
  const c1 = F.el('sc-q1');
  F.set([{ f: { id: 'q1' }, value: () => 'Dirty' }], F.buildScorerMap(RULES),
        { counts: { s1: true }, of: 1 });
  F.paintScores();
  assert.strictEqual(c1.className, 'qp zero');
  assert.strictEqual(c1.textContent, '0');
});
t('a question the roll-up does not sum is still coloured but not counted', () => {
  const F = loadForm();
  const c2 = F.el('sc-q2'), live = F.el('sc-live');
  F.set([{ f: { id: 'q1' }, value: () => 'Clean' }, { f: { id: 'q2' }, value: () => 'Yes' }],
        F.buildScorerMap(RULES), { counts: { s1: true }, of: 1 });   // s2 left out
  F.paintScores();
  assert.strictEqual(c2.className, 'qp plus', 'it still tells the person what they answered');
  assert.ok(/1 \/ 1 points/.test(live.innerHTML), 'but it is not in the total; got: ' + live.innerHTML);
});
t('the map is built from the rules, so an unscored question never gets a chip', () => {
  const F = loadForm();
  const map = F.buildScorerMap(RULES.concat([{ id: 'plain', options: {} }, { id: 'none' }]));
  assert.deepStrictEqual(Object.keys(map).sort(), ['q1', 'q2']);
});
t('no scoring on the table means paintScores does nothing at all', () => {
  const F = loadForm();
  F.set([{ f: { id: 'q1' }, value: () => 'Clean' }], null, { counts: null, of: 0 });
  F.paintScores();   // must not throw
  assert.strictEqual(F.el('sc-q1').className, '', 'an unscored table paints nothing');
});

// ---- every control that can hold a scored answer must tell the page ----
// The gap this closes: the earlier tests asserted the listener was WIRED, and it was. They
// did not ask whether each kind of control reaches it. A dropdown is a custom combo -- it
// assigns input.value in script and calls its own onChange, and assigning .value fires no
// input or change event -- so the delegated listener never heard the commonest answer of all.
// Typing a number coloured its question; picking from a dropdown did not, which is 63 of
// QC's 70 scored questions.
const FORM_SRC = fs.readFileSync('f/index.html', 'utf8');
t('an answer changing has one named path, and everything that follows an answer is on it', () => {
  // Every consequence of an answer belongs in this one function. Three of them now: the
  // questions that appear, the scores that repaint, and the shops a branch question offers
  // once the country is known. A fourth added at a call site instead is a consequence that
  // fires for some controls and not others, which is exactly the bug this test was born from.
  const m = FORM_SRC.match(/function answerChanged\(\) \{([^}]*)\}/);
  assert.ok(m, 'answerChanged is no longer a single-line function');
  ['applyConditions()', 'paintScores()', 'applyBranchScope()'].forEach(function (call) {
    assert.ok(m[1].indexOf(call) !== -1, call + ' does not follow an answer changing');
  });
});
t('the dropdown widget goes through it — every call site', () => {
  // Matched on the callback rather than on the options argument: the branch question now
  // builds its list from the country, so "dopts" is not what every call site passes.
  const sites = FORM_SRC.match(/buildCombo\(f, .*?, function \(v\) \{[^}]*\}/g) || [];
  assert.ok(sites.length >= 2, 'expected the combo call sites, found ' + sites.length);
  for (const s of sites) {
    assert.ok(/answerChanged\(\)/.test(s), 'a combo that still calls applyConditions alone: ' + s);
    assert.ok(!/applyConditions\(\)/.test(s), 'and it must not call applyConditions directly: ' + s);
  }
});
t('the native-event path is still wired for the controls that do fire events', () => {
  // a checkbox and a number box announce themselves, so those stay on delegation
  assert.ok(/host\.addEventListener\(ev, paintScores, true\)/.test(FORM_SRC));
});
t('paintScores is reachable from both, so no control type is left out', () => {
  // dropdown -> answerChanged -> paintScores;  number/checkbox -> delegated -> paintScores
  assert.ok(/answerChanged\(\) \{ applyConditions\(\); paintScores\(\)/.test(FORM_SRC));
  assert.ok(/\["change", "input"\]\.forEach\(function \(ev\) \{ host\.addEventListener/.test(FORM_SRC));
});

// ---- the editors ----
const APP = fs.readFileSync('index.html', 'utf8');
t('both editors paint through the SAME function', () => {
  // The record panel and the New record panel each had their own conditional-question loop
  // once and they drifted. The scoring painter is shared from the start.
  assert.ok(/function paintScoreRows\(table, fields, map, answers, liveBoxId\)/.test(APP));
  assert.ok(/paintScoreRows\(currentCustom\.table, fields, qsMap, edValues\(fields\), "ed-live-score"\)/.test(APP),
    'the record panel must call it');
  assert.ok(/paintScoreRows\(t, fields, nrMap, edValues\(asked\), "nr-live-score"\)/.test(APP),
    'and so must the New record panel — a new inspection is where the form is really filled in');
});
t('both editors repaint on every answer, and once before anything is touched', () => {
  assert.ok(/mgrid\.addEventListener\(ev, applyEdScores, true\)/.test(APP));
  assert.ok(/mg\.addEventListener\(ev, applyNrScores, true\)/.test(APP));
  assert.ok(/applyEdScores\(\);\s+\/\/ the running total has to read right/.test(APP),
    'the record panel needs an opening paint');
  assert.ok(/applyConds\(\);\s*\n\s*applyNrScores\(\);/.test(APP), 'so does the create panel');
});
t('the create panel only wires scoring when the table actually scores', () => {
  // Either engine counts. An imported scorecard has a roll-up rule and scorer columns; a
  // builder-made one has priced questions and neither, and was left out when it was only
  // the roll-up being asked about. A table with none of it still grows no score box.
  assert.ok(/var nrScored = \(!!scoreRollup\(t\) && Object\.keys\(nrMap\)\.length > 0\) \|\|/.test(APP),
    'an imported scorecard is still recognised by its roll-up');
  assert.ok(/t\.config && t\.config\.scorecard\)[\s\S]{0,80}f\.scoring/.test(APP),
    'a builder-made scorecard must wire it too, or a new Shop Audit scores in silence');
});
t('the create panel does not offer a computed score as a question', () => {
  // It filtered on type alone, so creating a QC inspection opened with seventy
  // "<Question> Score" boxes above the questions they are computed from. Nothing was ever
  // saved from them, which is why it went unnoticed — edValues() skips a scorer either way.
  assert.ok(/return f\.type !== "link" && !isScorerField\(f\)/.test(APP),
    'openNewRecord must drop computed scorers, not just link fields');
});
t('a computed score is refused by every path that could show or save it', () => {
  // one list, so a new panel cannot quietly reintroduce the boxes
  assert.ok(/if \(isScorerField\(f\)\) return false;/.test(APP), 'the record panel does not draw one');
  assert.ok(/if \(isScorerField\(f\)\) return;/.test(APP), 'edValues does not read one back');
  assert.ok(/!isScorerField\(f\)/.test(APP), 'and the create panel does not ask for one');
});
t('an unanswered question carries a hidden chip in an editor, a visible one in review', () => {
  // 68 marks on a blank inspection is a wall -- grey "n/a" ones on an imported scorecard,
  // red ones on a rules scorecard, where a blank answer really has lost the point. On a
  // finished record both are worth reading, so only the editors hold the mark back, and
  // they key off "unanswered" rather than off the grey, which is what lets one rule cover
  // both engines.
  assert.ok(/var editorCls = \(!answered \|\| cls === "na"\) \? "na" : cls;/.test(APP),
    'the editor holds back an unanswered question whichever engine priced it');
  assert.ok(/chipEditor: chipOf\(editorCls, editorCls === "na"\)/.test(APP));
  assert.ok(/chip: chipOf\(cls, false\)/.test(APP), 'review keeps the honest colour');
  assert.ok(/sm \? sm\.chipEditor : ""/.test(APP), 'the editor row must use the hiding variant');
  assert.ok(/\(sm \? sm\.chip : ""\)/.test(APP), 'and the review grid the plain one');
});
t('the review grid colours the answer in place instead of reprinting it below', () => {
  assert.ok(/scoredKeyBlock/.test(APP), 'the report is now just its key');
  assert.ok(!/scoredBlock/.test(APP), 'the end-of-page report block must be gone');
  assert.ok(/esc\(f\.label\) \+ \(sm \? sm\.chip : ""\)/.test(APP), 'the chip rides on the label');
  assert.ok(/\(sm \? " sc-" \+ sm\.cls : ""\)/.test(APP), 'and the colour on the row');
});

if (!process.exitCode) console.log(n + ' passed');
