import * as THREE from "three";
import { RoundedBoxGeometry } from "../vendor/three-addons/geometries/RoundedBoxGeometry.js";
import {
  R, shared, seeThrough, patchMaterial, mergeStatic, mergeGeometries,
  taperedTube, lumpGeometry
} from "./geo.js";
import { softTexture, blobTexture, woodTexture, shingleTexture, stoneTexture } from "./look.js";

export const mat = (color, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, envMapIntensity: 0.45, ...extra });

export const textured = (map, extra = {}) =>
  new THREE.MeshStandardMaterial({ map, roughness: 0.9, metalness: 0, ...extra });

export function shadow(obj) {
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

export function addBlob(group, radius, opacity = 0.45) {
  // Hug the sphere: on a planet of radius R a flat tangent disk floats r²/2R above the ground at
  // its edge, so droop the disk to follow the curvature before rotating it into place.
  const geo = new THREE.CircleGeometry(radius, 40);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    pos.setZ(i, 0.014 - (x * x + y * y) / (2 * R));
  }
  geo.rotateX(-Math.PI / 2);
  geo.computeVertexNormals();
  const blob = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({
      map: BLOB, transparent: true, opacity, depthWrite: false, color: 0x1d2440,
      polygonOffset: true, polygonOffsetFactor: -2
    })
  );
  blob.position.y = 0.004;
  blob.userData.noShadow = true;
  blob.renderOrder = 1;
  group.add(blob);
  return blob;
}

export function addHalo(parent, position, size, color = 0xffc66b) {
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: SOFT, color, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending
  }));
  halo.position.copy(position);
  halo.scale.setScalar(size);
  parent.add(halo);
  return halo;
}

const FOLIAGE_DARK = new THREE.Color("#2e5a45");
const FOLIAGE_LIGHT = new THREE.Color("#b5d65a");
const foliageMat = seeThrough(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));

function foliageShadow(group) {
  group.traverse(node => {
    if (node.isMesh && node.material === foliageMat) node.receiveShadow = false;
  });
  return group;
}

