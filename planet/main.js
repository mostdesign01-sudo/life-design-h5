import * as THREE from "three";
import { createWorld, buildTraveler, surfaceRadius, POLE, SUN, R } from "./world.js";
import {
  loadLifeState, saveLifeState, loadPlanetState, savePlanetState,
  markCompleted, classifyProblem, requestCoreProblemCoach, dashboardItems, hasRiskSignal, SUPPORT_TEXT
} from "./state.js";
import { createSound } from "./sound.js";

const SCORE_SCENES = {
  spring: {
    key: "health",
    kicker: "泉水 · 健康",
    title: "这是星球上唯一的泉眼。",
    story: "身体、情绪、心理都好的时候，泉水是清的；透支久了，它会慢慢变浑，周围的草也会跟着发黄。",
    question: "你的健康现在有几分？",
    reactions: [
      "泉水有些浑了。身体和情绪在用自己的方式提醒你：先别透支。",
      "泉水还在流，只是不太清。照看它不需要大工程，需要几个固定的小动作。",
      "泉水很清。这是你的底盘，别因为别的事忙起来就把它抽干。"
    ]
  },
  workshop: {
    key: "work",
    kicker: "工坊 · 工作",
    title: "星球上有一间小工坊。",
    story: "炉子要天天清烟道。投入、价值、回报，任何一项长期堵着，烟囱就会冒黑烟，窗户也会烧得发红。",
    question: "你的工作仪表盘有几分？",
    reactions: [
      "烟囱在冒黑烟，炉子快过热了。投入、价值或回报里，至少有一项已经堵了很久。",
      "烟囱时不时冒烟。还在可控范围，但值得每周清一次烟道：是什么在堆积？",
      "烟囱只冒着一缕白烟，窗里是暖光。工作正在给你能量，而不只是拿走它。"
    ]
  },
  bench: {
    key: "play",
    kicker: "晚霞长椅 · 娱乐",
    title: "这条长椅，只用来发呆。",
    story: "坐下来，什么都不做，看一会儿天。娱乐是纯粹为了快乐的事：不为效率，不为成长，也不为证明什么。",
    question: "最近，纯粹为了快乐的时间有几分？",
    reactions: [
      "最近几乎没有为快乐留出时间。娱乐不是奖励，是燃料。",
      "偶尔能坐下来看看天。试着把它从“有空再说”挪进日程里。",
      "你知道怎样让自己快乐。这是很稀缺的能力，别把它让给忙碌。"
    ]
  },
  lanterns: {
    key: "love",
    kicker: "双生灯 · 爱",
    title: "两盏灯，中间牵着一串小灯泡。",
    story: "爱是双向流动的连接：一边亮着，另一边也会被照亮。灯串亮了几颗，取决于你们之间流动了多少。",
    question: "爱这一项，你给几分？",
    reactions: [
      "灯有点暗，灯串也只亮了几颗。最近也许只有一个方向在流动，或者你已经很久没顾上它。",
      "灯亮着，但灯串还有不少暗着。谁值得你这周多花一点时间？",
      "两盏灯都很亮，灯串一路亮到了对面。你为它花的那些时间，就是光的来源。"
    ]
  }
};

const QUESTS = [
  { id: "spring", name: "泉水", sub: "健康" },
  { id: "workshop", name: "工坊", sub: "工作" },
  { id: "bench", name: "晚霞长椅", sub: "娱乐" },
  { id: "lanterns", name: "双生灯", sub: "爱" },
  { id: "vine", name: "缠绕藤", sub: "核心困扰" },
  { id: "sign", name: "星球日记", sub: "明信片" }
];

const SCORE_IDS = ["spring", "workshop", "bench", "lanterns"];
const FULL_URL = "./index.html";
// Shown on the postcard so a viewer can find the planet; the path without protocol reads cleaner.
const SHARE_HOST = `${location.host}${location.pathname}`.replace(/\/$/, "");

const els = {
  canvas: document.getElementById("scene"),
  labels: document.getElementById("labels"),
  questCard: document.getElementById("questCard"),
  questHead: document.getElementById("questHead"),
  questList: document.getElementById("questList"),
  questTitle: document.getElementById("questTitle"),
  questCount: document.getElementById("questCount"),
  overviewBtn: document.getElementById("overviewBtn"),
  soundBtn: document.getElementById("soundBtn"),
  hint: document.getElementById("hint"),
  interactBtn: document.getElementById("interactBtn"),
  joystick: document.getElementById("joystick"),
  joystickKnob: document.getElementById("joystickKnob"),
  sheet: document.getElementById("sheet"),
  sheetBody: document.getElementById("sheetBody"),
  sheetBackdrop: document.getElementById("sheetBackdrop"),
  intro: document.getElementById("intro"),
  startBtn: document.getElementById("startBtn"),
  loading: document.getElementById("loading"),
  toast: document.getElementById("toast")
};

let life = loadLifeState();
const planet = loadPlanetState();

const world = createWorld(els.canvas);
const { scene, camera, objects, farPlanets } = world;
const traveler = buildTraveler();
scene.add(traveler.group);
const sound = createSound();
// Start fetching the display face early; the postcard canvas draws with it.
document.fonts?.load('600 32px "Planet Serif"');
// Traveler reactions, as the clock time each one started.
const react = { hop: -10, land: -10, glance: 0 };
let clockNow = 0;

const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpM = new THREE.Matrix4();

function tangentToward(from, to, out = new THREE.Vector3()) {
  out.copy(to).sub(tmpV.copy(from).multiplyScalar(to.dot(from)));
  return out.lengthSq() < 1e-8 ? out.set(0, 0, 0) : out.normalize();
}

function reproject(v, up) {
  v.sub(tmpV.copy(up).multiplyScalar(v.dot(up)));
  if (v.lengthSq() < 1e-8) v.set(1, 0, 0).sub(tmpV.copy(up).multiplyScalar(up.x));
  return v.normalize();
}

const player = {
  dir: POLE.clone(),
  facing: tangentToward(POLE, objects.sign.dir),
  speed: 0,
  phase: 0
};
const camForward = player.facing.clone();

// Camera state: a viewing direction, a look-at point and how many world units fit vertically
// on screen at the look-at point, each smoothed toward a per-mode target. The perspective camera
// is placed at whatever distance gives that framing, with a fairly long lens so the planet keeps
// a diorama feel without fisheye distortion.
const FOV = 34;
const cam = {
  mode: "intro",
  dir: new THREE.Vector3(),
  look: new THREE.Vector3(),
  up: new THREE.Vector3(0, 1, 0),
  view: 18,
  zoom: 1,
  focusId: null,
  offset: 0
};
// Intro and overview: an isometric-style view of the whole planet.
const orbit = {
  yaw: Math.atan2(POLE.x, POLE.z) - 0.5,
  pitch: 0.5,
  scale: 1
};

function orbitDirection(out) {
  return out.set(
    Math.cos(orbit.pitch) * Math.sin(orbit.yaw),
    Math.sin(orbit.pitch),
    Math.cos(orbit.pitch) * Math.cos(orbit.yaw)
  );
}

// Fit `height` world units vertically, but never fewer than `minWidth` across on narrow screens.
function viewHeightFor(height, minWidth) {
  const aspect = window.innerWidth / window.innerHeight;
  return Math.max(height, minWidth / aspect);
}

function distanceFor(height) {
  return height / 2 / Math.tan(THREE.MathUtils.degToRad(FOV / 2));
}

function applyView(cameraToSet, aspect) {
  cameraToSet.fov = FOV;
  cameraToSet.aspect = aspect;
  cameraToSet.updateProjectionMatrix();
}

