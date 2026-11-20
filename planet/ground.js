import * as THREE from "three";
import {
  R, Y, POLE, PATH_ANGLE, SUN, shared, NOISE_GLSL, patchMaterial, seeThrough,
  surfaceRadius, randomDir, yawToward
} from "./geo.js";

const GROUND_GLSL = /* glsl */`
  ${NOISE_GLSL}
  vec3 meadowOf(float p) {
    // Soft, unified pastel-lush greens: a tight tonal range reads as a calm, storybook meadow
    // rather than mottled patches.
    vec3 a = vec3(0.560, 0.775, 0.340);
    vec3 b = vec3(0.395, 0.665, 0.315);
    vec3 c = vec3(0.255, 0.540, 0.330);
    return p < 0.5 ? mix(a, b, p * 2.0) : mix(b, c, (p - 0.5) * 2.0);
  }
  vec3 strawOf(float p) {
    vec3 a = vec3(0.863, 0.773, 0.541);
    vec3 b = vec3(0.749, 0.639, 0.416);
    vec3 c = vec3(0.561, 0.498, 0.333);
    return p < 0.5 ? mix(a, b, p * 2.0) : mix(b, c, (p - 0.5) * 2.0);
  }
  float fieldPatch(vec3 d) {
    float v = sin(d.x * 2.0 + 0.7) * sin(d.y * 2.4 + 2.1) + 0.5 * sin(d.z * 3.0 + d.x * 1.5 + 0.4);
    return clamp(0.5 + v * 0.4, 0.0, 1.0);
  }
  float fieldDetail(vec3 d) {
    return 0.5 + 0.5 * sin(d.x * 6.5 + 0.3) * sin(d.y * 6.1 + 1.9) * sin(d.z * 6.9 + 0.8);
  }
  // Chord distance on the unit sphere: cheap and stable near the poles of each apron.
  float chordTo(vec3 d, vec3 c) {
    return length(d - c);
  }
  vec3 groundColour(vec3 d, float health, vec4 aprons[6]) {
    float p = fieldPatch(d);
    float n = fieldDetail(d);
    vec3 col = mix(strawOf(p), meadowOf(p), smoothstep(0.05, 0.6, health));
    col += (n - 0.5) * 0.014;
    // Keep only a broad, gentle colour drift so the meadow reads velvety instead of grainy.
    col *= 1.0 + (vnoise(d * 4.0) - 0.5) * 0.045;

    float off = abs(acos(clamp(dot(d, vec3(${POLE.x.toFixed(5)}, ${POLE.y.toFixed(5)}, ${POLE.z.toFixed(5)})), -1.0, 1.0)) - ${PATH_ANGLE.toFixed(5)});
    float edge = 0.026 + (vnoise(d * 14.0) - 0.5) * 0.008;
    float path = 1.0 - smoothstep(edge, edge + 0.032, off + (n - 0.5) * 0.004);
    vec3 dirt = vec3(0.855, 0.735, 0.560) * (1.0 + (n - 0.5) * 0.04);
    col = mix(col, dirt, path);

    for (int i = 0; i < 6; i++) {
      float dist = chordTo(d, aprons[i].xyz);
      // Darken toward the prop instead of lightening: a bright disc under every object is what
      // makes them read as stickers. Smooth dirt patch inside, soft AO skirt slightly wider.
      float dirtK = 1.0 - smoothstep(aprons[i].w * 0.35, aprons[i].w, dist);
      float rough = 0.94 + 0.08 * (vnoise(d * 10.0) - 0.5);
      col = mix(col, vec3(0.62, 0.53, 0.39) * rough, dirtK * 0.48);
      col *= 1.0 - 0.16 * (1.0 - smoothstep(0.0, aprons[i].w * 1.15, dist));
    }
    return col;
  }
`;

