import * as THREE from "three";
import { EffectComposer } from "../vendor/three-addons/postprocessing/EffectComposer.js";
import { RenderPass } from "../vendor/three-addons/postprocessing/RenderPass.js";
import { ShaderPass } from "../vendor/three-addons/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "../vendor/three-addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "../vendor/three-addons/postprocessing/OutputPass.js";

// Light finishing pass: a touch of saturation and a soft vignette, nothing that muddies flat colour.
const GradeShader = {
  name: "GradeShader",
  uniforms: {
    tDiffuse: { value: null },
    uSaturation: { value: 1.12 },
    uVignette: { value: 0.45 }
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
    varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSaturation);
      vec2 d = vUv - 0.5;
      c *= 1.0 - dot(d, d) * uVignette;
      gl_FragColor = vec4(c, 1.0);
    }
  `
};

export function createPost(renderer, scene, camera) {
  const size = renderer.getSize(new THREE.Vector2());
  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.4, 0.45, 0.92);
  composer.addPass(renderPass);
  composer.addPass(bloom);
  composer.addPass(new ShaderPass(GradeShader));
  composer.addPass(new OutputPass());

  return {
    setSize(w, h, pixelRatio) {
      composer.setPixelRatio(pixelRatio);
      composer.setSize(w, h);
    },
    setBloom(enabled) {
      bloom.enabled = enabled;
    },
    render(cam) {
      renderPass.camera = cam;
      composer.render();
    }
  };
}

function canvasTexture(width, height, draw) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext("2d"), width, height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function softTexture() {
  return canvasTexture(64, 64, (ctx, w) => {
    const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.45, "rgba(255,255,255,0.5)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, w);
  });
}

// One paper cloud: round bumps on a flat base with a lilac underside. Drawn on its own canvas so the
// underside tint only lands on the cloud, then stamped onto the backdrop.
function drawCloud(ctx, x, y, width, tint, shade) {
  const h = Math.ceil(width * 0.5);
  const w = Math.ceil(width);
  const layer = document.createElement("canvas");
  layer.width = w;
  layer.height = h;
  const c = layer.getContext("2d");
  const base = h * 0.92;
  c.fillStyle = tint;
  [[0.24, 0.17], [0.43, 0.27], [0.62, 0.22], [0.78, 0.15]].forEach(([fx, fr]) => {
    c.beginPath();
    c.arc(w * fx, base - w * fr * 0.75, w * fr, 0, Math.PI * 2);
    c.fill();
  });
  const bandH = w * 0.1;
  c.beginPath();
  c.arc(w * 0.12 + bandH / 2, base - bandH / 2, bandH / 2, Math.PI / 2, Math.PI * 1.5);
  c.arc(w * 0.88 - bandH / 2, base - bandH / 2, bandH / 2, Math.PI * 1.5, Math.PI / 2);
  c.closePath();
  c.fill();
  c.globalCompositeOperation = "source-atop";
  c.fillStyle = shade;
  c.fillRect(0, base - bandH * 0.75, w, h);
  c.globalCompositeOperation = "destination-out";
  c.fillRect(0, base, w, h);
  ctx.drawImage(layer, x, y - h * 0.5);
}

// The whole backdrop is a flat illustration in screen space: gradient sky, sun disc and paper clouds.
// It is redrawn only when the screen size or the play score changes.
export function createBackdrop() {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const clouds = [[0.04, 0.62, 0.34], [0.58, 0.7, 0.42], [0.3, 0.84, 0.3], [0.72, 0.36, 0.2], [0.08, 0.3, 0.16], [0.86, 0.9, 0.3]];
  return {
    texture,
    paint(width, height, colors) {
      const scale = Math.min(1, 900 / Math.max(width, height));
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const w = canvas.width;
      const h = canvas.height;
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, `#${colors.top.getHexString()}`);
      g.addColorStop(0.55, `#${colors.middle.getHexString()}`);
      g.addColorStop(1, `#${colors.bottom.getHexString()}`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      const unit = Math.min(w, h);
      ctx.fillStyle = `#${colors.sunRing.getHexString()}`;
      ctx.globalAlpha = 0.45;
      ctx.beginPath();
      ctx.arc(w * 0.8, h * 0.17, unit * 0.15, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = `#${colors.sun.getHexString()}`;
      ctx.beginPath();
      ctx.arc(w * 0.8, h * 0.17, unit * 0.095, 0, Math.PI * 2);
      ctx.fill();
      const tint = `#${colors.cloud.getHexString()}`;
      const shade = `#${colors.cloudShade.getHexString()}`;
      clouds.forEach(([fx, fy, fw]) => drawCloud(ctx, w * fx, h * fy, Math.max(w, h * 0.6) * fw, tint, shade));
      texture.needsUpdate = true;
    }
  };
}
