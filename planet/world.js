import * as THREE from "three";
import { createPost, softTexture, createBackdrop } from "./look.js";

export const R = 6;
const BUMP = 0.02;
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

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
  return Math.sin(d.x * 3.1 + 1.7) * Math.sin(d.y * 2.3 + 0.4) * Math.sin(d.z * 2.9 + 2.2);
}

export function surfaceRadius(dir) {
  return R + bump(dir) * BUMP;
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

// ---------- palette & materials ----------

// Soft, low-saturation pastels in the spirit of geometric puzzle games; one accent per role.
const PAL = {
  ground: "#a5d8bd",
  groundDry: "#dcc9a2",
  tile: "#f7ecd9",
  cream: "#f4e7d3",
  stone: "#e7d6bf",
  terracotta: "#e88a6c",
  coral: "#f2a490",
  teal: "#5bb2ae",
  navy: "#3f4b73",
  gold: "#f5c66e",
  lilac: "#b8a6db",
  pink: "#f4b9c4",
  sky: "#8fb8e3",
  trees: ["#7cc6a0", "#5aa894", "#b2dc94", "#f2b8c6"],
  trunk: "#a8775f"
};

// Three hard light bands: lit face, half-lit face, shaded face.
const TOON_RAMP = (() => {
  const tex = new THREE.DataTexture(new Uint8Array([110, 190, 255]), 3, 1, THREE.RedFormat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
})();

const toon = (color, extra = {}) => new THREE.MeshToonMaterial({ color, gradientMap: TOON_RAMP, ...extra });
const glow = (color, intensity = 1.6) => new THREE.MeshToonMaterial({ color, emissive: color, emissiveIntensity: intensity, gradientMap: TOON_RAMP });

const SOFT = softTexture();

// A crisp flat shadow disc under each object: a graphic device rather than a realistic shadow.
function addShadowDisc(group, radius, opacity = 0.09) {
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 40),
    new THREE.MeshBasicMaterial({ color: PAL.navy, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.012;
  disc.userData.decor = true;
  group.add(disc);
  return disc;
}

function addHalo(parent, position, size, color = 0xffd27a) {
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: SOFT, color, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
  halo.position.copy(position);
  halo.scale.setScalar(size);
  halo.userData.decor = true;
  parent.add(halo);
  return halo;
}

function box(w, h, d, material, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  return mesh;
}

// ---------- planet ----------

const PATH_ANGLE = THREE.MathUtils.degToRad(33);

function buildPlanet() {
  const material = toon(PAL.ground);
  const geometry = new THREE.SphereGeometry(1, 128, 96);
  const pos = geometry.attributes.position;
  const d = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 1) {
    d.fromBufferAttribute(pos, i).normalize();
    const r = surfaceRadius(d);
    pos.setXYZ(i, d.x * r, d.y * r, d.z * r);
  }
  geometry.computeVertexNormals();
  return { mesh: new THREE.Mesh(geometry, material), material };
}

// Cream stepping tiles laid along the walking ring, skipping where a prop stands.
function buildPath(blockers) {
  const tiles = [];
  const steps = 52;
  for (let i = 0; i < steps; i += 1) {
    const b = (i / steps) * 360;
    const dir = dirAt(33, b);
    if (blockers.some(item => dir.angleTo(item.dir) < item.radius + 0.03)) continue;
    tiles.push({ dir, next: dirAt(33, b + 2) });
  }
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.42, 0.05, 0.3), toon(PAL.tile), tiles.length);
  const obj = new THREE.Object3D();
  tiles.forEach((tile, i) => {
    placeOnPlanet(obj, tile.dir, yawToward(tile.dir, tile.next) + Math.PI / 2, 0.005);
    obj.updateMatrix();
    mesh.setMatrixAt(i, obj.matrix);
  });
  return mesh;
}

// ---------- props ----------

function buildSpring() {
  const group = new THREE.Group();
  const stone = toon(PAL.stone);
  const cream = toon(PAL.cream);
  group.add(box(1.8, 0.14, 1.8, stone, 0, 0.07, 0));
  [[0, 0.82, 1.8, 0.16], [0, -0.82, 1.8, 0.16], [0.82, 0, 0.16, 1.48], [-0.82, 0, 0.16, 1.48]].forEach(([x, z, w, d]) => {
    group.add(box(w, 0.1, d, cream, x, 0.19, z));
  });
  const waterMat = toon("#6cc7c9", { emissive: "#3fa9b0", emissiveIntensity: 0.25 });
  const water = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.04, 1.48), waterMat);
  water.position.y = 0.17;
  group.add(water);
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.34, 16), cream);
  pedestal.position.y = 0.33;
  group.add(pedestal);
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.12, 0.08, 20), cream);
  bowl.position.y = 0.52;
  group.add(bowl);
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 20, 14), glow("#bff0ec", 0.9));
  orb.position.y = 0.62;
  group.add(orb);
  const glints = [0, 0.5].map(() => {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.31, 4, 1, Math.PI / 4), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.195;
    ring.userData.decor = true;
    group.add(ring);
    return ring;
  });
  addShadowDisc(group, 1.2, 0.06);
  return { group, waterMat, glints, orb };
}

