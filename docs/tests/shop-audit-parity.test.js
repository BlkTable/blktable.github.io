// Shop Audit's scorecard, moved from the rules compute_scores() reads (a hidden
// "<Question> Score" column carrying options.score, summed by config.scoring) to the ones the
// builder writes (app_fields.scoring on the question, with a price on each answer, computed by
// score_submission()). The migration is only allowed to change WHERE a rule lives — not what
// any real record scores. Fourteen of them carry a percentage a shop has already been shown.
//
// THE FIXTURE IS NOT IN THIS REPO. blktable.github.io is public and served at blktable.blk.jo,
// and these are real audits: shop names, the auditor's name, free-text comments about staff.
// It lives beside the migrations, in the private folder, and this file skips without it:
//
//   C:\Users\ASUS\blktable-migration\fixtures\shop-audit-2026-09-01.json
//   (or set SHOP_AUDIT_FIXTURE=<path>)
//
// Rebuild it with build-fixture.js in the same folder. `--emit-sql` prints the migration body
// that installs exactly the mapping proved here, so the tested mapping and the applied one
// cannot drift.
const fs = require('fs'), vm = require('vm'), assert = require('assert');

const FIXTURE = process.env.SHOP_AUDIT_FIXTURE ||
  'C:/Users/ASUS/blktable-migration/fixtures/shop-audit-2026-09-01.json';
if (!fs.existsSync(FIXTURE)) {
  console.log('SKIPPED: no fixture at ' + FIXTURE + ' — it holds live records and is kept out of this public repo.');
  process.exit(0);
}
const FIX = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

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

// the new engine's arithmetic, out of the page, plus condMet which both engines share
const NEW = load('index.html', ['choicePoints', 'questionMaxPoints', 'naChoices',
                                'questionApplies', 'questionEarned', 'condMet']);

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };

const byId = {};
FIX.fields.forEach(f => { byId[f.id] = f; });
const choiceNames = q => (q.options || []).map(o => (typeof o === 'string' ? o : o.en));

// ---------------------------------------------------------------------------------------
// One old rule, as the new model holds it: the question's `scoring` column, and its answer
// list with prices on it. The ONLY place the mapping is decided — the migration is generated
// from this function, and every assertion below runs through it.
// ---------------------------------------------------------------------------------------
function mapRuleToScoring(rule, q) {
  // `match` on a choice question: the expected answer is worth the points, and every other
  // answer is worth `else` — which is 0 for all but the three penalties, where it is -2.
  // Trimmed on both sides because the old engine compares btrim to btrim, and one rule's
  // expected answer carries a trailing space that has always been invisible.
  const priced = (want) => (q.options || []).map(o => {
    const en = typeof o === 'string' ? o : o.en;
    const out = { en: en, ar: (typeof o === 'string' ? '' : o.ar) || '' };
    if (want.indexOf(String(en).trim()) !== -1) out.points = Number(rule.points);
    else if (Number(rule.else) !== 0) out.points = Number(rule.else);
    return out;
  });

  if (rule.kind === 'match' && (q.type === 'dropdown' || q.type === 'multi_select')) {
    return { scoring: { rule: 'choices' }, options: priced([String(rule.expect).trim()]) };
  }
  if (rule.kind === 'match_any' && (q.type === 'dropdown' || q.type === 'multi_select')) {
    return { scoring: { rule: 'choices' }, options: priced(rule.expect_any.map(s => String(s).trim())) };
  }
  // Every listed answer must be ticked or the question earns nothing. `choices` cannot say
  // that — it adds each ticked answer up independently, so half the tokens would earn half
  // the point. `all_of` is the rule added for exactly this.
  if (rule.kind === 'contains_all') {
    return { scoring: { rule: 'all_of', points: Number(rule.points) },
             options: priced(rule.tokens.map(s => String(s).trim())) };
  }
  if (rule.kind === 'compare') {
    return { scoring: { rule: 'threshold', op: rule.op, value: Number(rule.threshold), points: Number(rule.points) },
             options: q.options || null };
  }
  if (rule.kind === 'match' && q.type === 'number') {
    return { scoring: { rule: 'threshold', op: '=', value: Number(rule.expect), points: Number(rule.points) },
             options: q.options || null };
  }
  return null;
}

// The 68 that actually count. Two of the 70 write a column neither roll-up sums, so they have
// never moved a score and must not start now.
const counting = FIX.rules.filter(r => r.counts);

function mapped() {
  return counting.map(r => {
    const q = byId[r.source], m = mapRuleToScoring(r, q);
    if (!m) throw new Error('no mapping for ' + r.kind + ' on a ' + (q && q.type));
    return { rule: r, q: q, field: { id: q.id, type: q.type, options: m.options, scoring: m.scoring, show_if: q.show_if } };
  });
}

// ---- every rule maps, onto an answer that exists ----
t('every counting rule has a mapping', () => {
  const bad = counting.filter(r => mapRuleToScoring(r, byId[r.source]) === null);
  assert.strictEqual(bad.length, 0, bad.map(r => r.kind + '/' + byId[r.source].type).join(', '));
});
t('every priced question can actually earn its point', () => {
  const dead = mapped().filter(m => NEW.questionMaxPoints(m.field) <= 0)
    .map(m => m.q.label + ' (wants "' + (m.rule.expect || (m.rule.tokens || []).join(' + ')) + '", offers ' +
         choiceNames(m.q).join(' | ') + ')');
  assert.strictEqual(dead.length, 0, '\n    ' + dead.join('\n    '));
});
t('the whole card is still worth 68', () => {
  const total = mapped().reduce((a, m) => a + NEW.questionMaxPoints(m.field), 0);
  assert.strictEqual(total, 68, 'the card is worth ' + total);
});