orbitDirection(cam.dir);
// Intro framing: the planet sits in the upper part of the screen, clear of the title block below.
const PORTRAIT = window.innerWidth < window.innerHeight;
const INTRO_LOOK_Y = PORTRAIT ? -6 : -4.2;
function introView() {
  return PORTRAIT ? viewHeightFor(22, 17) : 26;
}
// Start exactly on the intro framing so the very first frame is already a finished picture.
cam.look.set(0, INTRO_LOOK_Y, 0);
cam.view = introView();

const input = { x: 0, y: 0, keys: new Set() };
let autoTarget = null;
let sheetState = null;
let lastNearId = null;

// ---------- life state <-> world ----------

function isDone(id) {
  if (SCORE_IDS.includes(id)) return planet.visited.includes(id) || life.completed.includes("dashboard");
  if (id === "vine") return life.completed.includes("coreProblem");
  if (id === "sign") return life.completed.includes("dashboard");
  return false;
}

function syncWorld(preview = {}) {
  const d = { ...life.answers.dashboard, ...preview };
  const p = life.problem;
  world.setTargets({
    health: Number(d.health ?? 5) / 10,
    work: Number(d.work ?? 5) / 10,
    play: Number(d.play ?? 5) / 10,
    love: Number(d.love ?? 5) / 10,
    problem: p ? 1 : 0,
    gravity: p ? p.gravity / 100 : 0,
    designable: p ? p.designable / 100 : 0
  });
}

function persist() {
  saveLifeState(life);
  savePlanetState(planet);
  renderQuests();
}

// ---------- HUD ----------

function renderQuests() {
  const done = QUESTS.filter(q => isDone(q.id)).length;
  els.questTitle.textContent = `星球 ${planet.code}`;
  els.questCount.textContent = `${done} / ${QUESTS.length}`;
  els.questList.innerHTML = QUESTS.map((q, i) => `
    <li class="${isDone(q.id) ? "is-done" : ""}">
      <button type="button" data-goto="${q.id}">
        <span class="quest-dot">${isDone(q.id) ? "✓" : i + 1}</span>
        <span>${q.name}</span>
        <span class="quest-sub">${q.sub}</span>
      </button>
    </li>
  `).join("");
  const next = nextQuest();
  const diaryReady = SCORE_IDS.every(isDone);
  world.setDiaryReady(diaryReady);
  labelEls.forEach(label => {
    label.el.classList.toggle("is-done", !label.far && isDone(label.id));
    label.el.classList.toggle("is-next", !label.far && label.id === next?.id);
    if (label.id === "sign") {
      label.el.classList.toggle("is-locked", !diaryReady);
      label.el.querySelector("small").textContent = diaryReady ? "明信片" : "最后一站";
    }
  });
}

els.questHead.addEventListener("click", () => {
  const collapsed = els.questCard.classList.toggle("is-collapsed");
  els.questHead.setAttribute("aria-expanded", String(!collapsed));
});

els.questList.addEventListener("click", event => {
  const button = event.target.closest("[data-goto]");
  if (button) goTo(button.dataset.goto);
});

if (window.innerWidth < 520) {
  els.questCard.classList.add("is-collapsed");
  els.questHead.setAttribute("aria-expanded", "false");
}

const labelEls = [
  ...QUESTS.map(q => ({ id: q.id, text: q.name, sub: q.sub, far: false })),
  ...farPlanets.map(p => ({ id: p.id, text: `${p.name} · 筹建中`, far: true }))
].map(item => {
  const el = document.createElement("div");
  el.className = `obj-label${item.far ? " is-far" : ""}`;
  el.textContent = item.text;
  if (item.sub) {
    const sub = document.createElement("small");
    sub.textContent = item.sub;
    el.appendChild(sub);
  }
  els.labels.appendChild(el);
  return { ...item, el };
});

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("is-visible");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.remove("is-visible"), 2600);
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// ---------- sheet ----------

// For objects framed from the front, where the traveler should stand so it doesn't block the view.
function standSpot(obj) {
  if (!obj?.front) return null;
  const side = new THREE.Vector3().crossVectors(obj.dir, obj.front).normalize();
  const t = obj.front.clone().multiplyScalar(0.45).add(side).normalize();
  const dist = obj.reach + 0.05;
  return obj.dir.clone().multiplyScalar(Math.cos(dist)).addScaledVector(t, Math.sin(dist)).normalize();
}

function openSheet(state, html) {
  sheetState = state;
  player.standTarget = standSpot(objects[state.focusId]);
  player.standTime = 2.5;
  player.lookTarget = objects[state.focusId]?.dir || null;
  els.sheetBody.innerHTML = html;
  if (!els.sheet.classList.contains("is-open")) sound.open();
  els.sheet.classList.add("is-open");
  els.sheetBackdrop.classList.add("is-open");
  els.interactBtn.hidden = true;
  autoTarget = null;
  if (state.focusId) {
    cam.mode = "focus";
    cam.focusId = state.focusId;
  }
}

function closeSheet() {
  if (!sheetState) return;
  const state = sheetState;
  sheetState = null;
  els.sheet.classList.remove("is-open");
  els.sheetBackdrop.classList.remove("is-open");
  if (cam.mode === "focus") cam.mode = "follow";
  if (state.onClose) state.onClose();
}

els.sheetBackdrop.addEventListener("click", closeSheet);

els.sheetBody.addEventListener("click", event => {
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!action || !sheetState) return;
  if (action === "close") closeSheet();
  else if (action === "goto") {
    const id = event.target.closest("[data-action]").dataset.id;
    closeSheet();
    goTo(id);
  } else sheetState.actions?.[action]?.(event);
});

// A reply to the coach question saves as it is typed, in the state shared with the questionnaire.
els.sheetBody.addEventListener("input", event => {
  const stepId = event.target.dataset?.followup;
  if (!stepId) return;
  life.answers.followups = life.answers.followups || {};
  life.answers.followups[stepId] = {
    question: life.aiCoach?.[stepId]?.result?.question || "",
    answer: event.target.value.trim(),
    answeredAt: new Date().toISOString()
  };
  saveLifeState(life);
  // A reply that raises a signal swaps the card for the help lines straight away.
  if (hasRiskSignal(event.target.value)) showProblemResult(false);
});

function scoreBand(score) {
  return score <= 3 ? 0 : score <= 6 ? 1 : 2;
}

function glowIndex(score) {
  return score * 10;
}

function openScore(id) {
  const scene = SCORE_SCENES[id];
  const saved = Number(life.answers.dashboard[scene.key] ?? 5);
  let value = saved;
  let confirmed = false;
  const visited = planet.visited.includes(id);

  const render = () => `
    <div class="sheet-kicker">${scene.kicker}</div>
    <h2 class="sheet-title" id="sheetTitle">${scene.title}</h2>
    <p class="sheet-story">${scene.story}</p>
    <p class="sheet-question">${scene.question}<br><span style="font-weight:400;color:var(--muted);font-size:13px">拖动看看，星球会跟着变。</span></p>
    <div class="score-row">
      <input type="range" min="0" max="10" step="1" value="${value}" id="scoreInput" aria-label="${scene.question}">
      <span class="score-num" id="scoreNum">${value}</span>
    </div>
    <div class="score-scale"><span>0 很糟</span><span>10 很充盈</span></div>
    <div class="sheet-actions">
      <button class="btn btn-ghost" type="button" data-action="close">先不填</button>
      <button class="btn btn-primary" type="button" data-action="confirm">${visited ? "更新分数" : "就是这样"}</button>
    </div>
  `;

  openSheet({
    focusId: id,
    actions: {
      confirm() {
        confirmed = true;
        life.answers.dashboard[scene.key] = value;
        if (!planet.visited.includes(id)) planet.visited.push(id);
        persist();
        syncWorld();
        celebrate(id, value);
        const extra = id === "bench" ? `今天的晚霞指数：${glowIndex(value)}%` : "";
        els.sheetBody.innerHTML = `
          <div class="sheet-kicker">${scene.kicker} · ${value} 分</div>
          <h2 class="sheet-title" id="sheetTitle">${extra || "星球记住了。"}</h2>
          <p class="reaction">${scene.reactions[scoreBand(value)]}</p>
          <div class="sheet-actions">
            <button class="btn btn-primary" type="button" data-action="next">${nextQuestLabel()}</button>
          </div>
        `;
      },
      next() {
        closeSheet();
        const next = nextQuest();
        if (next) goTo(next.id);
      }
    },
    onClose() {
      if (!confirmed) syncWorld();
    }
  }, render());

  const range = document.getElementById("scoreInput");
  // The filled part of the track shows the amount, not just a dot.
  const paintTrack = () => range.style.setProperty("--fill", `${value * 10}%`);
  paintTrack();
  range.addEventListener("input", () => {
    value = Number(range.value);
    paintTrack();
    document.getElementById("scoreNum").textContent = value;
    syncWorld({ [scene.key]: value });
  });
}