// Paint merged crown lumps: height grade plus soft AO where blobs overlap.
function paintFoliage(geo, lumps, dark, light) {
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  const c = new THREE.Color();
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pos.count; i += 1) {
    const y = pos.getY(i);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const span = Math.max(0.001, maxY - minY);
  for (let i = 0; i < pos.count; i += 1) {
    v.fromBufferAttribute(pos, i);
    const t = THREE.MathUtils.clamp((v.y - minY) / span, 0, 1);
    c.copy(dark).lerp(light, t * t * (3 - 2 * t));
    let ao = 0;
    for (let k = 0; k < lumps.length; k += 1) {
      const L = lumps[k];
      const dx = v.x - L.x;
      const dy = v.y - L.y;
      const dz = v.z - L.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      ao += THREE.MathUtils.clamp(1 - d / (L.r * 1.15), 0, 1);
    }
    ao = THREE.MathUtils.clamp((ao - 1) * 0.55, 0, 0.55);
    // Down-facing patches stay a touch cooler so the crown reads painted, not flat.
    const down = THREE.MathUtils.clamp((-v.y + lumps[0].y) * 0.4, 0, 0.15);
    c.multiplyScalar(1 - ao * 0.4 - down);
    c.offsetHSL(0, 0, Math.sin(v.x * 31 + v.z * 17) * 0.02);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geo;
}

function makeCrown(rand, blobCount, spread, yJitter) {
  const crown = new THREE.Group();
  crown.userData.keep = true;
  const parts = [];
  const lumps = [];
  for (let i = 0; i < blobCount; i += 1) {
    const a = (i / blobCount) * Math.PI * 2 + rand();
    const r = 0.28 + rand() * 0.22;
    const ox = i === 0 ? 0 : Math.cos(a) * spread;
    const oy = i === 0 ? 0.32 : (rand() - 0.3) * yJitter;
    const oz = i === 0 ? 0 : Math.sin(a) * spread;
    const geo = lumpGeometry(r, rand() * 100, { detail: 2, amount: 0.16 + rand() * 0.06, squash: 0.85 + rand() * 0.2 });
    const matrix = new THREE.Matrix4().makeTranslation(ox, oy, oz);
    parts.push({ geometry: geo, matrix });
    lumps.push({ x: ox, y: oy, z: oz, r });
  }
  const merged = paintFoliage(mergeGeometries(parts, false), lumps, FOLIAGE_DARK, FOLIAGE_LIGHT);
  const mesh = new THREE.Mesh(merged, foliageMat);
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  crown.add(mesh);
  return crown;
}

export function buildTree(rand, scale = 1) {
  const group = new THREE.Group();
  const bark = new THREE.Color("#6e4a32");
  const barkLight = new THREE.Color("#8a6240");
  const trunkPoints = [];
  for (let i = 0; i <= 10; i += 1) {
    const t = i / 10;
    trunkPoints.push(new THREE.Vector3(
      Math.sin(t * 1.4) * 0.07 * t,
      t * 1.05,
      Math.cos(t * 0.9) * 0.045 * t
    ));
  }
  const trunkGeo = taperedTube(trunkPoints, t => 0.13 * (1 - t * 0.55) * (1 + (1 - t) * (1 - t) * 0.35), {
    segments: 14,
    radial: 7,
    colorAt: (t, c) => c.copy(bark).lerp(barkLight, t * 0.35)
  });
  const trunkMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
  const trunk = new THREE.Mesh(trunkGeo, trunkMat);
  group.add(trunk);

  for (let i = 0; i < 2; i += 1) {
    const a = rand() * Math.PI * 2;
    const branch = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.035, 0.28, 5),
      mat(0x6e4a32)
    );
    branch.position.set(Math.cos(a) * 0.08, 0.72 + rand() * 0.12, Math.sin(a) * 0.08);
    branch.rotation.z = Math.cos(a) * 0.9;
    branch.rotation.x = Math.sin(a) * 0.7;
    group.add(branch);
  }

  const crown = makeCrown(rand, 5 + Math.floor(rand() * 3), 0.32, 0.3);
  crown.position.y = 1.05;
  group.add(crown);
  addBlob(group, 0.7, 0.4);
  group.scale.setScalar(scale);
  foliageShadow(shadow(group));
  mergeStatic(group);
  return { group, crown, phase: rand() * 6 };
}

export function buildBush(rand, scale = 1) {
  const group = new THREE.Group();
  const blobs = 2 + Math.floor(rand() * 2);
  const parts = [];
  const lumps = [];
  for (let i = 0; i < blobs; i += 1) {
    const r = 0.16 + rand() * 0.1;
    const ox = (rand() - 0.5) * 0.3;
    const oy = 0.1 + rand() * 0.05;
    const oz = (rand() - 0.5) * 0.3;
    const geo = lumpGeometry(r, rand() * 80, { detail: 2, amount: 0.18, squash: 0.75 });
    parts.push({ geometry: geo, matrix: new THREE.Matrix4().makeTranslation(ox, oy, oz) });
    lumps.push({ x: ox, y: oy, z: oz, r });
  }
  const mesh = new THREE.Mesh(paintFoliage(mergeGeometries(parts, false), lumps, FOLIAGE_DARK, FOLIAGE_LIGHT), foliageMat);
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  group.add(mesh);
  addBlob(group, 0.35, 0.35);
  group.scale.setScalar(scale);
  foliageShadow(shadow(group));
  mergeStatic(group);
  return group;
}