function buildWorkshop() {
  const group = new THREE.Group();
  const cream = toon(PAL.cream);
  const roof = toon(PAL.terracotta);
  const navy = toon(PAL.navy);
  const teal = toon(PAL.teal);

  group.add(box(0.95, 0.62, 0.8, cream, 0, 0.31, 0));
  group.add(box(1.02, 0.06, 0.87, toon(PAL.stone), 0, 0.03, 0));
  const pyramid = new THREE.Mesh(new THREE.ConeGeometry(0.76, 0.48, 4), roof);
  pyramid.rotation.y = Math.PI / 4;
  pyramid.scale.set(1, 1, 0.84);
  pyramid.position.y = 0.86;
  group.add(pyramid);

  // Arched door: a dark slab with a half-round head, plus a step.
  const door = new THREE.Group();
  door.add(box(0.24, 0.26, 0.02, navy, 0, 0.13, 0));
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.02, 24, 1, false, -Math.PI / 2, Math.PI), navy);
  head.rotation.x = Math.PI / 2;
  head.position.y = 0.26;
  door.add(head);
  door.position.set(-0.2, 0.06, 0.405);
  group.add(door);
  group.add(box(0.34, 0.04, 0.12, toon(PAL.stone), -0.2, 0.08, 0.46));

  const windowMat = glow("#ffcc7a", 0.9);
  [0.405, -0.405].forEach(z => {
    group.add(box(0.2, 0.2, 0.02, windowMat, 0.22, 0.36, z));
    group.add(box(0.26, 0.03, 0.05, cream, 0.22, 0.245, z + Math.sign(z) * 0.02));
  });

  // A slim side tower with a cone roof and a round window.
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 1.15, 24), teal);
  tower.position.set(0.5, 0.575, -0.3);
  group.add(tower);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.42, 24), roof);
  cap.position.set(0.5, 1.36, -0.3);
  group.add(cap);
  const porthole = new THREE.Mesh(new THREE.CircleGeometry(0.06, 24), windowMat);
  porthole.position.set(0.5, 0.86, -0.3 + 0.171);
  group.add(porthole);

  const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.36, 16), navy);
  chimney.position.set(-0.28, 1.0, -0.12);
  group.add(chimney);
  addShadowDisc(group, 0.7);

  // Smoke: low-poly puffs that rise, swell and fade.
  const puffGeo = new THREE.IcosahedronGeometry(0.1, 0);
  const puffs = [];
  for (let i = 0; i < 24; i += 1) {
    const mesh = new THREE.Mesh(puffGeo, toon("#ffffff", { transparent: true, opacity: 0, depthWrite: false, flatShading: true }));
    mesh.visible = false;
    mesh.userData.decor = true;
    group.add(mesh);
    puffs.push({ mesh, age: 0, life: 1, drift: new THREE.Vector2() });
  }
  return { group, windowMat, puffs, emit: new THREE.Vector3(-0.28, 1.2, -0.12), spawn: 0 };
}

function buildLanterns() {
  const group = new THREE.Group();
  const cream = toon(PAL.cream);
  const wood = toon("#c98f63");
  const posts = [];
  const glassMats = [];
  const halos = [];
  [-1, 1].forEach(side => {
    const pivot = new THREE.Group();
    pivot.position.x = side * 0.6;
    pivot.add(box(0.16, 0.08, 0.16, toon(PAL.stone), 0, 0.04, 0));
    pivot.add(box(0.09, 0.82, 0.09, cream, 0, 0.45, 0));
    pivot.add(box(0.22, 0.04, 0.04, wood, -side * 0.08, 0.89, 0));
    const glassMat = glow("#ffd27a", 1.2);
    const lamp = box(0.12, 0.12, 0.12, glassMat, -side * 0.16, 0.78, 0);
    lamp.rotation.y = Math.PI / 4;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.08, 4), wood);
    cap.position.set(-side * 0.16, 0.88, 0);
    pivot.add(lamp, cap);
    halos.push(addHalo(pivot, lamp.position, 0.5));
    group.add(pivot);
    posts.push(pivot);
    glassMats.push(glassMat);
  });
  // Ten separate bulbs, one per point of the love score, so the count can be read at a glance.
  const bulbGeo = new THREE.SphereGeometry(0.038, 14, 10);
  const bulbs = [];
  for (let i = 0; i < 10; i += 1) {
    const bulb = new THREE.Mesh(bulbGeo, new THREE.MeshToonMaterial({ color: "#b7b0aa", emissive: "#ffc861", emissiveIntensity: 1, gradientMap: TOON_RAMP }));
    group.add(bulb);
    bulbs.push(bulb);
  }
  addShadowDisc(group, 0.7, 0.1);
  return { group, posts, glassMats, halos, bulbs };
}