function nextQuest() {
  return QUESTS.find(q => !isDone(q.id));
}

function nextQuestLabel() {
  const next = nextQuest();
  return next ? `去下一站：${next.name}` : "回到星球";
}

function problemFeedback(p) {
  if (p.gravity > p.designable) {
    return "有些现实不是靠更努力就能改变的。先认出这堵墙，不再和它较劲，然后看看在墙内还能往哪儿走。认出它不是认输，是省下力气。";
  }
  return "这件事里，能动手的部分不少。不用马上找到唯一答案，先挑一小步试试：找一个人聊聊，或者做一个这周就能完成的小实验。";
}

function supportHTML(coach = {}) {
  return `
    <div class="coach is-support">
      <p><strong>${escapeHTML(coach.headline || "先照顾好你自己")}</strong></p>
      <p>${escapeHTML(coach.reflection || "你写下的话里有很重的东西。人生设计可以先放一放，此刻你的感受更重要，你不需要一个人扛着。")}</p>
      <p>${escapeHTML(SUPPORT_TEXT)}</p>
      <p class="coach-hint">如果这只是一句随口的话，可以忽略这段，继续往下走。</p>
    </div>
  `;
}

// Help lines lead the sheet: from the AI when it judged this a moment for support, otherwise from the
// page's own check, so they show even when the AI can't be reached.
function supportFor(coach) {
  if (coach?.result?.safety === "support") return supportHTML(coach.result);
  return hasRiskSignal([life.answers.coreProblem, life.answers.followups?.coreProblem?.answer]) ? supportHTML() : "";
}

function coachHTML(coach) {
  if (!coach) return "";
  if (coach.status === "loading") {
    return `<div class="coach"><span class="coach-label">AI 关键追问</span><p>AI 正在做一次短判断：一个关键观察、一个追问和一个低成本原型动作。</p></div>`;
  }
  // When the AI can't be reached, leave it out: the fixed feedback above stands on its own.
  if (coach.status === "error") return "";
  const c = coach.result || {};
  if (c.safety === "support") return "";
  const reply = life.answers.followups?.coreProblem?.answer || "";
  return `
    <div class="coach">
      <span class="coach-label">AI 关键追问</span>
      <p><strong>${escapeHTML(c.headline || "值得停一下")}</strong></p>
      ${c.reflection ? `<p>${escapeHTML(c.reflection)}</p>` : ""}
      ${c.question ? `<p><strong>追问：</strong>${escapeHTML(c.question)}</p>` : ""}
      ${c.prototype ? `<p><strong>小原型：</strong>${escapeHTML(c.prototype)}</p>` : ""}
      ${c.watchout ? `<p><strong>提醒：</strong>${escapeHTML(c.watchout)}</p>` : ""}
      ${c.question ? `
      <div class="coach-reply">
        <label for="followupInput">回答这个追问（选填）</label>
        <textarea id="followupInput" data-followup="coreProblem" maxlength="400" placeholder="想到什么写什么，一两句也行。后面的追问和 AI 深度蓝图会接着这条线往下想。">${escapeHTML(reply)}</textarea>
        <span class="coach-hint">自动保存</span>
      </div>` : ""}
    </div>
  `;
}

function radarHTML(p) {
  const old = Math.round(p.gravity / 10);
  return `<p class="sheet-question" style="font-weight:500">这团藤里，大约 <strong>${old} 成</strong>是拔不动的老藤，<strong>${10 - old} 成</strong>是可以动手的新芽。</p>`;
}

function openProblem() {
  const existing = life.answers.coreProblem || "";
  openSheet({
    focusId: "vine",
    actions: {
      submit() {
        const text = document.getElementById("problemInput").value.trim();
        if (text.length < 12) {
          document.getElementById("problemWarn").textContent = "再具体一点点。至少写出一个场景、一个感受，或一个你已经尝试过的动作。";
          return;
        }
        life.answers.coreProblem = text;
        life.problem = classifyProblem(text);
        markCompleted(life, "coreProblem");
        persist();
        syncWorld();
        celebrate("vine", 7);
        showProblemResult(true);
      }
    }
  }, `
    <div class="sheet-kicker">缠绕藤 · 核心困扰</div>
    <h2 class="sheet-title" id="sheetTitle">星球上缠着一团藤。</h2>
    <p class="sheet-story">有些藤是老根，扎得比你想的深，硬拔只会把自己耗干；有些只是新冒的芽，一伸手就能动。先认出哪部分是哪部分。</p>
    <p class="sheet-question">现在最让你焦虑、最想解决的那个人生问题是什么？</p>
    <textarea id="problemInput" placeholder="比如：我明明想换一种工作方式，但一直卡在收入、安全感、家人期待和自我怀疑之间……">${escapeHTML(existing)}</textarea>
    <p class="sheet-warn" id="problemWarn"></p>
    <div class="sheet-actions">
      <button class="btn btn-ghost" type="button" data-action="close">再想想</button>
      <button class="btn btn-primary" type="button" data-action="submit">${existing ? "重新看看" : "种下它"}</button>
    </div>
  `);
}

function showProblemResult(requestCoach) {
  const p = life.problem;
  const actionsHTML = `
    <div class="sheet-actions">
      <button class="btn btn-ghost" type="button" data-action="rewrite">改写</button>
      <button class="btn btn-primary" type="button" data-action="next">${nextQuestLabel()}</button>
    </div>
  `;
  // In that moment the support card stands alone, without the vine's analysis.
  const render = coach => supportFor(coach) ? `
    <div class="sheet-kicker">缠绕藤 · 核心困扰</div>
    <h2 class="sheet-title" id="sheetTitle">先停一下。</h2>
    ${supportFor(coach)}
    ${actionsHTML}
  ` : `
    <div class="sheet-kicker">缠绕藤 · 核心困扰</div>
    <h2 class="sheet-title" id="sheetTitle">${escapeHTML(p.label)}</h2>
    ${radarHTML(p)}
    <p class="reaction">${problemFeedback(p)}</p>
    ${coachHTML(coach)}
    ${actionsHTML}
  `;
  const actions = {
    rewrite() {
      closeSheet();
      openProblem();
    },
    next() {
      closeSheet();
      const next = nextQuest();
      if (next) goTo(next.id);
    }
  };
  const token = {};
  if (sheetState) {
    sheetState.actions = actions;
    sheetState.token = token;
  } else {
    openSheet({ focusId: "vine", actions, token }, "");
  }
  const existing = life.aiCoach.coreProblem;
  if (!requestCoach) {
    els.sheetBody.innerHTML = render(existing);
    return;
  }
  els.sheetBody.innerHTML = render({ status: "loading" });
  requestCoreProblemCoach(life).then(coach => {
    life.aiCoach.coreProblem = coach;
    saveLifeState(life);
    if (sheetState?.token === token) els.sheetBody.innerHTML = render(coach);
  });
}

