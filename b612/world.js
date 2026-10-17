import * as THREE from "../vendor/three.module.min.js";

export const R = 6;
const BUMP = 0.1;
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

export const SUN = new THREE.Vector3(0.6, 0.18, 0.78).normalize();
// The lived-in side of the planet: half-way between the sun and "up".
export const POLE = SUN.clone().add(Y.clone().multiplyScalar(0.9)).normalize();
// Topmost point of the day/night line, where the sunset chair sits.
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

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...extra });

function shadow(obj) {
  obj.traverse(node => {
    if (node.isMesh) {
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });
  return obj;
}

function softTexture() {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.45, "rgba(255,255,255,0.55)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildSky() {
  const uniforms = {
    uTop: { value: new THREE.Color("#2b2350") },
    uMid: { value: new THREE.Color("#8a5f9e") },
    uHorizon: { value: new THREE.Color("#ffb486") },
    uBottom: { value: new THREE.Color("#f6c6c9") },
    uSunDir: { value: SUN.clone() },
    uVivid: { value: 1 }
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    toneMapped: false,
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
        vec3 col = mix(uHorizon, uMid, smoothstep(0.02, 0.3, h));
        col = mix(col, uTop, smoothstep(0.25, 0.8, h));
        col = mix(col, uBottom, smoothstep(0.0, -0.25, h));
        float s = max(dot(d, uSunDir), 0.0);
        col += vec3(1.0, 0.55, 0.25) * pow(s, 10.0) * 0.55 * uVivid;
        col += vec3(1.0, 0.8, 0.55) * pow(s, 60.0) * 0.6;
        col = mix(col, vec3(1.0, 0.93, 0.8), smoothstep(0.9988, 0.9994, s));
        float g = dot(col, vec3(0.299, 0.587, 0.114));
        col = mix(vec3(g) * vec3(0.82, 0.84, 0.95), col, 0.3 + 0.7 * uVivid);
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

function buildStars(rand) {
  const count = 700;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const d = randomDir(rand);
    d.y = Math.abs(d.y) * 0.9 + 0.1;
    d.normalize().multiplyScalar(280);
    positions.set([d.x, d.y, d.z], i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({ color: 0xfff4e0, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.55, fog: false, depthWrite: false });
  const stars = new THREE.Points(geometry, material);
  stars.frustumCulled = false;
  return stars;
}

function buildClouds(rand) {
  const count = 230;
  const geometry = new THREE.IcosahedronGeometry(1, 2);
  const material = new THREE.MeshStandardMaterial({ color: 0xffe6ee, emissive: 0xff9fb6, emissiveIntensity: 0.18, roughness: 1, flatShading: false });
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  for (let i = 0; i < count; i += 1) {
    const angle = rand() * Math.PI * 2;
    const radius = 6 + Math.pow(rand(), 0.6) * 85;
    const s = 2.5 + rand() * 5;
    const pos = new THREE.Vector3(Math.cos(angle) * radius, -11 - rand() * 2.5 - radius * 0.05, Math.sin(angle) * radius);
    q.setFromAxisAngle(Y, rand() * Math.PI);
    m.compose(pos, q, new THREE.Vector3(s, s * 0.3, s * (0.8 + rand() * 0.4)));
    mesh.setMatrixAt(i, m);
  }
  mesh.receiveShadow = false;
  const group = new THREE.Group();
  group.add(mesh);
  return group;
}

const PATH_ANGLE = THREE.MathUtils.degToRad(33);
const LUSH = new THREE.Color();
const DRY = new THREE.Color();
const DIRT = new THREE.Color();
const TMP = new THREE.Color();

function grassColor(n, health, out) {
  LUSH.setHSL(0.28 + n * 0.06, 0.6, 0.26 + n * 0.12);
  DRY.setHSL(0.1 + n * 0.03, 0.45, 0.43 + n * 0.08);
  // Mid scores should still read as a living planet; only low scores turn it to straw.
  return out.copy(DRY).lerp(LUSH, THREE.MathUtils.smoothstep(health, 0.05, 0.75));
}

function buildPlanet() {
  const geometry = new THREE.SphereGeometry(1, 144, 96);
  const pos = geometry.attributes.position;
  const count = pos.count;
  const noise = new Float32Array(count);
  const pathMix = new Float32Array(count);
  const d = new THREE.Vector3();
  for (let i = 0; i < count; i += 1) {
    d.fromBufferAttribute(pos, i).normalize();
    const r = surfaceRadius(d);
    pos.setXYZ(i, d.x * r, d.y * r, d.z * r);
    noise[i] = detail(d);
    const off = Math.abs(Math.acos(THREE.MathUtils.clamp(d.dot(POLE), -1, 1)) - PATH_ANGLE);
    pathMix[i] = 1 - THREE.MathUtils.smoothstep(off, 0.022, 0.04);
  }
  geometry.computeVertexNormals();
  geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
  mesh.receiveShadow = true;

  function recolor(health) {
    const colors = geometry.attributes.color;
    for (let i = 0; i < count; i += 1) {
      grassColor(noise[i], health, TMP);
      if (pathMix[i] > 0) {
        DIRT.setHSL(0.08, 0.32, 0.5 + noise[i] * 0.08);
        TMP.lerp(DIRT, pathMix[i]);
      }
      colors.setXYZ(i, TMP.r, TMP.g, TMP.b);
    }
    colors.needsUpdate = true;
  }

  return { mesh, recolor };
}

function scatter(rand, count, blockers, geometry, material, { lift = 0, scaleMin = 0.7, scaleMax = 1.3, tilt = 0.25, avoidPath = false }) {
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
    const d = randomDir(rand);
    if (blockers.some(b => d.angleTo(b.dir) < b.radius + 0.05)) continue;
    if (avoidPath && Math.abs(d.angleTo(POLE) - PATH_ANGLE) < 0.05) continue;
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

function buildSpring() {
  const group = new THREE.Group();
  const waterMat = new THREE.MeshStandardMaterial({ color: 0x5fc4e8, roughness: 0.12, metalness: 0.15, emissive: 0x1a5f80, emissiveIntensity: 0.25 });
  const water = new THREE.Mesh(new THREE.CircleGeometry(0.85, 40), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.04;
  water.receiveShadow = true;
  group.add(water);
  const stoneMat = mat(0x9b938d, { flatShading: true });
  for (let i = 0; i < 16; i += 1) {
    const a = (i / 16) * Math.PI * 2;
    const r = 0.1 + ((i * 37) % 7) / 60;
    const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), stoneMat);
    stone.position.set(Math.cos(a) * 0.95, 0.04, Math.sin(a) * 0.95);
    stone.rotation.set(a, a * 2, 0);
    group.add(stone);
  }
  const glint = new THREE.Mesh(new THREE.RingGeometry(0.25, 0.3, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }));
  glint.rotation.x = -Math.PI / 2;
  glint.position.y = 0.05;
  group.add(glint);
  return { group: shadow(group), waterMat, glint };
}

function buildVolcano(scale, smokeTex) {
  const group = new THREE.Group();
  const profile = [[0.95, 0], [0.82, 0.1], [0.58, 0.4], [0.36, 0.68], [0.3, 0.74], [0.21, 0.67], [0, 0.63]]
    .map(([x, y]) => new THREE.Vector2(x * scale, y * scale));
  const cone = new THREE.Mesh(new THREE.LatheGeometry(profile, 20), mat(0x6f5a55, { flatShading: true }));
  const lavaMat = new THREE.MeshStandardMaterial({ color: 0xff6a2a, emissive: 0xff4a10, emissiveIntensity: 1.2, roughness: 0.6 });
  const lava = new THREE.Mesh(new THREE.CircleGeometry(0.22 * scale, 16), lavaMat);
  lava.rotation.x = -Math.PI / 2;
  lava.position.y = 0.66 * scale;
  group.add(shadow(cone), lava);
  const puffs = [];
  for (let i = 0; i < 26; i += 1) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
    sprite.visible = false;
    group.add(sprite);
    puffs.push({ sprite, age: 0, life: 1, drift: new THREE.Vector2() });
  }
  return { group, lavaMat, puffs, top: 0.74 * scale, spawn: 0, scale };
}

function buildRose() {
  const group = new THREE.Group();
  const stemPivot = new THREE.Group();
  const green = mat(0x3f7d3a);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.028, 0.6, 8), green);
  stem.position.y = 0.3;
  stemPivot.add(stem);
  [-1, 1].forEach(side => {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 6), green);
    leaf.scale.set(1.6, 0.35, 0.8);
    leaf.position.set(side * 0.08, 0.22 + side * 0.06, 0);
    leaf.rotation.z = side * 0.5;
    stemPivot.add(leaf);
  });
  const bloom = new THREE.Group();
  bloom.position.y = 0.62;
  const petalMat = new THREE.MeshStandardMaterial({ color: 0xe0233f, roughness: 0.55, side: THREE.DoubleSide });
  const petalGeo = new THREE.SphereGeometry(0.075, 12, 8);
  const petals = [];
  [[7, 0.055, 1], [5, 0.03, 0.75]].forEach(([n, offset, size], layer) => {
    for (let i = 0; i < n; i += 1) {
      const pivot = new THREE.Group();
      pivot.rotation.y = (i / n) * Math.PI * 2 + layer * 0.4;
      const petal = new THREE.Mesh(petalGeo, petalMat);
      petal.scale.set(size, size * 1.6, size * 0.45);
      petal.position.set(0, 0.09 * size, offset);
      pivot.add(petal);
      bloom.add(pivot);
      petals.push({ pivot, layer });
    }
  });
  const bud = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), petalMat);
  bud.position.y = 0.06;
  bloom.add(bud);
  stemPivot.add(bloom);
  group.add(shadow(stemPivot));

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(0.46, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xe8f4ff, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.18, depthWrite: false })
  );
  dome.scale.y = 1.75;
  group.add(dome);

  const wood = mat(0x8a5e3c);
  const fence = new THREE.Group();
  for (let i = 0; i < 4; i += 1) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.06), wood);
    post.position.set(-0.45 + i * 0.3, 0.25, 0);
    fence.add(post);
  }
  [0.18, 0.36].forEach(y => {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.05, 0.04), wood);
    rail.position.set(0, y, 0);
    fence.add(rail);
  });
  fence.position.z = -0.7;
  group.add(shadow(fence));
  return { group, stemPivot, petals, petalMat, bloom };
}