function waterMaterial() {
  const material = new THREE.MeshStandardMaterial({
    color: 0x5cc3dc, roughness: 0.08, metalness: 0.15, emissive: 0x1a6f8a, emissiveIntensity: 0.25
  });
  const uBurst = { value: 0 };
  material.userData.uBurst = uBurst;
  patchMaterial(material, "springWater", shader => {
    shader.uniforms.uTime = shared.uTime;
    shader.uniforms.uHealth = shared.uHealth;
    shader.uniforms.uHaze = shared.uHaze;
    shader.uniforms.uSunTint = shared.uSunTint;
    shader.uniforms.uBurst = uBurst;
    material.userData.uniforms = shader.uniforms;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>
        varying vec2 vPond;
        varying vec3 vWorldPos;
        varying vec3 vViewN;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        vPond = position.xy;
        vec4 wp = modelMatrix * vec4(transformed, 1.0);
        vWorldPos = wp.xyz;
        vViewN = normalize(normalMatrix * normal);`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
        uniform float uTime, uHealth, uBurst;
        uniform vec3 uHaze, uSunTint;
        varying vec2 vPond;
        varying vec3 vWorldPos;
        varying vec3 vViewN;
        float hash21(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        float pondRipple(vec2 p) {
          float rad = length(p) / 0.85;
          float ang = atan(p.y, p.x);
          return sin(rad * 18.0 - uTime * 2.4) * 0.45
            + sin(rad * 31.0 + ang * 3.0 + uTime * 1.7) * 0.25
            + uBurst * sin(rad * 22.0 - uTime * 6.0) * 0.8;
        }`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
        float ripN = pondRipple(vPond);
        normal = normalize(mix(normal, normalize(vViewN + vec3(ripN * 0.08, 0.0, ripN * 0.06)), 0.65));`)
      .replace("#include <color_fragment>", `#include <color_fragment>
        float rad = length(vPond) / 0.85;
        float ang = atan(vPond.y, vPond.x);
        float health = clamp(uHealth, 0.0, 1.0);
        vec3 clearCol = mix(vec3(0.12, 0.42, 0.58), vec3(0.45, 0.82, 0.88), smoothstep(0.05, 0.92, rad));
        vec3 murkCol = mix(vec3(0.28, 0.32, 0.18), vec3(0.42, 0.48, 0.28), smoothstep(0.05, 0.92, rad));
        vec3 waterCol = mix(murkCol, clearCol, health);
        waterCol = mix(waterCol, vec3(0.32, 0.4, 0.22), smoothstep(0.55, 0.2, health) * step(0.55, hash21(floor(vPond * 14.0))) * 0.18);
        float foam = smoothstep(0.72, 0.98, rad) * (0.35 + 0.65 * health);
        foam *= 0.7 + 0.3 * sin(ang * 10.0 + uTime * 1.5);
        waterCol = mix(waterCol, vec3(0.92, 0.96, 0.98), foam * 0.85);
        waterCol += vec3(0.55, 0.85, 0.95) * uBurst * (1.0 - smoothstep(0.0, 1.0, rad)) * 0.35;
        diffuseColor.rgb = waterCol;`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
        vec3 V = normalize(cameraPosition - vWorldPos);
        float healthE = clamp(uHealth, 0.0, 1.0);
        float fres = pow(1.0 - clamp(dot(normalize(vViewN), V), 0.0, 1.0), 3.0);
        totalEmissiveRadiance += uHaze * fres * (0.15 + 0.35 * healthE);
        float ripE = pondRipple(vPond);
        float spark = pow(max(dot(normalize(vViewN + vec3(ripE * 0.2, 0.15, 0.0)), V), 0.0), 48.0);
        totalEmissiveRadiance += uSunTint * spark * healthE * (0.6 + uBurst * 1.4);`);
  });
  return material;
}

const ROCK_GEO = (() => {
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
})();
const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });

export function buildSpring(rand) {
  const group = new THREE.Group();
  const waterMat = waterMaterial();
  const water = new THREE.Mesh(new THREE.CircleGeometry(0.85, 48), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.04;
  water.receiveShadow = true;
  water.userData.keep = true;
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

  shadow(group);
  mergeStatic(group);
  return { group, waterMat, water };
}

function smokeMaterial() {
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 1, transparent: true, opacity: 1, depthWrite: false
  });
  patchMaterial(material, "smokeAlpha", shader => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>
        attribute float aAlpha;
        varying float vAlpha;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        vAlpha = aAlpha;`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
        varying float vAlpha;`)
      .replace("#include <color_fragment>", `#include <color_fragment>
        // Fade out toward the silhouette so the low-poly puff outline never shows as a facet edge.
        float facing = abs(dot(normalize(vNormal), normalize(vViewPosition)));
        diffuseColor.a *= smoothstep(0.12, 0.78, facing);
        diffuseColor.a *= vAlpha;`);
  });
  return material;
}

export function buildWorkshop() {
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
  [0.41, -0.41].forEach(z => {
    const frame = new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.26, 0.03, 2, 0.01), trim);
    frame.position.set(0.22, 0.43, z);
    group.add(frame);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.2), windowMat);
    glass.position.set(0.22, 0.43, z + Math.sign(z) * 0.017);
    if (z < 0) glass.rotation.y = Math.PI;
    glass.userData.keep = true;
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
  const lamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.035, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0xffe6a8, emissive: 0xffc35a, emissiveIntensity: 2 })
  );
  lamp.position.set(-0.36, 0.48, 0.54);
  lamp.userData.keep = true;
  group.add(lamp);
  addHalo(group, lamp.position, 0.35);

  const bark = mat(0x7a5232);
  const cut = mat(0xe2b884);
  for (let i = 0; i < 6; i += 1) {
    const row = i < 3 ? 0 : i < 5 ? 1 : 2;
    const k = i < 3 ? i : i < 5 ? i - 3 : 0;
    const x = 0.62;
    const y = 0.06 + row * 0.105;
    const z = -0.12 + k * 0.125 + row * 0.062;
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.4, 10), bark);
    cyl.rotation.x = Math.PI / 2;
    cyl.position.set(x, y, z);
    group.add(cyl);
    [-0.2, 0.2].forEach(dz => {
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.058, 12), cut);
      disc.position.set(x, y, z + dz);
      if (dz < 0) disc.rotation.y = Math.PI;
      group.add(disc);
    });
  }

  addBlob(group, 0.85, 0.5);
  shadow(group);

  const max = 28;
  const puffGeo = new THREE.IcosahedronGeometry(0.11, 2);
  const alphas = new Float32Array(max);
  puffGeo.setAttribute("aAlpha", new THREE.InstancedBufferAttribute(alphas, 1));
  const smokeMesh = new THREE.InstancedMesh(puffGeo, smokeMaterial(), max);
  smokeMesh.count = 0;
  smokeMesh.castShadow = false;
  smokeMesh.receiveShadow = false;
  smokeMesh.frustumCulled = false;
  smokeMesh.userData.noShadow = true;
  group.add(smokeMesh);

  mergeStatic(group);

  return {
    group,
    windowMat,
    smoke: {
      mesh: smokeMesh,
      max,
      ages: new Float32Array(max),
      lives: new Float32Array(max),
      drifts: new Float32Array(max * 2),
      spins: new Float32Array(max),
      sizes: new Float32Array(max)
    },
    emit: new THREE.Vector3(-0.28, 1.3, -0.12),
    spawn: 0
  };
}