function sortedScores() {
  const d = life.answers.dashboard;
  return dashboardItems.map(item => ({ ...item, score: Number(d[item.key] ?? 5) })).sort((a, b) => a.score - b.score);
}

function openDiary() {
  const missing = SCORE_IDS.filter(id => !isDone(id));
  if (missing.length) {
    const names = missing.map(id => QUESTS.find(q => q.id === id).name).join("、");
    openSheet({ focusId: "sign" }, `
      <div class="sheet-kicker">星球日记</div>
      <h2 class="sheet-title" id="sheetTitle">日记本还空着几页。</h2>
      <p class="sheet-story">先去看看${names}，星球的样子才完整。</p>
      <div class="sheet-actions">
        <button class="btn btn-ghost" type="button" data-action="close">好</button>
        <button class="btn btn-primary" type="button" data-action="goto" data-id="${missing[0]}">带我去${QUESTS.find(q => q.id === missing[0]).name}</button>
      </div>
    `);
    return;
  }
  if (life.completed.includes("dashboard") && !openDiary.editing) {
    showPostcard();
    return;
  }
  openDiary.editing = false;
  const low = sortedScores()[0];
  openSheet({
    focusId: "sign",
    actions: {
      submit() {
        const note = document.getElementById("noteInput").value.trim();
        if (note.length < 4) {
          document.getElementById("noteWarn").textContent = "请写一句最亮红灯的观察。分数是仪表，原因才是设计材料。";
          return;
        }
        life.answers.dashboard.note = note;
        markCompleted(life, "dashboard");
        persist();
        celebrate("sign", 9);
        showPostcard();
      }
    }
  }, `
    <div class="sheet-kicker">星球日记</div>
    <h2 class="sheet-title" id="sheetTitle">走完一圈，最暗的地方是「${low.label}」。</h2>
    <p class="sheet-story">这里没有好坏评判，只有一个设计事实：如果红灯项长期被忽略，其他项迟早会替它付账。</p>
    <p class="sheet-question">写一句：哪一项已经亮红灯，为什么？</p>
    <textarea id="noteInput" placeholder="比如：${low.label}只有 ${low.score} 分，因为……">${escapeHTML(life.answers.dashboard.note || "")}</textarea>
    <p class="sheet-warn" id="noteWarn"></p>
    <div class="sheet-actions">
      <button class="btn btn-ghost" type="button" data-action="close">稍后</button>
      <button class="btn btn-primary" type="button" data-action="submit">写进日记</button>
    </div>
  `);
}

const NEXT_PLANETS = [
  ["引力星", "重力问题与可设计问题"],
  ["指南针星", "工作观与人生观"],
  ["心流星", "心流与能量"],
  ["锚点星", "锚点：你一直不肯放手的"],
  ["三岔路星", "三个五年奥德赛计划"]
];

function showPostcard() {
  const url = makePostcard();
  const html = `
    <div class="sheet-kicker">星球日记 · 明信片</div>
    <h2 class="sheet-title" id="sheetTitle">这是你的星球，现在的样子。</h2>
    <p class="sheet-story">长按图片保存。这只是这一季的快照，过一阵再来，它会因为你做的小事而变。</p>
    <div class="postcard-wrap"><img src="${url}" alt="我的小星球明信片"></div>
    <div class="sheet-actions is-sticky">
      <a class="btn btn-primary" href="${url}" download="我的小星球.png">保存明信片</a>
      <button class="btn btn-ghost" type="button" data-action="edit">改写日记</button>
      <a class="btn btn-ghost" href="${FULL_URL}">继续旅程</a>
    </div>
    <ul class="next-planets">
      ${NEXT_PLANETS.map(([name, sub]) => `<li><span>${name}</span><span>${sub} · 筹建中</span></li>`).join("")}
    </ul>
    <p class="sheet-story" style="margin-top:10px;font-size:12px">其他星球正在建造。在此之前，“继续旅程”会带你进入完整问卷，进度已经接上。</p>
  `;
  const actions = {
    edit() {
      closeSheet();
      openDiary.editing = true;
      openDiary();
    }
  };
  if (sheetState) {
    sheetState.actions = actions;
    els.sheetBody.innerHTML = html;
  } else {
    openSheet({ focusId: "sign", actions }, html);
  }
}

function openFarPlanet(p) {
  openSheet({}, `
    <div class="sheet-kicker">${p.name} · 筹建中</div>
    <h2 class="sheet-title" id="sheetTitle">下一站：${p.sub}</h2>
    <p class="sheet-story">这颗星球还在建造。它对应完整问卷里的「${p.sub}」部分，你现在就可以先去那里回答，进度会和这颗星球共用。</p>
    <div class="sheet-actions">
      <button class="btn btn-ghost" type="button" data-action="close">回到星球</button>
      <a class="btn btn-primary" href="${FULL_URL}">去完整问卷</a>
    </div>
  `);
}

function openObject(id) {
  if (SCORE_SCENES[id]) openScore(id);
  else if (id === "vine") {
    if (life.completed.includes("coreProblem") && life.problem) showProblemResult(false);
    else openProblem();
  } else if (id === "sign") openDiary();
}

function goTo(id) {
  if (cam.mode === "intro" || cam.mode === "overview") setFollow();
  const obj = objects[id];
  if (!obj) return;
  if (player.dir.angleTo(obj.dir) <= obj.reach + 0.02) {
    openObject(id);
    return;
  }
  autoTarget = id;
}

// ---------- postcard ----------

// One phrase per dashboard item for its best and worst state; the postcard title pairs the brightest
// spot with the one still waiting, so every card reads differently.
const CARD_PHRASES = {
  health: ["泉水还有点浑", "泉水很清"],
  work: ["工坊还在冒烟", "工坊很安静"],
  play: ["晚霞还在路上", "晚霞铺满了天"],
  love: ["灯串还没全亮", "灯串亮到了对面"]
};

function cardTitle() {
  const sorted = sortedScores();
  const high = sorted[sorted.length - 1];
  const low = sorted[0];
  if (high.score - low.score < 2) return high.score >= 6 ? ["每一处", "都在好好亮着"] : ["星球在慢慢", "攒着力气"];
  return [`${CARD_PHRASES[high.key][1]}，`, CARD_PHRASES[low.key][0]];
}

// Small flat icons drawn in the planet's palette, one per dashboard item.
function drawIcon(ctx, key, x, y, s, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = s * 0.08;
  if (key === "health") {
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.5);
    ctx.bezierCurveTo(s * 0.45, 0, s * 0.35, s * 0.45, 0, s * 0.45);
    ctx.bezierCurveTo(-s * 0.35, s * 0.45, -s * 0.45, 0, 0, -s * 0.5);
    ctx.fill();
  } else if (key === "work") {
    ctx.fillRect(-s * 0.36, -s * 0.05, s * 0.72, s * 0.5);
    ctx.beginPath();
    ctx.moveTo(-s * 0.46, -s * 0.03);
    ctx.lineTo(0, -s * 0.45);
    ctx.lineTo(s * 0.46, -s * 0.03);
    ctx.fill();
  } else if (key === "play") {
    // A setting sun with rays.
    ctx.beginPath();
    ctx.arc(0, s * 0.18, s * 0.26, Math.PI, 0);
    ctx.fill();
    ctx.lineCap = "round";
    for (let i = 0; i < 5; i += 1) {
      const a = Math.PI + (i + 0.5) * (Math.PI / 5);
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * s * 0.36, s * 0.18 + Math.sin(a) * s * 0.36);
      ctx.lineTo(Math.cos(a) * s * 0.5, s * 0.18 + Math.sin(a) * s * 0.5);
      ctx.stroke();
    }
    ctx.fillRect(-s * 0.5, s * 0.24, s, s * 0.08);
  } else {
    ctx.beginPath();
    ctx.moveTo(0, s * 0.42);
    ctx.bezierCurveTo(-s * 0.55, s * 0.02, -s * 0.38, -s * 0.48, 0, -s * 0.16);
    ctx.bezierCurveTo(s * 0.38, -s * 0.48, s * 0.55, s * 0.02, 0, s * 0.42);
    ctx.fill();
  }
  ctx.restore();
}

