/* Willowmere — tools/check_contract.js
   Source-contract gate (DESIGN.md §7). Node stdlib only.

   Scans every .js file in willowmere/js/ (exactly the 13 classic scripts at
   baseline) and fails with exit 1 if any of these appear in executable code:
     - a line starting with import / export   (module syntax)
     - require(
     - fetch(
     - XMLHttpRequest
     - module.exports
     - getImageData

   Comments are stripped first (block + line, string-aware) so a comment that
   merely *mentions* a forbidden token ("no getImageData anywhere") does not
   produce a false positive. Line numbers are preserved for reporting.

   Clean output: "CONTRACT OK", exit 0.

   Run from the workspace root:  node willowmere/tools/check_contract.js
*/
'use strict';

const fs = require('fs');
const path = require('path');

const JS_DIR = path.join(__dirname, '..', 'js');

/* The 13 scripts of the contract, in index.html order. */
const EXPECTED = [
  'util.js', 'manifest.js', 'assets.js', 'audio.js', 'input.js',
  'particles.js', 'world.js', 'npcs.js', 'dialogue.js', 'story.js',
  'action.js', 'hud.js', 'main.js'
];

/* Line-start module syntax + bare token usages (executable code only). */
const LINE_PATTERNS = [/^\s*import\b/, /^\s*export\b/];
const TOKENS = ['require(', 'fetch(', 'XMLHttpRequest', 'module.exports', 'getImageData'];

/* Replace comment text with spaces (newlines kept) so reported line numbers
   still match the original file. String literals are respected. */
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let state = 'code'; // code | line | block | squote | dquote
  while (i < n) {
    const c = src[i];
    const c2 = i + 1 < n ? src.substr(i, 2) : '';
    if (state === 'code') {
      if (c2 === '//') { state = 'line'; out += '  '; i += 2; continue; }
      if (c2 === '/*') { state = 'block'; out += '  '; i += 2; continue; }
      if (c === "'") { state = 'squote'; out += c; i++; continue; }
      if (c === '"') { state = 'dquote'; out += c; i++; continue; }
      out += c; i++; continue;
    }
    if (state === 'line') {
      if (c === '\n') { state = 'code'; out += c; } else { out += ' '; }
      i++; continue;
    }
    if (state === 'block') {
      if (c2 === '*/') { state = 'code'; out += '  '; i += 2; continue; }
      out += (c === '\n' ? '\n' : ' ');
      i++; continue;
    }
    /* inside a string literal */
    if (c === '\\') { out += src.substr(i, 2); i += 2; continue; }
    if ((state === 'squote' && c === "'") || (state === 'dquote' && c === '"')) {
      state = 'code';
    }
    out += c; i++;
  }
  return out;
}

function auditFile(file) {
  const violations = [];
  let src;
  try {
    src = fs.readFileSync(file, 'utf8');
  } catch (e) {
    return ['' + path.basename(file) + ': cannot read (' + e.message + ')'];
  }
  const clean = stripComments(src);
  const lines = clean.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const re of LINE_PATTERNS) {
      if (re.test(line)) {
        violations.push(path.basename(file) + ':' + (i + 1) +
          ': module syntax — "' + line.trim().slice(0, 60) + '"');
      }
    }
    for (const tok of TOKENS) {
      if (line.indexOf(tok) !== -1) {
        violations.push(path.basename(file) + ':' + (i + 1) +
          ': forbidden token "' + tok + '"');
      }
    }
  }
  return violations;
}

/* ---- cross-file API gate -------------------------------------------------
   Collect each module's exported keys (the `window.WX = {` literal, or the
   final `return {` of its IIFE), then check that every `WX.prop` referenced
   in ANY script is actually exported. Catches calls to functions that were
   renamed or never written. */
