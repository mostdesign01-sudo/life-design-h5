import * as THREE from "three";
import { FullScreenQuad } from "../vendor/three-addons/postprocessing/Pass.js";
import { UnrealBloomPass } from "../vendor/three-addons/postprocessing/UnrealBloomPass.js";

// The whole finish in one full-screen pass: a tilt-shift blur that grows away from the focus line,
// the painterly grade (a little extra saturation, warm highlights, cool lilac shadows, a soft
// vignette, faint paper grain), then tone mapping and the display transfer.
const FinishShader = {
  uniforms: {
    tDiffuse: { value: null },
    toneMappingExposure: { value: 1 },
    uTexel: { value: new THREE.Vector2(1, 1) },
    uBlur: { value: 0.6 },
    uFocus: { value: 0.45 },
    uSaturation: { value: 1.2 },
    uVignette: { value: 0.9 },
    uContrast: { value: 1.14 },
    tDepth: { value: null },
    uOutline: { value: 0 },
    uClip: { value: new THREE.Vector2(0.1, 600) },
    uHole: { value: new THREE.Vector4(0, 0, 0, 0) },
    uInk: { value: new THREE.Color("#5b3c4c") },
    uTime: { value: 0 }
  },
  vertexShader: /* glsl */`
    precision highp float;
    attribute vec3 position;
    attribute vec2 uv;
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform vec2 uTexel;
    uniform float uBlur;
    uniform float uFocus;
    uniform float uSaturation;
    uniform float uVignette;
    uniform float uTime;
    uniform float uContrast;
    uniform sampler2D tDepth;
    uniform float uOutline;
    uniform vec2 uClip;
    uniform vec4 uHole;
    uniform vec3 uInk;
    #include <tonemapping_pars_fragment>
    #include <colorspace_pars_fragment>
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    #ifdef TILT_SHIFT
      vec3 ring(float radius, float count, float turn, float weight, vec2 scale) {
        vec3 sum = vec3(0.0);
        for (float i = 0.0; i < 6.0; i += 1.0) {
          if (i >= count) break;
          float a = turn + i * 6.2831853 / count;
          sum += texture2D(tDiffuse, vUv + vec2(cos(a), sin(a)) * radius * scale).rgb;
        }
        return sum * weight;
      }
    #endif
    float viewZ(vec2 uv) {
      float d = texture2D(tDepth, uv).r;
      return uClip.x * uClip.y / (uClip.y - d * (uClip.y - uClip.x));
    }
    // An inked silhouette from the depth buffer. The Laplacian is zero across any flat slope, and
    // the terrain and grass mark themselves with alpha 0 (see geo.js), so a line is drawn only
    // where the nearest thing at a depth step is a prop or the traveler: blades of grass, and the
    // planet's own horizon, stay unlined.
    float inkLine() {
      vec2 o = uTexel * 1.15;
      vec2 uvs[5];
      uvs[0] = vUv;
      uvs[1] = vUv - vec2(o.x, 0.0);
      uvs[2] = vUv + vec2(o.x, 0.0);
      uvs[3] = vUv - vec2(0.0, o.y);
      uvs[4] = vUv + vec2(0.0, o.y);
      float zc = viewZ(uvs[0]);
      float near = zc;
      float mask = texture2D(tDiffuse, uvs[0]).a;
      float sum = -4.0 * zc;
      for (int i = 1; i < 5; i++) {
        float z = viewZ(uvs[i]);
        sum += z;
        if (z < near) {
          near = z;
          mask = texture2D(tDiffuse, uvs[i]).a;
        }
      }
      float line = smoothstep(0.03, 0.10, abs(sum) / near) * smoothstep(0.35, 0.75, mask);
      // Far trees keep a hairline, not a blot, and the sky dome (where depth precision runs out
      // and the Laplacian is all noise) gets none; whatever is dithered away in front of the
      // traveler is skipped too, since every other pixel there is a depth step.
      line *= (1.0 - 0.7 * smoothstep(9.0, 30.0, near)) * (1.0 - smoothstep(45.0, 80.0, near));
      if (uHole.z > 0.0 && near < uHole.w - 0.35) line *= smoothstep(0.9, 1.15, distance(gl_FragCoord.xy, uHole.xy) / uHole.z);
      return line;
    }
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      #ifdef TILT_SHIFT
        // Only the far top and bottom lose focus: the whole play area around the traveler stays
        // crisp, so the miniature feel comes from composition rather than from a soft image.
        float fall = smoothstep(0.24, 0.56, abs(uFocus - vUv.y));
        vec2 scale = uTexel * uBlur * fall * fall;
        c = c * 0.12 + ring(1.3, 5.0, 0.0, 0.07, scale) + ring(2.9, 5.0, 0.63, 0.06, scale) + ring(4.6, 6.0, 0.26, 0.23 / 6.0, scale);
      #endif
      // Gentle unsharp mask: a low-poly scene has few edges, and the bloom plus tilt-shift rounds
      // every one of them off. Recovering a little local contrast keeps the frame from reading soft.
      vec3 around = texture2D(tDiffuse, vUv + vec2(uTexel.x, 0.0)).rgb
        + texture2D(tDiffuse, vUv - vec2(uTexel.x, 0.0)).rgb
        + texture2D(tDiffuse, vUv + vec2(0.0, uTexel.y)).rgb
        + texture2D(tDiffuse, vUv - vec2(0.0, uTexel.y)).rgb;
      c += (c * 4.0 - around) * 0.07;
      if (uOutline > 0.0) c = mix(c, c * uInk, inkLine() * uOutline);
      // Contrast around scene mid-grey: deepens the shadow side and clears the milky veil that
      // ambient light, bloom and haze add up to.
      // Below the pivot the curve is eased back toward the original, so the shadow side of the
      // traveler and the props deepens without sinking to black.
      vec3 curved = pow(max(c, 0.0) / 0.2, vec3(uContrast)) * 0.2;
      c = mix(mix(c, curved, 0.45), curved, smoothstep(0.02, 0.2, max(c.r, max(c.g, c.b))));
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSaturation);
      float t = smoothstep(0.0, 0.9, l);
      c *= mix(vec3(0.87, 0.89, 1.12), vec3(1.07, 1.0, 0.88), t);
      vec2 d = vUv - 0.5;
      c *= 1.0 - dot(d, d) * uVignette;
      // Static low-frequency grain reads as paper; keep it whisper-light so broad meadows stay smooth.
      c += (hash(vUv * 420.0) - 0.5) * 0.0028;
      gl_FragColor = vec4(max(c, 0.0), 1.0);
      gl_FragColor.rgb = ACESFilmicToneMapping(gl_FragColor.rgb);
      gl_FragColor = sRGBTransferOETF(gl_FragColor);
    }
  `
};

