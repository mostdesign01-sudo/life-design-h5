import * as THREE from "../vendor/three.module.min.js";

export const R = 6;
const BUMP = 0.1;
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

export const SUN = new THREE.Vector3(0.6, 0.18, 0.78).normalize();
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
    uTop: { value: new THREE.Color("#141c44") },
    uMid: { value: new THREE.Color("#3f5f9c") },
    uHorizon: { value: new THREE.Color("#ffc59a") },
    uBottom: { value: new THREE.Color("#cfd2ec") },
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
  const material = new THREE.MeshStandardMaterial({ color: 0xeef0ff, emissive: 0x9aa8ff, emissiveIntensity: 0.14, roughness: 1, flatShading: false });
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

function buildWorkshop(smokeTex) {
  const group = new THREE.Group();
  const plank = mat(0xb98b5c);
  const walls = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.7, 0.8), plank);
  walls.position.y = 0.35;
  group.add(walls);
  const roofMat = mat(0x5d6f8f);
  [-1, 1].forEach(side => {
    const slope = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.05, 0.96), roofMat);
    slope.position.set(side * 0.27, 0.86, 0);
    slope.rotation.z = -side * 0.62;
    group.add(slope);
  });
  const gable = new THREE.Shape([new THREE.Vector2(-0.5, 0), new THREE.Vector2(0.5, 0), new THREE.Vector2(0, 0.36)]);
  [-0.4, 0.4].forEach(z => {
    const tri = new THREE.Mesh(new THREE.ShapeGeometry(gable), plank);
    tri.position.set(0, 0.7, z);
    tri.material = plank.clone();
    tri.material.side = THREE.DoubleSide;
    group.add(tri);
  });
  const stone = mat(0x8c8a92, { flatShading: true });
  const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.55, 0.16), stone);
  chimney.position.set(-0.28, 0.98, -0.12);
  group.add(chimney);
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.42, 0.03), mat(0x5a3b28));
  door.position.set(-0.18, 0.21, 0.41);
  group.add(door);
  const windowMat = new THREE.MeshStandardMaterial({ color: 0x3a2418, emissive: 0xffb455, emissiveIntensity: 0.8 });
  // Windows front and back, so the furnace glow reads from the path and from the door side.
  [0.41, -0.41].forEach(z => {
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.2, 0.03), windowMat);
    win.position.set(0.22, 0.42, z);
    group.add(win);
  });
  const logMat = mat(0x8a5e3c);
  for (let i = 0; i < 5; i += 1) {
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.4, 8), logMat);
    log.rotation.x = Math.PI / 2;
    log.position.set(0.62, 0.06 + Math.floor(i / 3) * 0.11, -0.12 + (i % 3) * 0.13 - Math.floor(i / 3) * 0.06);
    group.add(log);
  }
  shadow(group);
  const puffs = [];
  for (let i = 0; i < 28; i += 1) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
    sprite.visible = false;
    group.add(sprite);
    puffs.push({ sprite, age: 0, life: 1, drift: new THREE.Vector2() });
  }
  return { group, windowMat, puffs, emit: new THREE.Vector3(-0.28, 1.28, -0.12), spawn: 0 };
}

function buildLanterns() {
  const group = new THREE.Group();
  const wood = mat(0x6b4a33);
  const posts = [];
  const glassMats = [];
  [-1, 1].forEach(side => {
    const pivot = new THREE.Group();
    pivot.position.x = side * 0.5;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.9, 8), wood);
    post.position.y = 0.45;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.03, 0.03), wood);
    arm.position.set(-side * 0.08, 0.88, 0);
    const glassMat = new THREE.MeshStandardMaterial({ color: 0xffe3a8, emissive: 0xffb84d, emissiveIntensity: 1.2, roughness: 0.4 });
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.14, 6), glassMat);
    glass.position.set(-side * 0.16, 0.78, 0);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.07, 6), mat(0x2f3a4f));
    cap.position.set(-side * 0.16, 0.88, 0);
    pivot.add(post, arm, glass, cap);
    group.add(pivot);
    posts.push(pivot);
    glassMats.push(glassMat);
  });
  const bulbGeo = new THREE.SphereGeometry(0.03, 8, 6);
  const bulbs = [];
  for (let i = 0; i < 9; i += 1) {
    const bulbMat = new THREE.MeshStandardMaterial({ color: 0xfff1c9, emissive: 0xffc861, emissiveIntensity: 1 });
    const bulb = new THREE.Mesh(bulbGeo, bulbMat);
    group.add(bulb);
    bulbs.push(bulb);
  }
  shadow(group);
  return { group, posts, glassMats, bulbs };
}

