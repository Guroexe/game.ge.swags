import struct, json, glob, os
for f in sorted(glob.glob('assets/weapons/*.glb')):
    d = open(f, 'rb').read()
    jl = struct.unpack('<I', d[12:16])[0]
    j = json.loads(d[20:20 + jl])
    mn = [1e9] * 3
    mx = [-1e9] * 3
    for m in j.get('meshes', []):
        for p in m.get('primitives', []):
            a = j['accessors'][p['attributes']['POSITION']]
            if 'min' in a and 'max' in a:
                for i in range(3):
                    mn[i] = min(mn[i], a['min'][i])
                    mx[i] = max(mx[i], a['max'][i])
    sz = [round(mx[i] - mn[i], 3) for i in range(3)]
    c = [round((mx[i] + mn[i]) / 2, 3) for i in range(3)]
    print(os.path.basename(f).ljust(34), 'size', sz, 'center', c)