// The scene is drawn once into a multisampled HDR target (so edges are antialiased even though the
// picture goes through post-processing), bloom is added on top of it, and one finishing pass puts
// the result on screen.
export function createPost(renderer, scene, hole) {
  const gl = renderer.getContext();
  const hdr = renderer.capabilities.isWebGL2 && (renderer.extensions.has("EXT_color_buffer_float") || renderer.extensions.has("EXT_color_buffer_half_float"));
  const maxSamples = renderer.capabilities.isWebGL2 ? Math.min(4, gl.getParameter(gl.MAX_SAMPLES)) : 0;
  let samples = maxSamples;
  let width = 1;
  let height = 1;

  function makeTarget() {
    const depthTexture = renderer.capabilities.isWebGL2 ? new THREE.DepthTexture(width, height) : null;
    return new THREE.WebGLRenderTarget(width, height, { type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType, samples, depthTexture });
  }
  let target = makeTarget();

  const bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.28, 0.5, 0.98);
  // Bloom is added to the colour only: the alpha channel carries the outline mask.
  bloom.blendMaterial.blending = THREE.CustomBlending;
  bloom.blendMaterial.blendSrc = THREE.SrcAlphaFactor;
  bloom.blendMaterial.blendDst = THREE.OneFactor;
  bloom.blendMaterial.blendSrcAlpha = THREE.ZeroFactor;
  bloom.blendMaterial.blendDstAlpha = THREE.OneFactor;
  let bloomOn = hdr;
  const finish = new THREE.RawShaderMaterial({
    uniforms: FinishShader.uniforms,
    vertexShader: FinishShader.vertexShader,
    fragmentShader: FinishShader.fragmentShader,
    defines: { TILT_SHIFT: "" },
    depthTest: false,
    depthWrite: false
  });
  const quad = new FullScreenQuad(finish);
  const u = finish.uniforms;
  let focusY = 0.45;
  let outline = 0.7;

  return {
    get size() {
      return { width, height };
    },
    setSize(w, h, pixelRatio) {
      width = Math.max(1, Math.round(w * pixelRatio));
      height = Math.max(1, Math.round(h * pixelRatio));
      target.setSize(width, height);
      bloom.setSize(width, height);
      u.uTexel.value.set(1 / width, 1 / height);
    },
    // Fewer samples on the lowest tier; the target is rebuilt because the count is fixed at creation.
    setSamples(count) {
      const next = Math.min(count, maxSamples);
      if (next === samples) return;
      samples = next;
      target.dispose();
      target = makeTarget();
    },
    setTiltShift(enabled) {
      if (("TILT_SHIFT" in finish.defines) === enabled) return;
      if (enabled) finish.defines.TILT_SHIFT = "";
      else delete finish.defines.TILT_SHIFT;
      finish.needsUpdate = true;
    },
    setOutline(amount) {
      outline = amount;
    },
    setBloom(enabled) {
      bloomOn = enabled && hdr;
    },
    // `y` is the screen height (0 bottom, 1 top) that stays sharp.
    setFocus(y, immediate = false) {
      focusY = immediate ? y : focusY + (y - focusY) * 0.15;
      u.uFocus.value = focusY;
    },
    render(cam, time) {
      renderer.setRenderTarget(target);
      renderer.render(scene, cam);
      if (bloomOn) bloom.render(renderer, null, target, 0, false);
      renderer.setRenderTarget(null);
      u.tDiffuse.value = target.texture;
      u.tDepth.value = target.depthTexture;
      u.uOutline.value = target.depthTexture ? outline : 0;
      u.uClip.value.set(cam.near, cam.far);
      if (hole) u.uHole.value.copy(hole.value);
      u.toneMappingExposure.value = renderer.toneMappingExposure;
      u.uTime.value = time % 10;
      quad.render(renderer);
    }
  };
}