const CARD_COLORS = { health: "#3f9e9a", work: "#d0643f", play: "#c9902e", love: "#c95f7a" };

// linkText null leaves off the footer (the promo prints its own call to action beside the card).
function makePostcard(linkText = SHARE_HOST) {
  const W = 1080;
  const H = linkText === null ? 1360 : 1440;
  const shotCam = camera.clone();
  shotCam.clearViewOffset();
  // Look down on the lived-in side so every stop sits on the visible half of the planet.
  // The intro's three-quarter view: the whole planet floating in its window, with the trees on the
  // rim standing up in profile, rather than a top-down map.
  const yaw = Math.atan2(POLE.x, POLE.z) - 0.5;
  const pitch = 0.62;
  const view = new THREE.Vector3(Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw));
  shotCam.position.copy(view).multiplyScalar(distanceFor(16.2));
  shotCam.up.set(0, 1, 0);
  shotCam.lookAt(0, 0, 0);
  applyView(shotCam, 1);
  // The sky behind the planet carries the play score: warm when there was time for joy, grey when not.
  const shot = world.snapshot(shotCam, W);

  const card = document.createElement("canvas");
  card.width = W;
  card.height = H;
  const ctx = card.getContext("2d");
  ctx.fillStyle = "#fbf3e8";
  ctx.fillRect(0, 0, W, H);
  // The planet and its sky fade softly into the card instead of sitting in a hard-edged window.
  const top = 292;
  const size = 780;
  const left = (W - size) / 2;
  ctx.drawImage(shot, 0, 0, W, W, left, top, size, size);
  const cx = W / 2;
  const cy = top + size / 2;
  // Fully cream just inside the window edge, so nothing on the rim is cut by a hard line.
  const fade = ctx.createRadialGradient(cx, cy, size * 0.36, cx, cy, size * 0.49);
  fade.addColorStop(0, "rgba(251,243,232,0)");
  fade.addColorStop(1, "#fbf3e8");
  ctx.fillStyle = fade;
  ctx.fillRect(0, top - 10, W, size + 20);

  const font = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';
  const serif = '"Planet Serif", "Songti SC", serif';
  // Canvas letter-spacing where supported; older browsers simply draw without it.
  const track = value => { if ("letterSpacing" in ctx) ctx.letterSpacing = value; };
  const date = new Date();
  ctx.fillStyle = "#c95a26";
  ctx.fillRect(72, 92, 28, 3);
  ctx.fillStyle = "#4f5570";
  ctx.font = `500 24px ${font}`;
  track("4px");
  ctx.fillText(`星球 ${planet.code} · ${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`, 114, 102);
  const [line1, line2] = cardTitle();
  ctx.fillStyle = "#2f3756";
  ctx.font = `600 62px ${serif}`;
  track("3px");
  ctx.fillText(line1, 72, 196);
  ctx.fillText(line2, 72, 276);
  track("0px");

  // Lower block on one rhythm: scores, a hairline, the vine note, then the footer row.
  const d = life.answers.dashboard;
  const cardIcons = { health: "泉水", work: "工坊", play: "晚霞", love: "双生灯" };
  dashboardItems.forEach((item, i) => {
    const x = 72 + i * 240;
    const score = Number(d[item.key] ?? 5);
    const color = CARD_COLORS[item.key];
    drawIcon(ctx, item.key, x + 24, 1086, 44, color);
    ctx.fillStyle = "#2f3756";
    ctx.font = `600 52px ${serif}`;
    ctx.fillText(String(score), x + 64, 1104);
    ctx.fillStyle = "#4f5570";
    ctx.font = `500 22px ${font}`;
    track("3px");
    ctx.fillText(`${item.label} · ${cardIcons[item.key]}`, x, 1150);
    track("0px");
  });
  ctx.fillStyle = "#e8ddd0";
  ctx.fillRect(72, 1190, W - 144, 2);

  if (life.problem) {
    const old = Math.round(life.problem.gravity / 10);
    ctx.fillStyle = "#c95a26";
    ctx.fillRect(72, 1232, 28, 3);
    ctx.fillStyle = "#4f5570";
    ctx.font = `500 22px ${font}`;
    track("4px");
    ctx.fillText("缠绕藤 · 核心困扰", 114, 1242);
    ctx.fillStyle = "#2f3756";
    ctx.font = `600 34px ${serif}`;
    track("2px");
    ctx.fillText(`${old} 成老藤，${10 - old} 成是可以动手的新芽`, 72, 1292);
    track("0px");
  }

  if (linkText !== null) {
    ctx.fillStyle = "#2f3756";
    ctx.font = `600 28px ${serif}`;
    track("4px");
    ctx.fillText("测测你的小星球", 72, 1384);
    const ctaWidth = ctx.measureText("测测你的小星球").width;
    track("0px");
    ctx.fillStyle = "#4f5570";
    ctx.font = `400 24px ${font}`;
    // The link sits at the right of the same row; a long address drops below rather than colliding.
    const linkWidth = ctx.measureText(linkText).width;
    if (72 + ctaWidth + 40 + linkWidth <= W - 72) {
      ctx.textAlign = "right";
      ctx.fillText(linkText, W - 72, 1384);
      ctx.textAlign = "left";
    } else {
      ctx.fillText(linkText, 72, 1418);
    }
  }
  return card.toDataURL("image/png");
}

// Every confirmed answer gets a visible and audible result on its object, and the traveler hops.
function celebrate(id, score) {
  world.celebrate(id);
  react.hop = clockNow;
  if (id === "lanterns") sound.bulbs(score);
  else if (id === "workshop") sound.puff();
  else if (id === "vine") sound.sparkle();
  sound.confirm(score);
}

// ---------- camera modes ----------

function setFollow() {
  document.body.classList.remove("is-intro");
  if (cam.mode === "intro") {
    // Landing: hold wide for a beat, then dive, and squash the traveler on touchdown.
    cam.dive = clockNow;
    react.land = clockNow + 1.15;
    // Land facing the first unvisited stop, with the camera behind, so the next step is in view.
    const first = objects[nextQuest()?.id];
    if (first) {
      const face = tangentToward(player.dir, first.dir);
      if (face.lengthSq() > 0.5) {
        player.facing.copy(face);
        camForward.copy(face);
      }
    }
    sound.whoosh();
    setTimeout(() => sound.land(), 1150);
  }
  cam.mode = "follow";
  document.body.classList.remove("is-overview");
  els.overviewBtn.textContent = "看全貌";
  els.intro.classList.add("is-hidden");
}

function setOverview() {
  closeSheet();
  cam.mode = "overview";
  document.body.classList.add("is-overview");
  autoTarget = null;
  const p = player.dir.clone().add(SUN.clone().multiplyScalar(0.2)).normalize();
  orbit.yaw = Math.atan2(p.x, p.z);
  orbit.pitch = THREE.MathUtils.clamp(Math.asin(p.y), 0.35, 0.8);
  els.overviewBtn.textContent = "回到地面";
}

