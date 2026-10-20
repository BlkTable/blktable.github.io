// "Form not found" must mean the form is not there, and nothing else. Two ways it used to lie:
// a failed read (offline, blocked host, a rejected token) went down the same path as a missing
// row, and the client picked up a staff session left in localStorage by the app on the same
// origin, so a stale token made every read a 401. Source-read on purpose: both are wiring.
//
//   node docs/tests/form-load-errors.test.js
const fs = require('fs');
const page = fs.readFileSync('f/index.html', 'utf8');
let fails = 0;
function check(name, ok) { if (!ok) { fails++; console.log('FAIL: ' + name); } }

check('the public form never persists or reuses a session',
  /createClient\(SUPABASE_URL, SUPABASE_KEY,[^;]*auth:\s*\{[^}]*persistSession:\s*false/.test(page));
check('only a no-row answer (PGRST116) can mean "not found" for the form row',
  /tRes\.error && tRes\.error\.code !== "PGRST116"\) \{ loadFailed\(tRes\.error\)/.test(page));
check('a failed field read is a load failure, not "not found"',
  /if \(fRes\.error\) \{ loadFailed\(fRes\.error\)/.test(page) && !/if \(fRes\.error\) \{ notFound\(\)/.test(page));
check('the load-failure card has its own element and a retry button',
  /id="loadfail"/.test(page) && /id="loadfail-retry"/.test(page));
check('the form load is a function the retry button can call again', /function loadForm\(\)/.test(page) && /loadForm\(\);\s*\}\s*<\/script>/.test(page));

console.log(fails ? fails + ' failed' : 'all form-load-errors tests passed');
process.exit(fails ? 1 : 0);