// ---------- painted canvas textures ----------

function canvasTexture(width, height, draw, { repeat = false, srgb = true } = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext("2d"), width, height);
  const tex = new THREE.CanvasTexture(canvas);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

function seeded(seed) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

export function softTexture() {
  return canvasTexture(64, 64, (ctx, w) => {
    const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.45, "rgba(255,255,255,0.55)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, w);
  });
}

export function blobTexture() {
  return canvasTexture(64, 64, (ctx, w) => {
    const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    // Two soft stages instead of one hard fade: a darker core that reads as ground contact,
    // then a wide faint skirt so the edge never shows as a circle.
    g.addColorStop(0, "rgba(0,0,0,0.70)");
    g.addColorStop(0.45, "rgba(0,0,0,0.22)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, w);
  });
}

// A cumulus puff: overlapping soft circles, sunlit on top and lilac underneath.
export function cloudTexture(seed) {
  const rand = seeded(seed);
  return canvasTexture(256, 256, (ctx, w, h) => {
    for (let i = 0; i < 18; i += 1) {
      const x = w * (0.2 + rand() * 0.6);
      const y = h * (0.35 + rand() * 0.3) - Math.sin((x / w) * Math.PI) * h * 0.12;
      const r = w * (0.1 + rand() * 0.14);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.7, "rgba(255,255,255,0.9)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-atop";
    const shade = ctx.createLinearGradient(0, h * 0.2, 0, h * 0.75);
    shade.addColorStop(0, "#fffaf0");
    shade.addColorStop(0.55, "#f6eee8");
    shade.addColorStop(1, "#b9b6dc");
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, w, h);
  });
}

export function woodTexture(base = "#b98552", seed = 3) {
  const rand = seeded(seed);
  return canvasTexture(128, 128, (ctx, w, h) => {
    const rows = 6;
    for (let i = 0; i < rows; i += 1) {
      const c = new THREE.Color(base).offsetHSL((rand() - 0.5) * 0.02, (rand() - 0.5) * 0.1, (rand() - 0.5) * 0.08);
      ctx.fillStyle = `#${c.getHexString()}`;
      ctx.fillRect(0, (i * h) / rows, w, h / rows);
      ctx.fillStyle = "rgba(60,30,10,0.35)";
      ctx.fillRect(0, ((i + 1) * h) / rows - 2, w, 2);
      ctx.strokeStyle = "rgba(70,40,20,0.18)";
      for (let k = 0; k < 3; k += 1) {
        const y = (i * h) / rows + rand() * (h / rows);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.bezierCurveTo(w * 0.3, y + 2, w * 0.6, y - 2, w, y + 1);
        ctx.stroke();
      }
    }
  }, { repeat: true });
}

export function shingleTexture(base = "#c4553d") {
  const rand = seeded(11);
  return canvasTexture(128, 128, (ctx, w, h) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    const rows = 8;
    for (let r = 0; r < rows; r += 1) {
      const y = (r * h) / rows;
      const offset = r % 2 ? w / 12 : 0;
      for (let x = -offset; x < w; x += w / 6) {
        const c = new THREE.Color(base).offsetHSL(0, (rand() - 0.5) * 0.1, (rand() - 0.5) * 0.12);
        ctx.fillStyle = `#${c.getHexString()}`;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x + 1, y + 1, w / 6 - 2, h / rows - 1, [0, 0, 6, 6]);
        else ctx.rect(x + 1, y + 1, w / 6 - 2, h / rows - 1);
        ctx.fill();
      }
      ctx.fillStyle = "rgba(40,10,0,0.3)";
      ctx.fillRect(0, y + h / rows - 2, w, 2);
    }
  }, { repeat: true });
}

export function stoneTexture() {
  const rand = seeded(7);
  return canvasTexture(128, 128, (ctx, w, h) => {
    ctx.fillStyle = "#9a948c";
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 30; i += 1) {
      const c = new THREE.Color("#a39d94").offsetHSL(0, 0, (rand() - 0.5) * 0.18);
      ctx.fillStyle = `#${c.getHexString()}`;
      ctx.beginPath();
      ctx.ellipse(rand() * w, rand() * h, 8 + rand() * 12, 6 + rand() * 8, rand() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }, { repeat: true });
}
