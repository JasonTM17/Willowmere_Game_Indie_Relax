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

  if (violations.length) {
    for (const v of violations) console.error('VIOLATION: ' + v);
    console.error('CONTRACT FAIL (' + violations.length + ' violation(s))');
    process.exit(1);
  }
  console.log('CONTRACT OK');
  process.exit(0);
}

main();