export function buildLanterns() {
  const group = new THREE.Group();
  const wood = textured(woodTexture("#7a5236", 9));
  const iron = mat(0x2f3a4f, { roughness: 0.55, metalness: 0.25 });
  const stone = textured(stoneTexture());
  const posts = [];
  const glassMats = [];
  const halos = [];

  [-1, 1].forEach(side => {
    const plinth = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.1, 0.2, 2, 0.02), stone);
    plinth.position.set(side * 0.85, 0.05, 0);
    group.add(plinth);

    const pivot = new THREE.Group();
    pivot.userData.keep = true;
    pivot.position.x = side * 0.85;

    const post = new THREE.Mesh(new RoundedBoxGeometry(0.1, 0.96, 0.1, 2, 0.02), wood);
    post.position.y = 0.58;
    const arm = new THREE.Mesh(new RoundedBoxGeometry(0.28, 0.045, 0.05, 2, 0.012), wood);
    arm.position.set(-side * 0.1, 0.98, 0);
    const brace = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.03, 0.03, 2, 0.008), wood);
    brace.position.set(-side * 0.06, 0.9, 0);
    brace.rotation.z = side * 0.55;

    const lx = -side * 0.16;
    const ly = 0.78;
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0xffe3a8, emissive: 0xffb84d, emissiveIntensity: 1.2, roughness: 0.4, transparent: true, opacity: 0.92
    });
    // Tapered square lantern body (4-sided cylinder reads as a bevelled box).
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.052, 0.13, 4), glassMat);
    glass.position.set(lx, ly, 0);
    glass.rotation.y = Math.PI / 4;
    glass.userData.keep = true;

    const topCap = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.07, 0.05, 4), iron);
    topCap.position.set(lx, ly + 0.09, 0);
    topCap.rotation.y = Math.PI / 4;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.07, 4), iron);
    roof.position.set(lx, ly + 0.14, 0);
    roof.rotation.y = Math.PI / 4;
    const bottom = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.018, 0.1), iron);
    bottom.position.set(lx, ly - 0.075, 0);
    bottom.rotation.y = Math.PI / 4;

    const barGeo = new THREE.BoxGeometry(0.012, 0.14, 0.012);
    for (let i = 0; i < 4; i += 1) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const bar = new THREE.Mesh(barGeo, iron);
      bar.position.set(lx + Math.cos(a) * 0.048, ly, Math.sin(a) * 0.048);
      pivot.add(bar);
    }

    const hook = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.06, 5), iron);
    hook.position.set(lx, ly + 0.18, 0);

    pivot.add(post, arm, brace, glass, topCap, roof, bottom, hook);
    halos.push(addHalo(pivot, new THREE.Vector3(lx, ly, 0), 0.5));
    group.add(pivot);
    posts.push(pivot);
    glassMats.push(glassMat);
  });

  const bulbGeo = new THREE.SphereGeometry(0.05, 16, 12);
  const bulbs = [];
  for (let i = 0; i < 10; i += 1) {
    const bulbMat = new THREE.MeshStandardMaterial({
      color: 0x5e5866, emissive: 0xffc861, emissiveIntensity: 0, roughness: 0.5
    });
    const bulb = new THREE.Mesh(bulbGeo, bulbMat);
    bulb.userData.keep = true;
    group.add(bulb);
    bulbs.push(bulb);
  }

  addBlob(group, 1.0, 0.3);
  shadow(group);
  mergeStatic(group);
  return { group, posts, glassMats, halos, bulbs };
}

export function buildBench() {
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
  shadow(group);
  mergeStatic(group);
  return { group };
}

function vineColorAt(t, c) {
  c.setRGB(0.42, 0.3, 0.2).lerp(new THREE.Color("#5f7a3a"), THREE.MathUtils.smoothstep(t, 0.15, 0.85));
}

function spiralStem(turns, height, radius, phase, curl = 0.12) {
  const pts = [];
  const n = 28;
  for (let i = 0; i <= n; i += 1) {
    const t = i / n;
    const a = phase + t * turns * Math.PI * 2;
    const r = radius * (1 - t * 0.25);
    pts.push(new THREE.Vector3(Math.cos(a) * r, t * height, Math.sin(a) * r));
  }
  const tip = pts[pts.length - 1];
  const a = phase + turns * Math.PI * 2;
  pts.push(tip.clone().add(new THREE.Vector3(Math.cos(a) * curl, curl * 0.6, Math.sin(a) * curl)));
  pts.push(tip.clone().add(new THREE.Vector3(Math.cos(a + 0.8) * curl * 0.4, curl * 1.1, Math.sin(a + 0.8) * curl * 0.4)));
  return pts;
}

