// A link from another form brings the customer's name and phone to /apply/ and /cast/.
// (The generic /f/ forms are covered in handoff-link.chrome.js.) Driven in a real browser,
// because the bug that mattered here was only visible on screen: /cast/ restored the right
// number and then painted the Jordan dial code over it, so a Lebanese number would have been
// filed as +962.
//
//   ELECTRON_RUN_AS_NODE=1 "…/Code.exe" docs/tests/carry-pages.chrome.js
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const CHROMES = [process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean);
const chrome = CHROMES.filter(p => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } })[0];
if (!chrome) { console.log('SKIPPED: no Chrome or Edge found. Set CHROME=<path to chrome.exe> to run this file.'); process.exit(0); }

const probe = '<script>setTimeout(function(){var g=function(i){var e=document.getElementById(i);return e&&e.value};' +
  'document.title="OUT "+JSON.stringify({n:g("full_name"),p:g("phone_local"),c:g("country"),' +
  'dial:(document.getElementById("cc-dial")||{}).textContent,url:location.search});},1500)</script></body>';

function run(page, query) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'blk-carry-'));
  fs.mkdirSync(d + '/' + page); fs.mkdirSync(d + '/assets');
  try { fs.copyFileSync('assets/favicon.svg', d + '/assets/favicon.svg'); } catch (e) {}
  fs.writeFileSync(d + '/' + page + '/index.html', fs.readFileSync(page + '/index.html', 'utf8').replace('</body>', probe));
  const u = 'file:///' + (d + '/' + page + '/index.html').split(path.sep).join('/') + query;
  const r = cp.spawnSync(chrome, ['--headless=new', '--disable-gpu', '--allow-file-access-from-files',
    '--virtual-time-budget=6000', '--dump-dom', u], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {}
  const m = (r.stdout || '').match(/<title>OUT (\{[^<]*\})/);
  return m ? JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&')) : null;
}

let n = 0;
const t = (name, cond, extra) => { if (cond) n++; else { console.log('FAIL: ' + name + (extra ? ' -> ' + extra : '')); process.exitCode = 1; } };

for (const page of ['apply', 'cast']) {
  const lb = run(page, '?pf_name=Ali%20N&pf_phone=%2B961712345&k=x');
  t(page + ': page loaded', !!lb);
  if (!lb) continue;
  t(page + ': name arrives', lb.n === 'Ali N', JSON.stringify(lb));
  t(page + ': the local number arrives without the dial code', lb.p === '712345', JSON.stringify(lb));
  t(page + ': the dial code follows the number (Lebanon, not Jordan)', lb.dial === '+961', JSON.stringify(lb));
  t(page + ': the address is cleaned and the other parameters kept', lb.url === '?k=x', lb.url);
  const jo = run(page, '?pf_name=Ali&pf_phone=%2B962791234567');
  t(page + ': a Jordan number keeps +962', jo && jo.dial === '+962' && jo.p === '791234567', JSON.stringify(jo));
  const foreign = run(page, '?pf_name=Ali&pf_phone=%2B15551234567');
  t(page + ': a country the form does not serve fills the name and leaves the phone empty', foreign && foreign.n === 'Ali' && foreign.p === '', JSON.stringify(foreign));
  const none = run(page, '');
  t(page + ': no link, nothing filled', none && !none.n && !none.p, JSON.stringify(none));
}
console.log(n + ' carry-pages checks passed');