function buildBench() {
  const group = new THREE.Group();
  const seat = toon(PAL.coral);
  const cream = toon(PAL.cream);
  group.add(box(0.95, 0.07, 0.32, seat, 0, 0.3, 0));
  group.add(box(0.95, 0.24, 0.06, seat, 0, 0.47, -0.15));
  [-0.36, 0.36].forEach(x => group.add(box(0.12, 0.27, 0.28, cream, x, 0.135, 0)));
  addShadowDisc(group, 0.55);
  return { group };
}

function buildVine() {
  const group = new THREE.Group();
  const knot = new THREE.Group();
  const vineMat = toon("#6f8f7c", { flatShading: true });
  const core = new THREE.Mesh(new THREE.TorusKnotGeometry(0.34, 0.075, 64, 6, 2, 3), vineMat);
  core.position.y = 0.42;
  core.rotation.x = Math.PI / 2;
  knot.add(core);
  for (let i = 0; i < 4; i += 1) {
    const a = (i / 4) * Math.PI * 2 + 0.3;
    const root = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.055, 5, 10, Math.PI * 0.8), vineMat);
    root.position.set(Math.cos(a) * 0.32, 0.02, Math.sin(a) * 0.32);
    root.rotation.set(0, -a, 0);
    knot.add(root);
  }
  const thornMat = toon(PAL.cream);
  for (let i = 0; i < 12; i += 1) {
    const a = i * 2.4;
    const thorn = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.12, 4), thornMat);
    thorn.position.set(Math.cos(a) * 0.42, 0.3 + (i % 4) * 0.08, Math.sin(a) * 0.42);
    thorn.rotation.set(Math.sin(a) * 1.2, 0, -Math.cos(a) * 1.2);
    knot.add(thorn);
  }
  addShadowDisc(knot, 0.55);
  group.add(knot);

  const sprout = new THREE.Group();
  const glowMat = glow("#8ff0d6", 0.9);
  sprout.add(box(0.03, 0.22, 0.03, glowMat, 0, 0.11, 0));
  [-1, 1].forEach(side => {
    const leaf = new THREE.Mesh(new THREE.OctahedronGeometry(0.07, 0), glowMat);
    leaf.scale.set(1.3, 0.4, 0.8);
    leaf.position.set(side * 0.07, 0.22, 0);
    leaf.rotation.z = side * -0.5;
    sprout.add(leaf);
  });
  addHalo(sprout, new THREE.Vector3(0, 0.2, 0), 0.45, 0x8ff0d6);
  sprout.position.set(0.85, 0, 0.25);
  sprout.visible = false;
  group.add(sprout);
  return { group, knot, sprout, glowMat };
}

function buildSignpost() {
  const group = new THREE.Group();
  const cream = toon(PAL.cream);
  group.add(box(0.36, 0.1, 0.36, toon(PAL.stone), 0, 0.05, 0));
  group.add(box(0.2, 0.42, 0.2, cream, 0, 0.31, 0));
  const top = box(0.32, 0.04, 0.26, toon(PAL.teal), 0, 0.54, 0.02);
  top.rotation.x = -0.25;
  group.add(top);
  const book = box(0.24, 0.04, 0.18, toon(PAL.terracotta), 0, 0.58, 0.03);
  book.rotation.x = -0.25;
  group.add(book);
  group.add(box(0.05, 0.9, 0.05, cream, -0.24, 0.45, -0.1));
  const arrow = box(0.42, 0.11, 0.03, toon(PAL.coral), -0.06, 0.82, -0.1);
  arrow.rotation.y = 0.3;
  group.add(arrow);
  // The diary's light: a slowly turning gold octahedron hovering over the pedestal.
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.1, 0), glow(PAL.gold, 1.4));
  gem.position.y = 1.0;
  group.add(gem);
  const halo = addHalo(group, gem.position, 0.5);
  addShadowDisc(group, 0.32);
  return { group, gem, halo };
}

// ---------- decor ----------