function exportKeysOf(src) {
  const assign = /window\.(W[A-Z]\w*)\s*=\s*(\{|\(function)/.exec(src);
  if (!assign) return null;
  const wname = assign[1];
  let start = -1;
  /* a late `window.WX = {` literal wins (main.js assigns its object mid-IIFE);
     otherwise the export is the last `return {` at IIFE-body depth — inner
     `return {x}` inside exported functions would be picked by a naive
     lastIndexOf, so depth is computed on the comment-stripped source */
  const litRe = new RegExp('window\\.' + wname + '\\s*=\\s*\\{', 'g');
  let m, lastLit = -1;
  while ((m = litRe.exec(src))) lastLit = m.index;
  if (lastLit >= 0) {
    start = src.indexOf('{', lastLit);
  } else {
    const clean = stripComments(src);
    let depth = 0, lastTop = -1;
    for (let i = 0; i < clean.length; i++) {
      const ch = clean[i];
      if (ch === '{') { depth++; continue; }
      if (ch === '}') { depth--; continue; }
      if (ch === 'r' && depth === 1 && clean.slice(i, i + 7) === 'return ' &&
          clean.indexOf('{', i) >= 0 &&
          /^[ \t]*\{/.test(clean.slice(i + 7))) {
        lastTop = clean.indexOf('{', i);
      }
    }
    start = lastTop;
  }
  if (start < 0) return null;
  let depth = 0, end = -1;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) return null;
  const body = src.slice(start + 1, end);
  const keys = new Set();
  const re = /([A-Za-z_$][\w$]*)\s*(?::|\()/g;
  let km;
  while ((km = re.exec(body))) keys.add(km[1]);
  /* live-property exports added after the literal (e.g. WDialogue.env) */
  const dpRe = new RegExp(
    'Object\\.defineProperty\\(window\\.' + wname + ',\\s*[\'"]([A-Za-z_$][\\w$]*)[\'"]', 'g');
  while ((km = dpRe.exec(src))) keys.add(km[1]);
  return keys;
}

function main() {
  let names;
  try {
    names = fs.readdirSync(JS_DIR).filter(f => f.toLowerCase().endsWith('.js')).sort();
  } catch (e) {
    console.error('CONTRACT FAIL: cannot list ' + JS_DIR + ' (' + e.message + ')');
    process.exit(1);
  }

  const violations = [];

  const missing = EXPECTED.filter(f => names.indexOf(f) === -1);
  for (const f of missing) violations.push('missing contract file: willowmere/js/' + f);
  const extras = names.filter(f => EXPECTED.indexOf(f) === -1);
  for (const f of extras) {
    process.stdout.write('[check_contract] note: extra file scanned too: ' + f + '\n');
  }

  process.stdout.write('[check_contract] scanning ' + names.length +
    ' file(s) in willowmere/js (contract expects 13)\n');
  for (const name of names) {
    violations.push(...auditFile(path.join(JS_DIR, name)));
  }

  /* cross-file API usage: W<Name>.<prop> must exist in the module's exports */
  const exported = {};           // WName -> Set(keys) | null
  const srcs = {};
  for (const name of names) {
    const src = fs.readFileSync(path.join(JS_DIR, name), 'utf8');
    srcs[name] = src;
    const m = /window\.(W[A-Z]\w*)\s*=/.exec(src);
    if (m) exported[m[1]] = exportKeysOf(src);
  }
  const useRe = /\b(W[A-Z]\w*)\.([A-Za-z_$][\w$]*)/g;
  for (const name of names) {
    const clean = stripComments(srcs[name]);
    let m;
    while ((m = useRe.exec(clean))) {
      const keys = exported[m[1]];
      if (!keys) continue;                       // module w/o a parsed export list
      if (!keys.has(m[2])) {
        // locate the line for reporting
        const upto = clean.slice(0, m.index);
        const ln = upto.split('\n').length;
        violations.push(path.basename(name) + ':' + ln +
          ': uses ' + m[1] + '.' + m[2] + ' — not exported by that module');
      }
    }
  }

  if (violations.length) {
    for (const v of violations) console.error('VIOLATION: ' + v);
    console.error('CONTRACT FAIL (' + violations.length + ' violation(s))');
    process.exit(1);
  }
  console.log('CONTRACT OK');
  process.exit(0);
}

main();
