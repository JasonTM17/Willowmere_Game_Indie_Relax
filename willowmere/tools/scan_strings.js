/* scan_strings.js — find player-facing string literals that still look English.
   Heuristic: any 'single'- or "double"-quoted literal >= 8 chars containing a
   common English word and no Vietnamese diacritics gets reported. Review by
   eye — ids/flags/paths/fonts are filtered loosely. */
'use strict';
const fs = require('fs');
const files = process.argv.slice(2);
const EN = /\b(the|you|your|and|with|from|this|that|into|when|what|will|have|some|them|here|there|about|after|before|night|light|fish|day|sleep|until|thank|welcome|gift|give|quest|complete|save|new|load|start|menu|game|village|lake|lamp|keeper|warden|ember|vista|press|click|back|close|pause|resume|quit|settings|title|continue|morning|evening|summer|winter|spring)\b/i;
const VN = /[\u00C0-\u024F\u1E00-\u1EFF]/;
const SKIP = /^(#|rgb|http|[0-9]+px|bold|italic|\.\/|\.\.|[a-z_0-9\-\/.:]+$)/;
const lit = /'([^'\\]{8,})'|"([^"\\]{8,})"/g;
files.forEach(function (f) {
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  lines.forEach(function (l, i) {
    let m;
    lit.lastIndex = 0;
    while ((m = lit.exec(l))) {
      const inner = (m[1] || m[2]);
      if (VN.test(inner)) continue;
      if (SKIP.test(inner)) continue;
      if (/^[A-Z0-9 _\-:.!]+$/.test(inner) && inner.length < 10) continue;
      if (/\.(js|png|mp3|css|html|otf|ttf)\b/.test(inner)) continue;
      if (EN.test(inner)) {
        console.log(f + ':' + (i + 1) + ': ' + inner.slice(0, 100));
      }
    }
  });
});
