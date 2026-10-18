import * as THREE from "three";
import { RoundedBoxGeometry } from "../vendor/three-addons/geometries/RoundedBoxGeometry.js";
import {
  createPost, softTexture, blobTexture, cloudTexture, woodTexture, shingleTexture, stoneTexture
} from "./look.js";

export const R = 6;
const BUMP = 0.1;
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

// Golden-hour sun: low enough for long warm shadows, high enough to light the lived-in side.
export const SUN = new THREE.Vector3(0.6, 0.32, 0.74).normalize();
// The lived-in side of the planet: half-way between the sun and "up".
export const POLE = SUN.clone().add(Y.clone().multiplyScalar(0.9)).normalize();
// Topmost point of the day/night line, where the dusk bench sits.
const TERMINATOR = Y.clone().sub(SUN.clone().multiplyScalar(Y.dot(SUN))).normalize();
const NORTH = TERMINATOR.clone().sub(POLE.clone().multiplyScalar(TERMINATOR.dot(POLE))).normalize();
const EAST = new THREE.Vector3().crossVectors(NORTH, POLE).normalize();

function dirAt(aDeg, bDeg) {
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

function detail(d) {
  return 0.5 + 0.5 * Math.sin(d.x * 11.3 + 0.3) * Math.sin(d.y * 9.7 + 1.9) * Math.sin(d.z * 12.1 + 0.8);
}

// Broad meadow patches, so the ground reads as painted strokes rather than one flat green.
function patch(d) {
  const v = Math.sin(d.x * 2.2 + 0.7) * Math.sin(d.y * 2.6 + 2.1) + 0.6 * Math.sin(d.z * 3.4 + d.x * 1.7 + 0.4);
  return THREE.MathUtils.clamp(0.5 + v * 0.45, 0, 1);
}

function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomDir(rand) {
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
function yawToward(dir, target) {
  const up = dir.clone().normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(Y, up);
  const f = Z.clone().applyQuaternion(q);
  const d = target.clone().sub(up.clone().multiplyScalar(target.dot(up))).normalize();
  return Math.atan2(up.dot(new THREE.Vector3().crossVectors(f, d)), f.dot(d));
}

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, envMapIntensity: 0.45, ...extra });
const textured = (map, extra = {}) => new THREE.MeshStandardMaterial({ map, roughness: 0.9, metalness: 0, ...extra });

function shadow(obj) {
  obj.traverse(node => {
    if (node.isMesh && !node.userData.noShadow) {
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });
  return obj;
}

const BLOB = blobTexture();
const SOFT = softTexture();

// Soft contact shadow under an object; reads as ambient occlusion without an AO pass.
function addBlob(group, radius, opacity = 0.45) {
  const blob = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * 2, radius * 2),
    new THREE.MeshBasicMaterial({ map: BLOB, transparent: true, opacity, depthWrite: false, color: 0x1d2440, polygonOffset: true, polygonOffsetFactor: -2 })
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.025;
  blob.userData.noShadow = true;
  blob.renderOrder = 1;
  group.add(blob);
  return blob;
}

function addHalo(parent, position, size, color = 0xffc66b) {
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: SOFT, color, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }));
  halo.position.copy(position);
  halo.scale.setScalar(size);
  parent.add(halo);
  return halo;
}

// Vertex colours graded from a shaded base to a sunlit crown, like painted foliage.
function foliageGeometry(radius, rand, dark, light, minY, maxY, offsetY) {
  const geo = new THREE.SphereGeometry(radius, 18, 12);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 1) {
    v.fromBufferAttribute(pos, i);
    const wobble = 1 + Math.sin(v.x * 23 + v.y * 7) * 0.035 + Math.sin(v.z * 19 + v.y * 11) * 0.035;
    v.multiplyScalar(wobble);
    pos.setXYZ(i, v.x, v.y, v.z);
    const t = THREE.MathUtils.clamp((v.y + offsetY - minY) / (maxY - minY), 0, 1);
    c.copy(dark).lerp(light, t * t * (3 - 2 * t));
    c.offsetHSL(0, 0, Math.sin(v.x * 31 + v.z * 17) * 0.02);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

// Foliage casts shadows but doesn't receive them: soft VSM self-shadowing speckles round shapes.
function foliageShadow(group) {
  group.traverse(node => {
    if (node.isMesh && node.material === foliageMat) node.receiveShadow = false;
  });
  return group;
}

const FOLIAGE_DARK = new THREE.Color("#2e5a45");
const FOLIAGE_LIGHT = new THREE.Color("#b5d65a");
const foliageMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });

function buildTree(rand, scale = 1) {
  const group = new THREE.Group();
  const trunkMat = mat(0x6e4a32);
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.13, 1.0, 8), trunkMat);
  trunk.position.y = 0.5;
  group.add(trunk);
  const crown = new THREE.Group();
  crown.position.y = 1.15;
  const blobs = 5 + Math.floor(rand() * 3);
  for (let i = 0; i < blobs; i += 1) {
    const a = (i / blobs) * Math.PI * 2 + rand();
    const r = 0.3 + rand() * 0.2;
    const offsetY = i === 0 ? 0.35 : (rand() - 0.3) * 0.3;
    const geo = foliageGeometry(r, rand, FOLIAGE_DARK, FOLIAGE_LIGHT, -0.5, 0.7, offsetY);
    const mesh = new THREE.Mesh(geo, foliageMat);
    mesh.position.set(i === 0 ? 0 : Math.cos(a) * 0.32, offsetY, i === 0 ? 0 : Math.sin(a) * 0.32);
    crown.add(mesh);
  }
  group.add(crown);
  addBlob(group, 0.7, 0.4);
  group.scale.setScalar(scale);
  foliageShadow(shadow(group));
  return { group, crown, phase: rand() * 6 };
}

function buildBush(rand, scale = 1) {
  const group = new THREE.Group();
  const blobs = 2 + Math.floor(rand() * 2);
  for (let i = 0; i < blobs; i += 1) {
    const r = 0.16 + rand() * 0.1;
    const geo = foliageGeometry(r, rand, FOLIAGE_DARK, FOLIAGE_LIGHT, -0.15, 0.3, 0.1);
    const mesh = new THREE.Mesh(geo, foliageMat);
    mesh.position.set((rand() - 0.5) * 0.3, 0.1 + rand() * 0.05, (rand() - 0.5) * 0.3);
    group.add(mesh);
  }
  addBlob(group, 0.35, 0.35);
  group.scale.setScalar(scale);
  return foliageShadow(shadow(group));
}