export function buildPlanet(aprons) {
  const geometry = new THREE.SphereGeometry(1, 128, 80);
  const pos = geometry.attributes.position;
  const d = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 1) {
    d.fromBufferAttribute(pos, i).normalize();
    const r = surfaceRadius(d);
    pos.setXYZ(i, d.x * r, d.y * r, d.z * r);
  }
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, color: 0xffffff, envMapIntensity: 0.22 });
  material.defines.TOON_GROUND = "";
  const uAprons = { value: aprons };
  patchMaterial(material, "ground", shader => {
    shader.uniforms.uHealth = shared.uHealth;
    shader.uniforms.uHaze = shared.uHaze;
    shader.uniforms.uAprons = uAprons;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\nvarying vec3 vPlanetDir;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\nvPlanetDir = normalize(position);`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\nuniform float uHealth;\nuniform vec3 uHaze;\nuniform vec4 uAprons[6];\nvarying vec3 vPlanetDir;\n${GROUND_GLSL}`)
      .replace("#include <color_fragment>", `#include <color_fragment>
        vec3 g = groundColour(normalize(vPlanetDir), uHealth, uAprons);
        diffuseColor.rgb *= g;`)
      .replace("#include <opaque_fragment>", `#include <opaque_fragment>
        float haze = smoothstep(0.35, 0.98, 1.0 - max(dot(normalize(vPlanetDir), vec3(0.0, 1.0, 0.0)) * 0.5 + 0.5, 0.0));
        gl_FragColor.rgb = mix(gl_FragColor.rgb, uHaze, haze * 0.05);`);
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return { mesh, material };
}

// Soft limb of air around the planet: brightest where the view grazes the surface.
export function buildAtmosphere() {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uHaze: shared.uHaze,
      uSunTint: shared.uSunTint,
      uSunDir: { value: SUN.clone() },
      uStrength: { value: 1 }
    },
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    vertexShader: /* glsl */`
      varying vec3 vNormal;
      varying vec3 vWorld;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 uHaze, uSunTint, uSunDir;
      uniform float uStrength;
      varying vec3 vNormal;
      varying vec3 vWorld;
      void main() {
        vec3 V = normalize(cameraPosition - vWorld);
        vec3 N = normalize(vNormal);
        float fres = pow(clamp(-dot(N, V) / 0.531, 0.0, 1.0), 2.5);
        float sunSide = 0.55 + 0.45 * max(dot(normalize(vWorld), uSunDir), 0.0);
        vec3 tint = mix(uHaze, uSunTint, 0.35 * sunSide);
        gl_FragColor = vec4(tint * fres * uStrength * 0.85, fres * uStrength);
      }
    `
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(R * 1.18, 48, 32), material);
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;
  return { mesh, material };
}

const TUFT_H = 0.14;
// The breeze blows one way across the whole planet; every blade leans with it.
const WIND = new THREE.Vector3(0.82, 0.1, -0.56).normalize();