function buildChair() {
  const group = new THREE.Group();
  const wood = mat(0x7b5236);
  const add = (w, h, d, x, y, z) => {
    const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wood);
    box.position.set(x, y, z);
    group.add(box);
  };
  add(0.46, 0.05, 0.42, 0, 0.32, 0);
  [[-0.2, -0.18], [0.2, -0.18], [-0.2, 0.18], [0.2, 0.18]].forEach(([x, z]) => add(0.05, 0.32, 0.05, x, 0.16, z));
  [-0.2, 0.2].forEach(x => add(0.05, 0.5, 0.05, x, 0.58, -0.19));
  [0.48, 0.62, 0.76].forEach(y => add(0.42, 0.06, 0.03, 0, y, -0.19));
  return { group: shadow(group) };
}

function buildBaobab() {
  const group = new THREE.Group();
  const tree = new THREE.Group();
  const bark = mat(0x8c6a50, { flatShading: true });
  const trunkProfile = [[0.3, 0], [0.34, 0.12], [0.3, 0.45], [0.2, 0.85], [0.22, 1.0], [0, 1.02]]
    .map(([x, y]) => new THREE.Vector2(x, y));
  tree.add(new THREE.Mesh(new THREE.LatheGeometry(trunkProfile, 12), bark));
  const leaves = mat(0x45703c, { flatShading: true });
  for (let i = 0; i < 5; i += 1) {
    const a = (i / 5) * Math.PI * 2;
    const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.07, 0.5, 6), bark);
    branch.position.set(Math.cos(a) * 0.18, 1.12, Math.sin(a) * 0.18);
    branch.rotation.set(Math.sin(a) * 0.8, 0, -Math.cos(a) * 0.8);
    tree.add(branch);
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(0.26, 0), leaves);
    crown.position.set(Math.cos(a) * 0.42, 1.36, Math.sin(a) * 0.42);
    crown.scale.y = 0.55;
    tree.add(crown);
  }
  group.add(shadow(tree));

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
  sprout.position.set(0.85, 0, 0.25);
  sprout.visible = false;
  group.add(sprout);
  return { group, tree, sprout, glowMat };
}