function renderSoundButton() {
  els.soundBtn.textContent = sound.muted ? "声音 关" : "声音 开";
  els.soundBtn.setAttribute("aria-pressed", String(!sound.muted));
}

els.soundBtn.addEventListener("click", () => {
  sound.start();
  sound.toggleMute();
  renderSoundButton();
});
renderSoundButton();

if (new URLSearchParams(location.search).get("host") === "xhs") {
  document.documentElement.style.setProperty("--chrome-top", "76px");
}

els.overviewBtn.addEventListener("click", () => {
  if (cam.mode === "overview") setFollow();
  else setOverview();
});

els.startBtn.addEventListener("click", () => {
  sound.start();
  setFollow();
  // The hint stays until the visitor first moves or taps something.
  els.hint.style.opacity = "1";
});

// Height of the top HUD row (title card and buttons) that close-ups keep their subject out of.
const HUD_HEIGHT = 104;
const desired = { dir: new THREE.Vector3(), look: new THREE.Vector3(), up: new THREE.Vector3(), view: 18 };
// Camera elevation above the ground plane: the classic isometric angle, a little steeper.
const ELEVATION = THREE.MathUtils.degToRad(38);

function updateCamera(dt, time) {
  const up = player.dir;
  const base = tmpV.copy(up).multiplyScalar(surfaceRadius(up));
  if (cam.mode === "intro" || cam.mode === "overview") {
    if (cam.mode === "intro") orbit.yaw += dt * 0.05;
    orbitDirection(desired.dir);
    desired.look.set(0, cam.mode === "intro" ? INTRO_LOOK_Y : 0, 0);
    desired.up.set(0, 1, 0);
    desired.view = cam.mode === "intro" ? introView() : viewHeightFor(17 * orbit.scale, 17.5 * orbit.scale);
  } else if (cam.mode === "focus" && objects[cam.focusId]) {
    const obj = objects[cam.focusId];
    const od = obj.dir;
    const objPos = od.clone().multiplyScalar(R);
    let away;
    if (obj.front) {
      // The traveler steps to one side (see standSpot); the camera swings to the other.
      const side = new THREE.Vector3().crossVectors(od, obj.front).normalize();
      away = obj.front.clone().multiplyScalar(Math.cos(0.75)).addScaledVector(side, -Math.sin(0.75)).normalize();
    } else {
      away = tangentToward(od, player.dir);
      if (away.lengthSq() < 0.5) away.copy(camForward).negate();
      // Look from the far side, slightly off-axis, so the traveler stands facing the object in frame.
      away.applyAxisAngle(od, 2.4);
    }
    // The bench is about the sky, so that stop looks up from low down and lets the sky fill the frame.
    const elevation = obj.id === "bench" ? THREE.MathUtils.degToRad(10) : ELEVATION;
    desired.dir.copy(od).multiplyScalar(Math.sin(elevation)).addScaledVector(away, Math.cos(elevation));
    desired.look.copy(objPos).addScaledVector(od, (obj.id === "bench" ? 1.4 : 0.5) * obj.focus);
    desired.up.copy(od);
    // Frame the object and the traveler together: aim between them and widen to fit both.
    const travelerPos = traveler.group.position;
    // Only when the traveler is actually standing nearby; otherwise frame the object alone.
    const near = travelerPos.distanceTo(objPos) < 2.6;
    const gap = near ? travelerPos.distanceTo(objPos) : 0;
    if (near) desired.look.lerp(tmpV.copy(travelerPos).addScaledVector(od, 0.5), 0.3);
    // Fit them into the part of the screen the HUD and the sheet leave free.
    const free = THREE.MathUtils.clamp(1 - ((sheetState ? els.sheet.offsetHeight : 0) + HUD_HEIGHT) / window.innerHeight, 0.4, 1);
    const fit = Math.max(3.6 * obj.focus, gap * 1.9 + 1.4);
    desired.view = viewHeightFor(fit, fit) * (1 + (1 - free) * 0.55);
    const punch = (time - react.hop) / 0.6;
    if (punch > 0 && punch < 1) desired.view *= 1 - Math.sin(punch * Math.PI) * 0.08;
  } else {
    desired.dir.copy(up).multiplyScalar(Math.sin(ELEVATION)).addScaledVector(camForward, -Math.cos(ELEVATION));
    desired.look.copy(base).addScaledVector(up, 0.5).addScaledVector(camForward, 0.6);
    desired.up.copy(up);
    desired.view = viewHeightFor(6.5 * cam.zoom, 4.2 * cam.zoom);
  }
  // Dive: a short anticipation (the wide view eases out a little), then a slower, smooth descent.
  const diveT = time - (cam.dive ?? -10);
  if (diveT < 0.3) {
    orbitDirection(desired.dir);
    desired.look.set(0, INTRO_LOOK_Y, 0);
    desired.up.set(0, 1, 0);
    desired.view = introView() * 1.06;
  }
  // A director (used by the promo renderer) may take over the framing; it gets the same smoothing.
  if (cam.director) cam.director(desired, time);
  const rate = cam.directorRate ?? (diveT < 1.6 ? 2.6 : cam.mode === "follow" ? 7 : 3);
  const k = 1 - Math.exp(-dt * rate);
  cam.dir.lerp(desired.dir, k).normalize();
  cam.look.lerp(desired.look, k);
  cam.up.lerp(desired.up, k).normalize();
  cam.view += (desired.view - cam.view) * k;
  camera.position.copy(cam.look).addScaledVector(cam.dir, distanceFor(cam.view));
  // Keep the lens outside the planet while it travels between modes.
  if (camera.position.length() < R + 0.5) camera.position.setLength(R + 0.5);
  camera.up.copy(cam.up);
  camera.lookAt(cam.look);
  applyView(camera, window.innerWidth / window.innerHeight);
  // While a sheet is open, shift the projection so the scene centres in the space above it.
  const sheetH = sheetState ? els.sheet.offsetHeight : 0;
  const hud = cam.mode === "focus" ? HUD_HEIGHT : 0;
  cam.offset += ((sheetH - hud) * 0.5 - cam.offset) * (1 - Math.exp(-dt * 6));
  world.setNearCull(cam.mode === "focus" ? cam.dir : null, cam.look);
  if (Math.abs(cam.offset) > 0.5) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.setViewOffset(w, h, 0, cam.offset, w, h);
  } else if (camera.view?.enabled) {
    camera.clearViewOffset();
  }
}

// ---------- player ----------

function resolveCollisions() {
  world.blockers.forEach(b => {
    const angle = player.dir.angleTo(b.dir);
    if (angle < b.radius) {
      const t = tangentToward(b.dir, player.dir);
      if (t.lengthSq() < 0.5) return;
      player.dir.copy(b.dir).multiplyScalar(Math.cos(b.radius)).addScaledVector(t, Math.sin(b.radius)).normalize();
    }
  });
}

function movePlayer(moveDir, distance) {
  const axis = new THREE.Vector3().crossVectors(player.dir, moveDir);
  if (axis.lengthSq() < 1e-8) return;
  axis.normalize();
  tmpQ.setFromAxisAngle(axis, distance / R);
  player.dir.applyQuaternion(tmpQ).normalize();
  camForward.applyQuaternion(tmpQ);
  player.facing.applyQuaternion(tmpQ);
  resolveCollisions();
  reproject(camForward, player.dir);
  reproject(player.facing, player.dir);
}

const moveDir = new THREE.Vector3();
const right = new THREE.Vector3();

