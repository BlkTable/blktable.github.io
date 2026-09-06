// Every public page asks the API as the public, and the app is the only page that does not.
//
// public-form-anon.chrome.js proves the mechanism in a real browser on one page. This file is
// the standard: it holds the rule across all of them, so a fourth public page — or a revert to
// a bare createClient on one of the three — fails here rather than in somebody's face.
//
// The bug it pins, from 2026-09-06: the public pages share an origin with the app, so
// supabase-js read the staff session out of the app's localStorage and sent that person's
// token instead of the anon key. The public-form RLS policies are granted to the anon role
// alone, so the form's row came back empty for staff without access to that table and the page
// answered "Form not found" — for all 43 non-admin accounts, on a link the public could open.
const fs = require('fs'), vm = require('vm'), assert = require('assert');

// Every page that carries a supabase client. The app is listed apart because its rule is the
// opposite one: it MUST keep the session, or signing in would not survive a refresh.
const PUBLIC = ['f/index.html', 'apply/index.html', 'cast/index.html'];
const APP = 'index.html';

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
// The helper is called with a stub library, and what it asked for is read back off the stub —
// the options object itself, not the source text that spells it.
function optionsFrom(file) {
  const js = scripts(file);
  const ctx = { console, window: { supabase: { createClient: function (u, k, o) { return { __args: [u, k, o] }; } } } };
  vm.createContext(ctx);
  new vm.Script('(function(){' + grab(js, 'publicClient', file) +
    '\n this.OUT = publicClient("https://db.example", "anon-key").__args;}).call(this)').runInContext(ctx);
  return { url: ctx.OUT[0], key: ctx.OUT[1], opts: ctx.OUT[2] || {} };
}

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL: ' + name + ' -> ' + e.message); process.exitCode = 1; } };

PUBLIC.forEach(file => {
  t(file + ' hands the library a client that carries no session', () => {
    const { opts } = optionsFrom(file);
    assert.ok(opts.auth, 'no auth options passed at all — the page would adopt the staff session');
    // The one that fixes the bug: with persistSession off the library uses in-memory storage
    // and never reads the app's, so there is no session to send and every call is anon.
    assert.strictEqual(opts.auth.persistSession, false, 'persistSession must be false');
  });
  t(file + ' neither refreshes nor rewrites the session the app owns', () => {
    const { opts } = optionsFrom(file);
    assert.strictEqual(opts.auth.autoRefreshToken, false, 'autoRefreshToken must be false');
    assert.strictEqual(opts.auth.detectSessionInUrl, false, 'detectSessionInUrl must be false');
  });
  t(file + ' passes the anon key through untouched', () => {
    const { url, key } = optionsFrom(file);
    assert.strictEqual(url, 'https://db.example');
    assert.strictEqual(key, 'anon-key');
  });
  t(file + ' makes its client only through that helper', () => {
    // A second, bare createClient anywhere on the page would quietly bring the session back.
    const js = scripts(file);
    const direct = js.split('\n').filter(l => /window\.supabase\.createClient/.test(l) && !/^\s{4}return /.test(l));
    assert.strictEqual(direct.length, 0, 'createClient called outside publicClient: ' + direct.join(' | '));
  });
});

t('the three public pages carry the same helper, word for word', () => {
  // The repo keeps its shared rules as verbatim copies rather than a shared file; the tests are
  // what stops the copies drifting apart.
  const bodies = PUBLIC.map(f => grab(scripts(f), 'publicClient', f).replace(/\r/g, ''));
  bodies.forEach((b, i) => assert.strictEqual(b, bodies[0], PUBLIC[i] + ' has drifted from ' + PUBLIC[0]));
});

t('the app itself still keeps its session, which is the whole point of the split', () => {
  // If this ever fails, someone applied the public-page rule to the app: staff would be signed
  // out by every refresh.
  const js = scripts(APP);
  assert.ok(/window\.supabase\.createClient/.test(js), 'the app no longer makes a client');
  assert.ok(!/persistSession\s*:\s*false/.test(js), 'the app must not disable session persistence');
});

t('every page holding a client is accounted for by this test', () => {
  // A new public page that nobody added here is the way this bug comes back.
  const all = fs.readdirSync('.', { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'docs' && d.name !== 'assets')
    .map(d => d.name + '/index.html')
    .concat([APP])
    .filter(f => { try { return fs.statSync(f).isFile(); } catch (e) { return false; } })
    .filter(f => /createClient/.test(fs.readFileSync(f, 'utf8')));
  const known = PUBLIC.concat([APP]).sort();
  assert.deepStrictEqual(all.sort(), known,
    'a page with a supabase client is not covered: ' + all.filter(f => known.indexOf(f) === -1).join(', '));
});

if (!process.exitCode) console.log(n + ' public-page identity checks passed');