function buildSky() {
  const uniforms = {
    uTop: { value: new THREE.Color("#3a6cbf") },
    uMid: { value: new THREE.Color("#7fb0e6") },
    uHorizon: { value: new THREE.Color("#ffdcae") },
    uBottom: { value: new THREE.Color("#f3e3d6") },
    uSunDir: { value: SUN.clone() },
    uVivid: { value: 1 }
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uTop, uMid, uHorizon, uBottom, uSunDir;
      uniform float uVivid;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(uHorizon, uMid, smoothstep(-0.02, 0.16, h));
        col = mix(col, uTop, smoothstep(0.18, 0.75, h));
        col = mix(col, uBottom, smoothstep(0.0, -0.25, h));
        float s = max(dot(d, uSunDir), 0.0);
        col += vec3(1.0, 0.62, 0.3) * pow(s, 8.0) * 0.5 * uVivid;
        col += vec3(1.0, 0.85, 0.6) * pow(s, 64.0) * 0.7;
        col = mix(col, vec3(1.0, 0.96, 0.86) * 3.0, smoothstep(0.9988, 0.9994, s));
        float g = dot(col, vec3(0.299, 0.587, 0.114));
        col = mix(vec3(g) * vec3(0.86, 0.88, 0.95), col, 0.3 + 0.7 * uVivid);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }
    `
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 48, 24), material);
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  return { sky, uniforms };
}

// Painted cumulus: a sea of puffs below the planet and a few towering clouds on the horizon.
function buildClouds(rand) {
  const group = new THREE.Group();
  const materials = [3, 17, 29, 41].map(seed => new THREE.SpriteMaterial({
    map: cloudTexture(seed), transparent: true, depthWrite: false, fog: false, color: 0xffffff
  }));
  for (let i = 0; i < 70; i += 1) {
    const angle = rand() * Math.PI * 2;
    const radius = 8 + Math.pow(rand(), 0.6) * 80;
    const s = 9 + rand() * 14 + radius * 0.08;
    const sprite = new THREE.Sprite(materials[i % materials.length]);
    sprite.position.set(Math.cos(angle) * radius, -10 - rand() * 3 - radius * 0.04, Math.sin(angle) * radius);
    sprite.scale.set(s, s * 0.62, 1);
    group.add(sprite);
  }
  for (let k = 0; k < 10; k += 1) {
    const angle = (k / 10) * Math.PI * 2 + rand() * 0.4;
    const radius = 120 + rand() * 40;
    const base = new THREE.Vector3(Math.cos(angle) * radius, -6 + rand() * 6, Math.sin(angle) * radius);
    for (let j = 0; j < 4; j += 1) {
      const s = 34 + rand() * 26 - j * 5;
      const sprite = new THREE.Sprite(materials[(k + j) % materials.length]);
      sprite.position.copy(base).add(new THREE.Vector3((rand() - 0.5) * 30, j * 12 + rand() * 6, (rand() - 0.5) * 30));
      sprite.scale.set(s, s * 0.7, 1);
      group.add(sprite);
    }
  }
  return { group, materials };
}

// Drifting glow motes (fireflies) or fluff, with a per-point phase for twinkle.
function buildMotes(rand, { count, color, size, minLift, maxLift, speed, opacity }) {
  const positions = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    let d = randomDir(rand);
    if (d.dot(POLE) < 0.1) d = d.add(POLE).normalize();
    const r = R + minLift + rand() * (maxLift - minLift);
    positions.set([d.x * r, d.y * r, d.z * r], i * 3);
    phases[i] = rand() * Math.PI * 2;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(color) },
      uSize: { value: size },
      uSpeed: { value: speed },
      uOpacity: { value: opacity },
      uPixelRatio: { value: 1 }
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      uniform float uTime, uSize, uSpeed, uPixelRatio;
      attribute float aPhase;
      varying float vA;
      void main() {
        float t = uTime * uSpeed;
        vec3 p = position + vec3(sin(t * 0.7 + aPhase), cos(t * 0.9 + aPhase * 1.3), sin(t * 0.8 + aPhase * 0.7)) * 0.25;
        vA = 0.55 + 0.45 * sin(uTime * 2.2 + aPhase * 6.0);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = uSize * uPixelRatio / -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d) * vA * uOpacity;
        gl_FragColor = vec4(uColor * a, a);
      }
    `
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  return points;
}

const PATH_ANGLE = THREE.MathUtils.degToRad(33);
const MEADOW = [new THREE.Color("#b4c955"), new THREE.Color("#71a046"), new THREE.Color("#35704c")];
const STRAW = [new THREE.Color("#dcc58a"), new THREE.Color("#bfa36a"), new THREE.Color("#8f7f55")];
const DIRT = new THREE.Color("#d9b98a");
const TMP = new THREE.Color();
const TMP2 = new THREE.Color();

function ramp(stops, t, out) {
  if (t < 0.5) return out.copy(stops[0]).lerp(stops[1], t * 2);
  return out.copy(stops[1]).lerp(stops[2], (t - 0.5) * 2);
}

function groundColor(n, p, health, out) {
  ramp(MEADOW, p, out);
  ramp(STRAW, p, TMP2);
  // Mid scores should still read as a living planet; only low scores turn it to straw.
  out.lerp(TMP2, 1 - THREE.MathUtils.smoothstep(health, 0.05, 0.75));
  return out.offsetHSL(0, 0, (n - 0.5) * 0.06);
}

function buildPlanet() {
  const geometry = new THREE.SphereGeometry(1, 160, 110);
  const pos = geometry.attributes.position;
  const count = pos.count;
  const noise = new Float32Array(count);
  const patches = new Float32Array(count);
  const pathMix = new Float32Array(count);
  const d = new THREE.Vector3();
  for (let i = 0; i < count; i += 1) {
    d.fromBufferAttribute(pos, i).normalize();
    const r = surfaceRadius(d);
    pos.setXYZ(i, d.x * r, d.y * r, d.z * r);
    noise[i] = detail(d);
    patches[i] = patch(d);
    const off = Math.abs(Math.acos(THREE.MathUtils.clamp(d.dot(POLE), -1, 1)) - PATH_ANGLE);
    pathMix[i] = 1 - THREE.MathUtils.smoothstep(off + (noise[i] - 0.5) * 0.01, 0.02, 0.038);
  }
  geometry.computeVertexNormals();
  geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  mesh.receiveShadow = true;

  function recolor(health) {
    const colors = geometry.attributes.color;
    for (let i = 0; i < count; i += 1) {
      groundColor(noise[i], patches[i], health, TMP);
      if (pathMix[i] > 0) TMP.lerp(TMP2.copy(DIRT).offsetHSL(0, 0, (noise[i] - 0.5) * 0.08), pathMix[i]);
      colors.setXYZ(i, TMP.r, TMP.g, TMP.b);
    }
    colors.needsUpdate = true;
  }

  return { mesh, recolor };
}

function scatter(rand, count, blockers, geometry, material, { lift = 0, scaleMin = 0.7, scaleMax = 1.3, tilt = 0.25, avoidPath = false, near = null }) {
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  const dirs = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const q2 = new THREE.Quaternion();
  const e = new THREE.Euler();
  let placed = 0;
  let guard = 0;
  while (placed < count && guard < count * 30) {
    guard += 1;
    const d = near ? near(rand) : randomDir(rand);
    if (blockers.some(b => d.angleTo(b.dir) < b.radius + 0.05)) continue;
    if (avoidPath && Math.abs(d.angleTo(POLE) - PATH_ANGLE) < 0.045) continue;
    const s = scaleMin + rand() * (scaleMax - scaleMin);
    q.setFromUnitVectors(Y, d);
    q2.setFromEuler(e.set((rand() - 0.5) * tilt, rand() * Math.PI * 2, (rand() - 0.5) * tilt));
    q.multiply(q2);
    m.compose(d.clone().multiplyScalar(surfaceRadius(d) + lift * s), q, new THREE.Vector3(s, s, s));
    mesh.setMatrixAt(placed, m);
    dirs.push(d);
    placed += 1;
  }
  mesh.count = placed;
  return { mesh, dirs, max: placed };
}

const BLADE_H = 0.22;

// A tapered, slightly curved blade. Normals point straight up so blades light like the meadow under them.
function bladeGeometry() {
  const geo = new THREE.PlaneGeometry(0.045, BLADE_H, 1, 3);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i += 1) {
    const y = pos.getY(i) + BLADE_H / 2;
    const t = y / BLADE_H;
    pos.setXYZ(i, pos.getX(i) * (1 - t * 0.9), y, t * t * 0.04);
  }
  const normals = geo.attributes.normal;
  for (let i = 0; i < normals.count; i += 1) normals.setXYZ(i, 0, 1, 0);
  return geo;
}