function buildTree(rand) {
  const group = new THREE.Group();
  const kind = Math.floor(rand() * 3);
  const color = PAL.trees[Math.floor(rand() * PAL.trees.length)];
  const leaf = toon(color);
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.5, 8), toon(PAL.trunk));
  trunk.position.y = 0.25;
  group.add(trunk);
  let crown;
  if (kind === 0) {
    crown = new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 16), leaf);
    crown.position.y = 0.72;
  } else if (kind === 1) {
    crown = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.85, 24), leaf);
    crown.position.y = 0.85;
  } else {
    crown = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.45, 8, 20), leaf);
    crown.position.y = 0.85;
  }
  group.add(crown);
  addShadowDisc(group, 0.2, 0.08);
  const scale = 0.75 + rand() * 0.6;
  group.scale.setScalar(scale);
  return { group, crown, radius: (0.25 * scale) / R, phase: rand() * 6 };
}

// A simple gateway over the walking ring.
function buildArch() {
  const group = new THREE.Group();
  const cream = toon(PAL.cream);
  [-0.42, 0.42].forEach(x => group.add(box(0.14, 0.9, 0.14, cream, x, 0.45, 0)));
  group.add(box(1.0, 0.14, 0.2, toon(PAL.terracotta), 0, 0.97, 0));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.05, 10, 32, Math.PI), toon(PAL.teal));
  ring.position.y = 0.88;
  group.add(ring);
  return group;
}

function buildFarPlanets(rand) {
  const defs = [
    { id: "gravity", name: "引力星", sub: "重力问题", color: PAL.lilac, pos: [-26, 9, -16], r: 2.3, ring: PAL.gold },
    { id: "compass", name: "指南针星", sub: "工作观与人生观", color: PAL.sky, pos: [-6, 15, -30], r: 1.6, needle: true },
    { id: "flow", name: "心流星", sub: "心流与能量", color: PAL.teal, pos: [-34, 3, 14], r: 2.2, glowBand: "#a6f2e2" },
    { id: "anchor", name: "锚点星", sub: "锚点", color: PAL.coral, pos: [12, 12, -26], r: 1.8, anchor: true },
    { id: "crossroads", name: "三岔路星", sub: "奥德赛计划", color: PAL.gold, pos: [30, 7, -6], r: 2.6, roads: true }
  ];
  return defs.map((def, i) => {
    const group = new THREE.Group();
    const ball = new THREE.Mesh(new THREE.SphereGeometry(def.r, 40, 28), toon(def.color));
    group.scale.setScalar(0.6);
    group.add(ball);
    if (def.ring) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(def.r * 1.6, def.r * 0.05, 10, 72), toon(def.ring));
      ring.rotation.x = Math.PI / 2.4;
      group.add(ring);
    }
    if (def.needle) {
      const needle = new THREE.Mesh(new THREE.OctahedronGeometry(0.6, 0), toon(PAL.terracotta));
      needle.scale.set(0.4, 1.8, 0.4);
      needle.rotation.z = Math.PI / 2;
      needle.position.y = def.r + 0.5;
      group.add(needle);
    }
    if (def.glowBand) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(def.r * 1.08, def.r * 0.07, 10, 64), glow(def.glowBand, 1.1));
      band.rotation.x = Math.PI / 2 - 0.3;
      group.add(band);
    }
    if (def.anchor) {
      [0.9, 0.6, 0.35].forEach((s, k) => {
        const cube = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), toon(k % 2 ? PAL.cream : PAL.navy));
        cube.position.y = def.r + 0.2 + [0.45, 1.2, 1.67][k];
        cube.rotation.y = k * 0.5;
        group.add(cube);
      });
    }
    if (def.roads) {
      [PAL.terracotta, PAL.sky, PAL.teal].forEach((c, k) => {
        const road = new THREE.Mesh(new THREE.TorusGeometry(def.r * 1.01, def.r * 0.05, 8, 48, Math.PI * 0.7), toon(c));
        road.rotation.set(Math.PI / 2, 0, (k * Math.PI * 2) / 3);
        group.add(road);
      });
    }
    group.position.set(...def.pos);
    return { ...def, group, hit: [ball], phase: rand() * Math.PI * 2 + i };
  });
}