function buildBench() {
  const group = new THREE.Group();
  const wood = mat(0x8f5f3a);
  const iron = mat(0x2f3440, { roughness: 0.6 });
  const add = (geo, m, x, y, z, rx = 0) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.rotation.x = rx;
    group.add(mesh);
  };
  [-0.08, 0.04].forEach(z => add(new THREE.BoxGeometry(0.96, 0.04, 0.1), wood, 0, 0.3, z));
  [0.42, 0.54].forEach(y => add(new THREE.BoxGeometry(0.96, 0.08, 0.03), wood, 0, y, -0.16, -0.18));
  [-0.42, 0.42].forEach(x => {
    add(new THREE.BoxGeometry(0.04, 0.3, 0.26), iron, x, 0.15, -0.02);
    add(new THREE.BoxGeometry(0.04, 0.34, 0.04), iron, x, 0.46, -0.15, -0.18);
  });
  return { group: shadow(group) };
}

function buildVine() {
  const group = new THREE.Group();
  const knot = new THREE.Group();
  const vineMat = mat(0x4e5a34, { flatShading: true });
  const core = new THREE.Mesh(new THREE.TorusKnotGeometry(0.34, 0.075, 90, 8, 2, 3), vineMat);
  core.position.y = 0.42;
  core.rotation.x = Math.PI / 2;
  knot.add(core);
  for (let i = 0; i < 4; i += 1) {
    const a = (i / 4) * Math.PI * 2 + 0.3;
    const root = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.05, 6, 16, Math.PI * 0.8), vineMat);
    root.position.set(Math.cos(a) * 0.32, 0.02, Math.sin(a) * 0.32);
    root.rotation.set(0, -a, 0);
    knot.add(root);
  }
  const thornMat = mat(0x6e5236);
  for (let i = 0; i < 14; i += 1) {
    const a = i * 2.4;
    const thorn = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.1, 4), thornMat);
    thorn.position.set(Math.cos(a) * 0.42, 0.3 + (i % 4) * 0.08, Math.sin(a) * 0.42);
    thorn.rotation.set(Math.sin(a) * 1.2, 0, -Math.cos(a) * 1.2);
    knot.add(thorn);
  }
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
  sprout.position.set(0.85, 0, 0.25);
  sprout.visible = false;
  group.add(sprout);
  return { group, knot, sprout, glowMat };
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
  const jacket = mat(0xc8643b);
  const pants = mat(0x3a3d46);
  const skin = mat(0xf0cdb0);
  const hairMat = mat(0x3b2a20);
  const beanieMat = mat(0x2a8c88);

  const legs = [-1, 1].map(side => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.07, 0.3, 0);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.3, 8), pants);
    leg.position.y = -0.15;
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.15), mat(0x6b4429));
    boot.position.set(0, -0.28, 0.02);
    pivot.add(leg, boot);
    body.add(pivot);
    return pivot;
  });

  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.19, 0.36, 14), jacket);
  torso.position.y = 0.48;
  body.add(torso);
  const zip = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.32, 0.01), mat(0x8f3f22));
  zip.position.set(0, 0.48, 0.17);
  body.add(zip);

  const arms = [-1, 1].map(side => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.18, 0.62, 0);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.28, 8), jacket);
    arm.position.y = -0.14;
    arm.rotation.z = side * 0.12;
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.042, 8, 6), skin);
    hand.position.set(side * 0.018, -0.29, 0);
    pivot.add(arm, hand);
    body.add(pivot);
    return pivot;
  });
  // Walking stick in the right hand.
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.78, 6), mat(0x7a5634));
  stick.position.set(0.02, -0.25, 0.06);
  arms[1].add(stick);

  const head = new THREE.Group();
  head.position.y = 0.84;
  head.add(new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 14), skin));
  [-1, 1].forEach(side => {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.017, 8, 6), mat(0x2a2230));
    eye.position.set(side * 0.055, 0, 0.148);
    head.add(eye);
    const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.024, 8, 6), mat(0xeea08f));
    cheek.position.set(side * 0.095, -0.045, 0.125);
    cheek.scale.z = 0.4;
    head.add(cheek);
  });
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.165, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), hairMat);
  hair.rotation.x = -0.5;
  head.add(hair);
  const beanie = new THREE.Mesh(new THREE.SphereGeometry(0.172, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.45), beanieMat);
  beanie.position.y = 0.03;
  head.add(beanie);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.03, 8, 24), beanieMat);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.06;
  head.add(rim);
  const pompom = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), mat(0xf3ead8));
  pompom.position.y = 0.21;
  head.add(pompom);
  body.add(head);

  // Backpack: the pack itself, a rolled sleeping mat on top and a small lantern on the side.
  const pack = new THREE.Group();
  pack.position.set(0, 0.5, -0.2);
  const canvas = mat(0x8c7a4e);
  const bag = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.38, 0.18), canvas);
  pack.add(bag);
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.3, 12, 1, false, 0, Math.PI), canvas);
  lid.rotation.z = Math.PI / 2;
  lid.position.y = 0.19;
  pack.add(lid);
  const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.14, 0.06), mat(0x6f6140));
  pocket.position.set(0, -0.08, -0.11);
  pack.add(pocket);
  const bedroll = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.42, 12), mat(0xd4553a));
  bedroll.rotation.z = Math.PI / 2;
  bedroll.position.set(0, 0.3, 0.01);
  pack.add(bedroll);
  const charm = new THREE.Group();
  charm.position.set(0.17, 0.08, 0);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), new THREE.MeshStandardMaterial({ color: 0xffe6a8, emissive: 0xffc35a, emissiveIntensity: 1.6 }));
  lamp.position.y = -0.07;
  charm.add(lamp);
  pack.add(charm);
  body.add(pack);
  [-1, 1].forEach(side => {
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.3, 0.02), mat(0x5f5236));
    strap.position.set(side * 0.09, 0.53, 0.165);
    body.add(strap);
  });

  shadow(group);
  return { group, body, legs, arms, head, pack, charm };
}