function updatePlayer(dt, time) {
  let ix = input.x;
  let iy = input.y;
  if (input.keys.has("KeyA") || input.keys.has("ArrowLeft")) ix -= 1;
  if (input.keys.has("KeyD") || input.keys.has("ArrowRight")) ix += 1;
  if (input.keys.has("KeyW") || input.keys.has("ArrowUp")) iy += 1;
  if (input.keys.has("KeyS") || input.keys.has("ArrowDown")) iy -= 1;
  if (input.keys.has("KeyQ")) rotateView(-dt * 1.8);
  if (input.keys.has("KeyE")) rotateView(dt * 1.8);
  const mag = Math.min(1, Math.hypot(ix, iy));
  const canMove = cam.mode === "follow" && !sheetState;
  let speed = 0;

  if (canMove && mag > 0.05) {
    autoTarget = null;
    right.crossVectors(camForward, player.dir);
    moveDir.copy(right).multiplyScalar(ix).addScaledVector(camForward, iy).normalize();
    speed = 2.6 * mag;
  } else if (sheetState && player.standTarget) {
    // Step aside while a sheet is open, then turn to face the object.
    player.standTime -= dt;
    if (player.dir.angleTo(player.standTarget) > 0.01 && player.standTime > 0) {
      tangentToward(player.dir, player.standTarget, moveDir);
      speed = 1.6;
    } else {
      player.standTarget = null;
    }
  } else if (canMove && autoTarget) {
    const obj = objects[autoTarget];
    tangentToward(player.dir, obj.dir, moveDir);
    speed = 2.8;
    if (player.dir.angleTo(obj.dir) <= obj.reach) {
      const id = autoTarget;
      autoTarget = null;
      speed = 0;
      openObject(id);
    } else {
      // Let the camera swing round behind the walk so the target stays in view.
      camForward.lerp(moveDir, 1 - Math.exp(-dt * 1.5));
      reproject(camForward, player.dir);
    }
  }

  if (sheetState && !player.standTarget && player.lookTarget) {
    const face = tangentToward(player.dir, player.lookTarget);
    if (face.lengthSq() > 0.5) player.facing.lerp(face, 1 - Math.exp(-dt * 6));
    reproject(player.facing, player.dir);
  }

  if (speed > 0) {
    const before = player.dir.clone();
    movePlayer(moveDir, Math.min(speed * dt, player.standTarget ? player.dir.angleTo(player.standTarget) * R : Infinity));
    // Sliding along a blocker: walk in the direction actually travelled.
    const travelled = tangentToward(before, player.dir);
    if (travelled.lengthSq() > 0.5) player.facing.lerp(travelled, 1 - Math.exp(-dt * 12));
    reproject(player.facing, player.dir);
    els.hint.style.opacity = "0";
  }
  player.speed += (speed - player.speed) * (1 - Math.exp(-dt * 10));

  const up = player.dir;
  const x = new THREE.Vector3().crossVectors(up, player.facing);
  tmpM.makeBasis(x, up, player.facing);
  traveler.group.quaternion.setFromRotationMatrix(tmpM);
  traveler.group.position.copy(up).multiplyScalar(surfaceRadius(up) - 0.01);

  const s = Math.min(1, player.speed / 2.6);
  const prevStep = Math.sin(player.phase);
  player.phase += dt * (3 + player.speed * 3.2);
  if (s > 0.4 && Math.sign(prevStep) !== Math.sign(Math.sin(player.phase))) {
    world.kickDust(traveler.group.position, player.dir);
    sound.step();
  }
  const swing = Math.sin(player.phase) * 0.75 * s;
  traveler.legs[0].rotation.x = swing;
  traveler.legs[1].rotation.x = -swing;
  traveler.arms[0].rotation.x = -swing * 0.7;
  traveler.arms[1].rotation.x = swing * 0.7;
  const idle = 1 - s;
  // Hop on a confirmed answer; squash on landing from the dive; breathe and glance around when idle.
  const hopT = (time - react.hop) / 0.45;
  const hop = hopT > 0 && hopT < 1 ? Math.sin(hopT * Math.PI) : 0;
  const landT = time - react.land;
  const landSquash = landT > 0 && landT < 0.9 ? Math.sin(landT * 16) * Math.exp(-landT * 6) * 0.22 : 0;
  const breathe = Math.sin(time * 2.1) * 0.018 * idle;
  const sy = 1 - landSquash + breathe + hop * 0.08;
  traveler.body.scale.set(1 / Math.sqrt(sy), sy, 1 / Math.sqrt(sy));
  traveler.body.position.y = Math.abs(Math.sin(player.phase)) * 0.04 * s + hop * 0.16;
  traveler.head.rotation.z = Math.sin(time * 1.3) * 0.04 * idle;
  traveler.head.rotation.x = -hop * 0.25;
  traveler.head.rotation.y = Math.sin(time * 0.37) * Math.sin(time * 0.23 + 1) * 0.7 * idle * (sheetState ? 0.2 : 1);
  traveler.pack.position.y = 0.58 + Math.abs(Math.cos(player.phase)) * 0.025 * s;
  traveler.pack.rotation.x = -0.08 * s;
  traveler.charm.rotation.z = Math.sin(player.phase) * 0.5 * s + Math.sin(time * 1.7) * 0.08;

  updateNearby();
}

function updateNearby() {
  if (cam.mode !== "follow" || sheetState || autoTarget) {
    els.interactBtn.hidden = true;
    lastNearId = null;
    return;
  }
  let best = null;
  let bestAngle = Infinity;
  Object.values(objects).forEach(obj => {
    const angle = player.dir.angleTo(obj.dir);
    if (angle < obj.reach + 0.12 && angle < bestAngle) {
      best = obj;
      bestAngle = angle;
    }
  });
  if (best?.id !== lastNearId) {
    lastNearId = best?.id || null;
    els.interactBtn.hidden = !best;
    if (best) els.interactBtn.textContent = `查看${QUESTS.find(q => q.id === best.id).name}`;
  }
}

els.interactBtn.addEventListener("click", () => {
  if (lastNearId) openObject(lastNearId);
});

function rotateView(angle) {
  if (cam.mode === "overview" || cam.mode === "intro") {
    orbit.yaw -= angle;
    return;
  }
  camForward.applyAxisAngle(player.dir, -angle);
  reproject(camForward, player.dir);
}

// ---------- labels ----------

const labelPos = new THREE.Vector3();

function occludedByPlanet(point) {
  const from = camera.position;
  const d = tmpV.copy(point).sub(from);
  const t = THREE.MathUtils.clamp(-from.dot(d) / d.lengthSq(), 0, 1);
  return from.clone().addScaledVector(d, t).length() < R * 0.98;
}