export function buildVine(rand) {
  const group = new THREE.Group();
  const knot = new THREE.Group();
  knot.userData.keep = true;
  const vineMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  const parts = [];

  for (let s = 0; s < 3; s += 1) {
    const pts = spiralStem(1.6 + s * 0.25, 0.75 + s * 0.08, 0.34 - s * 0.04, s * 2.1 + rand(), 0.14);
    parts.push({
      geometry: taperedTube(pts, t => 0.055 * (1 - t * 0.75) + 0.008, {
        segments: 36, radial: 6, colorAt: vineColorAt
      })
    });
  }

  for (let i = 0; i < 5; i += 1) {
    const a = (i / 5) * Math.PI * 2 + 0.4;
    const rootPts = [
      new THREE.Vector3(Math.cos(a) * 0.2, 0.12, Math.sin(a) * 0.2),
      new THREE.Vector3(Math.cos(a) * 0.38, 0.02, Math.sin(a) * 0.38),
      new THREE.Vector3(Math.cos(a) * 0.5, -0.06, Math.sin(a) * 0.5),
      new THREE.Vector3(Math.cos(a) * 0.58, -0.1, Math.sin(a) * 0.58)
    ];
    parts.push({
      geometry: taperedTube(rootPts, t => 0.045 * (1 - t * 0.7), {
        segments: 10, radial: 5, colorAt: (t, c) => c.setRGB(0.36, 0.24, 0.16)
      })
    });
  }

  for (let i = 0; i < 4; i += 1) {
    const a = i * 1.7 + 0.5;
    const base = new THREE.Vector3(Math.cos(a) * 0.3, 0.35 + (i % 2) * 0.12, Math.sin(a) * 0.3);
    const tendril = [
      base,
      base.clone().add(new THREE.Vector3(Math.cos(a + 1) * 0.12, 0.08, Math.sin(a + 1) * 0.12)),
      base.clone().add(new THREE.Vector3(Math.cos(a + 2) * 0.18, 0.02, Math.sin(a + 2) * 0.18)),
      base.clone().add(new THREE.Vector3(Math.cos(a + 3.2) * 0.1, -0.04, Math.sin(a + 3.2) * 0.1))
    ];
    parts.push({
      geometry: taperedTube(tendril, t => 0.018 * (1 - t * 0.8), {
        segments: 12, radial: 5, colorAt: vineColorAt
      })
    });
  }

  const stemMesh = new THREE.Mesh(mergeGeometries(parts, true), vineMat);
  knot.add(stemMesh);

  const leafMat = mat(0x5e8a3c, { side: THREE.DoubleSide });
  const leafGeo = new THREE.SphereGeometry(0.055, 8, 6);
  for (let i = 0; i < 20; i += 1) {
    const a = rand() * Math.PI * 2;
    const leaf = new THREE.Mesh(leafGeo, leafMat);
    leaf.scale.set(1.5, 0.28, 0.85);
    leaf.position.set(
      Math.cos(a) * (0.28 + rand() * 0.18),
      0.22 + rand() * 0.48,
      Math.sin(a) * (0.28 + rand() * 0.18)
    );
    leaf.rotation.set(rand() * 2, rand() * 6, rand() * 2);
    knot.add(leaf);
  }

  const thornMat = mat(0x6e5236);
  for (let i = 0; i < 16; i += 1) {
    const a = i * 2.3;
    const thorn = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.085, 5), thornMat);
    thorn.position.set(Math.cos(a) * 0.4, 0.28 + (i % 5) * 0.08, Math.sin(a) * 0.4);
    thorn.rotation.set(Math.sin(a) * 1.2, 0, -Math.cos(a) * 1.2);
    knot.add(thorn);
  }

  addBlob(knot, 0.6, 0.4);
  shadow(knot);
  mergeStatic(knot);
  group.add(knot);

  const sprout = new THREE.Group();
  sprout.userData.keep = true;
  const glowMat = new THREE.MeshStandardMaterial({
    color: 0x7fe0c8, emissive: 0x2fd3b0, emissiveIntensity: 0.9, roughness: 0.5
  });
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
  sprout.position.set(0.95, 0, 0.2);
  sprout.visible = false;
  group.add(sprout);

  return { group, knot, sprout, glowMat };
}

