import io, sys

files = [
    'js/engine/arenaLoader.js',
    'js/engine/assetlib.js',
    'js/engine/physics.js',
]
OPEN = {'{': '}', '(': ')', '[': ']'}
CLOSE = {'}', ')', ']'}

def strip_code(s):
    out = []
    i, n = 0, len(s)
    state = None  # None | 'line' | 'block' | 'sq' | 'dq' | 'tpl'
    while i < n:
        c = s[i]
        nxt = s[i+1] if i+1 < n else ''
        if state is None:
            if c == '/' and nxt == '/': state = 'line'; i += 2; continue
            if c == '/' and nxt == '*': state = 'block'; i += 2; continue
            if c == "'": state = 'sq'; i += 1; continue
            if c == '"': state = 'dq'; i += 1; continue
            if c == '`': state = 'tpl'; i += 1; continue
            out.append(c); i += 1; continue
        if state == 'line':
            if c == '\n': state = None
            i += 1; continue
        if state == 'block':
            if c == '*' and nxt == '/': state = None; i += 2; continue
            i += 1; continue
        if state in ('sq', 'dq', 'tpl'):
            if c == '\\': i += 2; continue
            if (state == 'sq' and c == "'") or (state == 'dq' and c == '"') or (state == 'tpl' and c == '`'):
                state = None
            i += 1; continue
    return ''.join(out)

bad = 0
for f in files:
    s = io.open(f, encoding='utf-8').read()
    code = strip_code(s)
    st = []
    ok = True
    for ch in code:
        if ch in OPEN: st.append(ch)
        elif ch in CLOSE:
            if not st or OPEN[st.pop()] != ch:
                ok = False; break
    if st: ok = False
    print(('OK  ' if ok else 'BAD ') + f)
    if not ok: bad += 1
sys.exit(1 if bad else 0)