function updateLabels() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  labelEls.forEach(label => {
    let visible = !sheetState;
    if (label.far) {
      const p = farPlanets.find(item => item.id === label.id);
      labelPos.copy(p.group.position).add(new THREE.Vector3(0, p.r + 1.2, 0));
    } else {
      const obj = objects[label.id];
      labelPos.copy(obj.dir).multiplyScalar(R + obj.labelHeight);
      if (cam.mode === "follow" && label.id === lastNearId) visible = false;
    }
    if (visible && occludedByPlanet(labelPos)) visible = false;
    const projected = labelPos.clone().project(camera);
    if (projected.z > 1) visible = false;
    const sx = (projected.x * 0.5 + 0.5) * w;
    const sy = (-projected.y * 0.5 + 0.5) * h;
    // Keep labels clear of the HUD at the top and fully on screen; hide rather than clip.
    if (sx < 44 || sx > w - 44 || sy < 120 || sy > h - 24) visible = false;
    // The intro copy already names every stop; labels appear once the traveler lands.
    if (cam.mode === "intro") visible = false;
    label.el.style.opacity = visible ? (label.el.classList.contains("is-locked") ? "0.65" : "1") : "0";
    if (visible) {
      label.el.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -100%)`;
    }
  });
}

// ---------- pointer / keyboard ----------

const raycaster = new THREE.Raycaster();
const hitList = [];
const hitOwner = new Map();
Object.values(objects).forEach(obj => obj.hit.forEach(mesh => { hitList.push(mesh); hitOwner.set(mesh, { type: "object", id: obj.id }); }));
farPlanets.forEach(p => p.hit.forEach(mesh => { hitList.push(mesh); hitOwner.set(mesh, { type: "far", planet: p }); }));

function handleTap(clientX, clientY) {
  const ndc = new THREE.Vector2((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObjects(hitList, false)[0];
  if (!hit) return;
  const owner = hitOwner.get(hit.object);
  if (owner.type === "object") goTo(owner.id);
  else openFarPlanet(owner.planet);
}

const pointers = new Map();
let joystickId = null;
let joystickOrigin = { x: 0, y: 0 };
let pinchStart = null;

els.canvas.addEventListener("pointerdown", event => {
  try {
    els.canvas.setPointerCapture(event.pointerId);
  } catch (error) {
    // Synthetic or already-released pointers can't be captured; dragging still works without it.
  }
  const isTouch = event.pointerType !== "mouse";
  const p = { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, time: performance.now(), moved: 0 };
  pointers.set(event.pointerId, p);
  if (isTouch && joystickId === null && cam.mode === "follow" && event.clientX < window.innerWidth * 0.45 && event.clientY > window.innerHeight * 0.3) {
    joystickId = event.pointerId;
    joystickOrigin = { x: event.clientX, y: event.clientY };
    els.joystick.style.display = "block";
    els.joystick.style.left = `${event.clientX}px`;
    els.joystick.style.top = `${event.clientY}px`;
    els.joystickKnob.style.transform = "translate(0, 0)";
  }
  const touches = [...pointers.entries()].filter(([id]) => id !== joystickId);
  if (touches.length === 2) {
    const [a, b] = touches.map(([, value]) => value);
    pinchStart = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: cam.zoom, orbitScale: orbit.scale };
  }
});

els.canvas.addEventListener("pointermove", event => {
  const p = pointers.get(event.pointerId);
  if (!p) return;
  const dx = event.clientX - p.x;
  const dy = event.clientY - p.y;
  p.x = event.clientX;
  p.y = event.clientY;
  p.moved = Math.max(p.moved, Math.hypot(event.clientX - p.startX, event.clientY - p.startY));
  if (event.pointerId === joystickId) {
    const max = 50;
    let jx = event.clientX - joystickOrigin.x;
    let jy = event.clientY - joystickOrigin.y;
    const len = Math.hypot(jx, jy);
    if (len > max) {
      jx = (jx / len) * max;
      jy = (jy / len) * max;
    }
    els.joystickKnob.style.transform = `translate(${jx}px, ${jy}px)`;
    input.x = jx / max;
    input.y = -jy / max;
    return;
  }
  const others = [...pointers.entries()].filter(([id]) => id !== joystickId);
  if (others.length === 2 && pinchStart) {
    const [a, b] = others.map(([, value]) => value);
    const ratio = pinchStart.dist / Math.max(20, Math.hypot(a.x - b.x, a.y - b.y));
    cam.zoom = THREE.MathUtils.clamp(pinchStart.zoom * ratio, 0.6, 1.8);
    orbit.scale = THREE.MathUtils.clamp(pinchStart.orbitScale * ratio, 0.6, 1.5);
    return;
  }
  if (sheetState) return;
  rotateView(dx * 0.006);
  if (cam.mode === "overview" || cam.mode === "intro") {
    orbit.pitch = THREE.MathUtils.clamp(orbit.pitch + dy * 0.004, 0.05, 1.3);
  }
});

function endPointer(event) {
  const p = pointers.get(event.pointerId);
  pointers.delete(event.pointerId);
  if (event.pointerId === joystickId) {
    joystickId = null;
    input.x = 0;
    input.y = 0;
    els.joystick.style.display = "none";
    return;
  }
  if (pointers.size < 2) pinchStart = null;
  if (p && event.type === "pointerup" && p.moved < 10 && performance.now() - p.time < 400 && !sheetState) {
    handleTap(event.clientX, event.clientY);
  }
}

els.canvas.addEventListener("pointerup", endPointer);
els.canvas.addEventListener("pointercancel", endPointer);

els.canvas.addEventListener("wheel", event => {
  event.preventDefault();
  const f = Math.exp(event.deltaY * 0.001);
  cam.zoom = THREE.MathUtils.clamp(cam.zoom * f, 0.6, 1.8);
  orbit.scale = THREE.MathUtils.clamp(orbit.scale * f, 0.6, 1.5);
}, { passive: false });

window.addEventListener("keydown", event => {
  if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) return;
  if (event.code === "Escape") {
    closeSheet();
    return;
  }
  if ((event.code === "Enter" || event.code === "Space") && !sheetState) {
    if (cam.mode === "intro") {
      sound.start();
      setFollow();
    }
    else if (lastNearId) openObject(lastNearId);
    event.preventDefault();
    return;
  }
  input.keys.add(event.code);
});

window.addEventListener("keyup", event => input.keys.delete(event.code));
window.addEventListener("blur", () => input.keys.clear());

// ---------- loop ----------

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  world.setSize(w, h);
}

window.addEventListener("resize", resize);
resize();

syncWorld();
world.snap();
renderQuests();

const clock = new THREE.Clock();
let started = false;

// Measure the frame rate for a few seconds and step effects down on slower phones.
// `?quality=0|1|2` in the URL pins a level instead.
const pinnedQuality = new URLSearchParams(location.search).get("quality");
const perf = { frames: 0, time: 0, done: pinnedQuality !== null };
if (pinnedQuality !== null) world.setQuality(Number(pinnedQuality));

function measure(dt, time) {
  if (perf.done || time < 1.5) return;
  perf.frames += 1;
  perf.time += dt;
  if (perf.time < 3) return;
  perf.done = true;
  const fps = perf.frames / perf.time;
  if (fps < 24) world.setQuality(0);
  else if (fps < 40) world.setQuality(1);
}

const focusPoint = new THREE.Vector3();

// Keep the tilt-shift band on whatever the camera is about: the traveler, the open object, or the planet.
function updateFocus() {
  if (cam.mode === "focus" && objects[cam.focusId]) focusPoint.copy(objects[cam.focusId].dir).multiplyScalar(R + 0.4);
  else if (cam.mode === "follow") focusPoint.copy(traveler.group.position).addScaledVector(player.dir, 0.5);
  else focusPoint.set(0, 0, 0);
  world.setFocus(THREE.MathUtils.clamp(focusPoint.project(camera).y * 0.5 + 0.5, 0.1, 0.9));
}

function frame() {
  const rawDt = clock.getDelta();
  const dt = Math.min(rawDt, 0.05);
  const time = clock.elapsedTime;
  measure(rawDt, time);
  clockNow = time;
  world.update(dt, time);
  sound.tick(Number(life.answers.dashboard.play ?? 5) / 10);
  updatePlayer(dt, time);
  updateCamera(dt, time);
  updateFocus();
  world.render(camera, time);
  updateLabels();
  if (!started) {
    started = true;
    els.loading.classList.add("is-hidden");
  }
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

// Testing hook: lets automated checks drive the scene without pointer gestures.
window.__planet = { goTo, setOverview, setFollow, openObject, closeSheet, life: () => life, autoTarget: () => autoTarget, cam, player, traveler, world, makePostcard, orbitDirection, viewHeightFor };
