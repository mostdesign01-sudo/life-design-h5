import * as THREE from "../vendor/three.module.min.js";
import { createWorld, buildTraveler, surfaceRadius, POLE, SUN, R } from "./world.js";
import {
  loadLifeState, saveLifeState, loadPlanetState, savePlanetState,
  markCompleted, classifyProblem, requestCoreProblemCoach, dashboardItems
} from "./state.js";

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

const els = {
  canvas: document.getElementById("scene"),
  labels: document.getElementById("labels"),
  questCard: document.getElementById("questCard"),
  questHead: document.getElementById("questHead"),
  questList: document.getElementById("questList"),
  questTitle: document.getElementById("questTitle"),
  questCount: document.getElementById("questCount"),
  overviewBtn: document.getElementById("overviewBtn"),
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
const { renderer, scene, camera, objects, farPlanets } = world;
const traveler = buildTraveler();
scene.add(traveler.group);

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

// Camera state: smoothed position/look/up chasing a per-mode target.
const cam = {
  mode: "intro",
  pos: new THREE.Vector3(),
  look: new THREE.Vector3(),
  up: new THREE.Vector3(0, 1, 0),
  zoom: 1,
  focusId: null,
  offset: 0
};
// Intro: a low side view so the planet floats over the cloud sea at dusk.
const orbit = {
  yaw: Math.atan2(POLE.x, POLE.z) - 0.5,
  pitch: 0.3,
  dist: 22
};

// Portrait screens have a narrow horizontal field of view, so pull the camera back.
function portraitScale(strength) {
  const aspect = window.innerWidth / window.innerHeight;
  return aspect < 1 ? 1 + (1 - aspect) * strength : 1;
}

function orbitPosition(out) {
  return out.set(
    Math.cos(orbit.pitch) * Math.sin(orbit.yaw),
    Math.sin(orbit.pitch),
    Math.cos(orbit.pitch) * Math.cos(orbit.yaw)
  ).multiplyScalar(orbit.dist * portraitScale(1.1));
}

orbitPosition(cam.pos);
camera.position.copy(cam.pos);
camera.lookAt(0, 0, 0);

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
  labelEls.forEach(label => label.el.classList.toggle("is-done", !label.far && isDone(label.id)));
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
  ...QUESTS.map(q => ({ id: q.id, text: q.name, far: false })),
  ...farPlanets.map(p => ({ id: p.id, text: `${p.name} · 筹建中`, far: true }))
].map(item => {
  const el = document.createElement("div");
  el.className = `obj-label${item.far ? " is-far" : ""}`;
  el.textContent = item.text;
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

function openSheet(state, html) {
  sheetState = state;
  els.sheetBody.innerHTML = html;
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
  range.addEventListener("input", () => {
    value = Number(range.value);
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
    return "这里有明显的<strong>重力问题</strong>成分：有些现实不是靠你更努力就会改变。真正可设计的部分，是你在这些现实边界内如何重新定向、选择场景、降低试错成本。先把不能推动的墙认出来，不是认输，是节省生命。";
  }
  return "这个问题里已经有不少<strong>可设计空间</strong>。下一步不是立刻找唯一答案，而是把它拆成可以试的小问题：你能找谁聊、能做什么小实验、能用什么证据判断它是否更靠近你。";
}

function coachHTML(coach) {
  if (!coach) return "";
  if (coach.status === "loading") {
    return `<div class="coach"><span class="coach-label">AI 关键追问</span><p>AI 正在做一次短判断：一个关键观察、一个追问和一个低成本原型动作。</p></div>`;
  }
  if (coach.status === "error") {
    return `<div class="coach"><span class="coach-label">AI 关键追问</span><p>${escapeHTML(coach.error || "这次 AI 追问暂时不可用。")}</p></div>`;
  }
  const c = coach.result || {};
  return `
    <div class="coach">
      <span class="coach-label">AI 关键追问</span>
      <p><strong>${escapeHTML(c.headline || "值得停一下")}</strong></p>
      ${c.reflection ? `<p>${escapeHTML(c.reflection)}</p>` : ""}
      ${c.question ? `<p><strong>追问：</strong>${escapeHTML(c.question)}</p>` : ""}
      ${c.prototype ? `<p><strong>小原型：</strong>${escapeHTML(c.prototype)}</p>` : ""}
      ${c.watchout ? `<p><strong>提醒：</strong>${escapeHTML(c.watchout)}</p>` : ""}
    </div>
  `;
}

function radarHTML(p) {
  return `
    <div class="radar">
      <div class="radar-row"><span>重力问题</span><div class="radar-bar"><span style="width:${p.gravity}%;background:#8c6a50"></span></div><span>${p.gravity}%</span></div>
      <div class="radar-row"><span>可设计</span><div class="radar-bar"><span style="width:${p.designable}%;background:#2fbfa0"></span></div><span>${p.designable}%</span></div>
    </div>
  `;
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
  const render = coach => `
    <div class="sheet-kicker">缠绕藤 · 核心困扰</div>
    <h2 class="sheet-title" id="sheetTitle">${escapeHTML(p.label)}</h2>
    <p class="sheet-story">老藤是你拔不动的那部分：接受它，别再和墙拔河。旁边发光的新芽，是你可以动手设计的部分。</p>
    ${radarHTML(p)}
    <p class="reaction">${problemFeedback(p)}</p>
    ${coachHTML(coach)}
    <div class="sheet-actions">
      <button class="btn btn-ghost" type="button" data-action="rewrite">改写</button>
      <button class="btn btn-primary" type="button" data-action="next">${nextQuestLabel()}</button>
    </div>
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
    <div class="postcard-wrap"><img src="${url}" alt="我的小星球明信片"></div>
    <p class="sheet-story" style="margin-top:10px">手机上可以长按图片保存。它不是判决，只是这一季的快照：过一阵再来，星球会因为你做的小事而变。</p>
    <div class="sheet-actions">
      <a class="btn btn-ghost" href="${url}" download="我的小星球.png">保存明信片</a>
      <button class="btn btn-ghost" type="button" data-action="edit">改写日记</button>
      <a class="btn btn-primary" href="${FULL_URL}">继续旅程</a>
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

function makePostcard() {
  const size = 1080;
  const prevRatio = renderer.getPixelRatio();
  const prevSize = renderer.getSize(new THREE.Vector2());
  const shotCam = camera.clone();
  shotCam.clearViewOffset();
  // Same low side view as the intro: the planet floating over the clouds, with room for the title.
  const yaw = Math.atan2(POLE.x, POLE.z) - 0.5;
  const pitch = 0.5;
  shotCam.position.set(Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw)).multiplyScalar(21);
  shotCam.up.set(0, 1, 0);
  shotCam.aspect = 1;
  shotCam.fov = 50;
  shotCam.lookAt(0, 1.6, 0);
  shotCam.updateProjectionMatrix();
  world.sky.position.copy(shotCam.position);

  renderer.setPixelRatio(1);
  renderer.setSize(size, size, false);
  renderer.render(scene, shotCam);
  const card = document.createElement("canvas");
  card.width = size;
  card.height = 1480;
  const ctx = card.getContext("2d");
  ctx.drawImage(renderer.domElement, 0, 0, size, size);
  renderer.setPixelRatio(prevRatio);
  renderer.setSize(prevSize.x, prevSize.y, false);

  const font = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';
  const shade = ctx.createLinearGradient(0, 0, 0, 260);
  shade.addColorStop(0, "rgba(29,21,48,0.55)");
  shade.addColorStop(1, "rgba(29,21,48,0)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, size, 260);
  ctx.fillStyle = "#fff";
  ctx.font = `700 68px ${font}`;
  ctx.fillText("我的小星球", 64, 120);
  ctx.font = `400 30px ${font}`;
  const date = new Date();
  ctx.fillText(`${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")} · 星球 ${planet.code} · 晚霞指数 ${glowIndex(Number(life.answers.dashboard.play ?? 5))}%`, 66, 172);

  ctx.fillStyle = "#fffbf4";
  ctx.fillRect(0, size, size, 1480 - size);
  const d = life.answers.dashboard;
  const icons = { health: "泉水", work: "工坊", play: "晚霞", love: "双生灯" };
  dashboardItems.forEach((item, i) => {
    const x = 64 + i * 245;
    const score = Number(d[item.key] ?? 5);
    ctx.fillStyle = "rgba(35,29,43,0.6)";
    ctx.font = `500 28px ${font}`;
    ctx.fillText(`${item.label} · ${icons[item.key]}`, x, size + 74);
    ctx.fillStyle = item.color;
    ctx.font = `800 64px ${font}`;
    ctx.fillText(String(score), x, size + 146);
    ctx.fillStyle = "rgba(35,29,43,0.08)";
    ctx.fillRect(x, size + 166, 200, 10);
    ctx.fillStyle = item.color;
    ctx.fillRect(x, size + 166, 20 * score, 10);
  });
  ctx.fillStyle = "#231d2b";
  ctx.font = `500 30px ${font}`;
  const low = sortedScores()[0];
  const note = (d.note || "").replace(/\s+/g, " ");
  const clip = (text, n) => (text.length > n ? `${text.slice(0, n)}…` : text);
  ctx.fillText(clip(`红灯：${low.label}${note ? ` —— ${note}` : ""}`, 32), 64, size + 248);
  if (life.problem) {
    ctx.fillStyle = "rgba(35,29,43,0.7)";
    ctx.fillText(`缠绕藤：重力 ${life.problem.gravity}% · 可设计 ${life.problem.designable}%`, 64, size + 298);
  }
  ctx.fillStyle = "rgba(35,29,43,0.45)";
  ctx.font = `400 24px ${font}`;
  ctx.fillText("设计人生蓝图 · 3D 第一站", 64, 1480 - 40);
  return card.toDataURL("image/png");
}

// ---------- camera modes ----------

function setFollow() {
  cam.mode = "follow";
  els.overviewBtn.textContent = "俯瞰";
  els.intro.classList.add("is-hidden");
}

function setOverview() {
  closeSheet();
  cam.mode = "overview";
  autoTarget = null;
  const p = player.dir.clone().add(SUN.clone().multiplyScalar(0.2)).normalize();
  orbit.yaw = Math.atan2(p.x, p.z);
  orbit.pitch = THREE.MathUtils.clamp(Math.asin(p.y), 0.25, 0.8);
  els.overviewBtn.textContent = "回到地面";
}

els.overviewBtn.addEventListener("click", () => {
  if (cam.mode === "overview") setFollow();
  else setOverview();
});

els.startBtn.addEventListener("click", () => {
  setFollow();
  els.hint.style.opacity = "1";
  setTimeout(() => { els.hint.style.opacity = "0"; }, 7000);
});

const desired = { pos: new THREE.Vector3(), look: new THREE.Vector3(), up: new THREE.Vector3() };

function updateCamera(dt, time) {
  const up = player.dir;
  const base = tmpV.copy(up).multiplyScalar(surfaceRadius(up));
  if (cam.mode === "intro" || cam.mode === "overview") {
    if (cam.mode === "intro") orbit.yaw += dt * 0.05;
    orbitPosition(desired.pos);
    desired.look.set(0, cam.mode === "intro" ? -1.2 : 0, 0);
    desired.up.set(0, 1, 0);
  } else if (cam.mode === "focus" && objects[cam.focusId]) {
    const obj = objects[cam.focusId];
    const od = obj.dir;
    const objPos = od.clone().multiplyScalar(R);
    let away;
    if (obj.front) {
      away = obj.front.clone().applyAxisAngle(od, 0.8);
    } else {
      away = tangentToward(od, player.dir);
      if (away.lengthSq() < 0.5) away.copy(camForward).negate();
      // Look from the far side, slightly off-axis, so the traveler stands facing the object in frame.
      away.applyAxisAngle(od, 2.4);
    }
    const f = obj.focus * portraitScale(0.9);
    desired.pos.copy(objPos).addScaledVector(od, 2.2 * f).addScaledVector(away, 4.4 * f);
    desired.look.copy(objPos).addScaledVector(od, 0.45 * obj.focus);
    desired.up.copy(od);
  } else {
    const z = cam.zoom * portraitScale(0.3);
    desired.pos.copy(base).addScaledVector(up, 2.3 * z).addScaledVector(camForward, -4.4 * z);
    desired.look.copy(base).addScaledVector(up, 0.7).addScaledVector(camForward, 1.2);
    desired.up.copy(up);
  }
  const k = 1 - Math.exp(-dt * (cam.mode === "follow" ? 7 : 3));
  cam.pos.lerp(desired.pos, k);
  cam.look.lerp(desired.look, k);
  cam.up.lerp(desired.up, k).normalize();
  // Keep the camera outside the planet while it travels between modes.
  const minR = R + 0.6;
  if (cam.pos.length() < minR) cam.pos.setLength(minR);
  camera.position.copy(cam.pos);
  camera.up.copy(cam.up);
  camera.lookAt(cam.look);
  // While a sheet is open, shift the projection so the scene centres in the space above it.
  const sheetH = sheetState ? els.sheet.offsetHeight : 0;
  cam.offset += (sheetH * 0.5 - cam.offset) * (1 - Math.exp(-dt * 6));
  if (cam.offset > 0.5) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.setViewOffset(w, h, 0, cam.offset, w, h);
  } else if (camera.view?.enabled) {
    camera.clearViewOffset();
  }
  world.sky.position.copy(camera.position);
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

  if (speed > 0) {
    const before = player.dir.clone();
    movePlayer(moveDir, speed * dt);
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
  player.phase += dt * (3 + player.speed * 3.2);
  const swing = Math.sin(player.phase) * 0.75 * s;
  traveler.legs[0].rotation.x = swing;
  traveler.legs[1].rotation.x = -swing;
  traveler.arms[0].rotation.x = -swing * 0.7;
  traveler.arms[1].rotation.x = swing * 0.7;
  traveler.body.position.y = Math.abs(Math.sin(player.phase)) * 0.04 * s + Math.sin(time * 2) * 0.008;
  traveler.head.rotation.z = Math.sin(time * 1.3) * 0.04 * (1 - s);
  traveler.pack.position.y = 0.5 + Math.abs(Math.cos(player.phase)) * 0.025 * s;
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
    if (projected.z > 1 || Math.abs(projected.x) > 1.1 || Math.abs(projected.y) > 1.1) visible = false;
    label.el.style.opacity = visible ? "1" : "0";
    if (visible) {
      label.el.style.transform = `translate(${(projected.x * 0.5 + 0.5) * w}px, ${(-projected.y * 0.5 + 0.5) * h}px) translate(-50%, -100%)`;
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
    pinchStart = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: cam.zoom, orbitDist: orbit.dist };
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
    orbit.dist = THREE.MathUtils.clamp(pinchStart.orbitDist * ratio, 12, 34);
    return;
  }
  if (sheetState) return;
  rotateView(dx * 0.006);
  if (cam.mode === "overview" || cam.mode === "intro") {
    orbit.pitch = THREE.MathUtils.clamp(orbit.pitch + dy * 0.004, -0.2, 1.3);
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
  orbit.dist = THREE.MathUtils.clamp(orbit.dist * f, 12, 34);
}, { passive: false });

window.addEventListener("keydown", event => {
  if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) return;
  if (event.code === "Escape") {
    closeSheet();
    return;
  }
  if ((event.code === "Enter" || event.code === "Space") && !sheetState) {
    if (cam.mode === "intro") setFollow();
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
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

window.addEventListener("resize", resize);
resize();

syncWorld();
world.snap();
renderQuests();

const clock = new THREE.Clock();
let started = false;

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const time = clock.elapsedTime;
  world.update(dt, time);
  updatePlayer(dt, time);
  updateCamera(dt, time);
  renderer.render(scene, camera);
  updateLabels();
  if (!started) {
    started = true;
    els.loading.classList.add("is-hidden");
  }
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

// Testing hook: lets automated checks drive the scene without pointer gestures.
window.__planet = { goTo, setOverview, setFollow, openObject, closeSheet, life: () => life, autoTarget: () => autoTarget, cam, player };