export function buildSignpost() {
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
  const lamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 12, 8),
    new THREE.MeshStandardMaterial({ color: 0xffe2a0, emissive: 0xffc35a, emissiveIntensity: 1.8 })
  );
  lamp.position.y = 1.16;
  lamp.userData.keep = true;
  group.add(lamp);
  const halo = addHalo(group, lamp.position, 0.45);
  addBlob(group, 0.3, 0.4);
  shadow(group);
  mergeStatic(group);
  return { group, gem: lamp, halo };
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
    pivot.userData.keep = true;
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
    pivot.userData.keep = true;
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
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.8, 8), mat(0x7a5634));
  stick.position.set(0.02, -0.25, 0.06);
  arms[1].add(stick);

  const head = new THREE.Group();
  head.userData.keep = true;
  head.position.y = 0.93;
  head.scale.setScalar(0.84);
  head.add(new THREE.Mesh(new THREE.SphereGeometry(0.165, 28, 20), skin));
  const eyes = [-1, 1].map(side => {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.019, 10, 8), mat(0x2a2230, { roughness: 0.3 }));
    eye.position.set(side * 0.056, 0, 0.152);
    eye.scale.y = 1.25;
    head.add(eye);
    return eye;
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

  const pack = new THREE.Group();
  pack.userData.keep = true;
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
  charm.userData.keep = true;
  charm.position.set(0.17, 0.08, 0);
  const lamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.035, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0xffe6a8, emissive: 0xffc35a, emissiveIntensity: 1.8 })
  );
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
  mergeStatic(body);
  return { group, body, legs, arms, head, pack, charm, eyes };
}

export function buildFarPlanets(rand) {
  const defs = [
    { id: "gravity", name: "引力星", sub: "重力问题", color: 0x7a6cc0, pos: [-26, 9, -16], r: 2.3, ring: 0xe6c97a },
    { id: "compass", name: "指南针星", sub: "工作观与人生观", color: 0x5d95d6, pos: [-6, 15, -30], r: 1.6, needle: true },
    { id: "flow", name: "心流星", sub: "心流与能量", color: 0x4fc2b0, pos: [-34, 3, 14], r: 2.2, glow: 0x9ff5e0 },
    { id: "anchor", name: "锚点星", sub: "锚点", color: 0xc08a66, pos: [12, 12, -26], r: 1.8, anchor: true },
    { id: "crossroads", name: "三岔路星", sub: "奥德赛计划", color: 0xe8bb84, pos: [30, 7, -6], r: 2.6, roads: true }
  ];
  return defs.map((def, i) => {
    const group = new THREE.Group();
    const ball = new THREE.Mesh(
      new THREE.IcosahedronGeometry(def.r, 5),
      new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.95 })
    );
    group.add(ball);
    if (def.ring) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(def.r * 1.6, def.r * 0.06, 8, 64),
        new THREE.MeshStandardMaterial({ color: def.ring, roughness: 0.6 })
      );
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
      const band = new THREE.Mesh(
        new THREE.TorusGeometry(def.r * 1.05, def.r * 0.08, 8, 48),
        new THREE.MeshStandardMaterial({ color: def.glow, emissive: def.glow, emissiveIntensity: 1.4 })
      );
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
        const road = new THREE.Mesh(
          new THREE.TorusGeometry(def.r * 1.01, def.r * 0.05, 6, 40, Math.PI * 0.7),
          new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.35 })
        );
        road.rotation.set(Math.PI / 2, 0, (k * Math.PI * 2) / 3);
        group.add(road);
      });
    }
    group.position.set(...def.pos);
    return { ...def, group, hit: [ball], phase: rand() * Math.PI * 2 + i };
  });
}
