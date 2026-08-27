// Approve / Reject, buildable on any table.
//
// Job Applications has had a real decision flow since the beginning: ✓ and ✕ on every card,
// New / Approved / Rejected tabs, and approve → pick a date & time → send a WhatsApp invite.
// No custom table could get any of it. The closest was naming a stage "Approved", which gave
// you a "→ Approved" button and nothing else — no date, no message, no one-click reject.
//
// This is that flow as a table setting. It is built ON the stage machinery rather than beside
// it: the decision writes app_submissions.status, the same column the stages read, so the
// tabs, the counts, the filters and the CSV export all follow with nothing added.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
function scripts(file){const src=fs.readFileSync(file,'utf8');return[...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');}
// Indentation, not brace-counting. fillTemplate contains /\{([^}]+)\}/ — a regex literal
// whose braces send a counter negative half way through and truncate the function. Every
// function here sits at two spaces, so its closing brace does too. A one-liner has no
// closing line of its own, hence the second form.
function grab(js, name) {
  const multi = js.match(new RegExp('\\n  function ' + name + '\\s*\\([\\s\\S]*?\\n  \\}'));
  if (multi) return multi[0];
  const one = js.match(new RegExp('\\n  function ' + name + '\\s*\\(.*'));
  if (one) return one[0];
  throw new Error('no fn ' + name);
}
function grabVar(js,name){const m=js.match(new RegExp('\\n  var '+name+' = [\\s\\S]*?;(?=\\r?\\n)'));if(!m)throw new Error('no var '+name);return m[0];}
function load(names,vars,extra){const js=scripts('index.html');const body=(vars||[]).map(v=>grabVar(js,v)).join('\n')+'\n'+names.map(n=>grab(js,n)).join('\n');const ctx=Object.assign({console},extra||{});vm.createContext(ctx);new vm.Script('(function(){'+body+'\nthis.API={'+names.concat(vars||[]).join(',')+'};}).call(this)').runInContext(ctx);return ctx.API;}

const SRC = scripts('index.html');
const API = load(
  ['decisionCfg','decisionButtons','decisionWhen','decisionSent','decisionDateText',
   'decisionMessageUrl','fillTemplate','fieldValueByType'],
  ['DECISION_STAGES','TEMPLATE_EXTRA_NAMES']
);
const asW = o => JSON.parse(JSON.stringify(o));
let n = 0; const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };

const FIELDS = [
  { id: 'f1', label: 'Full name', label_ar: 'الاسم', type: 'short_text' },
  { id: 'f2', label: 'Phone', label_ar: null, type: 'phone' }
];
const REC = { id: 'r1', status: null, data: { f1: 'Sara', f2: '+962 79 123 4567' }, extra: {} };

// ---- Off unless it is switched on ------------------------------------------------------
t('a table with no decision config has no decision', () => {
  // 226 imported tables and every table made before this. None of them grows a ✓ overnight.
  assert.strictEqual(API.decisionCfg({ config: {} }), null);
  assert.strictEqual(API.decisionCfg({}), null);
  assert.strictEqual(API.decisionCfg(null), null);
});
t('switched off is off, even with everything else filled in', () => {
  // The config is kept when the box is unticked so ticking it back on restores the labels
  // and the message. Kept must not mean live.
  assert.strictEqual(API.decisionCfg({ config: { decision: { on: false, approve: 'Hire', message: 'hi' } } }), null);
});
t('the labels fall back rather than coming out blank', () => {
  // A nameless button is a button nobody presses on purpose.
  const c = API.decisionCfg({ config: { decision: { on: true } } });
  assert.strictEqual(c.approve, 'Approve');
  assert.strictEqual(c.reject, 'Reject');
  assert.strictEqual(c.when_label, 'Date & time');
});
t('a label of only spaces falls back too', () => {
  const c = API.decisionCfg({ config: { decision: { on: true, approve: '   ', when_label: ' ' } } });
  assert.strictEqual(c.approve, 'Approve');
  assert.strictEqual(c.when_label, 'Date & time');
});
t('the labels that ARE set are the ones used', () => {
  const c = API.decisionCfg({ config: { decision: { on: true, approve: 'Hire', reject: 'Pass', when_label: 'Start date' } } });
  assert.strictEqual(c.approve, 'Hire');
  assert.strictEqual(c.reject, 'Pass');
  assert.strictEqual(c.when_label, 'Start date');
});
t('scheduling and the message are independent of each other', () => {
  // Approve-and-message with no date is a real shape: "you're in, here's where to go".
  const c = API.decisionCfg({ config: { decision: { on: true, schedule: false, message: 'welcome' } } });
  assert.strictEqual(c.schedule, false);
  assert.strictEqual(c.message, 'welcome');
});

// ---- Which buttons a record is offered --------------------------------------------------
t('an undecided record is offered both', () => {
  assert.deepStrictEqual(asW(API.decisionButtons({ status: null })), { approve: true, reject: true });
  assert.deepStrictEqual(asW(API.decisionButtons({ status: 'new' })), { approve: true, reject: true });
});
t('a decided record is offered the other one, so a mis-click is one click to undo', () => {
  assert.deepStrictEqual(asW(API.decisionButtons({ status: 'approved' })), { approve: false, reject: true });
  assert.deepStrictEqual(asW(API.decisionButtons({ status: 'rejected' })), { approve: true, reject: false });
});
t('nothing at all does not throw', () => {
  assert.deepStrictEqual(asW(API.decisionButtons(null)), { approve: true, reject: true });
});

// ---- Where the decision is kept ----------------------------------------------------------
t('the decision writes `status`, which is the column the stages already read', () => {
  // This is what makes the tabs, the counts, the filters and the CSV work with nothing added.
  const s = grab(SRC, 'setDecision');
  assert.ok(/update\(\{ status: status, extra: extra \}\)/.test(s), 'the decision is not written to status');
});
t('extra is MERGED, never replaced', () => {
  // A record's extra also carries the import marker, the test marker and the device key.
  // Replacing the object drops all of them, silently, one approval at a time.
  const s = grab(SRC, 'setDecision');
  assert.ok(/Object\.assign\(\{\}, s\.extra \|\| \{\}\)/.test(s), 'extra is replaced rather than merged');
  const m = grab(SRC, 'markDecisionSent');
  assert.ok(/Object\.assign\(\{\}, s\.extra \|\| \{\}, \{ msg_sent: true \}\)/.test(m), 'marking the message sent replaces extra');
});
t('the date and the sent flag live in extra, not in data', () => {
  // `data` means "answers to questions" everywhere else — the grid, the CSV and the public
  // form all read it that way. A date nobody was asked for does not belong in it.
  assert.strictEqual(API.decisionWhen({ extra: { decided_at: '2026-09-01T10:00:00Z' } }), '2026-09-01T10:00:00Z');
  assert.strictEqual(API.decisionWhen({ extra: {} }), null);
  assert.strictEqual(API.decisionWhen({}), null);
  assert.strictEqual(API.decisionWhen(null), null);
  assert.strictEqual(API.decisionSent({ extra: { msg_sent: true } }), true);
  assert.strictEqual(API.decisionSent({ extra: {} }), false);
  assert.strictEqual(API.decisionSent(null), false);
});
t('approving clears the sent flag, so a re-approval offers the message again', () => {
  // Otherwise moving a record back and approving it for a new date shows "✓ Message sent"
  // about a message describing the OLD date.
  const s = grab(SRC, 'setDecision');
  assert.ok(/extra\.msg_sent = false/.test(s), 'the sent flag survives a re-approval');
});
t('rejecting does not touch the date or the sent flag', () => {
  const s = grab(SRC, 'setDecision');
  assert.ok(/if \(status === "approved"\)/.test(s), 'the date is written whatever the decision');
});

// ---- The message -------------------------------------------------------------------------
t('a question answer fills its own name', () => {
  assert.strictEqual(API.fillTemplate('Hi {Full name}', REC, FIELDS), 'Hi Sara');
  assert.strictEqual(API.fillTemplate('Hi {الاسم}', REC, FIELDS), 'Hi Sara');
});
t('the date, time and place fill theirs, in English and in Arabic', () => {
  // The message is Arabic; switching keyboards mid-sentence to type "{Location}" is a
  // reason not to bother.
  const ex = { date: 'Monday', time: '10:00', location: 'Abdoun' };
  assert.strictEqual(API.fillTemplate('{Date} {Time} {Location}', REC, FIELDS, ex), 'Monday 10:00 Abdoun');
  assert.strictEqual(API.fillTemplate('{التاريخ} {الوقت} {المكان}', REC, FIELDS, ex), 'Monday 10:00 Abdoun');
});
t('a QUESTION called "Date" beats the built-in one', () => {
  // It is the person's own question and they meant it. Shadowing it would fill their
  // template with a date they never asked about.
  const f = FIELDS.concat([{ id: 'f3', label: 'Date', type: 'date' }]);
  const r = { data: { f3: '2026-01-01' }, extra: {} };
  assert.strictEqual(API.fillTemplate('{Date}', r, f, { date: 'Monday' }), '2026-01-01');
});
t('an unknown token becomes nothing, not the token', () => {
  // A WhatsApp arriving with a literal "{Salary}" in it is worse than one without.
  assert.strictEqual(API.fillTemplate('a {Nope} b', REC, FIELDS, {}), 'a  b');
  assert.strictEqual(API.fillTemplate('a {Date} b', REC, FIELDS), 'a  b');
});
t('an unanswered question becomes nothing rather than "undefined"', () => {
  const r = { data: {}, extra: {} };
  assert.strictEqual(API.fillTemplate('Hi {Full name}', r, FIELDS), 'Hi ');
});
t('the message goes to the phone ANSWER, digits only', () => {
  const cfg = API.decisionCfg({ config: { decision: { on: true, message: 'Hi {Full name}' } } });
  const url = API.decisionMessageUrl(cfg, REC, FIELDS);
  assert.ok(url.indexOf('https://wa.me/962791234567') === 0, 'the number is not cleaned: ' + url);
  assert.ok(/text=Hi%20Sara/.test(url), 'the message is not in the link: ' + url);
});
t('no template means no message, and no button offering one', () => {
  const cfg = API.decisionCfg({ config: { decision: { on: true } } });
  assert.strictEqual(API.decisionMessageUrl(cfg, REC, FIELDS), null);
});
t('no phone answer means no message rather than a broken link', () => {
  // "Send" opening wa.me with an empty number is worse than no button at all.
  const cfg = API.decisionCfg({ config: { decision: { on: true, message: 'Hi' } } });
  assert.strictEqual(API.decisionMessageUrl(cfg, { data: {}, extra: {} }, FIELDS), null);
  assert.strictEqual(API.decisionMessageUrl(cfg, REC, [FIELDS[0]]), null, 'a table with no phone question still built a link');
});
t('a phone answer of punctuation only counts as no phone', () => {
  const cfg = API.decisionCfg({ config: { decision: { on: true, message: 'Hi' } } });
  assert.strictEqual(API.decisionMessageUrl(cfg, { data: { f2: '+ - ()' }, extra: {} }, FIELDS), null);
});
t('the message carries the date the approval was set for', () => {
  const cfg = API.decisionCfg({ config: { decision: { on: true, message: '{Time}', location: 'X' } } });
  const r = { data: { f2: '0791234567' }, extra: { decided_at: '2026-09-01T07:30:00Z' } };
  const url = API.decisionMessageUrl(cfg, r, FIELDS);
  assert.ok(url.length > 'https://wa.me/0791234567?text='.length, 'the time did not reach the message');
});
t('an approval with no date still produces a message, minus the date', () => {
  // schedule:false + a message is a real shape and must not throw on the missing date.
  const cfg = API.decisionCfg({ config: { decision: { on: true, message: 'Come to {Location}', location: 'Abdoun' } } });
  const url = API.decisionMessageUrl(cfg, REC, FIELDS);
  assert.ok(/Come%20to%20Abdoun/.test(url), url);
});
t('a date that cannot be read is blank, not "Invalid Date"', () => {
  assert.deepStrictEqual(asW(API.decisionDateText('not a date')), { date: '', time: '' });
  assert.deepStrictEqual(asW(API.decisionDateText(null)), { date: '', time: '' });
});
t('the date prints in Latin numerals so an Arabic message is not half-and-half', () => {
  const d = API.decisionDateText('2026-09-01T07:30:00Z');
  assert.ok(/\d/.test(d.date), 'the date has no Latin digits: ' + d.date);
  assert.ok(/\d/.test(d.time), 'the time has no Latin digits: ' + d.time);
});

// ---- Sending -------------------------------------------------------------------------------
t('the message is OFFERED, never sent behind your back', () => {
  // wa.me opens WhatsApp with the message typed out and a human presses send — the same
  // thing the interview invite and every record action already do.
  const o = grab(SRC, 'offerDecisionMessage');
  assert.ok(/window\.confirm/.test(o), 'the message is sent with no confirmation');
  assert.ok(/window\.open\(url, "_blank"\)/.test(o), 'the message does not open WhatsApp');
  assert.ok(o.indexOf('window.confirm') < o.indexOf('window.open'), 'WhatsApp opens before the confirm is answered');
});
t('declining the message does not mark it sent', () => {
  const o = grab(SRC, 'offerDecisionMessage');
  assert.ok(o.indexOf('if (!window.confirm') < o.indexOf('markDecisionSent'), 'the record is marked sent even when you say no');
});
t('nothing to send is silent rather than a confirm you cannot act on', () => {
  const o = grab(SRC, 'offerDecisionMessage');
  assert.ok(o.indexOf('if (!url) return') < o.indexOf('window.confirm'), 'a record with no phone still asks whether to send');
});

// ---- Approving ------------------------------------------------------------------------------
t('no schedule means the decision is one click', () => {
  const a = grab(SRC, 'approveRecord');
  assert.ok(/if \(!cfg\.schedule\)/.test(a), 'approving always opens the date panel');
  assert.ok(/setDecision\(s, "approved", null\)/.test(a), 'an unscheduled approval does not go straight through');
});
t('a date that was asked for is required', () => {
  // An approval with no date saved anyway is a record that looks decided and tells nobody when.
  assert.ok(/if \(!v\) \{ m\.textContent = "Please choose the "/.test(SRC), 'an empty date is accepted');
});
t('an unreadable date is refused rather than written as null', () => {
  assert.ok(/if \(isNaN\(when\.getTime\(\)\)\)/.test(SRC), 'a date that cannot be parsed is saved anyway');
});
t('the modal names the record it is deciding', () => {
  // A modal headed "—" while you decide somebody's application is the only thing confirming
  // you clicked the row you meant.
  const d = grab(SRC, 'decisionTitle');
  assert.ok(/summaryFields/.test(d), 'the modal does not use the name the card shows');
  assert.ok(/recordNumber\(s\)/.test(d), 'a record with no name has nothing to show');
});
t('the modal is labelled with the table\'s own words', () => {
  const a = grab(SRC, 'approveRecord');
  assert.ok(/dec-go"\)\.textContent = cfg\.approve/.test(a), 'the button always says "Approve"');
  assert.ok(/dec-when-lab"\)\.textContent = cfg\.when_label/.test(a), 'the date is always labelled "Date & time"');
});

// ---- On the record ---------------------------------------------------------------------------
t('the buttons replace the stage movers rather than joining them', () => {
  // Two ways to file the same record in the same place, side by side, is how one of them
  // quietly stops being used and then stops being maintained.
  const r = grab(SRC, 'renderCustom');
  assert.ok(/if \(decision && mayManageTbl\) \{[\s\S]{0,600}\} else if \(stages\.length && mayEdit\)/.test(r),
    'the decision buttons and the stage buttons are not exclusive');
});
t('deciding is for managers, not for anyone who can edit', () => {
  // canEdit is enough to fix a typo. Approving somebody is not a typo.
  const r = grab(SRC, 'renderCustom');
  assert.ok(/if \(decision && mayManageTbl\)/.test(r), 'an editor can approve records');
});
t('clicking a decision does not also open the record', () => {
  const r = grab(SRC, 'renderCustom');
  assert.ok(/data-decide[\s\S]{0,300}e\.stopPropagation\(\)/.test(r), 'the click falls through to the card');
});
t('an approved record shows its date and whether the message went', () => {
  // One that shows neither reads exactly like a record nobody has got to yet.
  const r = grab(SRC, 'renderCustom');
  assert.ok(/decisionWhen\(s\)[\s\S]{0,120}card-when/.test(r), 'the date is not shown');
  assert.ok(/decisionSent\(s\)[\s\S]{0,80}card-sent/.test(r), 'a sent message is not marked');
  assert.ok(/No phone answer to message/.test(r), 'a record that can never be messaged does not say so');
});

// ---- The builder ------------------------------------------------------------------------------
t('switching it on is written as off rather than as nothing', () => {
  // So a table that had the decision and lost it keeps its labels and its message, and
  // ticking the box back on gets them back instead of a blank form to retype.
  const s = grab(SRC, 'serializeDecision');
  assert.ok(/return \{ on: on,/.test(s), 'an unticked decision writes no config at all');
});
t('turning it on adds the stages it needs, when there are none', () => {
  // The decision writes `status`; with no stages there is nothing to read the two piles
  // apart with, so the ✓ would file records somewhere with no tab.
  const s = grab(SRC, 'syncDecisionRows');
  assert.ok(/DECISION_STAGES\.forEach/.test(s), 'no stages are offered');
  assert.ok(/have\.indexOf\("approved"\) !== -1 && have\.indexOf\("rejected"\) !== -1/.test(s),
    'a table that already has the stages gets them a second time');
});
t('the three stages are the ones the decision actually writes', () => {
  const keys = API.DECISION_STAGES.map(s => s.key);
  assert.deepStrictEqual(asW(keys), ['new', 'approved', 'rejected']);
});
t('the stages are added as ROWS, so they can be renamed before saving', () => {
  const s = grab(SRC, 'syncDecisionRows');
  assert.ok(/addStageRow\(st\)/.test(s), 'the stages are written to config behind the editor\'s back');
});
t('the decision is written on create and on edit', () => {
  assert.ok(/decision: serializeDecision\(\)/.test(grab(SRC, 'builderConfig')), 'a new table cannot be given one');
  assert.ok(/decision: serializeDecision\(\)/.test(grab(SRC, 'saveTableEdit')), 'an existing table cannot be given one');
});
t('an unsaved draft remembers the decision', () => {
  assert.ok(/decision: serializeDecision\(\)/.test(grab(SRC, 'serializeBuilder')), 'the draft drops it');
});
t('a built-in form is not offered a second decision flow', () => {
  // Job Applications already HAS one, hand-coded and wired to its own columns. Two ✓s on
  // one card writing two different places is not a feature.
  const c = grab(SRC, 'setBuilderChrome');
  assert.ok(/bld-decision-wrap[\s\S]{0,90}isBuiltin \? "none" : ""/.test(c), 'the section is shown for built-in forms');
});

console.log(n + ' decision-flow tests passed');
