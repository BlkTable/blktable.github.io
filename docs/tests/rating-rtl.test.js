// The "rating" question type, and a form's right-to-left / thank-you settings.
//
// Both live in the builder (index.html) and the public form (f/index.html). The database is
// type-agnostic (submit_public_form copies any answer whose field id exists) and config.intro
// is passed through whole by form_public_config, so what can go wrong is in these two pages:
// the builder losing the settings on save, or the public form not reading them.

const fs = require('fs'), assert = require('assert');
const APP = fs.readFileSync('index.html', 'utf8');
const PUB = fs.readFileSync('f/index.html', 'utf8');
let n = 0;
function t(name, fn) { fn(); n++; console.log('ok - ' + name); }

t('builder offers the rating type and gives it an options box', () => {
  assert(/\{ v: "rating"/.test(APP));
  assert(/function typeUsesOpts\(v\)[^}]*"rating"/.test(APP));
});

t('builder saves a rating range as {min,max,low,high} and refuses a bad range', () => {
  assert(/if \(type === "rating"\)/.test(APP));
  assert(/min: \+rm\[1\], max: \+rm\[2\]/.test(APP));
  assert(/A rating needs a range/.test(APP));
});

t('builder writes rtl and thanks into config.intro, and reads them back', () => {
  assert(/if \(rtl\) o\.rtl = true;/.test(APP));
  assert(/if \(thanks\) o\.thanks = thanks;/.test(APP));
  assert(/bld-rtl"\)\.checked = !!\(intro && intro\.rtl\)/.test(APP));
});

t('public form draws a rating as buttons min..max and stores the number as text', () => {
  assert(/f\.type === "rating"/.test(PUB));
  assert(/rb\.value = String\(rn\)/.test(PUB));
  assert(/value: function \(\) \{ return rval; \}/.test(PUB));
});

t('public form turns right-to-left, relabels Submit, and shows the thank-you text', () => {
  assert(/document\.documentElement\.dir = "rtl"/.test(PUB));
  assert(/submitLabel = "إرسال"/.test(PUB));
  assert(/btn\.textContent = submitLabel/.test(PUB));
  assert(/box\.querySelector\("p"\)\.textContent = thanksText/.test(PUB));
});

console.log(n + ' passed');
