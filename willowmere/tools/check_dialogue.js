/* Willowmere — tools/check_dialogue.js
   Dialogue-content gate (DESIGN.md §12). Node stdlib only.

   Story quest nodes are authored as N(speaker, 'text', ...) in story.js;
   the generic registry in dialogue.js uses object literals { text: '…' }.
   Node text is hard-capped at 120 chars by WDialogue (slice(0,120)), so any
   longer line is silently truncated mid-sentence.

   Epilogue paragraphs (story.js epilogueLines) are NOT capped — they render
   in the full-screen epilogue. We therefore scan only N(...) texts in
   story.js and `text:` fields in dialogue.js.

   Clean output: "DIALOGUE CAP OK", exit 0.
   Run from the workspace root:  node willowmere/tools/check_dialogue.js
*/
'use strict';

const fs = require('fs');
const path = require('path');

const JS_DIR = path.join(__dirname, '..', 'js');
const CAP = 120;

/* Decode JS single-quoted escapes enough to measure real glyph count. */
function unescapeLen(s) {
  return s.replace(/\\u([0-9a-fA-F]{4})/g, 'x')
          .replace(/\\(.)/g, '$1').length;
}

function scan(file, re, label) {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');
  const violations = [];
  lines.forEach((line, i) => {
    let m;
    const r = new RegExp(re.source, 'g');
    while ((m = r.exec(line))) {
      const len = unescapeLen(m[1]);
      if (len > CAP) {
        violations.push(path.basename(file) + ':' + (i + 1) +
          ' ' + label + ' text is ' + len + ' chars (cap ' + CAP + '): "' +
          m[1].slice(0, 50) + '…"');
      }
    }
  });
  return violations;
}

function main() {
  const violations = [];

  /* story.js: N('speaker', 'text'[, ...]) — 2nd arg is the node line */
  violations.push(...scan(
    path.join(JS_DIR, 'story.js'),
    /\bN\(\s*'(?:[^'\\]|\\.)*'\s*,\s*'((?:[^'\\]|\\.)*)'/,
    'N() node'
  ));

  /* dialogue.js generic registry: text: '…' literal fields only */
  violations.push(...scan(
    path.join(JS_DIR, 'dialogue.js'),
    /\btext:\s*'((?:[^'\\]|\\.)*)'/,
    'registry'
  ));

  if (violations.length) {
    for (const v of violations) console.error('VIOLATION: ' + v);
    console.error('DIALOGUE CAP FAIL (' + violations.length + ' violation(s))');
    process.exit(1);
  }
  console.log('DIALOGUE CAP OK');
  process.exit(0);
}

main();
