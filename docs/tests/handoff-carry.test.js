// Who the person is travels with the hand-off link.
//
// Contact Us asks name, number and email, then Topic; "Complaint" reveals a link to the
// complaints form. The link opened a brand-new page, so the customer re-typed everything they
// had just entered. The link now carries pf_name / pf_phone / pf_email, and the form it opens
// fills those questions in if they are still empty.
//
// The rule that matters most is the one a bug here would break silently: the answers go ONLY
// to a BLK address. A link to anywhere else must come out untouched.
const fs = require('fs'), vm = require('vm'), assert = require('assert');

const src = fs.readFileSync('f/index.html', 'utf8');
const js = [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
const grab = name => {
  const m = js.match(new RegExp('\\n  function ' + name + '\\s*\\([\\s\\S]*?\\n  \\}'));
  if (!m) throw new Error('could not find function ' + name);
  return m[0];
};
const re = js.match(/\n  var CARRY_(?:NAME|EMAIL)_RE = .*;/g);
if (!re || re.length !== 2) throw new Error('could not find CARRY_NAME_RE and CARRY_EMAIL_RE');
const names = ['carryKind', 'carryAnswers', 'carryTrusted', 'linkWithCarry', 'applyCarried'];
const ctx = { console, URL };
vm.createContext(ctx);
new vm.Script('(function(){' + re.join('') + names.map(grab).join('\n') + '\n this.API={' + names.join(',') + '};}).call(this)').runInContext(ctx);
const { carryAnswers, carryTrusted, linkWithCarry, applyCarried } = ctx.API;

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };

// a control as the page builds it
const ctl = (type, label, val) => {
  const c = { f: { id: 'f-' + label, type, label }, v: val || null };
  c.value = () => c.v;
  c.setDraft = x => { c.v = x; };
  return c;
};
const HERE = 'https://blktable.blk.jo/f/?t=contact-us';

t('name, phone and email are read from whatever the form calls them', () => {
  const got = carryAnswers([ctl('short_text', 'Full Name', 'Ali N'), ctl('phone', 'Phone', '+962791234567'),
    ctl('email', 'Email', 'a@b.jo'), ctl('dropdown', 'Topic', 'Complaint')]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(got)), { name: 'Ali N', phone: '+962791234567', email: 'a@b.jo' });
});
t('an Arabic name label counts, and a question that is not a name does not', () => {
  assert.strictEqual(carryAnswers([ctl('short_text', 'الاسم الكامل', 'علي')]).name, 'علي');
  assert.strictEqual(carryAnswers([ctl('short_text', 'Where is the location?', 'Amman')]).name, undefined);
});
t('an empty answer is not carried', () =>
  assert.strictEqual(JSON.stringify(carryAnswers([ctl("short_text", "Name", "  "), ctl("phone", "Phone", null)])), "{}"));
t('the link gets the answers, encoded, keeping its own query and hash', () => {
  const u = linkWithCarry('https://blktable.blk.jo/f/?t=customer-complaints#x', { phone: '+962791234567', name: 'A&B' }, HERE);
  assert.strictEqual(u, 'https://blktable.blk.jo/f/?t=customer-complaints&pf_name=A%26B&pf_phone=%2B962791234567#x');
});
t('a link with no query gets a ?', () =>
  assert.strictEqual(linkWithCarry('https://blktable.blk.jo/apply/', { name: 'Ali' }, HERE), 'https://blktable.blk.jo/apply/?pf_name=Ali'));
t('SAFETY: a link to another site is left exactly as it was', () => {
  ['https://evil.example/f/', 'https://blk.jo.evil.example/x', 'https://notblk.jo/x', 'javascript:alert(1)'].forEach(u =>
    assert.strictEqual(linkWithCarry(u, { phone: '+962791234567' }, HERE), u, u));
});
t('BLK addresses are trusted, lookalikes are not', () => {
  assert.ok(carryTrusted('https://blk.jo/privacy', HERE));
  assert.ok(carryTrusted('https://blktable.blk.jo/apply/', HERE));
  assert.ok(!carryTrusted('https://evilblk.jo/', HERE));
});
t('nothing to carry leaves the link alone', () =>
  assert.strictEqual(linkWithCarry('https://blktable.blk.jo/apply/', {}, HERE), 'https://blktable.blk.jo/apply/'));

t('the receiving form fills empty questions only', () => {
  const nm = ctl('short_text', 'Name'), ph = ctl('phone', 'Phone'), em = ctl('email', 'Email', 'kept@x.jo');
  const filled = applyCarried([nm, ph, em], { name: 'Ali', phone: '+962791234567', email: 'new@x.jo' });
  assert.strictEqual(filled, 2);
  assert.strictEqual(nm.v, 'Ali'); assert.strictEqual(ph.v, '+962791234567');
  assert.strictEqual(em.v, 'kept@x.jo', 'a restored or typed answer is never overwritten');
});
t('a form with no such question simply ignores the link', () =>
  assert.strictEqual(applyCarried([ctl('dropdown', 'Topic')], { name: 'Ali', phone: '+962791', email: 'a@b' }), 0));
t('the form reads the link back before it guesses the country', () => {
  assert.ok(js.indexOf('applyCarried(controls') < js.indexOf('var guessedCountry = prefillCountry()'));
  assert.ok(/a\.addEventListener\(ev, carryHref\)/.test(js), 'the link refreshes its href when used');
});
t('the link button never shows the address, and following it saves the draft first', () => {
  assert.ok(!/createTextNode\(lo\.text \|\| lo\.url/.test(js), 'the URL must not be a fallback label');
  assert.ok(/"Click here"/.test(js), 'no usable text means a Click here button');
  assert.ok(/var carryHref = function \(\) \{ saveDraftNow\(\);/.test(js), 'draft is flushed on every way of following the link');
});

t('an email asked in a plain text box is still an email', () => {
  const box = ctl('short_text', 'E-mail *'); box.v = 'a@b.jo';
  const ar = ctl('short_text', 'البريد الإلكتروني'); ar.v = 'x@y.jo';
  assert.strictEqual(carryAnswers([box]).email, 'a@b.jo');
  assert.strictEqual(carryAnswers([ar]).email, 'x@y.jo');
  const empty = ctl('short_text', 'E-mail'); const filled = applyCarried([empty], { email: 'n@b.jo' });
  assert.strictEqual(filled, 1); assert.strictEqual(empty.v, 'n@b.jo');
});
t('the link question draws no label over its button', () =>
  assert.ok(/if \(f\.type !== "link"\) wrap\.appendChild\(lab\);/.test(js)));

console.log(n + ' tests passed');