function buildFarPlanets(rand) {
  const defs = [
    { id: "gravity", name: "引力星", sub: "重力问题", color: 0x6b5ca8, pos: [-26, 9, -16], r: 2.3, ring: 0xc9b26a },
    { id: "compass", name: "指南针星", sub: "工作观与人生观", color: 0x4f86c6, pos: [-6, 15, -30], r: 1.6, needle: true },
    { id: "flow", name: "心流星", sub: "心流与能量", color: 0x3fb8a8, pos: [-34, 3, 14], r: 2.2, glow: 0x9ff5e0 },
    { id: "anchor", name: "锚点星", sub: "锚点", color: 0xb07a5a, pos: [12, 12, -26], r: 1.8, anchor: true },
    { id: "crossroads", name: "三岔路星", sub: "奥德赛计划", color: 0xe2b07a, pos: [30, 7, -6], r: 2.6, roads: true }
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
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xd9cfe0, 40, 110);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 600);

  const rand = rng(612);
  const { sky, uniforms: skyUniforms } = buildSky();
  scene.add(sky);
  const stars = buildStars(rand);
  scene.add(stars);
  const clouds = buildClouds(rand);
  scene.add(clouds);

  const hemi = new THREE.HemisphereLight(0xdfe4ff, 0x4a4a78, 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffd2a0, 3);
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
  const workshop = buildWorkshop(smokeTex);
  const lanterns = buildLanterns();
  const bench = buildBench();
  const vine = buildVine();
  const sign = buildSignpost();

  const benchDir = TERMINATOR.clone().multiplyScalar(0.97).add(SUN.clone().multiplyScalar(0.26)).normalize();
  const layout = {
    spring: { dir: dirAt(34, 120), radius: 1.15 / R, labelHeight: 0.7, focus: 1.1, parts: [spring.group] },
    workshop: { dir: dirAt(40, 190), radius: 0.85 / R, labelHeight: 1.55, focus: 1.3, parts: [workshop.group] },
    bench: { dir: benchDir, radius: 0.55 / R, labelHeight: 1.0, focus: 0.85, parts: [bench.group] },
    lanterns: { dir: dirAt(32, 52), radius: 0.65 / R, labelHeight: 1.25, focus: 0.85, parts: [lanterns.group] },
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

  // Objects with a clear front get framed from it when their sheet opens.
  layout.workshop.front = Z.clone().applyQuaternion(workshop.group.quaternion);
  layout.lanterns.front = Z.clone().applyQuaternion(lanterns.group.quaternion);

  const blockers = Object.values(layout).map(item => ({ dir: item.dir, radius: item.radius }));

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
  const windowCalm = new THREE.Color(0xffb455);
  const windowHot = new THREE.Color(0xff2a00);
  const smokeDark = new THREE.Color(0x2a2328);
  const smokeLight = new THREE.Color(0xfff6f0);
  const murky = new THREE.Color(0x7d7a45);
  const clear = new THREE.Color(0x58c6ea);
  const horizonVivid = new THREE.Color("#ffc59a");
  const horizonDull = new THREE.Color("#b9bccb");
  const fogTint = new THREE.Color(0xc9cbe6);
  const bulbOn = new THREE.Color(0xffc861);
  const bulbOff = new THREE.Color(0x000000);
  const lanternA = new THREE.Vector3();
  const lanternB = new THREE.Vector3();

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
      const size = 0.16 + k * (0.55 + (1 - w) * 0.6);
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

    updateWorkshop(workshop, dt, time);

    // Twin lanterns: brighter, leaning in, and more of the string lit as love rises.
    const love = current.love;
    lanterns.posts.forEach((post, i) => {
      post.rotation.z = (i === 0 ? -1 : 1) * (love * 0.3 - 0.12);
      lanterns.glassMats[i].emissiveIntensity = 0.15 + love * 2.2 + Math.sin(time * 2 + i) * 0.08;
    });
    lanterns.posts[0].updateMatrix();
    lanterns.posts[1].updateMatrix();
    lanternA.set(0.16, 0.74, 0).applyMatrix4(lanterns.posts[0].matrix);
    lanternB.set(-0.16, 0.74, 0).applyMatrix4(lanterns.posts[1].matrix);
    const lit = love * lanterns.bulbs.length;
    lanterns.bulbs.forEach((bulb, i) => {
      const t = (i + 1) / (lanterns.bulbs.length + 1);
      bulb.position.lerpVectors(lanternA, lanternB, t);
      bulb.position.y -= Math.sin(t * Math.PI) * (0.12 + (1 - love) * 0.18);
      // Light spreads in from both ends, meeting in the middle.
      const fromEdge = Math.min(i, lanterns.bulbs.length - 1 - i);
      const on = THREE.MathUtils.clamp(lit / 2 - fromEdge, 0, 1);
      bulb.material.emissive.copy(bulbOff).lerp(bulbOn, on);
      bulb.material.emissiveIntensity = 1.6;
    });

    const play = current.play;
    skyUniforms.uVivid.value = play;
    skyUniforms.uHorizon.value.copy(horizonDull).lerp(horizonVivid, play);
    scene.fog.color.copy(skyUniforms.uHorizon.value).lerp(fogTint, 0.55);
    sun.intensity = 2 + play * 1.4;
    stars.material.opacity = 0.35 + (1 - play) * 0.35;

    const knotScale = current.problem < 0.5 ? 0.45 : 0.4 + current.gravity * 1.2;
    vine.knot.scale.setScalar(knotScale);
    vine.sprout.visible = current.problem > 0.5;
    vine.sprout.scale.setScalar(0.6 + current.designable * 1.6);
    vine.glowMat.emissiveIntensity = 0.6 + Math.sin(time * 2.4) * 0.35;

    clouds.rotation.y = time * 0.004;
    farPlanets.forEach(p => {
      p.group.position.y = p.pos[1] + Math.sin(time * 0.4 + p.phase) * 0.6;
      p.group.rotation.y = time * 0.08 + p.phase;
    });
  }

  return { renderer, scene, camera, sky, objects, farPlanets, blockers, setTargets, snap, update };
}