export function buildTraveler() {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const jacket = toon(PAL.terracotta);
  const pants = toon(PAL.navy);
  const skin = toon("#f6d6bf");
  const beanieMat = toon(PAL.teal);

  const legs = [-1, 1].map(side => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.07, 0.3, 0);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.26, 12), pants);
    leg.position.y = -0.13;
    const boot = box(0.1, 0.06, 0.15, toon("#5b4a5e"), 0, -0.27, 0.02);
    pivot.add(leg, boot);
    body.add(pivot);
    return pivot;
  });

  // Coat as a clean truncated cone, the traveler's main silhouette.
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 0.42, 24), jacket);
  torso.position.y = 0.5;
  body.add(torso);

  const arms = [-1, 1].map(side => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.16, 0.65, 0);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.26, 10), jacket);
    arm.position.y = -0.13;
    arm.rotation.z = side * 0.18;
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.038, 12, 8), skin);
    hand.position.set(side * 0.025, -0.27, 0);
    pivot.add(arm, hand);
    body.add(pivot);
    return pivot;
  });
  // Walking stick in the right hand.
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.8, 8), toon(PAL.trunk));
  stick.position.set(0.03, -0.25, 0.06);
  arms[1].add(stick);

  const head = new THREE.Group();
  head.position.y = 0.86;
  head.add(new THREE.Mesh(new THREE.SphereGeometry(0.16, 32, 24), skin));
  [-1, 1].forEach(side => {
    const eye = box(0.022, 0.05, 0.01, toon(PAL.navy), side * 0.055, 0, 0.155);
    head.add(eye);
  });
  const beanie = new THREE.Mesh(new THREE.SphereGeometry(0.17, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.46), beanieMat);
  beanie.position.y = 0.025;
  head.add(beanie);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.172, 0.172, 0.05, 32), toon("#4a9a97"));
  rim.position.y = 0.05;
  head.add(rim);
  const pompom = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), toon(PAL.cream));
  pompom.position.y = 0.21;
  head.add(pompom);
  body.add(head);

  // Backpack: the pack itself, a rolled mat on top and a small lantern on the side.
  const pack = new THREE.Group();
  pack.position.set(0, 0.52, -0.19);
  pack.add(box(0.28, 0.34, 0.16, toon("#d8b98d")));
  pack.add(box(0.18, 0.12, 0.05, toon("#c4a477"), 0, -0.07, -0.1));
  const bedroll = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.38, 20), toon(PAL.coral));
  bedroll.rotation.z = Math.PI / 2;
  bedroll.position.set(0, 0.23, 0.01);
  pack.add(bedroll);
  const charm = new THREE.Group();
  charm.position.set(0.16, 0.06, 0);
  const lamp = box(0.05, 0.05, 0.05, glow(PAL.gold, 1.8), 0, -0.07, 0);
  lamp.rotation.y = Math.PI / 4;
  charm.add(lamp);
  addHalo(charm, lamp.position, 0.2);
  pack.add(charm);
  body.add(pack);

  addShadowDisc(group, 0.22, 0.16);
  return { group, body, legs, arms, head, pack, charm };
}

// ---------- world ----------

