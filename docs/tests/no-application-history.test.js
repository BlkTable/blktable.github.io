// There is no application "history" any more.
//
// `origin` split one table into two sidebar entries — 'blktable' for applications through
// our own form, 'airtable' for the imported ones — and the imported side was where 33,789
// real applicants sat unread. `workspaces/31` moved all of them onto the board, so the
// second entry listed nothing and was removed.
//
// Every test here is source-read rather than behavioural, on purpose: what was removed is
// *reveal* code — a sidebar row, a scope default, a name suffix — and this project has
// shipped three features that were live and unreachable because nothing tested the reveal.
const fs = require('fs'), assert = require('assert');
function scripts(file){const src=fs.readFileSync(file,'utf8');return[...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');}
function grab(js,name){const at=js.search(new RegExp('\\bfunction\\s+'+name+'\\s*\\('));if(at===-1)throw new Error('no fn '+name);const open=js.indexOf('{',at);let d=0;for(let i=open;i<js.length;i++){if(js[i]==='{')d++;else if(js[i]==='}'){d--;if(!d)return js.slice(at,i+1);}}throw new Error('unbalanced '+name);}
const PAGE = fs.readFileSync('index.html', 'utf8');   // markup as well as script
const SRC = scripts('index.html');
let n = 0; const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };

t('the sidebar has no "Job Applications · history" entry', () => {
  assert.ok(!/side-ja-history/.test(PAGE), 'the history sidebar row is still built');
  assert.ok(!/Job Applications · history/.test(PAGE), 'the history label is still in the page');
});
t('nothing switches the board between a live scope and a history one', () => {
  assert.ok(!/setJaOrigin/.test(SRC), 'setJaOrigin is still there');
  assert.ok(!/paintJaOrigin/.test(SRC), 'paintJaOrigin is still there');
  assert.ok(!/JA_HISTORY|JA_LIVE/.test(SRC), 'the two origin constants are still there');
});
t('the board carries no origin scope at all', () => {
  // Not "defaults to live" — none. A scope that matches every row can only ever hide one by
  // accident, and with no entry left there would be nowhere to find what it hid.
  assert.ok(!/jaScope\.origin/.test(SRC), 'something still reads jaScope.origin');
  const m = SRC.match(/var jaScope = \{[^}]*\}/);
  assert.ok(m, 'jaScope is not declared the way this test expects');
  assert.ok(!/origin/.test(m[0]), 'jaScope still carries an origin');
});
t('the row query filters by year and country, and by nothing else', () => {
  const j = grab(SRC, 'jaScoped');
  assert.ok(!/origin/.test(j), 'jaScoped still filters on origin');
  assert.ok(/jaScope\.year/.test(j) && /jaScope\.country/.test(j), 'the year or country scope was removed too');
});
t('the facets RPC is still called with all three keys, p_origin as null', () => {
  // The one trap in this change. PostgREST resolves an RPC by the KEYS IN THE BODY, so
  // dropping p_origin turns a three-argument call into a two-argument one — the same shape
  // as the 2026-08-09 outage and the p_token near-miss. Null means every origin.
  const f = grab(SRC, 'loadFacets');
  assert.ok(/p_year/.test(f) && /p_country/.test(f) && /p_origin/.test(f), 'a key was dropped from the RPC body');
  assert.ok(/p_origin:\s*null/.test(f), 'p_origin is not sent as null');
});
t('the board header prints the table name with nothing appended', () => {
  const p = grab(SRC, 'paintBuiltinNames');
  assert.ok(/ja\.textContent = builtinName\("job_applications"\);/.test(p), 'the header still appends a scope to the name');
  // The em dash is the discriminator: what was removed is the appended `" — Airtable
  // history"`. An unrelated comment about archiving mentions "the imported Airtable
  // history", and matching that would make this test fail for no reason.
  assert.ok(!/— Airtable history/.test(PAGE), 'the appended " — Airtable history" suffix is still in the page');
  assert.ok(!/ja-wstag/.test(PAGE), 'the OLD (Airtable) tag is still on the board header');
});
t('pressing the Job Applications line only opens its countries', () => {
  // It used to also have to put the scope back, because you could be looking at the history.
  const m = PAGE.match(/side-item\[data-view="job_applications"\]'\)\.addEventListener\("click",[\s\S]{0,400}?\n  \}\);/);
  assert.ok(m, 'the sidebar click handler could not be found');
  assert.ok(/toggleJaKids\(\)/.test(m[0]), 'the countries no longer reveal');
  assert.ok(!/Origin/.test(m[0]), 'the handler still restores a scope');
});
t('opening the board loads it without repainting a scope first', () => {
  const o = grab(SRC, 'openJa');
  assert.ok(/showView\("job_applications"\)/.test(o) && /loadApps\(\)/.test(o), 'openJa no longer shows or loads the board');
  assert.ok(!/Origin/.test(o), 'openJa still paints an origin');
});
t('the origin column is not written by the page either', () => {
  // It stays in the database as provenance — `extra._import` marks the same rows and
  // workspaces/31 documents the one-statement undo — but the app must not set it, or a new
  // application could acquire a value nothing reads.
  assert.ok(!/origin:\s*['"]/.test(SRC), 'something writes an origin value');
});

console.log(n + ' no-application-history tests passed');
