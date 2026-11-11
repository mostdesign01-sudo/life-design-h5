import * as THREE from "three";

// The planet is small against what stands on it: a house is about a quarter of its radius, so the
// horizon always curves and every stop reads at a glance.
export const R = 4.4;
const BUMP = 0.08;
export const Y = new THREE.Vector3(0, 1, 0);
export const Z = new THREE.Vector3(0, 0, 1);

// Golden-hour sun: low enough for long warm shadows, high enough to light the lived-in side.
export const SUN = new THREE.Vector3(0.6, 0.32, 0.74).normalize();
// The lived-in side of the planet: half-way between the sun and "up".
export const POLE = SUN.clone().add(Y.clone().multiplyScalar(0.9)).normalize();
// Topmost point of the day/night line, where the dusk bench sits.
export const TERMINATOR = Y.clone().sub(SUN.clone().multiplyScalar(Y.dot(SUN))).normalize();
const NORTH = TERMINATOR.clone().sub(POLE.clone().multiplyScalar(TERMINATOR.dot(POLE))).normalize();
const EAST = new THREE.Vector3().crossVectors(NORTH, POLE).normalize();

// The ring path around the lived-in area, as an angle from POLE.
export const PATH_ANGLE = THREE.MathUtils.degToRad(33);

export function dirAt(aDeg, bDeg) {
  const a = THREE.MathUtils.degToRad(aDeg);
  const b = THREE.MathUtils.degToRad(bDeg);
  return POLE.clone().multiplyScalar(Math.cos(a))
    .add(NORTH.clone().multiplyScalar(Math.cos(b) * Math.sin(a)))
    .add(EAST.clone().multiplyScalar(Math.sin(b) * Math.sin(a)))
    .normalize();
}

function bump(d) {
  return (Math.sin(d.x * 3.1 + 1.7) * Math.sin(d.y * 2.3 + 0.4) * Math.sin(d.z * 2.9 + 2.2)
    + 0.5 * Math.sin(d.x * 7.3 + d.z * 5.1) * Math.sin(d.y * 6.7 + 1.3)) * 0.66;
}

export function surfaceRadius(dir) {
  return R + bump(dir) * BUMP;
}

export function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomDir(rand) {
  const u = rand() * 2 - 1;
  const th = rand() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  return new THREE.Vector3(s * Math.cos(th), u, s * Math.sin(th));
}

// Stand an object on the surface at `dir`, local +Y along the planet normal.
export function placeOnPlanet(obj, dir, yaw = 0, lift = 0) {
  const up = dir.clone().normalize();
  obj.position.copy(up).multiplyScalar(surfaceRadius(up) + lift);
  obj.quaternion.setFromUnitVectors(Y, up);
  if (yaw) obj.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(Y, yaw));
}

// Yaw that turns an object's local +Z toward world direction `target` (projected on the tangent plane).
export function yawToward(dir, target) {
  const up = dir.clone().normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(Y, up);
  const f = Z.clone().applyQuaternion(q);
  const d = target.clone().sub(up.clone().multiplyScalar(target.dot(up))).normalize();
  return Math.atan2(up.dot(new THREE.Vector3().crossVectors(f, d)), f.dot(d));
}

// ---------- shared shader state ----------

// One set of uniforms drives every custom shader: the clock, the health of the meadow, the colour
// of the air at the horizon, and the see-through window kept open around the traveler.
export const shared = {
  uTime: { value: 0 },
  uHealth: { value: 0.5 },
  uHaze: { value: new THREE.Color("#f3e3d6") },
  uSunTint: { value: new THREE.Color("#ffe0b5") },
  // xy: centre in render-target pixels, z: radius in pixels (0 = off), w: view-space depth of the traveler.
  uHole: { value: new THREE.Vector4(0, 0, 0, 0) },
  // Where the traveler stands, so the grass can part around their feet.
  uFeet: { value: new THREE.Vector3(0, 100, 0) }
};

export const NOISE_GLSL = /* glsl */`
  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }
  float vnoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash13(i), hash13(i + vec3(1.0, 0.0, 0.0)), f.x), mix(hash13(i + vec3(0.0, 1.0, 0.0)), hash13(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
      mix(mix(hash13(i + vec3(0.0, 0.0, 1.0)), hash13(i + vec3(1.0, 0.0, 1.0)), f.x), mix(hash13(i + vec3(0.0, 1.0, 1.0)), hash13(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
      f.z);
  }
`;

// Add shader patches to a built-in material. Each patch has a name, so materials with different
// sets of patches never share a compiled program.
export function patchMaterial(material, name, patch) {
  const patches = material.userData.patches || (material.userData.patches = []);
  patches.push({ name, patch });
  material.onBeforeCompile = shader => patches.forEach(p => p.patch(shader));
  material.customProgramCacheKey = () => patches.map(p => p.name).join("|");
  return material;
}

