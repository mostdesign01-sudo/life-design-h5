import * as THREE from "three";
import { FullScreenQuad } from "../vendor/three-addons/postprocessing/Pass.js";
import { R, SUN, POLE, NOISE_GLSL, randomDir } from "./geo.js";
import { cloudTexture } from "./look.js";

// Clouds are painted once into a panorama (R: cloud field, G: how much of it faces the sun,
// B: where clouds are allowed, thick near the horizon and thin overhead). The sky reads it every
// frame with a moving threshold, so the same field can be a few fair-weather puffs or a full overcast.
function bakeClouds(renderer) {
  const target = new THREE.WebGLRenderTarget(1024, 512, { depthBuffer: false });
  target.texture.wrapS = THREE.RepeatWrapping;
  target.texture.wrapT = THREE.ClampToEdgeWrapping;
  target.texture.minFilter = THREE.LinearFilter;
  target.texture.magFilter = THREE.LinearFilter;
  target.texture.generateMipmaps = false;
  const material = new THREE.ShaderMaterial({
    uniforms: { uSun: { value: SUN.clone() } },
    depthTest: false,
    depthWrite: false,
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 uSun;
      varying vec2 vUv;
      ${NOISE_GLSL}
      float field(vec3 d) {
        // Stretched sideways so the shapes come out as banks and streaks rather than round blobs.
        vec3 p = vec3(d.x, d.y * 2.6, d.z) * 2.3 + vec3(3.1, 1.7, 5.3);
        float f = 0.0;
        float a = 0.5;
        for (int i = 0; i < 5; i++) {
          f += a * vnoise(p);
          p = p * 2.03 + vec3(1.7, 9.2, 4.1);
          a *= 0.5;
        }
        return f;
      }
      void main() {
        float lon = (vUv.x - 0.5) * 6.2831853;
        float lat = (vUv.y - 0.5) * 3.1415927;
        vec3 d = vec3(cos(lat) * cos(lon), sin(lat), cos(lat) * sin(lon));
        float f = field(d);
        vec3 toSun = normalize(uSun - d * dot(uSun, d) + vec3(0.0, 0.35, 0.0));
        float lit = clamp(0.5 + (f - field(normalize(d + toSun * 0.05))) * 7.0, 0.0, 1.0);
        float band = smoothstep(-0.2, 0.0, d.y) * (1.0 - 0.75 * smoothstep(0.3, 0.85, d.y));
        gl_FragColor = vec4(f, lit, band, 1.0);
      }
    `
  });
  const quad = new FullScreenQuad(material);
  const previous = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  quad.render(renderer);
  renderer.setRenderTarget(previous);
  material.dispose();
  return target.texture;
}

const hex = value => new THREE.Color(value);

// Three moods, picked by the play score: overcast when there is no time for joy, a fair day in the
// middle, and a full evening glow at the top.
const MOODS = {
  dull: {
    top: hex("#8e96a8"), mid: hex("#b9bec9"), horizon: hex("#c9ccd4"), bottom: hex("#d6d5d8"),
    cloudLit: hex("#e2e3e8"), cloudShade: hex("#8f95a6"), glow: hex("#e6e2dc"), sun: hex("#f3efe6"),
    cover: 0.38, glowAmount: 0.2, sunAmount: 0.0, sunPower: 1.0,
    light: hex("#e9edf5"), lightPower: 1.15, skyLight: hex("#dfe6f2"), groundLight: hex("#8e9a84"), ambient: 1.25
  },
  day: {
    top: hex("#3a6cbf"), mid: hex("#7fb0e6"), horizon: hex("#ffe2b8"), bottom: hex("#f3e3d6"),
    cloudLit: hex("#fffaf0"), cloudShade: hex("#b4bbe0"), glow: hex("#ffe1a8"), sun: hex("#fff3d6"),
    cover: 0.535, glowAmount: 0.7, sunAmount: 1.0, sunPower: 3.0,
    light: hex("#ffe0b5"), lightPower: 2.75, skyLight: hex("#d6e6ff"), groundLight: hex("#7d9a55"), ambient: 0.95
  },
  dusk: {
    top: hex("#7a6fc0"), mid: hex("#f7a98c"), horizon: hex("#ff9a5c"), bottom: hex("#ffc39b"),
    cloudLit: hex("#ffb07a"), cloudShade: hex("#8a5f9e"), glow: hex("#ff8438"), sun: hex("#ffb060"),
    cover: 0.5, glowAmount: 1.0, sunAmount: 1.0, sunPower: 3.4,
    light: hex("#ffb878"), lightPower: 3.0, skyLight: hex("#f4cfd6"), groundLight: hex("#a08a5a"), ambient: 0.9
  }
};

export function buildSky(renderer) {
  const uniforms = {
    uTop: { value: MOODS.day.top.clone() },
    uMid: { value: MOODS.day.mid.clone() },
    uHorizon: { value: MOODS.day.horizon.clone() },
    uBottom: { value: MOODS.day.bottom.clone() },
    uSunDir: { value: SUN.clone() },
    uSunColor: { value: MOODS.day.sun.clone() },
    uSunPower: { value: 3 },
    uSunAmount: { value: 1 },
    // Cosine of the sun disc's angular radius, and how soft its edge is.
    uSunSize: { value: 0.9991 },
    uSunSoft: { value: 0.0003 },
    uGlowColor: { value: MOODS.day.glow.clone() },
    uGlow: { value: 0.7 },
    uCloudMap: { value: bakeClouds(renderer) },
    uCloudLit: { value: MOODS.day.cloudLit.clone() },
    uCloudShade: { value: MOODS.day.cloudShade.clone() },
    uCover: { value: 0.53 },
    uCloudShift: { value: 0 },
    uVivid: { value: 1 }
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 uTop, uMid, uHorizon, uBottom, uSunDir, uSunColor, uGlowColor, uCloudLit, uCloudShade;
      uniform float uSunPower, uSunAmount, uSunSize, uSunSoft, uGlow, uCover, uCloudShift, uVivid;
      uniform sampler2D uCloudMap;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(uHorizon, uMid, smoothstep(-0.02, 0.2, h));
        col = mix(col, uTop, smoothstep(0.2, 0.8, h));
        col = mix(col, uBottom, smoothstep(0.0, -0.25, h));
        float s = max(dot(d, uSunDir), 0.0);
        // Warm air around the sun. Blended toward a colour rather than added, so facing the sun
        // gives a deeper sky instead of a white one.
        col = mix(col, uGlowColor, pow(s, 4.0) * 0.8 * uGlow);

        vec2 uv = vec2(atan(d.z, d.x) / 6.2831853 + 0.5 + uCloudShift, asin(clamp(h, -1.0, 1.0)) / 3.1415927 + 0.5);
        vec3 c = texture2D(uCloudMap, uv).rgb;
        float dens = smoothstep(uCover, uCover + 0.13, c.r) * c.b;
        float thin = dens * (1.0 - dens) * 4.0;
        vec3 cloud = mix(uCloudShade, uCloudLit, c.g);
        // Clouds near the sun take its colour, and their thin edges light up.
        cloud = mix(cloud, uGlowColor * 1.08, pow(s, 2.5) * 0.65 * uGlow);
        cloud += uSunColor * thin * pow(s, 8.0) * 0.35 * uSunAmount;
        col = mix(col, cloud, dens * 0.94);

        float disc = smoothstep(uSunSize - uSunSoft, uSunSize + uSunSoft, s) * (1.0 - dens * 0.85);
        col += uSunColor * pow(s, 220.0) * 0.5 * uSunAmount * (1.0 - dens * 0.6);
        col = mix(col, uSunColor * uSunPower, disc * uSunAmount);

        float g = dot(col, vec3(0.299, 0.587, 0.114));
        col = mix(vec3(g) * vec3(0.9, 0.92, 0.98), col, 0.35 + 0.65 * uVivid);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }
    `
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 48, 24), material);
  sky.renderOrder = -1;
  sky.frustumCulled = false;

  const mixed = {
    light: new THREE.Color(), skyLight: new THREE.Color(), groundLight: new THREE.Color(),
    lightPower: 1, ambient: 1, vivid: 1, glow: 0
  };
  const tmp = new THREE.Color();

  // Blend the three moods for a play score in 0..1 and write the result into the sky's uniforms.
  // Returns the matching light colours so the ground is always lit by the sky above it.
  function setMood(play, time) {
    const vivid = THREE.MathUtils.smoothstep(play, 0.1, 0.55);
    const glow = THREE.MathUtils.smoothstep(play, 0.68, 1);
    const blend = key => tmp.copy(MOODS.dull[key]).lerp(MOODS.day[key], vivid).lerp(MOODS.dusk[key], glow);
    const blendNumber = key => THREE.MathUtils.lerp(THREE.MathUtils.lerp(MOODS.dull[key], MOODS.day[key], vivid), MOODS.dusk[key], glow);
    uniforms.uTop.value.copy(blend("top"));
    uniforms.uMid.value.copy(blend("mid"));
    uniforms.uHorizon.value.copy(blend("horizon"));
    uniforms.uBottom.value.copy(blend("bottom"));
    uniforms.uCloudLit.value.copy(blend("cloudLit"));
    uniforms.uCloudShade.value.copy(blend("cloudShade"));
    uniforms.uGlowColor.value.copy(blend("glow"));
    uniforms.uSunColor.value.copy(blend("sun"));
    uniforms.uCover.value = blendNumber("cover");
    uniforms.uGlow.value = blendNumber("glowAmount");
    uniforms.uSunAmount.value = blendNumber("sunAmount");
    uniforms.uSunPower.value = blendNumber("sunPower");
    uniforms.uVivid.value = 0.25 + 0.75 * vivid;
    uniforms.uCloudShift.value = time * 0.0004;
    mixed.light.copy(blend("light"));
    mixed.skyLight.copy(blend("skyLight"));
    mixed.groundLight.copy(blend("groundLight"));
    mixed.lightPower = blendNumber("lightPower");
    mixed.ambient = blendNumber("ambient");
    mixed.vivid = vivid;
    mixed.glow = glow;
    return mixed;
  }

  return { sky, uniforms, setMood };
}

// A sea of painted puffs far below the planet: it floats above the weather.
export function buildCloudSea(rand) {
  const group = new THREE.Group();
  const materials = [3, 17, 29, 41].map(seed => new THREE.SpriteMaterial({
    map: cloudTexture(seed), transparent: true, depthWrite: false, fog: false, color: 0xffffff
  }));
  for (let i = 0; i < 44; i += 1) {
    const angle = rand() * Math.PI * 2;
    const radius = 7 + Math.pow(rand(), 0.6) * 80;
    const s = 9 + rand() * 13 + radius * 0.09;
    const sprite = new THREE.Sprite(materials[i % materials.length]);
    sprite.position.set(Math.cos(angle) * radius, -R - 3.4 - rand() * 3 - radius * 0.045, Math.sin(angle) * radius);
    sprite.scale.set(s, s * 0.62, 1);
    group.add(sprite);
  }
  return { group, materials };
}

// Drifting glow motes (fireflies) or fluff, with a per-point phase for twinkle.
export function buildMotes(rand, { count, color, size, minLift, maxLift, speed, opacity }) {
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
    vertexShader: /* glsl */`
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
    fragmentShader: /* glsl */`
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
