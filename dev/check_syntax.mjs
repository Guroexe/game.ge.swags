import { readFileSync } from 'node:fs';

const files = ['js/engine/arenaLoader.js', 'js/engine/assetlib.js', 'js/engine/physics.js'];
let bad = 0;
for (const f of files) {
  const src = readFileSync(f, 'utf8');


  // Баланс скобок вне строк/комментариев
  let st = [], ok = true, state = null;
  const OPEN = { '{': '}', '(': ')', '[': ']' };
  for (let i = 0; i < src.length; i++) {
    const c = src[i], n = src[i+1];
    if (state === null) {
      if (c === '/' && n === '/') { state = 'line'; i++; continue; }
      if (c === '/' && n === '*') { state = 'block'; i++; continue; }
      if (c === "'") { state = 'sq'; continue; }
      if (c === '"') { state = 'dq'; continue; }
      if (c === '`') { state = 'tpl'; continue; }
      if (OPEN[c]) st.push(c);
      else if ('})]'.includes(c)) {
        const o = st.pop();
        if (!o || OPEN[o] !== c) { ok = false; break; }
      }
    } else if (state === 'line') { if (c === '\n') state = null; }
    else if (state === 'block') { if (c === '*' && n === '/') { state = null; i++; } }
    else {
      if (c === '\\') { i++; continue; }
      if ((state === 'sq' && c === "'") || (state === 'dq' && c === '"') || (state === 'tpl' && c === '`')) state = null;
    }
  }
  if (st.length) ok = false;
  console.log((ok ? 'OK  ' : 'BAD ') + f);
  if (!ok) bad++;
}
process.exit(bad ? 1 : 0);