// Anything tall enough to hide the traveler gets a dithered window around them, so the walk never
// disappears behind a tree or a wall. Shadows are unaffected.
export function seeThrough(material) {
  return patchMaterial(material, "hole", shader => {
    shader.uniforms.uHole = shared.uHole;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec4 uHole;")
      .replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>
        if (uHole.z > 0.0 && vViewPosition.z < uHole.w - 0.35) {
          float holeD = distance(gl_FragCoord.xy, uHole.xy) / uHole.z;
          if (holeD < 1.0) {
            float holeN = fract(52.9829189 * fract(dot(floor(gl_FragCoord.xy), vec2(0.06711056, 0.00583715))));
            if (smoothstep(0.45, 1.0, holeD) < holeN + 0.02) discard;
          }
        }`);
  });
}

// ---------- geometry helpers ----------

const mergeTmp = new THREE.Matrix4();

function concat(geometries, useColor) {
  let count = 0;
  geometries.forEach(g => { count += g.attributes.position.count; });
  const position = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const color = useColor ? new Float32Array(count * 3).fill(1) : null;
  let offset = 0;
  geometries.forEach(g => {
    const n = g.attributes.position.count;
    position.set(g.attributes.position.array.subarray(0, n * 3), offset * 3);
    if (g.attributes.normal) normal.set(g.attributes.normal.array.subarray(0, n * 3), offset * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array.subarray(0, n * 2), offset * 2);
    if (color && g.attributes.color) color.set(g.attributes.color.array.subarray(0, n * 3), offset * 3);
    offset += n;
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(position, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
  out.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  if (color) out.setAttribute("color", new THREE.BufferAttribute(color, 3));
  return out;
}

// Join geometries (each optionally with its own transform) into one, so they draw in a single call.
export function mergeGeometries(parts, useColor = false) {
  const flat = parts.map(part => {
    const source = part.geometry || part;
    const g = source.index ? source.toNonIndexed() : source.clone();
    if (part.matrix) g.applyMatrix4(part.matrix);
    return g;
  });
  const out = concat(flat, useColor);
  flat.forEach(g => g.dispose());
  return out;
}

// Collapse the static meshes under `root` into one mesh per material. Meshes (or groups) flagged
// `userData.keep` are left alone: anything that moves on its own, or is picked out by name later.
export function mergeStatic(root) {
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert();
  const buckets = new Map();
  const merged = [];
  root.traverse(node => {
    if (!node.isMesh || node.isInstancedMesh || Array.isArray(node.material)) return;
    for (let p = node; p && p !== root; p = p.parent) if (p.userData.keep) return;
    const key = `${node.material.uuid}|${node.castShadow}|${node.receiveShadow}|${node.userData.noShadow ? 1 : 0}|${node.renderOrder}`;
    if (!buckets.has(key)) buckets.set(key, { nodes: [], parts: [] });
    const bucket = buckets.get(key);
    bucket.nodes.push(node);
    bucket.parts.push({ geometry: node.geometry, matrix: mergeTmp.multiplyMatrices(inverse, node.matrixWorld).clone() });
    merged.push(node);
  });
  merged.forEach(node => node.parent.remove(node));
  buckets.forEach(({ nodes, parts }) => {
    const first = nodes[0];
    const mesh = new THREE.Mesh(mergeGeometries(parts, first.material.vertexColors === true), first.material);
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.renderOrder = first.renderOrder;
    Object.assign(mesh.userData, first.userData);
    root.add(mesh);
  });
  return root;
}

// A tube along `points` whose radius follows `radiusAt(t)`, with vertex colours from `colorAt(t)`.
export function taperedTube(points, radiusAt, { segments = 40, radial = 7, colorAt = null, closed = false } = {}) {
  const curve = new THREE.CatmullRomCurve3(points, closed);
  const geo = new THREE.TubeGeometry(curve, segments, 1, radial, closed);
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const colors = colorAt ? new Float32Array(pos.count * 3) : null;
  const c = new THREE.Color();
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    const r = radiusAt(t);
    if (colorAt) colorAt(t, c);
    for (let j = 0; j <= radial; j += 1) {
      const k = i * (radial + 1) + j;
      // TubeGeometry places each vertex one unit from the curve along its normal.
      pos.setXYZ(k, pos.getX(k) + nor.getX(k) * (r - 1), pos.getY(k) + nor.getY(k) * (r - 1), pos.getZ(k) + nor.getZ(k) * (r - 1));
      if (colors) colors.set([c.r, c.g, c.b], k * 3);
    }
  }
  if (colors) geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geo;
}

// A smooth, lumpy blob: an icosphere pushed in and out by a few sine waves, with normals taken
// from the displaced surface so the lumps catch the light.
export function lumpGeometry(radius, seed, { detail = 3, amount = 0.14, squash = 1 } = {}) {
  const geo = new THREE.IcosahedronGeometry(1, detail);
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const a = seed * 12.9898;
  const height = d => 1
    + amount * 0.6 * Math.sin(d.x * 3.7 + a) * Math.sin(d.y * 4.3 + a * 1.7) * Math.sin(d.z * 3.9 + a * 0.6)
    + amount * 0.4 * Math.sin(d.x * 7.1 + a * 2.1 + d.y * 5.3) * Math.sin(d.z * 6.7 + a * 1.3);
  const stretch = new THREE.Vector3(1, squash, 1);
  const point = (d, out) => out.copy(d).normalize().multiplyScalar(radius * height(d)).multiply(stretch);
  const d = new THREE.Vector3();
  const p = new THREE.Vector3();
  const p1 = new THREE.Vector3();
  const p2 = new THREE.Vector3();
  const t1 = new THREE.Vector3();
  const t2 = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 1) {
    d.fromBufferAttribute(pos, i).normalize();
    t1.crossVectors(d, Math.abs(d.y) < 0.9 ? Y : Z).normalize();
    t2.crossVectors(d, t1);
    point(d, p);
    point(p1.copy(d).addScaledVector(t1, 0.04).normalize(), p1);
    point(p2.copy(d).addScaledVector(t2, 0.04).normalize(), p2);
    n.crossVectors(p1.sub(p), p2.sub(p)).normalize();
    if (n.dot(d) < 0) n.negate();
    pos.setXYZ(i, p.x, p.y, p.z);
    nor.setXYZ(i, n.x, n.y, n.z);
  }
  return geo;
}
