import * as THREE from "three";
import { EffectComposer } from "../vendor/three-addons/postprocessing/EffectComposer.js";
import { RenderPass } from "../vendor/three-addons/postprocessing/RenderPass.js";
import { ShaderPass } from "../vendor/three-addons/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "../vendor/three-addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "../vendor/three-addons/postprocessing/OutputPass.js";
import { HorizontalTiltShiftShader } from "../vendor/three-addons/shaders/HorizontalTiltShiftShader.js";
import { VerticalTiltShiftShader } from "../vendor/three-addons/shaders/VerticalTiltShiftShader.js";

// Painterly grade: a little extra saturation, warm highlights, cool lilac shadows, soft vignette.
const GradeShader = {
  name: "GradeShader",
  uniforms: {
    tDiffuse: { value: null },
    uSaturation: { value: 1.12 },
    uVignette: { value: 0.9 },
    uTime: { value: 0 }
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uSaturation;
    uniform float uVignette;
    uniform float uTime;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSaturation);
      float t = smoothstep(0.0, 0.9, l);
      c *= mix(vec3(0.88, 0.9, 1.1), vec3(1.06, 1.0, 0.9), t);
      vec2 d = vUv - 0.5;
      c *= 1.0 - dot(d, d) * uVignette;
      // Faint paper grain keeps large flat areas from looking digital.
      c += (hash(vUv * 900.0 + uTime) - 0.5) * 0.012;
      gl_FragColor = vec4(c, 1.0);
    }
  `
};

export function createPost(renderer, scene, camera) {
  const size = renderer.getSize(new THREE.Vector2());
  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.5, 0.5, 0.95);
  const tiltH = new ShaderPass(HorizontalTiltShiftShader);
  const tiltV = new ShaderPass(VerticalTiltShiftShader);
  const grade = new ShaderPass(GradeShader);
  composer.addPass(renderPass);
  composer.addPass(bloom);
  composer.addPass(tiltH);
  composer.addPass(tiltV);
  composer.addPass(grade);
  composer.addPass(new OutputPass());

  let blur = 2.2;
  let focusY = 0.45;

  function setSize(w, h, pixelRatio) {
    composer.setPixelRatio(pixelRatio);
    composer.setSize(w, h);
    tiltH.uniforms.h.value = blur / (w * pixelRatio);
    tiltV.uniforms.v.value = blur / (h * pixelRatio);
  }

  return {
    composer,
    setSize,
    setTiltShift(enabled) {
      tiltH.enabled = enabled;
      tiltV.enabled = enabled;
    },
    setBloom(enabled) {
      bloom.enabled = enabled;
    },
    // `y` is the screen height (0 bottom, 1 top) that stays sharp.
    setFocus(y, immediate = false) {
      focusY = immediate ? y : focusY + (y - focusY) * 0.15;
      tiltH.uniforms.r.value = focusY;
      tiltV.uniforms.r.value = focusY;
    },
    render(cam, time) {
      renderPass.camera = cam;
      grade.uniforms.uTime.value = time % 10;
      composer.render();
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
    g.addColorStop(0, "rgba(0,0,0,0.75)");
    g.addColorStop(0.55, "rgba(0,0,0,0.35)");
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