function buildSignpost() {
  const group = new THREE.Group();
  const wood = mat(0x8a6040);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.1, 8), wood);
  post.position.y = 0.55;
  group.add(post);
  const boardMat = mat(0xd9b98c);
  [[0.95, 0.35], [0.74, -0.45]].forEach(([y, rot]) => {
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.14, 0.03), boardMat);
    board.position.set(0.12, y, 0);
    board.rotation.y = rot;
    group.add(board);
  });
  const book = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.28), mat(0xc8443c));
  book.position.set(0, 0.5, 0.08);
  book.rotation.x = -0.3;
  group.add(book);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), new THREE.MeshStandardMaterial({ color: 0xffe2a0, emissive: 0xffc35a, emissiveIntensity: 1.4 }));
  lamp.position.y = 1.16;
  group.add(lamp);
  return { group: shadow(group) };
}

export function buildTraveler() {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const coat = mat(0x2f6f78);
  const legMat = mat(0x2c2a3a);
  const skin = mat(0xf2d0b4);
  const hairMat = mat(0xe6b64c, { flatShading: true });
  const scarfMat = mat(0xf0a53a, { side: THREE.DoubleSide });

  const legs = [-1, 1].map(side => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.07, 0.3, 0);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.3, 8), legMat);
    leg.position.y = -0.15;
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.05, 0.13), mat(0x5a3b2a));
    boot.position.set(0, -0.29, 0.02);
    pivot.add(leg, boot);
    body.add(pivot);
    return pivot;
  });

  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.24, 0.42, 14), coat);
  torso.position.y = 0.47;
  body.add(torso);

  const arms = [-1, 1].map(side => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.15, 0.62, 0);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.28, 8), coat);
    arm.position.y = -0.14;
    arm.rotation.z = side * 0.18;
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), skin);
    hand.position.set(side * 0.025, -0.29, 0);
    pivot.add(arm, hand);
    body.add(pivot);
    return pivot;
  });

  const head = new THREE.Group();
  head.position.y = 0.84;
  head.add(new THREE.Mesh(new THREE.SphereGeometry(0.17, 20, 14), skin));
  [-1, 1].forEach(side => {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), mat(0x2a2230));
    eye.position.set(side * 0.06, 0.01, 0.155);
    head.add(eye);
    const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), mat(0xf2a3a0));
    cheek.position.set(side * 0.1, -0.04, 0.13);
    cheek.scale.z = 0.4;
    head.add(cheek);
  });
  const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.175, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), hairMat);
  hairCap.position.y = 0.02;
  hairCap.rotation.x = -0.25;
  head.add(hairCap);
  for (let i = 0; i < 11; i += 1) {
    const a = (i / 11) * Math.PI * 2;
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.14, 5), hairMat);
    const tilt = 0.9 + (i % 3) * 0.15;
    spike.position.set(Math.cos(a) * 0.13, 0.1 + (i % 2) * 0.03, Math.sin(a) * 0.13 - 0.02);
    spike.rotation.set(Math.sin(a) * tilt, 0, -Math.cos(a) * tilt);
    head.add(spike);
  }
  body.add(head);

  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.045, 8, 18), scarfMat);
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 0.68;
  body.add(collar);
  // Scarf tail: a chain of pivots so it can ripple behind while walking.
  const scarf = [];
  let parent = new THREE.Group();
  parent.position.set(0.06, 0.68, -0.1);
  body.add(parent);
  for (let i = 0; i < 6; i += 1) {
    const seg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.012, 0.11), scarfMat);
    seg.position.z = -0.055;
    parent.add(seg);
    const next = new THREE.Group();
    next.position.z = -0.11;
    parent.add(next);
    scarf.push(parent);
    parent = next;
  }

  shadow(group);
  return { group, body, legs, arms, head, scarf };
}

