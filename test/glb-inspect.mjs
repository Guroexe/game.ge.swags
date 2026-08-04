// GLB inspector: заголовок + JSON chunk, список анимаций/костей/текстур/треугольников.
// Используется тестом assets и как CLI: node test/glb-inspect.mjs <file.glb> [--json]
export function inspectGLB(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf.length < 20) throw new Error('too small');
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('bad magic');
  const version = dv.getUint32(4, true);
  const total = dv.getUint32(8, true);
  const jsonLen = dv.getUint32(12, true);
  if (dv.getUint32(16, true) !== 0x4e4f534a) throw new Error('no JSON chunk');
  const json = JSON.parse(Buffer.from(buf.buffer, buf.byteOffset + 20, jsonLen).toString('utf8'));
  const anims = (json.animations || []).map((a) => a.name || '(unnamed)');
  const images = json.images || [];
  const external = images.filter((im) => im.uri && !im.uri.startsWith('data:')).map((im) => im.uri);
  const bones = new Set();
  for (const skin of json.skins || []) for (const j of skin.joints || []) {
    bones.add(json.nodes?.[j]?.name || `node${j}`);
  }
  // Треугольники: сумма по мешам (indices/3 или pos count/3)
  let tris = 0;
  for (const mesh of json.meshes || []) {
    for (const prim of mesh.primitives || []) {
      const mode = prim.mode ?? 4;
      if (mode !== 4) continue;
      if (prim.indices != null) tris += Math.floor((json.accessors[prim.indices].count || 0) / 3);
      else if (prim.attributes?.POSITION != null) tris += Math.floor((json.accessors[prim.attributes.POSITION].count || 0) / 3);
    }
  }
  const nodeNames = (json.nodes || []).map((n) => n.name || '');
  return {
    version, bytes: buf.length, declaredBytes: total,
    animations: anims,
    imagesEmbedded: images.length - external.length,
    imagesExternal: external,
    skins: (json.skins || []).length,
    bones: [...bones],
    triangles: tris,
    nodes: nodeNames,
    generator: json.asset?.generator || '',
  };
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const fs = await import('node:fs');
  const file = process.argv[2];
  const info = inspectGLB(fs.readFileSync(file));
  if (process.argv.includes('--json')) console.log(JSON.stringify(info, null, 1));
  else {
    console.log(`${file}: ${(info.bytes / 1024).toFixed(0)}KB, tris=${info.triangles}, skins=${info.skins}, imgs=${info.imagesEmbedded}+ext:${info.imagesExternal.length}`);
    console.log('animations:', info.animations.join(', ') || '(none)');
  }
}