// A soft velvet tuft rather than spiky needles: fewer, broader blades leaning gently downwind so
// neighbouring tufts blend into one calm carpet instead of breaking up into pixel-wide stripes.
function tuftGeometry() {
  const blades = 7;
  const segs = 2;
  const positions = [];
  const normals = [];
  const uvs = [];
  const rand = (() => { let s = 7; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; })();
  for (let b = 0; b < blades; b += 1) {
    const ba = (b / blades) * Math.PI * 2 + rand() * 0.45;
    const br = 0.03 + 0.065 * Math.sqrt(rand());
    const bx = Math.cos(ba) * br;
    const bz = Math.sin(ba) * br;
    const face = rand() * Math.PI;
    const lean = 0.03 + rand() * 0.015;
    const h = TUFT_H * (0.86 + rand() * 0.14);
    const w = 0.05;
    const width = t => w * (1 - t * t * 0.72);
    for (let s = 0; s < segs; s += 1) {
      const t0 = s / segs;
      const t1 = (s + 1) / segs;
      const y0 = t0 * h;
      const y1 = t1 * h;
      const z0 = bz + lean * t0 * t0;
      const z1 = bz + lean * t1 * t1;
      const wx0 = Math.cos(face) * width(t0);
      const wz0 = Math.sin(face) * width(t0);
      const wx1 = Math.cos(face) * width(t1);
      const wz1 = Math.sin(face) * width(t1);
      const verts = [
        [bx - wx0, y0, z0 - wz0], [bx + wx0, y0, z0 + wz0], [bx + wx1, y1, z1 + wz1],
        [bx - wx0, y0, z0 - wz0], [bx + wx1, y1, z1 + wz1], [bx - wx1, y1, z1 - wz1]
      ];
      verts.forEach(v => {
        positions.push(...v);
        // Lit as the ground it grows from, so the lawn shades as one surface, not blade by blade.
        normals.push(0, 1, 0);
        uvs.push(v[1] / h, v[1] / h);
      });
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  return geo;
}

function grassMaterial() {
  const material = new THREE.MeshStandardMaterial({
    roughness: 0.94,
    metalness: 0,
    envMapIntensity: 0.18,
    side: THREE.DoubleSide,
    vertexColors: false
  });
  material.defines.TOON_GROUND = "";
  patchMaterial(material, "grass", shader => {
    shader.uniforms.uTime = shared.uTime;
    shader.uniforms.uHealth = shared.uHealth;
    shader.uniforms.uHaze = shared.uHaze;
    shader.uniforms.uAprons = { value: shared._aprons || [] };
    // Bind the same apron array the planet uses (filled by createWorld).
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\nuniform float uTime;\nvarying float vH;\nvarying float vWave;\nvarying vec3 vPlanetDir;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        vH = clamp(position.y / ${TUFT_H.toFixed(3)}, 0.0, 1.0);
        vec3 ip = vec3(0.0);
        #ifdef USE_INSTANCING
          ip = instanceMatrix[3].xyz;
        #endif
        vPlanetDir = normalize(ip);
        // Broad bands of wind roll downwind across the meadow; a slower cross swell keeps the
        // fronts from reading as ruled lines.
        vec3 windDir = vec3(${WIND.x.toFixed(4)}, ${WIND.y.toFixed(4)}, ${WIND.z.toFixed(4)});
        float along = dot(ip, windDir);
        float cross = dot(ip, vec3(0.31, 0.62, 0.72));
        float wave = 0.5 + 0.5 * sin(along * 1.15 - uTime * 1.4 + 1.0 * sin(cross * 0.75 + uTime * 0.25));
        wave = wave * wave * (3.0 - 2.0 * wave);
        vWave = wave;
        transformed.z += (0.01 + 0.055 * wave) * vH * vH;
        transformed.y -= 0.018 * wave * vH * vH;`)
      // A blade is shadowed where it stands, not where its tip happens to reach: sampled per
      // vertex, a tree's shadow on the lawn broke up into a litter of lit tips and dark roots.
      .replace("#include <shadowmap_vertex>", `
        #if defined( USE_SHADOWMAP ) && defined( USE_INSTANCING )
          worldPosition = modelMatrix * instanceMatrix * vec4(position.x, 0.01, position.z, 1.0);
        #endif
        #include <shadowmap_vertex>`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\nuniform float uHealth;\nuniform vec3 uHaze;\nuniform vec4 uAprons[6];\nvarying float vH;\nvarying float vWave;\nvarying vec3 vPlanetDir;\n${GROUND_GLSL}`)
      .replace("#include <color_fragment>", `#include <color_fragment>
        vec3 g = groundColour(normalize(vPlanetDir), uHealth, uAprons);
        // Almost seamless with the ground in the troughs, lifting softly in warm sunlight where
        // the breeze rolls past; fade tip contrast with distance so far blades never fizz.
        // Shaded root to tinted tip, never bright to bright: a blade is a pixel or two wide on
        // screen, so any lift in luminance turns into an isolated white speck that sparkles as
        // the wind rolls the lawn. Tone and hue carry the texture instead.
        vec3 rootC = g * 0.95;
        vec3 tipC = g * vec3(1.0, 1.045, 0.965);
        float distFade = 1.0 - smoothstep(16.0, 30.0, length(vViewPosition));
        // Each tuft sits a little apart in tone from its neighbours: without that, a lawn lit by
        // one flat normal reads as a single painted colour, with no grass in it at all.
        // A smooth drift of tone across the meadow, never a per-tuft random value: at a distance
        // a per-tuft value puts one brighter tuft next to a darker one and the lawn glitters.
        float tuftTone = vnoise(normalize(vPlanetDir) * 9.0);
        diffuseColor.rgb *= 0.975 + 0.05 * tuftTone;
        diffuseColor.rgb = mix(rootC * (0.975 + 0.05 * tuftTone), tipC * (0.975 + 0.05 * tuftTone), vH * (0.5 + 0.4 * vWave) * distFade);`)
      // Blades are two-sided, and the renderer flips the normal on a back face: half the lawn was
      // being lit as if it faced the ground. Both sides take the ground's normal.
      .replace("#include <normal_fragment_begin>", `#include <normal_fragment_begin>
        normal = normalize(vNormal);`);
  });
  return material;
}

// Split tufts into chunks whose origins sit on an icosahedron, so the far side of the planet can
// be frustum-culled without walking every instance.
export function buildGrass(rand, blockers, { count, aprons }) {
  const material = grassMaterial();
  const patches = material.userData.patches;
  patches.forEach(p => {
    if (p.name !== "grass") return;
    const inner = p.patch;
    p.patch = shader => {
      inner(shader);
      shader.uniforms.uAprons = { value: aprons };
    };
  });

  const chunkDirs = [];
  const ico = new THREE.IcosahedronGeometry(1, 1);
  const cpos = ico.attributes.position;
  for (let i = 0; i < cpos.count; i += 1) {
    const d = new THREE.Vector3().fromBufferAttribute(cpos, i).normalize();
    if (!chunkDirs.some(x => x.dot(d) > 0.92)) chunkDirs.push(d);
  }
  ico.dispose();

  const geo = tuftGeometry();
  const per = Math.ceil(count / chunkDirs.length);
  const chunks = chunkDirs.map(center => {
    const mesh = new THREE.InstancedMesh(geo, material, per);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    // Instances are in world space; a single generous sphere keeps culling simple and safe.
    mesh.frustumCulled = true;
    mesh.boundingSphere = new THREE.Sphere(center.clone().multiplyScalar(R), R * 0.9);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const q2 = new THREE.Quaternion();
    const e = new THREE.Euler();
    let placed = 0;
    let guard = 0;
    while (placed < per && guard < per * 40) {
      guard += 1;
      let d = randomDir(rand);
      if (d.dot(POLE) < -0.05 && rand() < 0.7) d = d.multiplyScalar(-1);
      d = d.addScaledVector(center, 1.4).normalize();
      if (d.dot(center) < 0.55) continue;
      if (blockers.some(b => d.angleTo(b.dir) < b.radius + 0.04)) continue;
      if (Math.abs(d.angleTo(POLE) - PATH_ANGLE) < 0.05) continue;
      const s = 0.9 + rand() * 0.25;
      q.setFromUnitVectors(Y, d);
      q2.setFromEuler(e.set((rand() - 0.5) * 0.015, yawToward(d, WIND) + (rand() - 0.5) * 0.55, (rand() - 0.5) * 0.015));
      q.multiply(q2);
      m.compose(d.clone().multiplyScalar(surfaceRadius(d)), q, new THREE.Vector3(s, s, s));
      mesh.setMatrixAt(placed, m);
      placed += 1;
    }
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  });

  return {
    meshes: chunks,
    material,
    setCount(ratio) {
      chunks.forEach(mesh => {
        mesh.count = Math.max(0, Math.floor(mesh.instanceMatrix.count * ratio));
      });
    }
  };
}

export function scatter(rand, count, blockers, geometry, material, {
  lift = 0, scaleMin = 0.7, scaleMax = 1.3, tilt = 0.25, avoidPath = false, near = null
} = {}) {
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

export function flowerGeometry() {
  const geo = new THREE.CircleGeometry(0.06, 20);
  const pos = geo.attributes.position;
  for (let i = 1; i < pos.count; i += 1) {
    const a = Math.atan2(pos.getY(i), pos.getX(i));
    const r = 0.06 * (0.62 + 0.38 * Math.abs(Math.cos(a * 2.5)));
    pos.setXY(i, Math.cos(a) * r, Math.sin(a) * r);
  }
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0.095, 0);
  return geo;
}

export function mossyRockGeometry() {
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