function buildFarPlanets(rand) {
  const defs = [
    { id: "king", name: "国王星", sub: "重力问题", color: 0x8d6fd1, pos: [-26, 9, -16], r: 2.1, ring: 0xe8c66a },
    { id: "lamp", name: "点灯人星", sub: "心流", color: 0xe39a52, pos: [-6, 15, -30], r: 1.5, lamp: true },
    { id: "merchant", name: "商人星", sub: "人生观", color: 0x4f86c6, pos: [-34, 3, 14], r: 2.5 },
    { id: "fox", name: "麦田星", sub: "锚点", color: 0xd8b45a, pos: [12, 12, -26], r: 1.8 },
    { id: "desert", name: "三口井", sub: "奥德赛计划", color: 0xe2b07a, pos: [30, 7, -6], r: 2.8, ring: 0xf6dfb4 }
  ];
  return defs.map((def, i) => {
    const group = new THREE.Group();
    const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(def.r, 3), new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.9, flatShading: true }));
    group.add(ball);
    if (def.ring) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(def.r * 1.6, def.r * 0.06, 6, 48), new THREE.MeshStandardMaterial({ color: def.ring, roughness: 0.6 }));
      ring.rotation.x = Math.PI / 2.4;
      group.add(ring);
    }
    if (def.lamp) {
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 8), new THREE.MeshStandardMaterial({ color: 0xffe6a0, emissive: 0xffc14a, emissiveIntensity: 2.2 }));
      lamp.position.y = def.r + 0.5;
      group.add(lamp);
    }
    group.position.set(...def.pos);
    return { ...def, group, hit: [ball], phase: rand() * Math.PI * 2 + i };
  });
}

