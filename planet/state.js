// Shares progress with index.html: same localStorage key and the same state shape,
// so answers given on the planet show up in the full questionnaire and report.
const STORAGE_KEY = "lifeDesignH5StateV1";
const PLANET_KEY = "lifeDesignPlanetV1";
const AI_ENDPOINT_STORAGE_KEY = "lifeDesignAiEndpointV1";
const DEFAULT_AI_ENDPOINT = "https://api.mostdesign.cn/api/analyze-life-design";
const AI_USER_STORAGE_KEY = "lifeDesignAnonymousUserV1";

// Must match the order of `steps` in index.html.
const STEP_ORDER = ["dashboard", "coreProblem", "reverseConsent", "reverseTuesday", "workview", "lifeview", "flow", "energy", "anchor", "odyssey"];

const initialState = {
  currentStepId: "dashboard",
  mode: "input",
  answers: {
    dashboard: { health: 5, work: 5, play: 5, love: 5, note: "" }
  },
  completed: [],
  feedback: {},
  aiCoach: {},
  problem: null,
  reportGeneratedAt: null
};

export const dashboardItems = [
  { key: "health", label: "健康", color: "#1f9c8c" },
  { key: "work", label: "工作", color: "#3476d9" },
  { key: "play", label: "娱乐", color: "#e0a02a" },
  { key: "love", label: "爱", color: "#e0475a" }
];

function readJSON(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    return null;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    // Private mode or full storage: the planet still works for this visit.
  }
}

export function loadLifeState() {
  const parsed = readJSON(STORAGE_KEY);
  if (!parsed) return structuredClone(initialState);
  return {
    ...structuredClone(initialState),
    ...parsed,
    answers: {
      ...structuredClone(initialState.answers),
      ...(parsed.answers || {})
    },
    completed: Array.isArray(parsed.completed) ? parsed.completed : [],
    feedback: parsed.feedback || {},
    aiCoach: parsed.aiCoach || {}
  };
}

export function saveLifeState(state) {
  writeJSON(STORAGE_KEY, state);
}

export function loadPlanetState() {
  const parsed = readJSON(PLANET_KEY) || {};
  const planet = {
    // Each visitor gets their own planet number, shown on the HUD and the postcard.
    code: typeof parsed.code === "string" ? parsed.code : `LD-${String(Math.floor(Math.random() * 9000) + 1000)}`,
    visited: Array.isArray(parsed.visited) ? parsed.visited : []
  };
  if (!parsed.code) writeJSON(PLANET_KEY, planet);
  return planet;
}

export function savePlanetState(planet) {
  writeJSON(PLANET_KEY, planet);
}

export function markCompleted(state, stepId) {
  if (!state.completed.includes(stepId)) state.completed.push(stepId);
  // Move the questionnaire's resume point past steps finished here, never backwards.
  let moved = false;
  while (STEP_ORDER.indexOf(state.currentStepId) <= 1 && state.completed.includes(state.currentStepId)) {
    state.currentStepId = STEP_ORDER[STEP_ORDER.indexOf(state.currentStepId) + 1];
    moved = true;
  }
  if (moved) state.mode = "input";
}

export function classifyProblem(text = "") {
  const gravityTerms = ["别人", "社会", "时代", "行业", "政策", "房价", "年龄", "学历", "家庭出身", "父母", "老板", "公司", "歧视", "不公平", "大环境", "经济", "市场", "无法", "不能改变", "没办法"];
  const designTerms = ["我如何", "怎么", "尝试", "选择", "行动", "学习", "联系", "测试", "改变", "计划", "作品", "面试", "转型", "沟通", "边界", "时间", "原型"];
  const countHits = terms => terms.reduce((sum, term) => sum + (text.includes(term) ? 1 : 0), 0);
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const gravityHits = countHits(gravityTerms);
  const designHits = countHits(designTerms);
  let gravity = clamp(35 + gravityHits * 11 - designHits * 5, 15, 85);
  let designable = clamp(100 - gravity + designHits * 6, 20, 85);
  const total = gravity + designable;
  gravity = Math.round((gravity / total) * 100);
  designable = 100 - gravity;
  const label = gravity > designable
    ? "现实边界很强，先停止和墙拔河，再重定向。"
    : "行动空间已经露出来了，下一步适合做原型。";
  return { gravity, designable, label };
}

function hashText(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function getAiUserId() {
  let id = localStorage.getItem(AI_USER_STORAGE_KEY);
  if (id) return id;
  const random = new Uint8Array(16);
  crypto.getRandomValues(random);
  id = `anon_${Array.from(random).map(value => value.toString(16).padStart(2, "0")).join("")}`;
  localStorage.setItem(AI_USER_STORAGE_KEY, id);
  return id;
}

function coachUrl() {
  let endpoint = DEFAULT_AI_ENDPOINT;
  try {
    endpoint = localStorage.getItem(AI_ENDPOINT_STORAGE_KEY) || DEFAULT_AI_ENDPOINT;
    const url = new URL(endpoint);
    url.pathname = "/api/coach-step";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch (error) {
    return "";
  }
}

// Same request index.html sends after the coreProblem step; the result is stored in
// state.aiCoach.coreProblem with the same signature so the questionnaire reuses it.
export async function requestCoreProblemCoach(state) {
  const input = { dashboard: state.answers.dashboard, coreProblem: state.answers.coreProblem };
  const signature = hashText(JSON.stringify(input));
  const existing = state.aiCoach.coreProblem;
  if (existing?.status === "done" && existing.signature === signature) return existing;

  const url = coachUrl();
  if (!url) return { signature, status: "error", error: "AI 接口地址无效，已先保留固定反馈。" };
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Life-Design-User": getAiUserId()
      },
      body: JSON.stringify({
        version: "life-design-h5-v1",
        stepId: "coreProblem",
        generatedAt: new Date().toISOString(),
        answers: input,
        problemRadar: state.problem || classifyProblem(state.answers.coreProblem || "")
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || data.message || `接口返回 ${response.status}`);
    return { signature, status: "done", result: data.coach, model: data.model || "", generatedAt: new Date().toISOString() };
  } catch (error) {
    const offline = error instanceof TypeError;
    return { signature, status: "error", error: offline ? "AI 追问暂时连不上，固定反馈不受影响，可以继续往下走。" : (error.message || "AI 关键追问暂时不可用，固定流程可以继续。") };
  }
}