// ---- the real records score what they score today ----
function newScore(record) {
  let earned = 0, possible = 0;
  mapped().forEach(m => {
    if (!NEW.questionApplies(m.field, record.data)) return;
    possible += NEW.questionMaxPoints(m.field);
    earned += NEW.questionEarned(m.field, record.data);
  });
  return { earned: earned, possible: possible };
}

// ---------------------------------------------------------------------------------------
// The three rules the new model deliberately does NOT reproduce, and why. Everything else
// must agree to the point. Listing them here rather than loosening the comparison means a
// fourth one cannot appear without this file failing.
// ---------------------------------------------------------------------------------------
const ACCEPTED = {
  'Bottle Fridge Temperature':
    'the temperature was left blank. Airtable read an empty number as 0, and 0 < 5, so not ' +
    'measuring the fridge earned the point. The new engine refuses a non-answer.',
  'Lockers':
    'the old rule wanted the whole answer to BE "Organized". This shop ticked Organized AND ' +
    'Messy, and earned nothing for the half it got right.',
  'Delivery Apps All Live':
    'the old rule wanted the whole answer to BE "All Working". This shop ticked all three ' +
    'apps and All Working, and earned nothing.'
};

// What each question scores now against what the old engine left in its score column.
function perQuestionDiff(rec) {
  const out = [];
  mapped().forEach(m => {
    if (rec.data[m.rule.scorer] == null) return;       // a record the outage left unscored
    const was = Number(rec.data[m.rule.scorer]);
    const now = NEW.questionApplies(m.field, rec.data) ? NEW.questionEarned(m.field, rec.data) : 0;
    if (was !== now) out.push({ label: m.q.label, was: was, now: now });
  });
  return out;
}

t('nothing changes that is not on the accepted list', () => {
  const surprises = [];
  FIX.records.forEach(rec => perQuestionDiff(rec).forEach(d => {
    if (!ACCEPTED[d.label]) surprises.push(rec.created_at.slice(0, 16) + ': ' + d.label +
      ' ' + d.was + ' -> ' + d.now);
  }));
  assert.strictEqual(surprises.length, 0, '\n    ' + surprises.join('\n    '));
});

const broken = FIX.records.filter(r => String(r.raw_today) === '0');
const scored = FIX.records.filter(r => String(r.raw_today) !== '0');

t('the outage is in the fixture', () => assert.ok(broken.length >= 1,
  'no zero-scoring record — rebuild the fixture, this test is about restoring them'));

scored.forEach(rec => {
  const when = rec.created_at.slice(0, 16);
  t('the audit of ' + when + ' scores what it scores today, give or take the accepted three', () => {
    const got = newScore(rec);
    assert.strictEqual(got.possible, 68, 'denominator moved to ' + got.possible);
    // The only allowed difference is the sum of the accepted corrections on THIS record.
    const delta = perQuestionDiff(rec).reduce((a, d) => a + (d.now - d.was), 0);
    const want = Number(rec.raw_today) + delta;
    assert.strictEqual(got.earned, want,
      'new model says ' + got.earned + ', expected ' + want + ' (' + rec.raw_today +
      (delta ? (delta > 0 ? ' +' : ' ') + delta : '') + ')');
    if (delta) console.log('       ' + when + ': ' + rec.raw_today + '/68 -> ' + got.earned +
      '/68   ' + perQuestionDiff(rec).map(d => d.label + ' ' + d.was + '->' + d.now).join(', '));
  });
});

broken.forEach(rec => {
  const when = rec.created_at.slice(0, 16);
  t('the audit of ' + when + ', which reads 0 today, scores again', () => {
    const got = newScore(rec);
    assert.ok(got.earned > 0, 'still 0 — the rules are not reaching this record');
    console.log('       ' + when + ': 0/68 -> ' + got.earned + '/68 (' +
      (got.earned / 68 * 100).toFixed(1) + '%)');
  });
});

// ---- emit the migration body from the mapping that was just proved ----
if (process.argv.indexOf('--emit-sql') !== -1) {
  const q = s => "'" + String(s).replace(/'/g, "''") + "'";
  const lines = mapped().map(m =>
    'update public.app_fields set options = ' + q(JSON.stringify(m.field.options)) + '::jsonb,' +
    ' scoring = ' + q(JSON.stringify(m.field.scoring)) + '::jsonb where id = ' + q(m.q.id) + ';');
  // and the total each record must come out at, so the database can check itself against the
  // arithmetic proved here rather than both being trusted separately
  const totals = FIX.records.map(rec => "  ('" + rec.id + "', " + newScore(rec).earned + ", " +
    q(rec.created_at.slice(0, 16)) + ")").join(',\n');
  fs.writeFileSync(process.env.EMIT_TO || 'shop-audit-rules.sql',
    '-- Generated by docs/tests/shop-audit-parity.test.js --emit-sql. Do not hand-edit:\n' +
    '-- this is the mapping the ' + FIX.records.length + ' live records were proved against.\n' +
    lines.join('\n') + '\n\n' +
    '-- What each record must score once the rules above are in place.\n' +
    'create temp table expected_(id uuid, earned numeric, taken text);\n' +
    'insert into expected_ values\n' + totals + ';\n');
  console.log('emitted ' + lines.length + ' updates and ' + FIX.records.length + ' expected totals');
}

if (!process.exitCode) console.log('ok - ' + n + ' assertions');
