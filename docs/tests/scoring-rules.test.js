// What a score means. Every case here is a way the arithmetic could be wrong about
// somebody's work: a question they were never asked counting against them, a question
// they skipped quietly forgiven, or a total that moves when nothing about the form did.
//
// The rule, decided 2026-08-25: a question that was never asked leaves the total, whether
// it was hidden by "ask only if" or answered N/A. A question that was asked and missed
// stays in the total and earns nothing.
//
// These rules are mirrored in SQL by score_submission() in the private workspaces/40-scorecard-rules.sql, because
// the browser needs them for the live breakdown and the database needs them so that a
// public submit, a staff edit, an added record and an import all agree. If the two ever
// disagree, both have to be fixed: the SQL is what is stored, the JS is what people see.
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

// naChoices and condMet are not tested directly, but questionApplies calls both, so they
// have to come along or the whole file dies on a ReferenceError rather than a failed assert.
const API = load('index.html',
  ['choicePoints', 'questionMaxPoints', 'naChoices', 'questionApplies', 'questionEarned',
   'scorecardTotals', 'condMet']);
const { choicePoints, questionMaxPoints, questionApplies, questionEarned, scorecardTotals } = API;

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };

// Objects built inside the vm carry that realm's prototype, so deepStrictEqual rejects
// them against a literal on reference-equality alone. Compare the shape instead.
const same = (a, b, msg) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), msg ||
  ('expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)));

// A scored yes/no worth 4, and a priced three-way choice worth 3 at most.
const Q_CLEAN = { id: 'q1', type: 'yesno', scoring: { rule: 'equals', earn: ['Yes'], points: 4 } };
const Q_RATE = {
  id: 'q2', type: 'dropdown', scoring: { rule: 'choices' },
  options: [{ en: 'Excellent', points: 3 }, { en: 'Acceptable', points: 1 }, { en: 'Poor', points: 0 }]
};
const Q_PLAIN = { id: 'q3', type: 'short_text' };   // no scoring: an ordinary question

// ---- one question at a time ----
t('a priced choice list is worth its dearest choice', () => {
  assert.strictEqual(questionMaxPoints(Q_RATE), 3);
});
t('a flat question is worth what it says', () => {
  assert.strictEqual(questionMaxPoints(Q_CLEAN), 4);
});
t('an unscored question is worth nothing', () => {
  assert.strictEqual(questionMaxPoints(Q_PLAIN), 0);
});
t('each choice earns its own price', () => {
  assert.strictEqual(questionEarned(Q_RATE, { q2: 'Excellent' }), 3);
  assert.strictEqual(questionEarned(Q_RATE, { q2: 'Acceptable' }), 1);
  assert.strictEqual(questionEarned(Q_RATE, { q2: 'Poor' }), 0);
});
t('the earning answer takes the points and the other does not', () => {
  assert.strictEqual(questionEarned(Q_CLEAN, { q1: 'Yes' }), 4);
  assert.strictEqual(questionEarned(Q_CLEAN, { q1: 'No' }), 0);
});
t('a choice nobody priced earns nothing rather than NaN', () => {
  const q = { id: 'q', type: 'dropdown', scoring: { rule: 'choices' }, options: [{ en: 'Fine' }] };
  assert.strictEqual(questionEarned(q, { q: 'Fine' }), 0);
  assert.strictEqual(questionMaxPoints(q), 0);
});
t('an answer that is not one of the choices earns nothing', () => {
  assert.strictEqual(questionEarned(Q_RATE, { q2: 'Something the form never offered' }), 0);
});

// ---- multi-select adds up, and can reach full marks ----
const Q_MULTI = {
  id: 'm', type: 'multi_select', scoring: { rule: 'choices' },
  options: [{ en: 'Gloves', points: 2 }, { en: 'Hairnet', points: 1 }, { en: 'Apron', points: 1 }]
};
t('a multi-select is worth all its priced choices together', () => {
  assert.strictEqual(questionMaxPoints(Q_MULTI), 4);
});
t('ticking some earns those', () => {
  assert.strictEqual(questionEarned(Q_MULTI, { m: 'Gloves, Apron' }), 3);
});
t('ticking everything is full marks', () => {
  assert.strictEqual(questionEarned(Q_MULTI, { m: 'Gloves, Hairnet, Apron' }), 4);
});
t('ticking nothing earns nothing', () => {
  assert.strictEqual(questionEarned(Q_MULTI, { m: '' }), 0);
});

// ---- a number over or under a line ----
const Q_FRIDGE = { id: 'f', type: 'number', scoring: { rule: 'threshold', op: '<', value: 5, points: 2 } };
t('a number under the line earns the points', () => {
  assert.strictEqual(questionEarned(Q_FRIDGE, { f: '3' }), 2);
});
t('a number over the line earns nothing', () => {
  assert.strictEqual(questionEarned(Q_FRIDGE, { f: '7' }), 0);
});
t('a blank number earns nothing rather than passing as zero', () => {
  // Airtable read an empty number as 0 and gave the point away. Deliberately not copied:
  // this is a new form and a non-answer should not pass.
  assert.strictEqual(questionEarned(Q_FRIDGE, { f: '' }), 0);
});

// ---- the denominator rule ----
t('a question that was asked and missed stays in the total and earns nothing', () => {
  assert.strictEqual(questionApplies(Q_CLEAN, {}), true);
  assert.strictEqual(questionEarned(Q_CLEAN, {}), 0);
});
t('an N/A answer takes the question out of the total', () => {
  const q = {
    id: 'k', type: 'dropdown', scoring: { rule: 'choices' },
    options: [{ en: 'Clean', points: 2 }, { en: 'Not applicable', na: true }]
  };
  assert.strictEqual(questionApplies(q, { k: 'Not applicable' }), false);
  assert.strictEqual(questionApplies(q, { k: 'Clean' }), true);
});
t('a question hidden by "ask only if" leaves the total', () => {
  const q = { id: 'k', type: 'yesno', show_if: { field: 'g', equals: ['Yes'] },
              scoring: { rule: 'equals', earn: ['Yes'], points: 5 } };
  assert.strictEqual(questionApplies(q, { g: 'No' }), false, 'hidden question must leave the total');
  assert.strictEqual(questionApplies(q, { g: 'Yes' }), true);
});
t('an unscored question never enters the total, answered or not', () => {
  assert.strictEqual(questionApplies(Q_PLAIN, { q3: 'anything' }), false);
});
t('a multi-select answered only with N/A choices leaves the total', () => {
  const q = {
    id: 'm2', type: 'multi_select', scoring: { rule: 'choices' },
    options: [{ en: 'Gloves', points: 2 }, { en: 'Not applicable', na: true }]
  };
  assert.strictEqual(questionApplies(q, { m2: 'Not applicable' }), false);
  assert.strictEqual(questionApplies(q, { m2: 'Gloves, Not applicable' }), true);
});

// ---- the whole record ----
t('the worked example: 60 of 64 reads as 94%', () => {
  // 20 questions worth 3 each, plus one worth 4, is 64. Answering the 4 and 56 of the 60.
  const fields = [Q_CLEAN];
  const data = { q1: 'Yes' };
  for (let i = 0; i < 20; i++) {
    const id = 'r' + i;
    fields.push({ id, type: 'dropdown', scoring: { rule: 'choices' },
                  options: [{ en: 'Full', points: 3 }, { en: 'Part', points: 1 }, { en: 'None', points: 0 }] });
    // 18 full (54) + 2 part (2) = 56, plus the 4 above = 60
    data[id] = i < 18 ? 'Full' : 'Part';
  }
  const r = scorecardTotals(fields, data);
  assert.strictEqual(r.possible, 64, 'total should be 64, got ' + r.possible);
  assert.strictEqual(r.earned, 60, 'earned should be 60, got ' + r.earned);
  assert.strictEqual(Math.round(r.earned / r.possible * 100), 94);
});
t('an N/A question shrinks the total for that record only', () => {
  const na = { id: 'na', type: 'dropdown', scoring: { rule: 'choices' },
               options: [{ en: 'Clean', points: 3 }, { en: 'Not applicable', na: true }] };
  const fields = [Q_CLEAN, na];
  same(scorecardTotals(fields, { q1: 'Yes', na: 'Clean' }), { earned: 7, possible: 7 });
  same(scorecardTotals(fields, { q1: 'Yes', na: 'Not applicable' }), { earned: 4, possible: 4 });
});
t('a record where everything was N/A produces no total, not a divide by zero', () => {
  const na = { id: 'na', type: 'dropdown', scoring: { rule: 'choices' },
               options: [{ en: 'Clean', points: 3 }, { en: 'Not applicable', na: true }] };
  const r = scorecardTotals([na], { na: 'Not applicable' });
  assert.strictEqual(r.possible, 0);
  assert.strictEqual(r.earned, 0);
});
t('a table with no scored questions at all totals nothing', () => {
  same(scorecardTotals([Q_PLAIN], { q3: 'hello' }), { earned: 0, possible: 0 });
});
t('renaming a choice keeps its price, because the price is on the choice', () => {
  const renamed = JSON.parse(JSON.stringify(Q_RATE));
  renamed.options[0].en = 'Outstanding';
  assert.strictEqual(questionMaxPoints(renamed), 3);
  assert.strictEqual(questionEarned(renamed, { q2: 'Outstanding' }), 3);
});
t('no fields and no data is a total of nothing, not a crash', () => {
  same(scorecardTotals(null, null), { earned: 0, possible: 0 });
});

// ---- the record view's own totals ----
// scoredDetail is what the record header reads. It has two paths now: the imported
// scorer-field path that QC and Mystery Shopper use, and the rules path a builder-made
// scorecard uses. They must not interfere with each other.
//
// cellValueHtml is stubbed rather than loaded. It reaches customCellText, pillClass,
// fmtFieldDate and half a dozen more, and dragging that chain in would make this file
// fail for reasons that have nothing to do with scoring. What is under test here is which
// questions count and what they are worth, not how one answer is painted.
function loadWith(file, names, stubs) {
  const js = scripts(file);
  const ctx = { console };
  vm.createContext(ctx);
  new vm.Script('(function(){' + (stubs || '') + '\n' + names.map(x => grab(js, x, file)).join('\n') +
    '\n this.API={' + names.join(',') + '};}).call(this)').runInContext(ctx);
  return ctx.API;
}
const SD = loadWith('index.html',
  ['scoredDetail', 'scoredDetailFromRules', 'questionScorerMap', 'questionApplies', 'questionEarned',
   'questionMaxPoints', 'choicePoints', 'naChoices', 'condMet', 'esc',
   'scoreRollup', 'scoreChipTitle', 'isScorerField', 'scoreRawNoteHtml'],
  'function cellValueHtml(f, d, s) { return "<i>" + ((d && d[f.id]) || "") + "</i>"; }');

t('a table that is not scored at all returns nothing', () => {
  assert.strictEqual(SD.scoredDetail({ config: {} }, [Q_CLEAN], { q1: 'Yes' }), null);
});
t('a builder-made scorecard totals from its rules', () => {
  const table = { config: { scorecard: true, score_field: 'pct' } };
  const sd = SD.scoredDetail(table, [Q_CLEAN, Q_RATE], { q1: 'Yes', q2: 'Acceptable' });
  assert.ok(sd, 'expected a breakdown');
  assert.strictEqual(sd.possible, 7);
  assert.strictEqual(sd.earned, 5);
});
t('the breakdown names every scored question', () => {
  const table = { config: { scorecard: true, score_field: 'pct' } };
  const labelled = [Object.assign({ label: 'Floors clean' }, Q_CLEAN)];
  const sd = SD.scoredDetail(table, labelled, { q1: 'Yes' });
  assert.ok(sd.html.includes('Floors clean'), 'expected the question in the breakdown');
});
t('an N/A question is shown as n/a rather than as a zero', () => {
  const table = { config: { scorecard: true, score_field: 'pct' } };
  const q = { id: 'k', label: 'Kitchen', type: 'dropdown', scoring: { rule: 'choices' },
              options: [{ en: 'Clean', points: 3 }, { en: 'Not applicable', na: true }] };
  const sd = SD.scoredDetail(table, [q], { k: 'Not applicable' });
  assert.strictEqual(sd.possible, 0, 'an N/A question must not be in the total');
  assert.ok(sd.html.includes('n/a'), 'expected the row to read n/a, got: ' + sd.html);
});
t('sections group and each carries its own total', () => {
  const table = { config: { scorecard: true, score_field: 'pct' } };
  const a = { id: 'a', label: 'A', type: 'yesno', scoring: { rule: 'equals', earn: ['Yes'], points: 2, section: 'Cleanliness' } };
  const b = { id: 'b', label: 'B', type: 'yesno', scoring: { rule: 'equals', earn: ['Yes'], points: 3, section: 'Service' } };
  const sd = SD.scoredDetail(table, [a, b], { a: 'Yes', b: 'No' });
  assert.strictEqual(sd.sections.length, 2);
  const clean = sd.sections.filter(s => s.name === 'Cleanliness')[0];
  same([clean.earned, clean.possible], [2, 2]);
});
t('a scorecard with no priced questions yet returns nothing rather than an empty box', () => {
  assert.strictEqual(SD.scoredDetail({ config: { scorecard: true, score_field: 'pct' } }, [Q_PLAIN], {}), null);
});

// ---- the same six cases the database was checked against ----
// These are not extra coverage. They are the exact records run through score_submission()
// on the live database on 2026-08-25, with the exact figures it returned, so the two
// implementations of the rule are pinned to each other here rather than in a paragraph
// somebody has to remember to re-run. If one of these changes, the SQL changed too.
const MIRROR_FIELDS = [
  { id: 'q1', type: 'yesno', scoring: { rule: 'equals', earn: ['Yes'], points: 4 } },
  { id: 'q2', type: 'dropdown', scoring: { rule: 'choices' },
    options: [{ en: 'Excellent', points: 3 }, { en: 'Acceptable', points: 1 }, { en: 'Poor', points: 0 }] },
  { id: 'q3', type: 'dropdown', scoring: { rule: 'choices' },
    options: [{ en: 'Clean', points: 3 }, { en: 'Not applicable', na: true }] },
  { id: 'q4', type: 'yesno', show_if: { field: 'q1', equals: ['Yes'] },
    scoring: { rule: 'equals', earn: ['Yes'], points: 5 } }
];
const pct = d => {
  const r = scorecardTotals(MIRROR_FIELDS, d);
  return r.possible ? Number((r.earned / r.possible).toFixed(4)) : null;
};
t('mirror 1: everything applies, 8 of 15', () => {
  assert.strictEqual(pct({ q1: 'Yes', q2: 'Acceptable', q3: 'Clean', q4: 'No' }), 0.5333);
});
t('mirror 2: an N/A answer leaves the total, 12 of 12', () => {
  assert.strictEqual(pct({ q1: 'Yes', q2: 'Excellent', q3: 'Not applicable', q4: 'Yes' }), 1);
});
t('mirror 3: a question never asked leaves the total, 6 of 10', () => {
  assert.strictEqual(pct({ q1: 'No', q2: 'Excellent', q3: 'Clean' }), 0.6);
});
t('mirror 4: asked and missed stays in the total, 12 of 15', () => {
  assert.strictEqual(pct({ q1: 'Yes', q3: 'Clean', q4: 'Yes' }), 0.8);
});
t('mirror 5: unanswered questions still count, so this is 0 of 7 and not a null', () => {
  // Only q3 is N/A and only q4 was never asked. q1 and q2 were asked and missed, so the
  // record scores zero out of seven rather than having no score at all.
  assert.strictEqual(pct({ q3: 'Not applicable' }), 0);
});

// ---- the IMPORTED scorecard: QC, Shop Audit, Mystery Shopper ----
// The other path. A builder-made scorecard prices the questions themselves; an imported one
// has a computed "<Question> Score" column per question plus a roll-up in
// app_tables.config.scoring that sums a named list and divides by a fixed number. Both end
// up in the same panel, so both are checked here.
//
// The bug these pin down: the panel used to count whichever questions happened to be scored
// and divide by that. QC carries 70 rules and a roll-up that sums 68 of them and always
// divides by 68, so the panel and the stored score disagreed on the same record. The
// breakdown now comes from the roll-up, which is the same list the database sums.
const IMP_TABLE = {
  config: {
    score_field: 'pct',
    scoring: [
      // the headline: sums three of the four scorers, always over 4
      { target: 'pct', kind: 'sum', divisor: 4, of: ['s1', 's2', 's3'] },
      { target: 'raw', kind: 'sum', divisor: null, of: ['s1', 's2', 's3', 's4'] },
    ],
  },
};
const IMP_FIELDS = [
  { id: 'q1', label: 'Floors', type: 'dropdown' },
  { id: 's1', label: 'Floors Score', type: 'short_text', options: { score: { kind: 'match', source: 'q1', expect: 'Clean', points: 1, else: 0 } } },
  { id: 'q2', label: 'Espresso Calibration', type: 'dropdown' },
  { id: 's2', label: 'Calibration Score', type: 'short_text', options: { score: { kind: 'match', source: 'q2', expect: 'Yes', points: 1, else: -2 } } },
  { id: 'q3', label: 'Sink Area', type: 'dropdown' },
  { id: 's3', label: 'Sink Area Score', type: 'short_text', options: { score: { kind: 'match', source: 'q3', expect: 'Clean', points: 1, else: 0 } } },
  // scored in Airtable and deliberately left out of the headline roll-up
  { id: 'q4', label: 'Eliminate Search', type: 'dropdown' },
  { id: 's4', label: 'Eliminate Search Score', type: 'short_text', options: { score: { kind: 'match', source: 'q4', expect: 'Complete', points: 1, else: -2 } } },
];
function imp(data) { return SD.scoredDetail(IMP_TABLE, IMP_FIELDS, data); }

t('a scorer is paired to its question by the rule\'s own source, with no score_of column', () => {
  const map = SD.questionScorerMap({}, IMP_FIELDS);
  assert.strictEqual(map.q1 && map.q1.id, 's1');
  assert.strictEqual(map.q3 && map.q3.id, 's3');
});
t('the roll-up divisor is the denominator, not the number of questions asked', () => {
  // one question of three answered: the score is 1 of 4, exactly as the database computes it
  const sd = imp({ q1: 'Clean', s1: '1' });
  assert.strictEqual(sd.possible, 4, 'expected the divisor, got ' + sd.possible);
  assert.strictEqual(sd.earned, 1);
});
t('a scorer the headline roll-up does not sum is shown, apart, and in no total', () => {
  // Hiding it made the rows add up to the score, but a scored question missing from a list
  // called "Scored answers" reads as a bug in the panel. It is shown at the foot instead,
  // marked, and left out of the arithmetic.
  const sd = imp({ q1: 'Clean', s1: '1', q4: 'Complete', s4: '1' });
  assert.ok(sd.html.includes('Floors'), 'expected the summed question');
  assert.strictEqual(sd.outside, 1);
  assert.ok(sd.html.includes('Eliminate Search'), 'it must still be visible');
  assert.ok(sd.html.includes('Scored, but outside the total'), 'under its own heading');
  assert.ok(sd.html.includes('q-scored outside'), 'and marked as outside');
  assert.strictEqual(sd.earned, 1, 'but its point must not be added in');
  // and it comes after every counted question, not interleaved with them
  assert.ok(sd.html.indexOf('Eliminate Search') > sd.html.indexOf('Floors'));
});
t('the uncounted tail is absent entirely when every scorer counts', () => {
  const tbl = { config: { score_field: 'pct', scoring: [{ target: 'pct', divisor: 4, of: ['s1', 's2', 's3', 's4'] }] } };
  const sd = SD.scoredDetail(tbl, IMP_FIELDS, { q1: 'Clean', s1: '1' });
  assert.strictEqual(sd.outside, 0);
  assert.ok(!sd.html.includes('outside the total'));
});
t('right is green, partly right is yellow, wrong is red, a penalty is its own red', () => {
  const sd = imp({ q1: 'Clean', s1: '1', q2: 'No', s2: '-2', q3: 'Dirty', s3: '0' });
  assert.ok(sd.html.includes('qp plus'), 'a full point must be green');
  assert.ok(sd.html.includes('qp neg'), 'a negative must be its own class, not a plain zero');
  assert.ok(sd.html.includes('qp zero'), 'nothing earned must be red');
  assert.ok(sd.html.includes('−2'), 'a penalty must read as a minus, got: ' + sd.html);
  assert.strictEqual(sd.earned, -1, '1 + (-2) + 0');
});
t('a half point is yellow and not grey', () => {
  const half = [{ id: 'q1', label: 'Floors', type: 'dropdown' },
                { id: 's1', label: 'Floors Score', type: 'short_text',
                  options: { score_weight: 2, score: { kind: 'match', source: 'q1', expect: 'Clean', points: 2, else: 0 } } }];
  const tbl = { config: { score_field: 'pct', scoring: [{ target: 'pct', divisor: 2, of: ['s1'] }] } };
  const sd = SD.scoredDetail(tbl, half, { q1: 'Half', s1: '1' });
  assert.ok(sd.html.includes('qp part'), 'partly earned must be yellow, got: ' + sd.html);
  assert.ok(!sd.html.includes('qp na'), 'and must not be the grey "not asked" colour');
});
t('a question with no computed score reads n/a and is counted as not asked', () => {
  const sd = imp({ q1: 'Clean', s1: '1' });          // s2 and s3 absent entirely
  assert.ok(sd.html.includes('n/a'), 'expected an n/a row');
  assert.strictEqual(sd.notAsked, 2);
  assert.strictEqual(sd.lost, 0, 'never asked is not the same as lost');
});
t('lost counts the questions that were scored and did not earn full marks', () => {
  const sd = imp({ q1: 'Clean', s1: '1', q2: 'No', s2: '-2', q3: 'Dirty', s3: '0' });
  assert.strictEqual(sd.lost, 2);
  assert.strictEqual(sd.notAsked, 0);
});
t('the panel total equals the stored percentage, which is the whole point', () => {
  // the figures the live database returned for Fuhais on 2026-08-26: 29 of 68
  const of = [], flds = [];
  for (let i = 0; i < 68; i++) {
    of.push('s' + i);
    flds.push({ id: 'q' + i, label: 'Q' + i, type: 'dropdown' });
    flds.push({ id: 's' + i, label: 'Q' + i + ' Score', type: 'short_text',
                options: { score: { kind: 'match', source: 'q' + i, expect: 'Clean', points: 1, else: 0 } } });
  }
  const tbl = { config: { score_field: 'pct', scoring: [{ target: 'pct', divisor: 68, of: of }] } };
  const data = {};
  for (let i = 0; i < 68; i++) { data['q' + i] = i < 29 ? 'Clean' : 'Dirty'; data['s' + i] = i < 29 ? '1' : '0'; }
  const sd = SD.scoredDetail(tbl, flds, data);
  assert.strictEqual(sd.earned, 29);
  assert.strictEqual(sd.possible, 68);
  assert.strictEqual(Math.round(sd.earned / sd.possible * 10000) / 10000, 0.4265);
});
t('a table with a score_field but no roll-up still totals by counting the questions', () => {
  const tbl = { config: { score_field: 'pct' } };     // no config.scoring at all
  assert.strictEqual(SD.scoreRollup(tbl), null);
  const sd = SD.scoredDetail(tbl, IMP_FIELDS, { q1: 'Clean', s1: '1', q2: 'Yes', s2: '1', q3: 'Clean', s3: '1', q4: 'Complete', s4: '1' });
  assert.strictEqual(sd.possible, 4, 'all four scorers count when nothing says otherwise');
  assert.strictEqual(sd.earned, 4);
});

// ---- a computed score is not an answer ----
t('a field carrying a scoring rule is computed, so it is never an editable box', () => {
  assert.strictEqual(SD.isScorerField(IMP_FIELDS[1]), true, 'options.score makes it computed');
  assert.strictEqual(SD.isScorerField(IMP_FIELDS[0]), false, 'a plain question is not');
  assert.strictEqual(SD.isScorerField({ options: { score_of: 'q1' } }), true, 'a hand-wired scorer too');
  assert.strictEqual(SD.isScorerField({}), false);
  assert.strictEqual(SD.isScorerField({ options: null }), false);
});
t('the panel says so when the table keeps a second, disagreeing total', () => {
  // QC's "out of 68" column sums 68 scorers while its percentage sums 67 and still divides
  // by 68, so a shop that earns the Food Display point reads 29 in one and 28/68 in the
  // other. Unexplained, that one-point gap reads as a bug in this panel.
  const tbl = { config: { score_field: 'pct', score_raw_field: 'raw',
                          scoring: [{ target: 'pct', divisor: 4, of: ['s1', 's2', 's3'] }] } };
  const d = { q1: 'Clean', s1: '1', q4: 'Complete', s4: '1', raw: '2' };
  const sd = SD.scoredDetail(tbl, IMP_FIELDS, d);
  assert.strictEqual(sd.earned, 1);
  assert.ok(/reads 2\b/.test(SD.scoreRawNoteHtml(tbl, d, sd)), 'expected the gap to be named');
  // and nothing is said when the two agree
  assert.strictEqual(SD.scoreRawNoteHtml(tbl, { raw: '1' }, sd), '');
  assert.strictEqual(SD.scoreRawNoteHtml({ config: {} }, d, sd), '', 'no raw column, nothing to say');
});
t('every chip explains itself on hover', () => {
  assert.ok(/not asked/i.test(SD.scoreChipTitle('na', 0, 1)));
  assert.ok(/takes 2 off/i.test(SD.scoreChipTitle('neg', -2, 1)));
  assert.ok(/right answer/i.test(SD.scoreChipTitle('plus', 1, 1)));
  assert.ok(/partly/i.test(SD.scoreChipTitle('part', 1, 2)));
  assert.ok(/wrong/i.test(SD.scoreChipTitle('zero', 0, 1)));
});

// The points are not typeable. This is the lock rather than the tidy-up: the panel already
// declines to render a computed score as a box, and this checks that even when a box for one
// somehow exists on the page, the editor does not read it back. edValues feeds both saving
// and the conditional-question check, so a value it refuses to return cannot be written.
const ED = loadWith('index.html', ['edValues', 'isScorerField'],
  'var edPhoneReg = {};' +
  'function isFileField(f) { return f.type === "photo"; }' +
  'function edChecksValue(el) { return el.value; }' +
  // every field has a filled-in box on this imaginary page, scorers included
  'var document = { getElementById: function (id) { return { value: "999" }; } };');

t('a typed-in score is not read back out of the editor', () => {
  const flds = [
    { id: 'q1', type: 'dropdown' },
    { id: 's1', type: 'short_text', options: { score: { kind: 'match', source: 'q1', points: 1, else: 0 } } },
    { id: 's2', type: 'short_text', options: { score_of: 'q1' } },
  ];
  const out = ED.edValues(flds);
  assert.strictEqual(out.q1, '999', 'an ordinary answer is still read');
  assert.ok(!('s1' in out), 'a field with a scoring rule must not be readable from the editor');
  assert.ok(!('s2' in out), 'nor a hand-wired scorer');
});
t('leaving a score out of the editor values means the stored one is kept, not cleared', () => {
  // saveCustom starts from the existing data and only overwrites what edValues returned, so
  // a key that is absent is a key left untouched -- which is what lets the database's own
  // computed value survive an edit to some other answer on the same record.
  const flds = [{ id: 's1', type: 'short_text', options: { score: { source: 'q1' } } }];
  assert.strictEqual(Object.keys(ED.edValues(flds)).length, 0);
});

// ---- an answer may contain a comma ----------------------------------------------------
// A dropdown holds ONE answer, and that answer is allowed a comma in it: "Clean, Neat or
// Organized" and "Yes, and they are good / نعم، موجود و قوي" are single choices on Shop
// Audit, and 21 stored answers across its 16 audits are one or the other. Splitting the
// stored value on commas and reading the first piece looks for a choice called "Clean" and
// prices the question at nothing. score_submission() in SQL never did this — it matches the
// whole answer — so this was also the two engines disagreeing about the same record.
const comma = { id: 'q', type: 'dropdown', scoring: { rule: 'choices' },
                options: [{ en: 'Clean, Neat or Organized', points: 1 },
                          { en: 'Dirty, Messy or Unorganized', points: 0 }] };
t('a single answer containing a comma earns its points', () => {
  assert.strictEqual(questionEarned(comma, { q: 'Clean, Neat or Organized' }), 1);
});
t('and the wrong one containing a comma earns nothing', () => {
  assert.strictEqual(questionEarned(comma, { q: 'Dirty, Messy or Unorganized' }), 0);
});
// A multi-select is the case commas are FOR: several answers, joined. That must not change.
const multi = { id: 'm', type: 'multi_select', scoring: { rule: 'choices' },
                options: [{ en: 'Clean', points: 1 }, { en: 'Organized', points: 1 }, { en: 'Dirty' }] };
t('a multi-select still reads its comma as a separator', () => {
  assert.strictEqual(questionEarned(multi, { m: 'Clean, Organized' }), 2);
});

// ---- "all of these, or nothing" --------------------------------------------------------
// Airtable expressed five of Shop Audit's questions as a formula over the whole answer
// string: Clean AND Organized, Hopper is clean AND No Dust. `choices` cannot say that — it
// adds each ticked answer up on its own, so half the tokens would earn half the point, which
// on a checklist of two is a shop scoring for being clean and disorganised.
const allOf = { id: 'a', type: 'multi_select', scoring: { rule: 'all_of', points: 1 },
                options: [{ en: 'Clean', points: 1 }, { en: 'Organized', points: 1 },
                          { en: 'Dirty' }, { en: 'Messy' }] };
t('all_of earns its points only when every priced answer is ticked', () => {
  assert.strictEqual(questionEarned(allOf, { a: 'Clean, Organized' }), 1);
});
t('all_of earns nothing for half of them', () => {
  assert.strictEqual(questionEarned(allOf, { a: 'Clean' }), 0);
});
t('all_of earns nothing for none of them', () => {
  assert.strictEqual(questionEarned(allOf, { a: 'Dirty, Messy' }), 0);
});
t('all_of earns nothing when the question was not answered', () => {
  assert.strictEqual(questionEarned(allOf, {}), 0);
});
t('an unpriced answer alongside the priced ones does not block the point', () => {
  assert.strictEqual(questionEarned(allOf, { a: 'Clean, Organized, Messy' }), 1);
});
t('all_of is worth what the question is priced at, not the sum of its answers', () => {
  assert.strictEqual(questionMaxPoints(allOf), 1);
});
t('an all_of question with nothing priced can never earn', () => {
  const none = { id: 'a', type: 'multi_select', scoring: { rule: 'all_of', points: 1 },
                 options: [{ en: 'Clean' }, { en: 'Dirty' }] };
  assert.strictEqual(questionEarned(none, { a: 'Clean' }), 0);
});

if (!process.exitCode) console.log(n + ' passed');
