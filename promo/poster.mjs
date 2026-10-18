// 3:4 poster: the traveler on the bench at the top of the planet, backlit by a low sun.
// Renders the background from the live planet, then captures promo/poster.html over it.
// Serves nothing itself: point it at a static server rooted at the repo.
// Usage: node promo/poster.mjs <base-url> <out.jpg>
//
// The staging (traveler seated, props scaled up, clutter hidden, sun placed) lives in promo/stage.js,
// shared with the promo's opening shot; the product itself is unchanged.
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

await page.evaluate(() => {
  const P = window.__planet;
  P.world.farPlanets.forEach(p => { p.group.visible = false; });
  P.setFollow();
  P.world.setTargets({ health: 0.7, work: 0.9, play: 0.9, love: 1, problem: 1, gravity: 0.4, designable: 0.6 });
  P.world.snap();
});
await page.addScriptTag({ path: path.join(path.dirname(new URL(import.meta.url).pathname), "stage.js") });
await page.evaluate(shot => {
  const P = window.__planet;
  window.__stage.enter({ props: shot.props });
  P.cam.mode = "focus";
  P.cam.focusId = "bench";
  P.cam.directorRate = 60;
  P.cam.director = desired => window.__stage.shot(desired, shot);
}, SHOT);

// Place the sun by screen position once the camera has settled, and light the scene from it.
await page.waitForTimeout(4500);
await page.evaluate(shot => window.__stage.placeSun(shot.sunNdc), SHOT);
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