export function createWorld(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xf3b8a8, 40, 110);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 600);

  const rand = rng(612);
  const { sky, uniforms: skyUniforms } = buildSky();
  scene.add(sky);
  const stars = buildStars(rand);
  scene.add(stars);
  const clouds = buildClouds(rand);
  scene.add(clouds);

  const hemi = new THREE.HemisphereLight(0xffd9c4, 0x5d4a7e, 0.8);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffc28a, 3);
  sun.position.copy(SUN).multiplyScalar(30);
  sun.castShadow = true;
  const shadowSize = window.innerWidth < 700 ? 1024 : 2048;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -9;
  sc.right = sc.top = 9;
  sc.near = 10;
  sc.far = 50;
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(0xb9c2ff, 0.55);
  fill.position.copy(SUN).multiplyScalar(-1).add(Y.clone().multiplyScalar(1.2)).multiplyScalar(20);
  scene.add(fill);

  const planet = buildPlanet();
  scene.add(planet.mesh);

  const smokeTex = softTexture();
  const spring = buildSpring();
  const volcanoA = buildVolcano(1, smokeTex);
  const volcanoB = buildVolcano(0.72, smokeTex);
  const rose = buildRose();
  const chair = buildChair();
  const baobab = buildBaobab();
  const sign = buildSignpost();

  const chairDir = TERMINATOR.clone().multiplyScalar(0.97).add(SUN.clone().multiplyScalar(0.26)).normalize();
  const layout = {
    spring: { dir: dirAt(34, 120), radius: 1.15 / R, labelHeight: 0.7, focus: 1.1, parts: [spring.group] },
    volcano: { dir: dirAt(38, 182), radius: 1.0 / R, labelHeight: 1.3, focus: 1.4, parts: [volcanoA.group, volcanoB.group] },
    chair: { dir: chairDir, radius: 0.38 / R, labelHeight: 1.1, focus: 0.8, parts: [chair.group] },
    rose: { dir: dirAt(32, 52), radius: 0.55 / R, labelHeight: 1.15, focus: 0.75, parts: [rose.group] },
    baobab: { dir: dirAt(40, 255), radius: 0.55 / R, labelHeight: 1.0, focus: 1.3, parts: [baobab.group] },
    sign: { dir: dirAt(20, 305), radius: 0.25 / R, labelHeight: 1.45, focus: 0.9, parts: [sign.group] }
  };
  const volcanoBDir = dirAt(50, 202);

  placeOnPlanet(spring.group, layout.spring.dir, 0, -0.03);
  placeOnPlanet(volcanoA.group, layout.volcano.dir, 0, -0.04);
  placeOnPlanet(volcanoB.group, volcanoBDir, 1, -0.04);
  placeOnPlanet(rose.group, layout.rose.dir, yawToward(layout.rose.dir, POLE), -0.02);
  placeOnPlanet(chair.group, chairDir, yawToward(chairDir, SUN), -0.02);
  placeOnPlanet(baobab.group, layout.baobab.dir, yawToward(layout.baobab.dir, POLE), -0.03);
  placeOnPlanet(sign.group, layout.sign.dir, yawToward(layout.sign.dir, POLE) + 0.6, -0.02);
  [spring.group, volcanoA.group, volcanoB.group, rose.group, chair.group, baobab.group, sign.group].forEach(g => scene.add(g));

  const blockers = [
    ...Object.values(layout).map(item => ({ dir: item.dir, radius: item.radius })),
    { dir: volcanoBDir, radius: 0.75 / R }
  ];

  const grassGeo = new THREE.ConeGeometry(0.018, 0.15, 3);
  grassGeo.translate(0, 0.075, 0);
  const grass = scatter(rand, 2600, blockers, grassGeo, new THREE.MeshStandardMaterial({ roughness: 1 }), { scaleMin: 0.6, scaleMax: 1.5, tilt: 0.5, avoidPath: true });
  const grassNoise = grass.dirs.map(d => detail(d) * 0.7 + rand() * 0.3);
  scene.add(grass.mesh);

  const flowerGeo = new THREE.SphereGeometry(0.045, 6, 4);
  flowerGeo.translate(0, 0.08, 0);
  const flowers = scatter(rand, 320, blockers, flowerGeo, new THREE.MeshStandardMaterial({ roughness: 0.7 }), { avoidPath: true });
  const flowerPalette = [0xffb3c7, 0xffffff, 0xffe27a, 0xc9a7ff, 0xff8a8a].map(c => new THREE.Color(c));
  for (let i = 0; i < flowers.max; i += 1) flowers.mesh.setColorAt(i, flowerPalette[Math.floor(rand() * flowerPalette.length)]);
  scene.add(flowers.mesh);

  const rocks = scatter(rand, 60, blockers, new THREE.DodecahedronGeometry(0.1, 0), mat(0x8f8790, { flatShading: true }), { scaleMin: 0.6, scaleMax: 2.2, tilt: 1.5 });
  rocks.mesh.castShadow = true;
  scene.add(rocks.mesh);

  const farPlanets = buildFarPlanets(rand);
  farPlanets.forEach(p => scene.add(p.group));

  const objects = {};
  Object.entries(layout).forEach(([id, item]) => {
    const hit = [];
    item.parts.forEach(part => part.traverse(node => { if (node.isMesh) hit.push(node); }));
    objects[id] = { id, ...item, hit, reach: item.radius + 0.1 };
  });

  const current = { health: 0.5, work: 0.5, play: 0.5, love: 0.5, gravity: 0, designable: 0, problem: 0 };
  const target = { ...current };
  let colorHealth = -1;
  const tmpColor = new THREE.Color();
  const wilted = new THREE.Color(0x6e3138);
  const vivid = new THREE.Color(0xe31e3f);
  const lavaCalm = new THREE.Color(0xff8a3a);
  const smokeDark = new THREE.Color(0x2a2328);
  const smokeLight = new THREE.Color(0xfff6f0);
  const murky = new THREE.Color(0x7d7a45);
  const clear = new THREE.Color(0x58c6ea);
  const horizonVivid = new THREE.Color("#ffb486");
  const horizonDull = new THREE.Color("#c9b7c4");

  function setTargets(next) {
    Object.assign(target, next);
  }

  function snap() {
    Object.assign(current, target);
  }

  function applyHealth(h) {
    if (Math.abs(h - colorHealth) < 0.004) return;
    colorHealth = h;
    planet.recolor(h);
    for (let i = 0; i < grass.max; i += 1) {
      grassColor(grassNoise[i], h, tmpColor);
      tmpColor.multiplyScalar(1.12);
      grass.mesh.setColorAt(i, tmpColor);
    }
    grass.mesh.instanceColor.needsUpdate = true;
    flowers.mesh.count = Math.round(flowers.max * (0.12 + 0.88 * h));
    spring.waterMat.color.copy(murky).lerp(clear, h);
    spring.waterMat.emissiveIntensity = 0.08 + 0.3 * h;
  }

  function updateVolcano(v, dt, time) {
    const w = current.work;
    v.lavaMat.emissiveIntensity = 0.4 + (1 - w) * 2.4 + Math.sin(time * 3 + v.scale * 5) * 0.15 * (1 - w);
    v.lavaMat.color.copy(lavaCalm);
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
      puff.sprite.position.set(0, v.top, 0);
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
      const size = (0.2 + k * (0.7 + (1 - w) * 0.7)) * v.scale;
      p.sprite.scale.set(size, size, size);
      p.sprite.material.color.copy(smokeLight).lerp(smokeDark, (1 - w) * 0.9);
      p.sprite.material.opacity = Math.sin(k * Math.PI) * (0.25 + (1 - w) * 0.55);
    });
  }

  function update(dt, time) {
    const k = 1 - Math.exp(-dt * 2.5);
    Object.keys(current).forEach(key => { current[key] += (target[key] - current[key]) * k; });

    applyHealth(current.health);
    spring.glint.scale.setScalar(1 + ((time * 0.6) % 1) * 1.6);
    spring.glint.material.opacity = 0.35 * (1 - ((time * 0.6) % 1)) * current.health;

    updateVolcano(volcanoA, dt, time);
    updateVolcano(volcanoB, dt, time);

    const love = current.love;
    rose.petalMat.color.copy(wilted).lerp(vivid, love);
    rose.petals.forEach(p => { p.pivot.rotation.x = (p.layer === 0 ? 0.15 + love * 0.95 : 0.05 + love * 0.45); });
    rose.bloom.scale.setScalar(0.75 + love * 0.45);
    rose.stemPivot.rotation.z = (1 - love) * 0.55 + Math.sin(time * 1.3) * 0.03;

    const play = current.play;
    skyUniforms.uVivid.value = play;
    skyUniforms.uHorizon.value.copy(horizonDull).lerp(horizonVivid, play);
    scene.fog.color.copy(skyUniforms.uHorizon.value).lerp(new THREE.Color(0xf6c6c9), 0.4);
    sun.intensity = 2 + play * 1.4;
    stars.material.opacity = 0.35 + (1 - play) * 0.35;

    const treeScale = current.problem < 0.5 ? 0.3 : 0.35 + current.gravity * 1.3;
    baobab.tree.scale.setScalar(treeScale);
    baobab.sprout.visible = current.problem > 0.5;
    baobab.sprout.scale.setScalar(0.6 + current.designable * 1.6);
    baobab.glowMat.emissiveIntensity = 0.6 + Math.sin(time * 2.4) * 0.35;

    clouds.rotation.y = time * 0.004;
    farPlanets.forEach(p => {
      p.group.position.y = p.pos[1] + Math.sin(time * 0.4 + p.phase) * 0.6;
      p.group.rotation.y = time * 0.08 + p.phase;
    });
  }

  return { renderer, scene, camera, sky, objects, farPlanets, blockers, setTargets, snap, update };
}
