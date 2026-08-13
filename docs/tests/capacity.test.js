// Capacity and backup places: the wording the public page puts in front of somebody deciding
// whether to sign up. The counting itself is done in the database under a row lock
// (11-capacity-and-backup.sql) because a count read outside one is a count that was true a
// moment ago — what is testable here is that the page never misdescribes the count it is
// given, and in particular never lets a backup believe they have a place.
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

const F = load('f/index.html', ['slotsText']);

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };
// what form_slots returns for an event with 8 places and 2 backup
const ev = (over) => Object.assign({ limited: true, slots: 8, backup: 2, taken: 0, waiting: 0, open: true, full: false }, over);

// ---- a form with no capacity is unchanged ----
t('a form with no capacity declared says nothing at all', () => {
  assert.strictEqual(F.slotsText({ limited: false, accepting: true }), null);
  assert.strictEqual(F.slotsText(null), null);
});
t('a form with no capacity is never blocked by this', () => {
  // every one of the 226 existing forms is this case
  assert.strictEqual(F.slotsText({ limited: false }), null);
});

// ---- real places left ----
t('an empty event offers all its places', () => {
  const s = F.slotsText(ev());
  assert.strictEqual(s.text, '8 places left of 8');
  assert.strictEqual(s.blocked, false);
});
t('places left counts down', () => {
  assert.strictEqual(F.slotsText(ev({ taken: 5 })).text, '3 places left of 8');
});
t('one place left is singular', () => {
  assert.strictEqual(F.slotsText(ev({ taken: 7 })).text, '1 place left of 8');
});
t('a real place is not marked as gone', () => {
  assert.strictEqual(F.slotsText(ev({ taken: 7 })).gone, false);
});

// ---- backup places ----
t('when the real places are gone it says so AND says you would be backup', () => {
  const s = F.slotsText(ev({ taken: 8 }));
  assert.ok(/All 8 places are taken/.test(s.text), s.text);
  assert.ok(/2 backup places left/.test(s.text), s.text);
  // the sentence that matters: nobody should sign up thinking they have a place
  assert.ok(/backup list/.test(s.text), s.text);
  assert.strictEqual(s.blocked, false, 'a backup place is still open to take');
  assert.strictEqual(s.gone, true, 'it must not read as an ordinary place');
});
t('one backup place left is singular', () => {
  assert.ok(/1 backup place left/.test(F.slotsText(ev({ taken: 8, waiting: 1 })).text));
});
t('an event with no backup places and no room is simply full', () => {
  // 0 backup and all places gone: nothing is left either way, so it must block rather than
  // offer a backup place that does not exist
  const s = F.slotsText(ev({ backup: 0, taken: 8 }));
  assert.strictEqual(s.blocked, true);
  assert.ok(!/backup place/.test(s.text), s.text);
});
t('backup places already over-booked never read as a negative number', () => {
  // only reachable if a capacity is edited below what is already booked, but "-1 backup
  // places left" in front of a barista is worse than being wrong quietly
  const s = F.slotsText(ev({ taken: 8, waiting: 3 }));
  assert.ok(!/-\d/.test(s.text), s.text);
  assert.strictEqual(s.blocked, true);
});

// ---- closed ----
t('full is blocked and says every place is gone', () => {
  const s = F.slotsText(ev({ taken: 8, waiting: 2, full: true }));
  assert.strictEqual(s.blocked, true);
  assert.ok(/taken/.test(s.text), s.text);
});
t('not open is blocked, and says so rather than saying full', () => {
  // a draft event and a full event are different things to whoever opened the link
  const s = F.slotsText(ev({ open: false }));
  assert.strictEqual(s.blocked, true);
  assert.ok(/not open/i.test(s.text), s.text);
  assert.ok(!/taken/i.test(s.text), s.text);
});
t('not open wins over full', () => {
  // an event moved to done is closed, and "no places left" would be a lie about why
  const s = F.slotsText(ev({ open: false, full: true }));
  assert.ok(/not open/i.test(s.text), s.text);
});

// ---- shapes the server can legitimately produce ----
t('missing counts are treated as zero, not NaN', () => {
  const s = F.slotsText({ limited: true, slots: 8, open: true, full: false });
  assert.strictEqual(s.text, '8 places left of 8');
});
t('more taken than there are places does not report negative places left', () => {
  // should be impossible, but a hand-edited capacity could shrink below what is booked
  const s = F.slotsText(ev({ slots: 8, taken: 9 }));
  assert.ok(!/-1/.test(s.text), s.text);
  assert.ok(/taken/.test(s.text), s.text);
});
t('a capacity that came back as no limit says nothing', () => {
  // jsonb_int treats "eight" as no limit, and the page must not invent a number
  assert.strictEqual(F.slotsText({ limited: false, open: true }), null);
});

console.log(n + ' capacity tests passed');
