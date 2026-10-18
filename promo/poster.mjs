// 3:4 poster: the traveler on the bench at the top of the planet, backlit by a low sun.
// Renders the background from the live planet, then captures promo/poster.html over it.
// Serves nothing itself: point it at a static server rooted at the repo.
// Usage: node promo/poster.mjs <base-url> <out.jpg>
//
// Everything below is staging for a still image only (the product is unchanged): the bench and
// traveler are scaled up so they read at thumbnail size, the traveler sits with the backpack set
// down, the sun is placed just right of the bench, and clouds, grass, pebbles, the lanterns and the
// signpost are hidden so nothing competes with the subject.
import fs from "fs";
import path from "path";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");

const [BASE, OUT] = process.argv.slice(2);
const SHOT = { elevation: 9, lookUp: 0.8, view: 12, props: 1.8, sunNdc: [0.36, -0.2] };

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
});
const context = await browser.newContext({ viewport: { width: 540, height: 720 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await context.addInitScript(() => {
  try {
    localStorage.setItem("lifeDesignH5StateV1", JSON.stringify({
      currentStepId: "reverseConsent", mode: "input",
      answers: { dashboard: { health: 7, work: 9, play: 9, love: 10, note: "示例" }, coreProblem: "示例" },
      completed: ["dashboard", "coreProblem"], feedback: {}, aiCoach: {},
      problem: { gravity: 40, designable: 60, label: "可以先试一小步了。" }, reportGeneratedAt: null
    }));
    localStorage.setItem("lifeDesignPlanetV1", JSON.stringify({ code: "LD-0612", visited: ["spring", "workshop", "bench", "lanterns"] }));
    localStorage.setItem("lifeDesignPlanetMuted", "1");
  } catch (error) {
    // Storage unavailable: the page still renders with defaults.
  }
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", e => errors.push(e.message));
await page.goto(`${BASE}/planet.html?quality=2`);
await page.waitForFunction(() => window.__planet, null, { timeout: 120000 });
await page.waitForTimeout(3000);
await page.addStyleTag({ content: ".hud-top,.labels,.hint,.interact-btn,.intro,.sheet,.sheet-backdrop,.toast,.joystick,.loading{display:none!important}" });

await page.evaluate(shot => {
  const P = window.__planet;
  const T = P.traveler;
  const V = P.player.dir.constructor;
  const bench = P.world.objects.bench.parts[0];
  P.world.farPlanets.forEach(p => { p.group.visible = false; });
  P.setFollow();
  P.world.setTargets({ health: 0.7, work: 0.9, play: 0.9, love: 1, problem: 1, gravity: 0.4, designable: 0.6 });
  P.world.snap();

  // The backpack, set down against the bench's right leg: just the bag, no bedroll, ties or lamp.
  const pack = T.pack.clone(true);
  pack.position.set(0.6, 0.2, -0.02);
  pack.rotation.set(0, -0.25, 0.06);
  pack.children.forEach(c => {
    const hex = c.material && c.material.color && c.material.color.getHexString();
    if (c.isGroup || hex === "d4553a" || hex === "3b2a20") c.visible = false;
  });
  bench.add(pack);
  // Matte iron, so the backlight leaves no bright streak down the legs.
  bench.traverse(n => { if (n.material && n.material.metalness > 0) { n.material.metalness = 0; n.material.roughness = 1; } });
  bench.scale.setScalar(shot.props);
  T.group.scale.setScalar(shot.props);
  P.world.objects.sign.parts[0].visible = false;
  P.world.objects.lanterns.parts[0].visible = false;
  P.world.scene.traverse(n => {
    if (n.isInstancedMesh && n.count > 3000) n.count = 0;                                   // grass
    else if (n.isInstancedMesh && n.geometry.type === "CircleGeometry") n.count = Math.round(n.count * 0.08); // flowers
    else if (n.isInstancedMesh && n.geometry.type === "IcosahedronGeometry") n.count = 0;   // pebbles
    if (n.material && n.material.map && n.material.transparent && n.material.depthWrite === false && !n.isInstancedMesh && n.material.fog === false) n.visible = false; // clouds
  });

  // A smaller, crisper sun than the live sky's wide glow, so it stays a shape rather than a wash.
  const sky = P.world.sky.material;
  sky.fragmentShader = sky.fragmentShader
    .replace("pow(s, 8.0) * 0.5", "pow(s, 24.0) * 0.28")
    .replace("pow(s, 64.0) * 0.7", "pow(s, 300.0) * 0.3")
    .replace("vec3(1.0, 0.96, 0.86) * 3.0", "vec3(1.0, 0.93, 0.78) * 1.15")
    .replace("smoothstep(0.9988, 0.9994, s)", "smoothstep(0.99945, 0.9997, s)");
  sky.needsUpdate = true;

  // The traveler sits on the bench, looking toward the sun the bench faces.
  const seat = new V();
  const render = P.world.render;
  P.world.render = (cam, time) => {
    bench.updateMatrixWorld();
    seat.set(0, 0.32 - 0.38, 0.07);
    bench.localToWorld(seat);
    T.group.position.copy(seat);
    T.group.quaternion.copy(bench.quaternion);
    T.legs.forEach((l, i) => { l.rotation.x = -1.45; l.rotation.z = (i ? -1 : 1) * 0.06; });
    T.arms.forEach((a, i) => { a.rotation.x = -0.55; a.rotation.z = (i ? 1 : -1) * 0.12; });
    T.arms[1].children.forEach(c => { if (c.geometry && c.geometry.type === "CylinderGeometry") c.visible = false; });
    T.body.position.y = 0;
    T.body.scale.set(1, 1, 1);
    T.head.rotation.set(-0.12, 0, 0);
    T.pack.visible = false;
    render(cam, time);
  };

  // Camera: behind the bench, looking over it toward the sun, far enough back to show the planet's curve.
  const od = P.world.objects.bench.dir;
  const fwd = new V(0, 0, 1).applyQuaternion(bench.quaternion);
  const back = fwd.clone().addScaledVector(od, -fwd.dot(od)).normalize().negate();
  const e = shot.elevation * Math.PI / 180;
  P.cam.mode = "focus";
  P.cam.focusId = "bench";
  P.cam.directorRate = 60;
  P.cam.director = desired => {
    desired.dir.copy(od).multiplyScalar(Math.sin(e)).addScaledVector(back, Math.cos(e)).normalize();
    desired.look.copy(od).multiplyScalar(6 + shot.lookUp);
    desired.up.copy(od);
    desired.view = shot.view;
  };
}, SHOT);

// Place the sun by screen position once the camera has settled, and light the scene from it.
await page.waitForTimeout(4500);
await page.evaluate(shot => {
  const P = window.__planet;
  const camera = P.world.camera;
  const sunDir = camera.position.clone().set(shot.sunNdc[0], shot.sunNdc[1], 0.5).unproject(camera).sub(camera.position).normalize();
  P.world.sky.material.uniforms.uSunDir.value.copy(sunDir);
  P.world.scene.traverse(n => { if (n.isDirectionalLight && n.castShadow) n.position.copy(sunDir).multiplyScalar(40); });
}, SHOT);
await page.waitForTimeout(1500);
const bg = path.join(path.dirname(path.resolve(OUT)), ".poster-bg.jpg");
await page.screenshot({ path: bg, type: "jpeg", quality: 94 });

// Typeset the poster over the background.
const card = await (await browser.newContext({ viewport: { width: 540, height: 720 }, deviceScaleFactor: 2 })).newPage();
await card.route("**/poster-bg.jpg", route => route.fulfill({ path: bg, contentType: "image/jpeg" }));
await card.goto(`${BASE}/promo/poster.html?bg=poster-bg.jpg`);
await card.waitForFunction(() => document.fonts.status === "loaded" && document.getElementById("bg").complete);
await card.evaluate(() => document.fonts.load('600 46px "Promo Serif"'));
await card.waitForTimeout(300);
await card.screenshot({ path: OUT, type: "jpeg", quality: 94 });
fs.rmSync(bg);

console.log(errors.length ? errors.join("\n") : "no page errors");
await browser.close();
