// Frame-by-frame renderer for the 15 s vertical promo.
// Serves nothing itself: point it at a static server rooted at the repo.
// Usage: node promo/render.mjs <base-url> <timing.json> <out-dir> [fromSec] [toSec]
//
// The page runs on a virtual clock (performance.now, Date.now, requestAnimationFrame and
// Math.random are replaced), so every frame is a pure function of its frame number.
import fs from "fs";
import path from "path";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");

const [BASE, TIMING, OUT, FROM = "0", TO] = process.argv.slice(2);
const timing = JSON.parse(fs.readFileSync(TIMING, "utf8"));
const fps = timing.fps;
const from = Math.round(Number(FROM) * fps);
const to = Math.round(Number(TO ?? timing.length) * fps);
fs.mkdirSync(OUT, { recursive: true });

// Demo answers, written before the page loads. The postcard is drawn from these final values.
// Story: the hook shows the planet at its best; on landing it drops to where a real week might be
// (dark smoke, lamps out, grey sky); each stop then brings one part back.
const FINAL = { health: 7, work: 9, play: 9, love: 10 };
const HOOK = { health: 7, work: 8, play: 8, love: 8 };

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
});
const context = await browser.newContext({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await context.addInitScript(({ final, timing }) => {
  let now = 0;
  let queue = [];
  performance.now = () => now;
  const epoch = Date.UTC(2026, 9, 18, 8, 0, 0);
  Date.now = () => epoch + now;
  window.requestAnimationFrame = cb => { queue.push(cb); return queue.length; };
  window.cancelAnimationFrame = () => {};
  let seed = 612;
  Math.random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  window.__advance = ms => {
    now += ms;
    const run = queue;
    queue = [];
    run.forEach(cb => cb(now));
  };
  window.__promoTiming = timing;
  try {
    localStorage.clear();
    localStorage.setItem("lifeDesignH5StateV1", JSON.stringify({
      currentStepId: "reverseConsent", mode: "input",
      answers: {
        dashboard: { ...final, note: "示例" },
        coreProblem: "示例：想换一种工作方式，但一直卡在收入和安全感之间。"
      },
      completed: ["dashboard", "coreProblem"], feedback: {}, aiCoach: {},
      problem: { gravity: 40, designable: 60, label: "可以先试一小步了。" }, reportGeneratedAt: null
    }));
    localStorage.setItem("lifeDesignPlanetV1", JSON.stringify({ code: "LD-0612", visited: ["spring", "workshop", "bench", "lanterns"] }));
    localStorage.setItem("lifeDesignPlanetMuted", "1");
  } catch (error) {
    // Storage unavailable: the page still renders with defaults.
  }
}, { final: FINAL, timing });

const page = await context.newPage();
const errors = [];
page.on("pageerror", e => errors.push(e.message));
await page.goto(`${BASE}/planet.html?quality=2`);
await page.waitForFunction(() => window.__planet && document.fonts.status === "loaded", null, { timeout: 120000 });
await page.addScriptTag({ path: path.join(path.dirname(new URL(import.meta.url).pathname), "overlay.js") });
await page.evaluate(() => document.fonts.load('600 40px "Promo Serif"'));

const toTargets = s => ({ health: s.health / 10, work: s.work / 10, play: s.play / 10, love: s.love / 10, problem: 1, gravity: 0.4, designable: 0.6 });

// The distant preview planets are for the live page; in a 9:16 frame they read as stray blobs.
await page.evaluate(() => window.__planet.world.farPlanets.forEach(p => { p.group.visible = false; }));

// Postcard first, from the final answers, then reset the world to the opening state.
await page.evaluate(({ final, start }) => {
  const P = window.__planet;
  P.world.setTargets(final);
  P.world.snap();
  for (let i = 0; i < 3; i += 1) window.__advance(1000 / 30);
  window.__promo.setCard(P.makePostcard("链接在评论区"));
  P.world.setTargets(start);
  P.world.snap();
}, { final: toTargets(FINAL), start: toTargets(HOOK) });

// Director: the camera plan for each segment, as a function of time.
await page.evaluate(timing => {
  const P = window.__planet;
  const seg = Object.fromEntries(timing.segments.map(s => [s.id, s]));
  const ev = timing.events;
  // Same side-on angle as the product's own intro, so trees and houses stand up on the horizon.
  const baseYaw = Math.atan2(0.4, 0.5) - 0.5;
  // Wide orbit for the hook and the ending: the planet sits a little low so the title has the sky.
  const orbit = (desired, t, yawOffset, pitch, view, lookY) => {
    const yaw = baseYaw + yawOffset + t * 0.07;
    desired.dir.set(Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw));
    desired.look.set(0, lookY, 0);
    desired.up.set(0, 1, 0);
    desired.view = view;
  };
  window.__director = { t: 0 };
  const orbitShot = desired => {
    const t = window.__director.t;
    if (t < seg.dive.start) orbit(desired, t * 3.2, 0, -0.08, 29 - t * 1.6, 2.2 - t * 0.2);
    else orbit(desired, t, 0.4, 0.4, 34, -2.5);
  };
  // Sky stop: the bench seen from the sunward side, so the camera faces the warm, saturated half of
  // the evening sky (looking into the sun washes everything out to cream).
  const SUN = { x: 0.6, y: 0.32, z: 0.74 };
  const benchShot = desired => {
    const od = P.world.objects.bench.dir;
    const sunLen = Math.hypot(SUN.x, SUN.y, SUN.z);
    const s = { x: SUN.x / sunLen, y: SUN.y / sunLen, z: SUN.z / sunLen };
    const along = s.x * od.x + s.y * od.y + s.z * od.z;
    const t0 = { x: s.x - od.x * along, y: s.y - od.y * along, z: s.z - od.z * along };
    const tl = Math.hypot(t0.x, t0.y, t0.z);
    const u = { x: t0.x / tl, y: t0.y / tl, z: t0.z / tl };
    // Turn the sunward tangent 20 degrees off axis about the bench's up, so the bench reads at three-quarters.
    const a = -20 * Math.PI / 180;
    const c = { x: od.y * u.z - od.z * u.y, y: od.z * u.x - od.x * u.z, z: od.x * u.y - od.y * u.x };
    const h = { x: u.x * Math.cos(a) + c.x * Math.sin(a), y: u.y * Math.cos(a) + c.y * Math.sin(a), z: u.z * Math.cos(a) + c.z * Math.sin(a) };
    const e = 8 * Math.PI / 180;
    desired.dir.set(od.x * Math.sin(e) + h.x * Math.cos(e), od.y * Math.sin(e) + h.y * Math.cos(e), od.z * Math.sin(e) + h.z * Math.cos(e)).normalize();
    desired.look.copy(od).multiplyScalar(6 + 0.6);
    desired.up.copy(od);
    desired.view = 5;
  };
  // The orbit and sky shots belong to the director; elsewhere the planet's own camera (dive,
  // follow, object close-ups) does the work, exactly as a visitor would see it.
  window.__director.apply = t => {
    window.__director.t = t;
    // The diary signpost stands just below the sky shot's frame and its lamp flares into the corner.
    P.world.objects.sign.parts[0].visible = !(t >= seg.sky.start && t < seg.postcard.start - 0.3);
    if (t >= seg.sky.start - 0.3 && t < seg.postcard.start - 0.3) {
      P.cam.director = benchShot;
      P.cam.directorRate = 3;
    } else if (t < seg.dive.start) {
      P.cam.director = orbitShot;
      P.cam.directorRate = 30;
    } else if (t >= seg.postcard.start - 0.3) {
      P.cam.director = orbitShot;
      P.cam.directorRate = 2.2;
    } else {
      P.cam.director = null;
      P.cam.directorRate = undefined;
    }
  };
}, timing);

// Warm up so the opening pop-ins have settled and frame 0 is a finished picture.
await page.evaluate(() => {
  window.__director.apply(0);
  for (let i = 0; i < 75; i += 1) window.__advance(1000 / 30);
});

const scoreAt = (t, steps) => {
  let n = steps.from;
  steps.steps.forEach((s, i) => { if (t >= s) n = steps.from + (i + 1) * Math.sign(steps.to - steps.from); });
  return n;
};

let state = { dove: false, focus: null, celebrated: new Set() };
for (let f = 0; f < to; f += 1) {
  const t = f / fps;
  const seg = Object.fromEntries(timing.segments.map(s => [s.id, s]));
  const ev = timing.events;
  const hook = t < ev.dive;
  const work = hook ? HOOK.work : scoreAt(t, ev.work);
  const love = hook ? HOOK.love : scoreAt(t, ev.bulbs);
  const play = hook ? HOOK.play : scoreAt(t, ev.play);
  // Camera moves start a beat before each stop so the subject is settled when its segment begins.
  const focus = t >= seg.postcard.start - 0.3 ? null
    : t >= seg.sky.start - 0.3 ? "bench"
      : t >= seg.lanterns.start - 0.3 ? "lanterns"
        : t >= seg.workshop.start - 0.45 ? "workshop" : null;
  const actions = {
    dive: t >= ev.dive && !state.dove,
    focus: focus !== state.focus ? focus : undefined,
    celebrate: [["workshop", ev.work], ["lanterns", ev.bulbs], ["bench", ev.play]]
      .filter(([id, steps]) => t >= steps.steps[steps.steps.length - 1] + 0.1 && !state.celebrated.has(id))
      .map(([id]) => id)
  };
  if (actions.dive) state.dove = true;
  if (actions.focus !== undefined) state.focus = focus;
  actions.celebrate.forEach(id => state.celebrated.add(id));

  await page.evaluate(({ t, work, love, play, actions, focusId }) => {
    const P = window.__planet;
    window.__director.apply(t);
    if (actions.dive) P.setFollow();
    if (focusId) {
      P.cam.mode = "focus";
      P.cam.focusId = focusId;
    } else if (actions.focus === null && P.cam.mode === "focus") {
      P.cam.mode = "follow";
    }
    actions.celebrate.forEach(id => P.world.celebrate(id));
    P.world.setTargets({ work: work / 10, love: love / 10, play: play / 10 });
    window.__advance(1000 / 30);
    window.__promo.frame(t);
  }, { t, work, love, play, actions, focusId: focus });

  if (f >= from) {
    await page.screenshot({ path: path.join(OUT, `${String(f).padStart(4, "0")}.jpg`), type: "jpeg", quality: 93 });
    if (f % 15 === 0) console.log(`frame ${f}/${to}`);
  }
}

console.log(errors.length ? errors.join("\n") : "no page errors");
await browser.close();