export function createWorld(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  let pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(pixelRatio);
  // No tone mapping: the pastel palette should land on screen exactly as specified.
  renderer.toneMapping = THREE.NoToneMapping;

  const scene = new THREE.Scene();
  const backdrop = createBackdrop();
  scene.background = backdrop.texture;
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);

  const rand = rng(612);

  const ambient = new THREE.HemisphereLight(0xfff4ea, 0xc9d6f0, 1.4);
  const ambientWarm = new THREE.Color(0xfff0e0);
  const ambientDull = new THREE.Color(0xe4e7ee);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(0xfff1df, 2.2);
  sun.position.copy(SUN).multiplyScalar(30);
  scene.add(sun);

  const planet = buildPlanet();
  scene.add(planet.mesh);

  const spring = buildSpring();
  const workshop = buildWorkshop();
  const lanterns = buildLanterns();
  const bench = buildBench();
  const vine = buildVine();
  const sign = buildSignpost();

  const benchDir = TERMINATOR.clone().multiplyScalar(0.97).add(SUN.clone().multiplyScalar(0.26)).normalize();
  const layout = {
    spring: { dir: dirAt(34, 120), radius: 1.2 / R, labelHeight: 1.35, focus: 1.1, parts: [spring.group] },
    workshop: { dir: dirAt(40, 190), radius: 0.85 / R, labelHeight: 1.75, focus: 1.3, parts: [workshop.group] },
    bench: { dir: benchDir, radius: 0.55 / R, labelHeight: 0.9, focus: 0.9, parts: [bench.group] },
    lanterns: { dir: dirAt(32, 52), radius: 0.65 / R, labelHeight: 1.2, focus: 1.05, parts: [lanterns.group] },
    vine: { dir: dirAt(40, 255), radius: 0.6 / R, labelHeight: 1.1, focus: 1.2, parts: [vine.group] },
    sign: { dir: dirAt(20, 305), radius: 0.3 / R, labelHeight: 1.4, focus: 0.9, parts: [sign.group] }
  };

  placeOnPlanet(spring.group, layout.spring.dir, yawToward(layout.spring.dir, POLE));
  placeOnPlanet(workshop.group, layout.workshop.dir, yawToward(layout.workshop.dir, POLE));
  placeOnPlanet(lanterns.group, layout.lanterns.dir, yawToward(layout.lanterns.dir, POLE));
  placeOnPlanet(bench.group, benchDir, yawToward(benchDir, SUN));
  placeOnPlanet(vine.group, layout.vine.dir, yawToward(layout.vine.dir, POLE));
  placeOnPlanet(sign.group, layout.sign.dir, yawToward(layout.sign.dir, POLE));
  [spring.group, workshop.group, lanterns.group, bench.group, vine.group, sign.group].forEach(g => scene.add(g));

  // Objects with a clear front get framed from it when their sheet opens.
  layout.workshop.front = Z.clone().applyQuaternion(workshop.group.quaternion);
  layout.lanterns.front = Z.clone().applyQuaternion(lanterns.group.quaternion);

  // Scale animations driven by world time: pop-ins on load, squash-and-stretch on celebrations.
  // The planet and its buildings are on screen from the first frame; everything else lands around them.
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

  const blockers = Object.values(layout).map(item => ({ dir: item.dir, radius: item.radius }));
  scene.add(buildPath(blockers));

  [[33, 95], [33, 228]].forEach(([a, b]) => {
    const dir = dirAt(a, b);
    const arch = buildArch();
    placeOnPlanet(arch, dir, yawToward(dir, dirAt(a, b + 3)) + Math.PI / 2);
    scene.add(arch);
    popIn(arch, 0.35 + b / 900);
  });

  // Trees: a loose ring around the lived-in area plus a sprinkling over the rest of the planet.
  const trees = [];
  for (let i = 0; i < 70 && trees.length < 34; i += 1) {
    const dir = i < 40 ? dirAt(52 + rand() * 30, rand() * 360) : randomDir(rand);
    if (blockers.some(item => dir.angleTo(item.dir) < item.radius + 0.1)) continue;
    if (Math.abs(dir.angleTo(POLE) - PATH_ANGLE) < 0.09) continue;
    const tree = buildTree(rand);
    placeOnPlanet(tree.group, dir, rand() * 6);
    scene.add(tree.group);
    popIn(tree.group, 0.15 + trees.length * 0.035);
    trees.push(tree);
    blockers.push({ dir, radius: tree.radius });
  }

  // Footstep dust: small pale puffs kicked up by main.js as the traveler walks.
  const dustGeo = new THREE.IcosahedronGeometry(0.05, 0);
  const dust = Array.from({ length: 14 }, () => {
    const mesh = new THREE.Mesh(dustGeo, toon(PAL.cream, { transparent: true, opacity: 0, depthWrite: false }));
    mesh.visible = false;
    scene.add(mesh);
    return { mesh, age: 0, up: new THREE.Vector3() };
  });
  let dustIndex = 0;
  function kickDust(position, up) {
    const d = dust[dustIndex];
    dustIndex = (dustIndex + 1) % dust.length;
    d.mesh.position.copy(position).addScaledVector(up, 0.05);
    d.up.copy(up);
    d.age = 0;
    d.mesh.visible = true;
  }

  const farPlanets = buildFarPlanets(rand);
  farPlanets.forEach(p => scene.add(p.group));

  const objects = {};
  Object.entries(layout).forEach(([id, item]) => {
    const hit = [];
    item.parts.forEach(part => part.traverse(node => { if (node.isMesh && !node.userData.decor) hit.push(node); }));
    objects[id] = { id, ...item, hit, reach: item.radius + 0.1 };
  });

  const post = createPost(renderer, scene, camera);

  const current = { health: 0.5, work: 0.5, play: 0.5, love: 0.5, gravity: 0, designable: 0, problem: 0 };
  // The four dashboard values move on a slightly underdamped spring, so a change overshoots and settles.
  const velocity = { health: 0, work: 0, play: 0, love: 0 };
  const target = { ...current };
  let paintedPlay = -1;
  const groundLush = new THREE.Color(PAL.ground);
  const groundDry = new THREE.Color("#d8c48f");
  const windowCalm = new THREE.Color("#ffcc7a");
  const windowHot = new THREE.Color("#ff5a3a");
  const smokeDark = new THREE.Color("#4b4658");
  const smokeLight = new THREE.Color("#ffffff");
  const murky = new THREE.Color("#8f7b55");
  const clear = new THREE.Color("#78c8c2");
  // Backdrop colours for a joyful (vivid) and a joyless (dull) play score.
  const skyVivid = { top: "#ffc9a8", middle: "#ffb8b0", bottom: "#9ec3f0", sun: "#fff6d8", sunRing: "#ffd59e", cloud: "#ffffff", cloudShade: "#f3d8e6" };
  const skyDull = { top: "#b9bcc6", middle: "#c4c6cd", bottom: "#a6abb8", sun: "#d4d5d9", sunRing: "#c9cad0", cloud: "#d9dbe1", cloudShade: "#b9bcc7" };
  const skyColors = Object.fromEntries(Object.keys(skyVivid).map(key => [key, new THREE.Color()]));
  const screen = { w: window.innerWidth, h: window.innerHeight };

  function paintBackdrop(play) {
    Object.keys(skyColors).forEach(key => skyColors[key].set(skyDull[key]).lerp(new THREE.Color(skyVivid[key]), play));
    backdrop.paint(screen.w, screen.h, skyColors);
  }
  const bulbOn = new THREE.Color("#ffc861");
  const bulbOff = new THREE.Color("#000000");
  const lanternA = new THREE.Vector3();
  const lanternB = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();

  let diaryReady = false;
  function setDiaryReady(ready) {
    diaryReady = ready;
  }

  // In close-ups, hide trees that sit between the camera and the subject.
  let cull = null;
  const cullTmp = new THREE.Vector3();
  function setNearCull(dir, look) {
    cull = dir ? { dir, look } : null;
  }

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
    if (id === "spring") {
      fx.glint = clockTime;
      fx.orb = clockTime;
    } else if (id === "workshop") {
      fx.flash = clockTime;
      workshop.spawn += 6;
    } else if (id === "lanterns") {
      fx.bulbs = clockTime;
    } else if (id === "vine") {
      fx.sprout = clockTime;
    } else if (id === "sign") {
      fx.gem = clockTime;
    }
  }

  function updateWorkshop(v, dt, time) {
    const w = current.work;
    // An overworked furnace: the windows burn red and flicker, the chimney pours dark smoke.
    v.windowMat.emissive.copy(windowCalm).lerp(windowHot, THREE.MathUtils.clamp((1 - w) * 1.4 - 0.2, 0, 1));
    v.windowMat.color.copy(v.windowMat.emissive);
    v.windowMat.emissiveIntensity = 0.9 + Math.sin(time * 9) * 0.3 * (1 - w);
    const rate = 1.2 + (1 - w) * 9;
    v.spawn += dt * rate;
    while (v.spawn >= 1) {
      v.spawn -= 1;
      const puff = v.puffs.find(p => !p.mesh.visible);
      if (!puff) break;
      puff.age = 0;
      puff.life = 2.2 + Math.random() * 1.4;
      puff.drift.set((Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.2);
      puff.mesh.visible = true;
      puff.mesh.position.copy(v.emit);
      puff.mesh.rotation.set(Math.random() * 3, Math.random() * 3, 0);
    }
    v.puffs.forEach(p => {
      if (!p.mesh.visible) return;
      p.age += dt;
      const k = p.age / p.life;
      if (k >= 1) {
        p.mesh.visible = false;
        return;
      }
      p.mesh.position.y += dt * (0.32 + (1 - w) * 0.2);
      p.mesh.position.x += p.drift.x * dt;
      p.mesh.position.z += p.drift.y * dt;
      p.mesh.scale.setScalar(0.6 + k * (1.6 + (1 - w) * 1.8));
      p.mesh.material.color.copy(smokeLight).lerp(smokeDark, THREE.MathUtils.smoothstep(1 - w, 0.25, 0.8));
      p.mesh.material.opacity = Math.min(1, Math.sin(k * Math.PI) * 1.6) * 0.92;
    });
  }

  function update(dt, time) {
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

    pops.forEach((p, i) => {
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

    const h = current.health;
    planet.material.color.copy(groundDry).lerp(groundLush, THREE.MathUtils.smoothstep(h, 0.05, 0.75));
    spring.waterMat.color.copy(murky).lerp(clear, THREE.MathUtils.smoothstep(h, 0.15, 0.85));
    spring.waterMat.emissiveIntensity = Math.max(0, h) * 0.35;
    spring.orb.material.emissiveIntensity = 0.2 + h * 1.2;
    const burst = bumpAt(fx.glint, 1.2);
    spring.glints.forEach((ring, i) => {
      const phase = (time * 0.4 + i * 0.5) % 1;
      ring.scale.setScalar(0.5 + phase * 2 + burst * 0.8);
      ring.material.opacity = Math.min(1, 0.45 * (1 - phase) * Math.max(h, 0) + burst * 0.6);
    });

    updateWorkshop(workshop, dt, time);

    // Twin lanterns: brighter, leaning in, and more of the string lit as love rises.
    const love = current.love;
    lanterns.posts.forEach((p, i) => {
      p.rotation.z = (i === 0 ? -1 : 1) * (love * 0.3 - 0.12);
      lanterns.glassMats[i].emissiveIntensity = 0.15 + love * 2;
      lanterns.halos[i].material.opacity = 0.08 + love * 0.55;
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
      bulb.material.color.set(on ? "#ffc65c" : "#b7b0aa");
      bulb.material.emissive.copy(bulbOff).lerp(bulbOn, on);
      // Kept below the bloom threshold so each bulb stays a distinct dot rather than one streak.
      bulb.material.emissiveIntensity = 0.18;
      // On confirm, the lit bulbs pop one after another from both ends.
      bulb.scale.setScalar(1 + bumpAt(fx.bulbs + fromEdge * 0.09, 0.35) * 0.9 * on);
    });

    const play = current.play;
    if (Math.abs(play - paintedPlay) > 0.01) {
      paintedPlay = play;
      paintBackdrop(play);
    }
    sun.intensity = 1.3 + play * 1.3;
    ambient.color.copy(ambientDull).lerp(ambientWarm, THREE.MathUtils.clamp(play, 0, 1));

    const knotScale = current.problem < 0.5 ? 0.45 : 0.4 + current.gravity * 1.2;
    vine.knot.scale.setScalar(knotScale);
    vine.sprout.visible = current.problem > 0.5;
    vine.sprout.scale.setScalar((0.6 + current.designable * 1.6) * (1 + bumpAt(fx.sprout + 0.4, 0.6) * 0.6));
    vine.glowMat.emissiveIntensity = 0.6 + Math.sin(time * 2.4) * 0.35;

    // The diary is the last stop: its gem stays dim until the other stops are done.
    sign.gem.material.emissiveIntensity = diaryReady ? 1.4 : 0.15;
    sign.halo.visible = diaryReady;
    sign.gem.rotation.y = time * 0.8 + bumpAt(fx.gem, 1) * 6;
    sign.gem.position.y = 1.0 + Math.sin(time * 1.4) * 0.04 + bumpAt(fx.gem, 1) * 0.25;
    spring.orb.position.y = 0.62 + Math.sin(time * 1.1) * 0.02 + bumpAt(fx.orb, 0.6) * 0.18;
    workshop.windowMat.emissiveIntensity += bumpAt(fx.flash, 0.5) * 1.5;

    trees.forEach(tree => {
      tree.crown.rotation.z = Math.sin(time * 0.8 + tree.phase) * 0.03;
      tree.group.visible = !cull || cullTmp.copy(tree.group.position).sub(cull.look).dot(cull.dir) < 1.2;
    });
    dust.forEach(d => {
      if (!d.mesh.visible) return;
      d.age += dt;
      const t = d.age / 0.6;
      if (t >= 1) {
        d.mesh.visible = false;
        return;
      }
      d.mesh.position.addScaledVector(d.up, dt * 0.3);
      d.mesh.scale.setScalar(0.6 + t * 1.2);
      d.mesh.material.opacity = (1 - t) * 0.8;
    });
    farPlanets.forEach(p => {
      p.group.position.y = p.pos[1] + Math.sin(time * 0.4 + p.phase) * 0.6;
      p.group.rotation.y = time * 0.08 + p.phase;
    });
  }

  function setSize(w, h) {
    if (w !== screen.w || h !== screen.h) {
      screen.w = w;
      screen.h = h;
      paintBackdrop(current.play);
    }
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(w, h, false);
    post.setSize(w, h, pixelRatio);
  }

  // Quality steps for slower phones: 2 = everything, 1 = lower resolution, 0 = also no bloom.
  function setQuality(level) {
    post.setBloom(level >= 1);
    if (level < 2) pixelRatio = Math.min(pixelRatio, 1.5);
    if (level < 1) pixelRatio = 1;
    setSize(window.innerWidth, window.innerHeight);
  }

  function render(cam) {
    post.render(cam);
  }

  // Render one frame from `cam` into a square image (for the postcard).
  function snapshot(cam, size) {
    renderer.setPixelRatio(1);
    renderer.setSize(size, size, false);
    post.setSize(size, size, 1);
    backdrop.paint(size, size, skyColors);
    post.render(cam);
    backdrop.paint(screen.w, screen.h, skyColors);
    const out = document.createElement("canvas");
    out.width = out.height = size;
    out.getContext("2d").drawImage(renderer.domElement, 0, 0, size, size);
    setSize(window.innerWidth, window.innerHeight);
    return out;
  }

  return {
    renderer, scene, camera, objects, farPlanets, blockers,
    setTargets, snap, update, render, setSize, setQuality, snapshot, kickDust, celebrate, setDiaryReady, setNearCull
  };
}