function windMaterial(timeUniform, extra = {}) {
  const material = new THREE.MeshStandardMaterial({ roughness: 0.9, side: THREE.DoubleSide, ...extra });
  material.onBeforeCompile = shader => {
    shader.uniforms.uTime = timeUniform;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;\nvarying float vH;")
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        vH = clamp(position.y / ${BLADE_H.toFixed(3)}, 0.0, 1.0);
        vec3 ip = vec3(0.0);
        #ifdef USE_INSTANCING
          ip = instanceMatrix[3].xyz;
        #endif
        float gust = sin(uTime * 1.6 + ip.x * 0.9 + ip.z * 0.7) + 0.5 * sin(uTime * 2.7 + ip.y * 1.9);
        transformed.x += gust * 0.04 * vH * vH;
        transformed.z += gust * 0.025 * vH * vH;`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vH;")
      .replace("#include <color_fragment>", "#include <color_fragment>\n  diffuseColor.rgb *= mix(0.55, 1.18, vH);");
  };
  return material;
}

// Five-petal flower head, flat and facing up.
function flowerGeometry() {
  const geo = new THREE.CircleGeometry(0.055, 20);
  const pos = geo.attributes.position;
  for (let i = 1; i < pos.count; i += 1) {
    const a = Math.atan2(pos.getY(i), pos.getX(i));
    const r = 0.055 * (0.55 + 0.45 * Math.abs(Math.cos(a * 2.5)));
    pos.setXY(i, Math.cos(a) * r, Math.sin(a) * r);
  }
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0.12, 0);
  return geo;
}

function mossyRockGeometry() {
  const geo = new THREE.IcosahedronGeometry(0.11, 1);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  const stone = new THREE.Color("#a49c96");
  const moss = new THREE.Color("#7fa04a");
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i += 1) {
    v.fromBufferAttribute(pos, i);
    v.multiplyScalar(1 + Math.sin(v.x * 40) * 0.08 + Math.sin(v.z * 33) * 0.06);
    v.y *= 0.7;
    pos.setXYZ(i, v.x, v.y, v.z);
    c.copy(stone).lerp(moss, THREE.MathUtils.smoothstep(v.y, 0.02, 0.07));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

const ROCK_GEO = mossyRockGeometry();
const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });

function buildSpring(rand) {
  const group = new THREE.Group();
  const waterMat = new THREE.MeshStandardMaterial({ color: 0x5cc3dc, roughness: 0.05, metalness: 0.1, emissive: 0x1a6f8a, emissiveIntensity: 0.2 });
  const water = new THREE.Mesh(new THREE.CircleGeometry(0.85, 48), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.04;
  water.receiveShadow = true;
  group.add(water);
  for (let i = 0; i < 18; i += 1) {
    const a = (i / 18) * Math.PI * 2 + rand() * 0.2;
    const stone = new THREE.Mesh(ROCK_GEO, rockMat);
    stone.position.set(Math.cos(a) * 0.95, 0.03, Math.sin(a) * 0.95);
    stone.rotation.y = rand() * 6;
    stone.scale.setScalar(0.9 + rand() * 0.9);
    group.add(stone);
  }
  const padMat = mat(0x5f9a45, { side: THREE.DoubleSide });
  [[0.3, 0.2], [-0.35, -0.1], [0.05, -0.45]].forEach(([x, z], i) => {
    const pad = new THREE.Mesh(new THREE.CircleGeometry(0.11, 16, 0.4, Math.PI * 2 - 0.5), padMat);
    pad.rotation.set(-Math.PI / 2, 0, i * 2);
    pad.position.set(x, 0.05, z);
    group.add(pad);
    if (i === 0) {
      const bloom = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), mat(0xffd0e0));
      bloom.position.set(x, 0.08, z);
      group.add(bloom);
    }
  });
  const reedMat = mat(0x6f8f3a);
  const tipMat = mat(0x7a5232);
  for (let i = 0; i < 7; i += 1) {
    const a = 2.2 + i * 0.14;
    const h = 0.35 + rand() * 0.2;
    const reed = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, h, 5), reedMat);
    reed.position.set(Math.cos(a) * 0.82, h / 2, Math.sin(a) * 0.82);
    reed.rotation.z = (rand() - 0.5) * 0.3;
    group.add(reed);
    if (i % 2 === 0) {
      const tip = new THREE.Mesh(new THREE.CapsuleGeometry(0.02, 0.06, 4, 6), tipMat);
      tip.position.set(reed.position.x, h, reed.position.z);
      group.add(tip);
    }
  }
  const glints = [0, 0.5].map(() => {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.25, 0.28, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    group.add(ring);
    return ring;
  });
  return { group: shadow(group), waterMat, glints };
}

function buildWorkshop() {
  const group = new THREE.Group();
  const plank = textured(woodTexture("#c99059", 3));
  const walls = new THREE.Mesh(new RoundedBoxGeometry(1.0, 0.7, 0.8, 2, 0.035), plank);
  walls.position.y = 0.35;
  group.add(walls);
  const shingles = shingleTexture("#c4553d");
  shingles.center.set(0.5, 0.5);
  shingles.rotation = Math.PI / 2;
  shingles.repeat.set(1.4, 1);
  const roofMat = textured(shingles, { roughness: 0.8 });
  [-1, 1].forEach(side => {
    const slope = new THREE.Mesh(new RoundedBoxGeometry(0.68, 0.07, 1.02, 2, 0.025), roofMat);
    slope.position.set(side * 0.28, 0.87, 0);
    slope.rotation.z = -side * 0.62;
    group.add(slope);
  });
  const ridge = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.04, 8), mat(0x8f3b2a));
  ridge.rotation.x = Math.PI / 2;
  ridge.position.y = 1.07;
  group.add(ridge);
  const gable = new THREE.Shape([new THREE.Vector2(-0.5, 0), new THREE.Vector2(0.5, 0), new THREE.Vector2(0, 0.36)]);
  const gableMat = textured(woodTexture("#b98152", 5), { side: THREE.DoubleSide });
  [-0.4, 0.4].forEach(z => {
    const tri = new THREE.Mesh(new THREE.ShapeGeometry(gable), gableMat);
    tri.position.set(0, 0.7, z);
    group.add(tri);
  });
  const stone = textured(stoneTexture());
  const chimney = new THREE.Mesh(new RoundedBoxGeometry(0.17, 0.55, 0.17, 2, 0.02), stone);
  chimney.position.set(-0.28, 0.98, -0.12);
  group.add(chimney);
  const cap = new THREE.Mesh(new RoundedBoxGeometry(0.22, 0.05, 0.22, 2, 0.015), mat(0x6f6a66));
  cap.position.set(-0.28, 1.27, -0.12);
  group.add(cap);

  const darkWood = mat(0x5a3b28);
  const trim = mat(0xf1e4cc);
  const door = new THREE.Mesh(new RoundedBoxGeometry(0.24, 0.44, 0.04, 2, 0.012), darkWood);
  door.position.set(-0.18, 0.22, 0.41);
  group.add(door);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.015, 8, 6), mat(0xe0b44a, { metalness: 0.6, roughness: 0.4 }));
  knob.position.set(-0.1, 0.22, 0.435);
  group.add(knob);

  const windowMat = new THREE.MeshStandardMaterial({ color: 0x3a2418, emissive: 0xffb455, emissiveIntensity: 0.8 });
  // Windows front and back, so the furnace glow reads from the path and from the door side.
  [0.41, -0.41].forEach(z => {
    const frame = new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.26, 0.03, 2, 0.01), trim);
    frame.position.set(0.22, 0.43, z);
    group.add(frame);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.2), windowMat);
    glass.position.set(0.22, 0.43, z + Math.sign(z) * 0.017);
    if (z < 0) glass.rotation.y = Math.PI;
    group.add(glass);
    [[0.012, 0.2], [0.24, 0.012]].forEach(([w, h]) => {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.01), trim);
      bar.position.set(0.22, 0.43, z + Math.sign(z) * 0.022);
      group.add(bar);
    });
    const box = new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.06, 0.08, 2, 0.01), mat(0x7a4e30));
    box.position.set(0.22, 0.27, z + Math.sign(z) * 0.05);
    group.add(box);
    [0xff9fb8, 0xfff2d6, 0xffc857, 0xff9fb8].forEach((c, k) => {
      const f = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 6), mat(c));
      f.position.set(0.12 + k * 0.065, 0.31, z + Math.sign(z) * 0.05);
      group.add(f);
    });
  });

  const lampPost = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.16, 6), mat(0x2f3440));
  lampPost.rotation.x = Math.PI / 2;
  lampPost.position.set(-0.36, 0.52, 0.47);
  group.add(lampPost);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), new THREE.MeshStandardMaterial({ color: 0xffe6a8, emissive: 0xffc35a, emissiveIntensity: 2 }));
  lamp.position.set(-0.36, 0.48, 0.54);
  group.add(lamp);
  addHalo(group, lamp.position, 0.35);

  const bark = mat(0x7a5232);
  const cut = mat(0xe2b884);
  for (let i = 0; i < 6; i += 1) {
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.4, 10), [bark, cut, cut]);
    log.rotation.x = Math.PI / 2;
    const row = i < 3 ? 0 : i < 5 ? 1 : 2;
    const k = i < 3 ? i : i < 5 ? i - 3 : 0;
    log.position.set(0.62, 0.06 + row * 0.105, -0.12 + k * 0.125 + row * 0.062);
    group.add(log);
  }
  addBlob(group, 0.85, 0.5);
  shadow(group);
  // Smoke as soft rounded puffs that rise and swell, in the same rounded language as the trees.
  const puffs = [];
  const puffGeo = new THREE.IcosahedronGeometry(0.11, 2);
  for (let i = 0; i < 28; i += 1) {
    const sprite = new THREE.Mesh(puffGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0, depthWrite: false }));
    sprite.visible = false;
    group.add(sprite);
    puffs.push({ sprite, age: 0, life: 1, drift: new THREE.Vector2() });
  }
  return { group, windowMat, puffs, emit: new THREE.Vector3(-0.28, 1.3, -0.12), spawn: 0 };
}

function buildLanterns() {
  const group = new THREE.Group();
  const wood = textured(woodTexture("#7a5236", 9));
  const posts = [];
  const glassMats = [];
  const halos = [];
  [-1, 1].forEach(side => {
    const pivot = new THREE.Group();
    pivot.position.x = side * 0.85;
    const post = new THREE.Mesh(new RoundedBoxGeometry(0.07, 0.92, 0.07, 2, 0.015), wood);
    post.position.y = 0.46;
    const arm = new THREE.Mesh(new RoundedBoxGeometry(0.22, 0.04, 0.04, 2, 0.01), wood);
    arm.position.set(-side * 0.08, 0.89, 0);
    const glassMat = new THREE.MeshStandardMaterial({ color: 0xffe3a8, emissive: 0xffb84d, emissiveIntensity: 1.2, roughness: 0.4 });
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.13, 6), glassMat);
    glass.position.set(-side * 0.16, 0.78, 0);
    const frame = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.072, 0.135, 6, 1, true), mat(0x2f3a4f, { wireframe: true }));
    frame.position.copy(glass.position);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.08, 6), mat(0x2f3a4f));
    cap.position.set(-side * 0.16, 0.885, 0);
    pivot.add(post, arm, glass, frame, cap);
    halos.push(addHalo(pivot, glass.position, 0.5));
    group.add(pivot);
    posts.push(pivot);
    glassMats.push(glassMat);
  });
  // Ten separate bulbs, one per point of the love score, so the count can be read at a glance.
  const bulbGeo = new THREE.SphereGeometry(0.05, 16, 12);
  const bulbs = [];
  for (let i = 0; i < 10; i += 1) {
    const bulbMat = new THREE.MeshStandardMaterial({ color: 0x5e5866, emissive: 0xffc861, emissiveIntensity: 0, roughness: 0.5 });
    const bulb = new THREE.Mesh(bulbGeo, bulbMat);
    group.add(bulb);
    bulbs.push(bulb);
  }
  addBlob(group, 1.0, 0.3);
  shadow(group);
  return { group, posts, glassMats, halos, bulbs };
}

function buildBench() {
  const group = new THREE.Group();
  const wood = textured(woodTexture("#a8703f", 13));
  const iron = mat(0x2f3440, { roughness: 0.55, metalness: 0.3 });
  const add = (geo, m, x, y, z, rx = 0) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.rotation.x = rx;
    group.add(mesh);
  };
  [-0.09, 0.03, 0.15].forEach(z => add(new RoundedBoxGeometry(1.0, 0.04, 0.1, 2, 0.015), wood, 0, 0.3, z));
  [0.44, 0.57].forEach(y => add(new RoundedBoxGeometry(1.0, 0.09, 0.035, 2, 0.015), wood, 0, y, -0.17, -0.18));
  [-0.42, 0.42].forEach(x => {
    add(new RoundedBoxGeometry(0.045, 0.3, 0.3, 2, 0.015), iron, x, 0.15, 0.02);
    add(new RoundedBoxGeometry(0.045, 0.36, 0.045, 2, 0.015), iron, x, 0.47, -0.16, -0.18);
  });
  addBlob(group, 0.6, 0.4);
  return { group: shadow(group) };
}

function buildVine(rand) {
  const group = new THREE.Group();
  const knot = new THREE.Group();
  const vineMat = mat(0x5f7a5a, { roughness: 0.9 });
  const core = new THREE.Mesh(new THREE.TorusKnotGeometry(0.34, 0.07, 160, 12, 2, 3), vineMat);
  core.position.y = 0.42;
  core.rotation.x = Math.PI / 2;
  knot.add(core);
  for (let i = 0; i < 4; i += 1) {
    const a = (i / 4) * Math.PI * 2 + 0.3;
    const root = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.05, 8, 20, Math.PI * 0.8), vineMat);
    root.position.set(Math.cos(a) * 0.32, 0.02, Math.sin(a) * 0.32);
    root.rotation.set(0, -a, 0);
    knot.add(root);
  }
  const leafMat = mat(0x5e8a3c, { side: THREE.DoubleSide });
  const leafGeo = new THREE.SphereGeometry(0.05, 8, 6);
  for (let i = 0; i < 22; i += 1) {
    const a = rand() * Math.PI * 2;
    const leaf = new THREE.Mesh(leafGeo, leafMat);
    leaf.scale.set(1.4, 0.3, 0.8);
    leaf.position.set(Math.cos(a) * (0.3 + rand() * 0.15), 0.2 + rand() * 0.45, Math.sin(a) * (0.3 + rand() * 0.15));
    leaf.rotation.set(rand() * 2, rand() * 6, rand() * 2);
    knot.add(leaf);
  }
  const thornMat = mat(0x6e5236);
  for (let i = 0; i < 14; i += 1) {
    const a = i * 2.4;
    const thorn = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.09, 5), thornMat);
    thorn.position.set(Math.cos(a) * 0.42, 0.3 + (i % 4) * 0.08, Math.sin(a) * 0.42);
    thorn.rotation.set(Math.sin(a) * 1.2, 0, -Math.cos(a) * 1.2);
    knot.add(thorn);
  }
  addBlob(knot, 0.6, 0.4);
  group.add(shadow(knot));

  const sprout = new THREE.Group();
  const glowMat = new THREE.MeshStandardMaterial({ color: 0x7fe0c8, emissive: 0x2fd3b0, emissiveIntensity: 0.9, roughness: 0.5 });
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.22, 6), glowMat);
  stem.position.y = 0.11;
  sprout.add(stem);
  [-1, 1].forEach(side => {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 6), glowMat);
    leaf.scale.set(1.5, 0.35, 0.8);
    leaf.position.set(side * 0.07, 0.22, 0);
    leaf.rotation.z = side * -0.5;
    sprout.add(leaf);
  });
  addHalo(sprout, new THREE.Vector3(0, 0.2, 0), 0.45, 0x7ff0d0);
  sprout.position.set(0.85, 0, 0.25);
  sprout.visible = false;
  group.add(sprout);
  return { group, knot, sprout, glowMat };
}

function buildSignpost() {
  const group = new THREE.Group();
  const wood = textured(woodTexture("#9a6a42", 21));
  const post = new THREE.Mesh(new RoundedBoxGeometry(0.08, 1.1, 0.08, 2, 0.015), wood);
  post.position.y = 0.55;
  group.add(post);
  const boardMat = textured(woodTexture("#e0c08c", 23));
  [[0.95, 0.35], [0.74, -0.45]].forEach(([y, rot]) => {
    const board = new THREE.Mesh(new RoundedBoxGeometry(0.52, 0.14, 0.035, 2, 0.012), boardMat);
    board.position.set(0.12, y, 0);
    board.rotation.y = rot;
    group.add(board);
  });
  const lectern = new THREE.Mesh(new RoundedBoxGeometry(0.26, 0.03, 0.2, 2, 0.01), wood);
  lectern.position.set(0, 0.48, 0.1);
  lectern.rotation.x = -0.35;
  group.add(lectern);
  const book = new THREE.Mesh(new RoundedBoxGeometry(0.22, 0.04, 0.16, 2, 0.01), mat(0xc8443c));
  book.position.set(0, 0.51, 0.1);
  book.rotation.x = -0.35;
  group.add(book);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), new THREE.MeshStandardMaterial({ color: 0xffe2a0, emissive: 0xffc35a, emissiveIntensity: 1.8 }));
  lamp.position.y = 1.16;
  group.add(lamp);
  const halo = addHalo(group, lamp.position, 0.45);
  addBlob(group, 0.3, 0.4);
  return { group: shadow(group), gem: lamp, halo };
}

export function buildTraveler() {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const jacket = mat(0xb4654a, { roughness: 0.8 });
  const pants = mat(0x3a3d46);
  const skin = mat(0xf2cfb2, { roughness: 0.7 });
  const hairMat = mat(0x3b2a20);
  const beanieMat = mat(0x3d7f7b, { roughness: 0.95 });

  const legs = [-1, 1].map(side => {
    const pivot = new THREE.Group();
    // Longer legs and a smaller head than a chibi doll: a small traveler rather than a toy.
    pivot.position.set(side * 0.07, 0.38, 0);
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.046, 0.28, 4, 10), pants);
    leg.position.y = -0.18;
    const boot = new THREE.Mesh(new RoundedBoxGeometry(0.1, 0.07, 0.16, 2, 0.025), mat(0x6b4429));
    boot.position.set(0, -0.36, 0.02);
    pivot.add(leg, boot);
    body.add(pivot);
    return pivot;
  });

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.2, 6, 16), jacket);
  torso.position.y = 0.57;
  torso.scale.set(0.92, 1.05, 0.8);
  body.add(torso);
  const hem = new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.02, 6, 20), mat(0x9a4628));
  hem.rotation.x = Math.PI / 2;
  hem.position.y = 0.43;
  hem.scale.multiplyScalar(0.92);
  hem.scale.set(1, 0.85, 1);
  body.add(hem);
  const zip = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.3, 0.01), mat(0x8f3f22));
  zip.position.set(0, 0.58, 0.128);
  body.add(zip);

  const arms = [-1, 1].map(side => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.17, 0.7, 0);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.22, 4, 10), jacket);
    arm.position.y = -0.13;
    arm.rotation.z = side * 0.12;
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.043, 10, 8), skin);
    hand.position.set(side * 0.018, -0.28, 0);
    pivot.add(arm, hand);
    body.add(pivot);
    return pivot;
  });
  // Walking stick in the right hand.
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.8, 8), mat(0x7a5634));
  stick.position.set(0.02, -0.25, 0.06);
  arms[1].add(stick);

  const head = new THREE.Group();
  head.position.y = 0.93;
  head.scale.setScalar(0.84);
  head.add(new THREE.Mesh(new THREE.SphereGeometry(0.165, 28, 20), skin));
  [-1, 1].forEach(side => {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.019, 10, 8), mat(0x2a2230, { roughness: 0.3 }));
    eye.position.set(side * 0.056, 0, 0.152);
    eye.scale.y = 1.25;
    head.add(eye);
  });
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.17, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), hairMat);
  hair.rotation.x = -0.5;
  head.add(hair);
  const beanie = new THREE.Mesh(new THREE.SphereGeometry(0.177, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.45), beanieMat);
  beanie.position.y = 0.03;
  head.add(beanie);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.032, 10, 28), beanieMat);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.06;
  head.add(rim);
  const pompom = new THREE.Mesh(new THREE.IcosahedronGeometry(0.052, 2), mat(0xf3ead8, { roughness: 1 }));
  pompom.position.y = 0.215;
  head.add(pompom);
  body.add(head);

  // Backpack: the pack itself, a rolled sleeping mat on top and a small lantern on the side.
  const pack = new THREE.Group();
  pack.position.set(0, 0.58, -0.19);
  const canvas = mat(0x8c7a4e, { roughness: 0.95 });
  const bag = new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.38, 0.18, 3, 0.05), canvas);
  pack.add(bag);
  const pocket = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.14, 0.06, 2, 0.02), mat(0x6f6140));
  pocket.position.set(0, -0.08, -0.11);
  pack.add(pocket);
  const bedroll = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.42, 16), mat(0xd4553a));
  bedroll.rotation.z = Math.PI / 2;
  bedroll.position.set(0, 0.25, 0.01);
  pack.add(bedroll);
  [-0.12, 0.12].forEach(x => {
    const tie = new THREE.Mesh(new THREE.TorusGeometry(0.078, 0.008, 6, 16), mat(0x3b2a20));
    tie.rotation.y = Math.PI / 2;
    tie.position.set(x, 0.25, 0.01);
    pack.add(tie);
  });
  const charm = new THREE.Group();
  charm.position.set(0.17, 0.08, 0);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), new THREE.MeshStandardMaterial({ color: 0xffe6a8, emissive: 0xffc35a, emissiveIntensity: 1.8 }));
  lamp.position.y = -0.07;
  charm.add(lamp);
  addHalo(charm, lamp.position, 0.22);
  pack.add(charm);
  body.add(pack);
  [-1, 1].forEach(side => {
    const strap = new THREE.Mesh(new RoundedBoxGeometry(0.045, 0.3, 0.02, 2, 0.008), mat(0x5f5236));
    strap.position.set(side * 0.09, 0.61, 0.13);
    body.add(strap);
  });

  addBlob(group, 0.3, 0.45);
  shadow(group);
  return { group, body, legs, arms, head, pack, charm };
}

function buildFarPlanets(rand) {
  const defs = [
    { id: "gravity", name: "引力星", sub: "重力问题", color: 0x7a6cc0, pos: [-26, 9, -16], r: 2.3, ring: 0xe6c97a },
    { id: "compass", name: "指南针星", sub: "工作观与人生观", color: 0x5d95d6, pos: [-6, 15, -30], r: 1.6, needle: true },
    { id: "flow", name: "心流星", sub: "心流与能量", color: 0x4fc2b0, pos: [-34, 3, 14], r: 2.2, glow: 0x9ff5e0 },
    { id: "anchor", name: "锚点星", sub: "锚点", color: 0xc08a66, pos: [12, 12, -26], r: 1.8, anchor: true },
    { id: "crossroads", name: "三岔路星", sub: "奥德赛计划", color: 0xe8bb84, pos: [30, 7, -6], r: 2.6, roads: true }
  ];
  return defs.map((def, i) => {
    const group = new THREE.Group();
    const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(def.r, 5), new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.95 }));
    group.add(ball);
    if (def.ring) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(def.r * 1.6, def.r * 0.06, 8, 64), new THREE.MeshStandardMaterial({ color: def.ring, roughness: 0.6 }));
      ring.rotation.x = Math.PI / 2.4;
      group.add(ring);
    }
    if (def.needle) {
      const needle = new THREE.Group();
      const north = new THREE.Mesh(new THREE.ConeGeometry(0.25, 1.2, 4), mat(0xe0475a));
      north.position.y = 0.6;
      const south = new THREE.Mesh(new THREE.ConeGeometry(0.25, 1.2, 4), mat(0xf3ead8));
      south.position.y = -0.6;
      south.rotation.z = Math.PI;
      needle.add(north, south);
      needle.rotation.z = Math.PI / 2;
      needle.position.y = def.r + 0.5;
      group.add(needle);
    }
    if (def.glow) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(def.r * 1.05, def.r * 0.08, 8, 48), new THREE.MeshStandardMaterial({ color: def.glow, emissive: def.glow, emissiveIntensity: 1.4 }));
      band.rotation.x = Math.PI / 2 - 0.3;
      group.add(band);
    }
    if (def.anchor) {
      const metal = mat(0x3c4250, { roughness: 0.5 });
      const shank = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.2, 8), metal);
      shank.position.y = def.r + 0.6;
      const hook = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.09, 8, 20, Math.PI), metal);
      hook.rotation.z = Math.PI;
      hook.position.y = def.r + 0.15;
      const eye = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.06, 8, 16), metal);
      eye.position.y = def.r + 1.3;
      group.add(shank, hook, eye);
    }
    if (def.roads) {
      [0xe0475a, 0x3476d9, 0x1f9c8c].forEach((c, k) => {
        const road = new THREE.Mesh(new THREE.TorusGeometry(def.r * 1.01, def.r * 0.05, 6, 40, Math.PI * 0.7), new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.35 }));
        road.rotation.set(Math.PI / 2, 0, (k * Math.PI * 2) / 3);
        group.add(road);
      });
    }
    group.position.set(...def.pos);
    return { ...def, group, hit: [ball], phase: rand() * Math.PI * 2 + i };
  });
}

export function createWorld(canvas) {
  const mobile = window.innerWidth < 700 || matchMedia("(pointer: coarse)").matches;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  let pixelRatio = Math.min(window.devicePixelRatio || 1, mobile ? 1.75 : 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xf0e2d4, 45, 120);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 600);
  const timeUniform = { value: 0 };

  const rand = rng(612);
  const { sky, uniforms: skyUniforms } = buildSky();
  scene.add(sky);

  // Image-based light from the painted sky: soft, colour-matched ambient for every material.
  const envScene = new THREE.Scene();
  const envSky = sky.clone();
  envSky.material = sky.material.clone();
  envScene.add(envSky);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(envScene, 0.04, 0.1, 1000).texture;
  pmrem.dispose();

  const clouds = buildClouds(rand);
  scene.add(clouds.group);

  const hemi = new THREE.HemisphereLight(0xd6e6ff, 0x6b8a4e, 0.45);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe0b5, 2.6);
  sun.position.copy(SUN).multiplyScalar(30);
  sun.castShadow = true;
  const shadowSize = mobile ? 1024 : 2048;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -9;
  sc.right = sc.top = 9;
  sc.near = 10;
  sc.far = 50;
  sun.shadow.bias = -0.0005;
  sun.shadow.radius = 6;
  sun.shadow.blurSamples = 12;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(0xc4d2ff, 0.3);
  fill.position.copy(SUN).multiplyScalar(-1).add(Y.clone().multiplyScalar(1.2)).multiplyScalar(20);
  scene.add(fill);

  const planet = buildPlanet();
  scene.add(planet.mesh);

  const spring = buildSpring(rand);
  const workshop = buildWorkshop();
  const lanterns = buildLanterns();
  const bench = buildBench();
  const vine = buildVine(rand);
  const sign = buildSignpost();

  const benchDir = TERMINATOR.clone().multiplyScalar(0.97).add(SUN.clone().multiplyScalar(0.26)).normalize();
  const layout = {
    spring: { dir: dirAt(34, 120), radius: 1.15 / R, labelHeight: 0.7, focus: 1.1, parts: [spring.group] },
    workshop: { dir: dirAt(40, 190), radius: 0.85 / R, labelHeight: 1.55, focus: 1.3, parts: [workshop.group] },
    bench: { dir: benchDir, radius: 0.55 / R, labelHeight: 1.0, focus: 0.85, parts: [bench.group] },
    lanterns: { dir: dirAt(32, 52), radius: 0.9 / R, labelHeight: 1.25, focus: 1.05, parts: [lanterns.group] },
    vine: { dir: dirAt(40, 255), radius: 0.6 / R, labelHeight: 1.1, focus: 1.2, parts: [vine.group] },
    sign: { dir: dirAt(20, 305), radius: 0.25 / R, labelHeight: 1.45, focus: 0.9, parts: [sign.group] }
  };

  placeOnPlanet(spring.group, layout.spring.dir, 0, -0.03);
  placeOnPlanet(workshop.group, layout.workshop.dir, yawToward(layout.workshop.dir, POLE), -0.03);
  placeOnPlanet(lanterns.group, layout.lanterns.dir, yawToward(layout.lanterns.dir, POLE), -0.02);
  placeOnPlanet(bench.group, benchDir, yawToward(benchDir, SUN), -0.02);
  placeOnPlanet(vine.group, layout.vine.dir, yawToward(layout.vine.dir, POLE), -0.03);
  placeOnPlanet(sign.group, layout.sign.dir, yawToward(layout.sign.dir, POLE) + 0.6, -0.02);
  [spring.group, workshop.group, lanterns.group, bench.group, vine.group, sign.group].forEach(g => scene.add(g));

  // Scale animations driven by world time: pop-ins on load, squash-and-stretch on celebrations.
  const pops = [];
  let clockTime = 0;
  function popIn(obj, delay, from = 0) {
    pops.push({ obj, base: obj.scale.clone(), start: delay, kind: "in", from });
    obj.scale.copy(obj.scale).multiplyScalar(Math.max(from, 0.0001));
  }
  function squash(obj, amount = 0.22) {
    for (let i = pops.length - 1; i >= 0; i -= 1) if (pops[i].obj === obj && pops[i].kind === "squash") pops.splice(i, 1);
    pops.push({ obj, base: obj.userData.baseScale || obj.scale.clone(), start: clockTime, kind: "squash", amount });
  }
  [spring.group, workshop.group, lanterns.group, bench.group, vine.group, sign.group].forEach((g, i) => {
    g.userData.baseScale = g.scale.clone();
    popIn(g, 0.05 + i * 0.06, 0.6);
  });

  // Objects with a clear front get framed from it when their sheet opens.
  layout.workshop.front = Z.clone().applyQuaternion(workshop.group.quaternion);
  layout.lanterns.front = Z.clone().applyQuaternion(lanterns.group.quaternion);

  const blockers = Object.values(layout).map(item => ({ dir: item.dir, radius: item.radius }));

  // Trees ring the lived-in area; bushes fill gaps. Both block walking like the props do.
  const trees = [];
  const treeSpots = [[58, 20, 1.1], [62, 95, 0.95], [55, 150, 1.2], [64, 225, 1.0], [58, 285, 1.15], [70, 330, 0.9], [100, 60, 1.3], [105, 200, 1.25], [120, 300, 1.2], [140, 120, 1.3], [150, 250, 1.1]];
  treeSpots.forEach(([a, b, s]) => {
    const dir = dirAt(a, b);
    if (blockers.some(item => dir.angleTo(item.dir) < item.radius + 0.18)) return;
    const tree = buildTree(rand, s);
    placeOnPlanet(tree.group, dir, rand() * 6, -0.04);
    scene.add(tree.group);
    popIn(tree.group, 0.15 + trees.length * 0.05);
    trees.push(tree);
    blockers.push({ dir, radius: (0.22 * s) / R });
  });
  const bushes = [];
  for (let i = 0; i < 26; i += 1) {
    const dir = randomDir(rand);
    if (blockers.some(item => dir.angleTo(item.dir) < item.radius + 0.12)) continue;
    if (Math.abs(dir.angleTo(POLE) - PATH_ANGLE) < 0.07) continue;
    const bush = buildBush(rand, 0.8 + rand() * 0.7);
    placeOnPlanet(bush, dir, rand() * 6, -0.02);
    scene.add(bush);
    bushes.push(bush);
  }

  const grassCount = mobile ? 4200 : 6500;
  const grass = scatter(rand, grassCount, blockers, bladeGeometry(), windMaterial(timeUniform), { scaleMin: 0.7, scaleMax: 1.5, tilt: 0.5, avoidPath: true });
  const grassNoise = grass.dirs.map(d => ({ n: detail(d) * 0.6 + rand() * 0.4, p: patch(d) }));
  scene.add(grass.mesh);

  const flowers = scatter(rand, 420, blockers, flowerGeometry(), new THREE.MeshStandardMaterial({ roughness: 0.7, side: THREE.DoubleSide }), { avoidPath: true, tilt: 0.3 });
  const flowerPalette = [0xffffff, 0xfff1a8, 0xffb7cc, 0xd6c2ff, 0xffd27a].map(c => new THREE.Color(c));
  for (let i = 0; i < flowers.max; i += 1) flowers.mesh.setColorAt(i, flowerPalette[Math.floor(rand() * flowerPalette.length)]);
  scene.add(flowers.mesh);

  const rocks = scatter(rand, 70, blockers, ROCK_GEO, rockMat, { scaleMin: 0.5, scaleMax: 1.8, tilt: 0.4 });
  rocks.mesh.castShadow = true;
  rocks.mesh.receiveShadow = true;
  scene.add(rocks.mesh);

  const fireflies = buildMotes(rand, { count: 70, color: 0xfff09a, size: 26, minLift: 0.25, maxLift: 1.4, speed: 0.5, opacity: 0.9 });
  const fluff = buildMotes(rand, { count: 40, color: 0xffffff, size: 18, minLift: 0.6, maxLift: 3.2, speed: 0.25, opacity: 0.45 });
  scene.add(fireflies, fluff);

  // Footstep dust, kicked up by main.js as the traveler walks.
  const dust = Array.from({ length: 14 }, () => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: SOFT, color: 0xe6d2ad, transparent: true, opacity: 0, depthWrite: false }));
    sprite.visible = false;
    scene.add(sprite);
    return { sprite, age: 0, up: new THREE.Vector3() };
  });
  let dustIndex = 0;
  function kickDust(position, up) {
    const d = dust[dustIndex];
    dustIndex = (dustIndex + 1) % dust.length;
    d.sprite.position.copy(position).addScaledVector(up, 0.05);
    d.up.copy(up);
    d.age = 0;
    d.sprite.visible = true;
  }

  const farPlanets = buildFarPlanets(rand);
  farPlanets.forEach(p => scene.add(p.group));

  const objects = {};
  Object.entries(layout).forEach(([id, item]) => {
    const hit = [];
    item.parts.forEach(part => part.traverse(node => { if (node.isMesh && !node.userData.noShadow) hit.push(node); }));
    objects[id] = { id, ...item, hit, reach: item.radius + 0.1 };
  });

  // The sky environment lights everything softly; keep it below the sun so forms still read.
  scene.traverse(node => {
    const list = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
    list.forEach(m => { if (m.isMeshStandardMaterial) m.envMapIntensity = 0.45; });
  });

  const post = createPost(renderer, scene, camera);
  let tiltShift = true;

  const current = { health: 0.5, work: 0.5, play: 0.5, love: 0.5, gravity: 0, designable: 0, problem: 0 };
  const target = { ...current };
  // The four dashboard values move on a slightly underdamped spring, so a change overshoots and settles.
  const velocity = { health: 0, work: 0, play: 0, love: 0 };
  let colorHealth = -1;
  const tmpColor = new THREE.Color();
  const windowCalm = new THREE.Color(0xffb455);
  const windowHot = new THREE.Color(0xff2a00);
  const smokeDark = new THREE.Color(0x3b3742);
  const smokeLight = new THREE.Color(0xfff6f0);
  const murky = new THREE.Color(0x8a8650);
  const clear = new THREE.Color(0x5cc3dc);
  const horizonVivid = new THREE.Color("#ffdcae");
  const horizonDull = new THREE.Color("#b7bcc8");
  const midDay = skyUniforms.uMid.value.clone();
  const topDay = skyUniforms.uTop.value.clone();
  const midDusk = new THREE.Color("#ffb489");
  const horizonDusk = new THREE.Color("#ffa877");
  const bottomDay = skyUniforms.uBottom.value.clone();
  const bottomDusk = new THREE.Color("#ffc39b");
  const topDusk = new THREE.Color("#8a76b8");
  const fogTint = new THREE.Color(0xf3e3d6);
  const cloudVivid = new THREE.Color(0xffffff);
  const cloudDull = new THREE.Color(0xb8bcc9);
  const bulbOn = new THREE.Color(0xffc861);
  const bulbOff = new THREE.Color(0x000000);
  const lanternA = new THREE.Vector3();
  const lanternB = new THREE.Vector3();

  function setTargets(next) {
    Object.assign(target, next);
  }

  function snap() {
    Object.assign(current, target);
    Object.keys(velocity).forEach(key => { velocity[key] = 0; });
  }

  // Celebration timers (world time when each started) for one-off reactions to a confirmed answer.
  const fx = { glint: -10, orb: -10, bulbs: -10, gem: -10, flash: -10, sprout: -10 };
  const bumpAt = (start, duration) => {
    const t = (clockTime - start) / duration;
    return t > 0 && t < 1 ? Math.sin(t * Math.PI) : 0;
  };

  function celebrate(id) {
    const group = { spring: spring.group, workshop: workshop.group, lanterns: lanterns.group, bench: bench.group, vine: vine.group, sign: sign.group }[id];
    if (group) squash(group);
    if (id === "spring") fx.glint = clockTime;
    else if (id === "workshop") {
      fx.flash = clockTime;
      workshop.spawn += 6;
    } else if (id === "lanterns") fx.bulbs = clockTime;
    else if (id === "vine") fx.sprout = clockTime;
    else if (id === "sign") fx.gem = clockTime;
  }

  let diaryReady = false;
  function setDiaryReady(ready) {
    diaryReady = ready;
  }

  // In close-ups, hide trees and bushes that sit between the camera and the subject.
  let cull = null;
  const cullTmp = new THREE.Vector3();
  function setNearCull(dir, look) {
    cull = dir ? { dir, look } : null;
  }

  function applyHealth(h) {
    if (Math.abs(h - colorHealth) < 0.004) return;
    colorHealth = h;
    planet.recolor(h);
    for (let i = 0; i < grass.max; i += 1) {
      groundColor(grassNoise[i].n, grassNoise[i].p, h, tmpColor);
      tmpColor.offsetHSL(0, 0.04, 0.03);
      grass.mesh.setColorAt(i, tmpColor);
    }
    grass.mesh.instanceColor.needsUpdate = true;
    flowers.mesh.count = Math.round(flowers.max * (0.12 + 0.88 * h));
    spring.waterMat.color.copy(murky).lerp(clear, h);
    spring.waterMat.roughness = 0.35 - h * 0.3;
  }

  function updateWorkshop(v, dt, time) {
    const w = current.work;
    // An overworked furnace: the window burns red and flickers, the chimney pours dark smoke.
    v.windowMat.emissive.copy(windowCalm).lerp(windowHot, THREE.MathUtils.clamp((1 - w) * 1.4 - 0.2, 0, 1));
    v.windowMat.emissiveIntensity = 0.9 + Math.sin(time * 9) * 0.3 * (1 - w);
    const rate = 1.5 + (1 - w) * 12;
    v.spawn += dt * rate;
    while (v.spawn >= 1) {
      v.spawn -= 1;
      const puff = v.puffs.find(p => !p.sprite.visible);
      if (!puff) break;
      puff.age = 0;
      puff.life = 2.2 + Math.random() * 1.6;
      puff.drift.set((Math.random() - 0.5) * 0.25, (Math.random() - 0.5) * 0.25);
      puff.sprite.visible = true;
      puff.sprite.position.copy(v.emit);
    }
    v.puffs.forEach(p => {
      if (!p.sprite.visible) return;
      p.age += dt;
      const k = p.age / p.life;
      if (k >= 1) {
        p.sprite.visible = false;
        return;
      }
      p.sprite.position.y += dt * (0.35 + (1 - w) * 0.25);
      p.sprite.position.x += p.drift.x * dt;
      p.sprite.position.z += p.drift.y * dt;
      const size = 0.7 + k * (1.6 + (1 - w) * 1.8);
      p.sprite.scale.set(size, size, size);
      p.sprite.material.color.copy(smokeLight).lerp(smokeDark, THREE.MathUtils.smoothstep(1 - w, 0.25, 0.8));
      p.sprite.material.opacity = Math.min(1, Math.sin(k * Math.PI) * 1.5) * (0.55 + (1 - w) * 0.4);
    });
  }

  function update(dt, time) {
    timeUniform.value = time;
    clockTime = time;
    const k = 1 - Math.exp(-dt * 2.5);
    Object.keys(current).forEach(key => {
      if (key in velocity) {
        velocity[key] += ((target[key] - current[key]) * 45 - velocity[key] * 7.5) * dt;
        current[key] = THREE.MathUtils.clamp(current[key] + velocity[key] * dt, -0.05, 1.05);
      } else {
        current[key] += (target[key] - current[key]) * k;
      }
    });

    pops.forEach(p => {
      const t = time - p.start;
      if (t < 0) return;
      if (p.kind === "in") {
        const u = Math.min(1, t / 0.55);
        // Ease-out-back: lands slightly oversized, then settles.
        const c = 2.2;
        const e = 1 + (c + 1) * Math.pow(u - 1, 3) + c * Math.pow(u - 1, 2);
        p.obj.scale.copy(p.base).multiplyScalar(p.from + (1 - p.from) * e);
        if (u >= 1) p.done = true;
      } else {
        const sy = 1 - p.amount * Math.sin(t * 14) * Math.exp(-t * 5);
        const sxz = 1 / Math.sqrt(sy);
        p.obj.scale.set(p.base.x * sxz, p.base.y * sy, p.base.z * sxz);
        if (t > 1.2) {
          p.obj.scale.copy(p.base);
          p.done = true;
        }
      }
    });
    for (let i = pops.length - 1; i >= 0; i -= 1) if (pops[i].done) pops.splice(i, 1);

    applyHealth(THREE.MathUtils.clamp(current.health, 0, 1));
    const burst = bumpAt(fx.glint, 1.2);
    spring.glints.forEach((ring, i) => {
      const phase = (time * 0.45 + i * 0.5) % 1;
      ring.scale.setScalar(0.6 + phase * 2 + burst * 0.8);
      ring.material.opacity = Math.min(1, 0.3 * (1 - phase) * Math.max(current.health, 0) + burst * 0.6);
    });

    updateWorkshop(workshop, dt, time);

    // Twin lanterns: brighter, leaning in, and more of the string lit as love rises.
    const love = current.love;
    lanterns.posts.forEach((p, i) => {
      p.rotation.z = (i === 0 ? -1 : 1) * (love * 0.3 - 0.12);
      lanterns.glassMats[i].emissiveIntensity = 0.15 + love * 2.2 + Math.sin(time * 2 + i) * 0.08;
      lanterns.halos[i].material.opacity = 0.1 + love * 0.6;
      lanterns.halos[i].scale.setScalar(0.3 + love * 0.4);
    });
    lanterns.posts[0].updateMatrix();
    lanterns.posts[1].updateMatrix();
    lanternA.set(0.16, 0.74, 0).applyMatrix4(lanterns.posts[0].matrix);
    lanternB.set(-0.16, 0.74, 0).applyMatrix4(lanterns.posts[1].matrix);
    // Exactly as many bulbs are lit as the score (by target, so the count never shows half a bulb).
    const lit = Math.round(THREE.MathUtils.clamp(target.love, 0, 1) * lanterns.bulbs.length);
    lanterns.bulbs.forEach((bulb, i) => {
      const t = (i + 1) / (lanterns.bulbs.length + 1);
      bulb.position.lerpVectors(lanternA, lanternB, t);
      bulb.position.y -= Math.sin(t * Math.PI) * (0.1 + (1 - love) * 0.14);
      // Light spreads in from both ends, meeting in the middle.
      const fromEdge = Math.min(i, lanterns.bulbs.length - 1 - i);
      const rank = fromEdge * 2 + (i < lanterns.bulbs.length / 2 ? 0 : 1);
      const on = rank < lit ? 1 : 0;
      bulb.material.color.set(on ? 0xffd27a : 0x5e5866);
      bulb.material.emissive.copy(bulbOff).lerp(bulbOn, on);
      // Kept modest so each bulb stays a distinct dot rather than one bloom streak.
      bulb.material.emissiveIntensity = 0.7;
      bulb.scale.setScalar(1 + bumpAt(fx.bulbs + fromEdge * 0.09, 0.35) * 0.9 * on);
    });

    const play = current.play;
    skyUniforms.uVivid.value = play;
    // Near the top of the scale the whole sky turns to evening glow, horizon included.
    const glowK = THREE.MathUtils.smoothstep(play, 0.7, 1);
    skyUniforms.uHorizon.value.copy(horizonDull).lerp(horizonVivid, play).lerp(horizonDusk, glowK * 0.85);
    skyUniforms.uMid.value.copy(midDay).lerp(midDusk, glowK);
    skyUniforms.uTop.value.copy(topDay).lerp(topDusk, glowK);
    skyUniforms.uBottom.value.copy(bottomDay).lerp(bottomDusk, glowK * 0.8);
    scene.fog.color.copy(skyUniforms.uHorizon.value).lerp(fogTint, 0.6);
    clouds.materials.forEach(m => m.color.copy(cloudDull).lerp(cloudVivid, play));
    sun.intensity = 1.4 + play * 1.6;

    const knotScale = current.problem < 0.5 ? 0.45 : 0.4 + current.gravity * 1.2;
    vine.knot.scale.setScalar(knotScale);
    vine.sprout.visible = current.problem > 0.5;
    vine.sprout.scale.setScalar((0.6 + current.designable * 1.6) * (1 + bumpAt(fx.sprout + 0.4, 0.6) * 0.6));
    vine.glowMat.emissiveIntensity = 0.6 + Math.sin(time * 2.4) * 0.35;

    // The diary is the last stop: its lamp stays dim until the score stops are done.
    sign.gem.material.emissiveIntensity = (diaryReady ? 1.8 : 0.15) + bumpAt(fx.gem, 1) * 2;
    sign.halo.visible = diaryReady;
    workshop.windowMat.emissiveIntensity += bumpAt(fx.flash, 0.5) * 1.5;

    trees.forEach(tree => {
      tree.crown.rotation.z = Math.sin(time * 0.9 + tree.phase) * 0.025;
      tree.crown.rotation.x = Math.sin(time * 0.7 + tree.phase * 1.3) * 0.02;
      tree.group.visible = !cull || cullTmp.copy(tree.group.position).sub(cull.look).dot(cull.dir) < 1.2;
    });
    bushes.forEach(bush => {
      bush.visible = !cull || cullTmp.copy(bush.position).sub(cull.look).dot(cull.dir) < 1.2;
    });
    fireflies.material.uniforms.uTime.value = time;
    fluff.material.uniforms.uTime.value = time;
    dust.forEach(d => {
      if (!d.sprite.visible) return;
      d.age += dt;
      const t = d.age / 0.7;
      if (t >= 1) {
        d.sprite.visible = false;
        return;
      }
      d.sprite.position.addScaledVector(d.up, dt * 0.25);
      d.sprite.scale.setScalar(0.12 + t * 0.25);
      d.sprite.material.opacity = (1 - t) * 0.5;
    });

    clouds.group.rotation.y = time * 0.004;
    farPlanets.forEach(p => {
      p.group.position.y = p.pos[1] + Math.sin(time * 0.4 + p.phase) * 0.6;
      p.group.rotation.y = time * 0.08 + p.phase;
    });
  }

  function setSize(w, h) {
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(w, h, false);
    post.setSize(w, h, pixelRatio);
    [fireflies, fluff].forEach(m => { m.material.uniforms.uPixelRatio.value = pixelRatio * (h / 800); });
  }

  // Quality steps for slower phones: 2 = everything, 1 = no tilt-shift and a lower resolution, 0 = no bloom or soft shadows.
  function setQuality(level) {
    tiltShift = level >= 2;
    post.setTiltShift(tiltShift);
    post.setBloom(level >= 1);
    if (level < 2) pixelRatio = Math.min(pixelRatio, 1.25);
    if (level < 1) {
      pixelRatio = 1;
      renderer.shadowMap.type = THREE.PCFShadowMap;
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
    setSize(window.innerWidth, window.innerHeight);
  }

  function render(cam, time) {
    sky.position.copy(cam.position);
    post.render(cam, time);
  }

  // Render one frame from `cam` into a square image (for the postcard): planet and sky dome only,
  // without clouds or fog, so it can be faded softly into the card.
  function snapshot(cam, size) {
    renderer.setPixelRatio(1);
    renderer.setSize(size, size, false);
    post.setSize(size, size, 1);
    post.setTiltShift(false);
    clouds.group.visible = false;
    sky.position.copy(cam.position);
    const fog = scene.fog;
    scene.fog = null;
    post.render(cam, 0);
    scene.fog = fog;
    clouds.group.visible = true;
    post.setTiltShift(tiltShift);
    const out = document.createElement("canvas");
    out.width = out.height = size;
    out.getContext("2d").drawImage(renderer.domElement, 0, 0, size, size);
    setSize(window.innerWidth, window.innerHeight);
    return out;
  }

  return {
    renderer, scene, camera, sky, objects, farPlanets, blockers,
    setTargets, snap, update, render, setSize, setQuality, snapshot, kickDust, celebrate, setDiaryReady, setNearCull,
    setFocus: post.setFocus
  };
}
