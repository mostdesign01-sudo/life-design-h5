const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";
const AI_API_KEY = process.env.AI_API_KEY || "";
const AI_BASE_URL = (process.env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
const AI_MODEL = process.env.AI_MODEL || "gpt-4.1-mini";
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "https://mostdesign01-sudo.github.io,http://127.0.0.1:8024,http://localhost:8024,null")
  .split(",")
  .map(item => item.trim())
  .filter(Boolean);
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 220000);
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60 * 60 * 1000);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 20);
const DAILY_FREE_AI_CALLS = Number(process.env.DAILY_FREE_AI_CALLS || 1);
const DAILY_FREE_COACH_CALLS = Number(process.env.DAILY_FREE_COACH_CALLS || 4);
const QUOTA_TIMEZONE_OFFSET_MINUTES = Number(process.env.QUOTA_TIMEZONE_OFFSET_MINUTES || 480);
const ACTIVATION_CODES = (process.env.ACTIVATION_CODES || "")
  .split(",")
  .map(item => item.trim())
  .filter(Boolean);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, "usage-db.json");
const IP_HASH_SECRET = process.env.IP_HASH_SECRET || "replace-this-secret-on-server";
// Bearer token for GET /api/stats. Without one, stats can only be read on the server itself.
const STATS_TOKEN = process.env.STATS_TOKEN || "";

const rateLimitBuckets = new Map();
const promptPath = path.join(__dirname, "..", "prompts", "life-design-system-prompt.md");
const SYSTEM_PROMPT = fs.readFileSync(promptPath, "utf8");
const db = loadDb();

function loadDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    return { users: {}, activationCodes: {}, usageLogs: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  } catch (error) {
    return { users: {}, activationCodes: {}, usageLogs: [] };
  }
}

function saveDb() {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function todayKey() {
  return new Date(Date.now() + QUOTA_TIMEZONE_OFFSET_MINUTES * 60 * 1000).toISOString().slice(0, 10);
}

function sanitizeUserId(value) {
  const text = String(value || "");
  return /^[a-zA-Z0-9_-]{12,80}$/.test(text) ? text : "";
}

function ensureUser(userId) {
  if (!db.users[userId]) {
    db.users[userId] = {
      createdAt: new Date().toISOString(),
      credits: 0,
      dailyUsage: {},
      dailyCoachUsage: {}
    };
    saveDb();
  }
  if (!db.users[userId].dailyUsage) db.users[userId].dailyUsage = {};
  if (!db.users[userId].dailyCoachUsage) db.users[userId].dailyCoachUsage = {};
  if (typeof db.users[userId].credits !== "number") db.users[userId].credits = Number(db.users[userId].credits || 0);
  return db.users[userId];
}

function ipHash(ip) {
  return crypto.createHmac("sha256", IP_HASH_SECRET).update(ip).digest("hex").slice(0, 16);
}

function estimateCostUsd(usage) {
  if (!usage) return null;
  const inputTokens = Number(usage.prompt_tokens || 0);
  const outputTokens = Number(usage.completion_tokens || 0);
  const model = String(AI_MODEL).toLowerCase();
  const isPro = model.includes("pro") || model.includes("reasoner");
  const inputPerMillion = isPro ? 0.435 : 0.14;
  const outputPerMillion = isPro ? 0.87 : 0.28;
  return Number(((inputTokens / 1000000) * inputPerMillion + (outputTokens / 1000000) * outputPerMillion).toFixed(6));
}

function quotaFor(userId) {
  const user = ensureUser(userId);
  const day = todayKey();
  const usedToday = Number(user.dailyUsage[day] || 0);
  return {
    date: day,
    dailyFreeLimit: DAILY_FREE_AI_CALLS,
    usedToday,
    freeRemaining: Math.max(DAILY_FREE_AI_CALLS - usedToday, 0),
    credits: Number(user.credits || 0),
    totalRemaining: Math.max(DAILY_FREE_AI_CALLS - usedToday, 0) + Number(user.credits || 0),
    coachDailyLimit: DAILY_FREE_COACH_CALLS,
    coachUsedToday: Number(user.dailyCoachUsage[day] || 0),
    coachRemaining: Math.max(DAILY_FREE_COACH_CALLS - Number(user.dailyCoachUsage[day] || 0), 0)
  };
}

function consumeCoachQuota(userId) {
  const user = ensureUser(userId);
  const quota = quotaFor(userId);
  if (quota.coachRemaining <= 0) {
    const error = new Error("今日 AI 关键追问次数已用完，仍可继续完成固定问答和最终蓝图");
    error.status = 402;
    error.quota = quota;
    throw error;
  }
  user.dailyCoachUsage[quota.date] = quota.coachUsedToday + 1;
  saveDb();
  return { source: "daily_coach", quota: quotaFor(userId) };
}

function consumeQuota(userId) {
  const user = ensureUser(userId);
  const quota = quotaFor(userId);
  if (quota.freeRemaining > 0) {
    user.dailyUsage[quota.date] = quota.usedToday + 1;
    saveDb();
    return { source: "daily_free", quota: quotaFor(userId) };
  }
  if (quota.credits > 0) {
    user.credits -= 1;
    saveDb();
    return { source: "activation_credit", quota: quotaFor(userId) };
  }
  const error = new Error("今日免费 AI 次数已用完，请输入激活码获取更多次数");
  error.status = 402;
  error.quota = quota;
  throw error;
}

function refundQuota(userId, source) {
  const user = ensureUser(userId);
  const day = todayKey();
  if (source === "daily_free" && user.dailyUsage[day] > 0) {
    user.dailyUsage[day] -= 1;
  }
  if (source === "activation_credit") {
    user.credits = Number(user.credits || 0) + 1;
  }
  if (source === "daily_coach" && user.dailyCoachUsage[day] > 0) {
    user.dailyCoachUsage[day] -= 1;
  }
  saveDb();
}

function normalizeActivationCodes() {
  ACTIVATION_CODES.forEach(raw => {
    const [code, countText] = raw.split(":");
    const cleanCode = String(code || "").trim();
    if (!cleanCode || db.activationCodes[cleanCode]) return;
    db.activationCodes[cleanCode] = {
      credits: Math.max(Number(countText || 5), 1),
      usedBy: null,
      usedAt: null
    };
  });
  saveDb();
}

function redeemActivationCode(userId, code) {
  normalizeActivationCodes();
  const cleanCode = String(code || "").trim();
  const record = db.activationCodes[cleanCode];
  if (!record) {
    throw Object.assign(new Error("激活码无效"), { status: 400 });
  }
  if (record.usedBy && record.usedBy !== userId) {
    throw Object.assign(new Error("激活码已被使用"), { status: 409 });
  }
  const user = ensureUser(userId);
  if (!record.usedBy) {
    record.usedBy = userId;
    record.usedAt = new Date().toISOString();
    user.credits = Number(user.credits || 0) + Number(record.credits || 0);
    saveDb();
  }
  return quotaFor(userId);
}

function logUsage(entry) {
  db.usageLogs.push({
    createdAt: new Date().toISOString(),
    ...entry
  });
  if (db.usageLogs.length > 5000) {
    db.usageLogs.splice(0, db.usageLogs.length - 5000);
  }
  saveDb();
}

function statsSummary() {
  const today = todayKey();
  const todayLogs = db.usageLogs.filter(log => String(log.createdAt || "").startsWith(today));
  const successLogs = db.usageLogs.filter(log => log.status === "success");
  const totalCostUsd = successLogs.reduce((sum, log) => sum + Number(log.estimatedCostUsd || 0), 0);
  return {
    users: Object.keys(db.users).length,
    totalCalls: db.usageLogs.length,
    todayCalls: todayLogs.length,
    successCalls: successLogs.length,
    estimatedCostUsd: Number(totalCostUsd.toFixed(6)),
    latest: db.usageLogs.slice(-20).reverse()
  };
}

normalizeActivationCodes();

// Stats hold usage logs and anonymous ids. With STATS_TOKEN set they need that bearer token; without
// it, only a request made on the server itself (not one passed through the reverse proxy) may read them.
function canReadStats(req) {
  if (STATS_TOKEN) {
    const given = Buffer.from(String(req.headers.authorization || ""));
    const expected = Buffer.from(`Bearer ${STATS_TOKEN}`);
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
  }
  const address = req.socket.remoteAddress || "";
  return !req.headers["x-forwarded-for"] && ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address);
}

function corsHeaders(origin) {
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0] || "*";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
    "Access-Control-Allow-Headers": "Content-Type, X-Life-Design-User",
    "Vary": "Origin"
  };
}

function sendJson(res, status, payload, origin) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...corsHeaders(origin)
  });
  res.end(JSON.stringify(payload));
}

function requestUserId(req) {
  const headerId = sanitizeUserId(req.headers["x-life-design-user"]);
  if (headerId) return headerId;
  return "";
}

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded) return forwarded.split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}

function assertRateLimit(ip) {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    rateLimitBuckets.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return;
  }
  bucket.count += 1;
  if (bucket.count > RATE_LIMIT_MAX) {
    const retryAfterSeconds = Math.ceil((bucket.resetAt - now) / 1000);
    const error = new Error(`调用太频繁，请 ${retryAfterSeconds} 秒后再试`);
    error.status = 429;
    throw error;
  }
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("请求内容过大"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw Object.assign(new Error("请求体必须是 JSON 对象"), { status: 400 });
  }
  if (!payload.answers || typeof payload.answers !== "object") {
    throw Object.assign(new Error("缺少 answers 字段"), { status: 400 });
  }
}

const COACH_STEP_FOCUS = {
  coreProblem: "判断这个困扰里的重力问题、可设计问题，以及用户可能正在守住的安全策略。",
  lifeview: "对照工作观和人生观，指出一致线索或张力，不讨论具体职位。",
  energy: "拆开擅长、心流、回血和抽干，提醒一个可能的能量误判。",
  odyssey: "对三个五年版本做一次路线级追问，帮助用户选一个低成本原型。"
};

function validateCoachPayload(payload) {
  validatePayload(payload);
  if (!COACH_STEP_FOCUS[payload.stepId]) {
    throw Object.assign(new Error("这个步骤暂不支持 AI 关键追问"), { status: 400 });
  }
}

function buildUserPrompt(payload) {
  return [
    "以下是用户通过人生设计 H5 填写的结构化回答，以及当前固定模板生成的初版报告。",
    "请你不要简单复述初版报告，而是做更深入的重定义、矛盾识别和原型拆解。",
    "",
    "【结构化回答 JSON】",
    JSON.stringify(payload.answers, null, 2),
    "",
    "【问题雷达】",
    JSON.stringify(payload.problemRadar || {}, null, 2),
    "",
    "【固定模板初版报告】",
    payload.fixedReportText || "",
    "",
    "【关键追问和用户回应】",
    coachNotesText(payload.coachNotes),
    "",
    "请按系统提示输出 Markdown。"
  ].join("\n");
}

const STEP_NAMES = {
  dashboard: "四个仪表盘",
  coreProblem: "核心困扰",
  reverseConsent: "反向推演",
  reverseTuesday: "不改变的周二",
  workview: "工作观",
  lifeview: "人生观",
  flow: "心流时刻",
  energy: "能量",
  anchor: "执念",
  odyssey: "奥德赛计划"
};

// Earlier coach notes and the user's own replies to them, one line each.
function coachNotesText(notes) {
  if (!Array.isArray(notes) || !notes.length) return "（还没有）";
  return notes.slice(0, 8).map(note => {
    const name = STEP_NAMES[note?.stepId] || String(note?.stepId || "");
    const reply = limitText(note?.reply, 300);
    return `- ${name}：AI 的观察「${limitText(note?.headline, 30)}」；追问「${limitText(note?.question, 90)}」；用户回应：${reply ? `「${reply}」` : "（未回应）"}`;
  }).join("\n");
}

function buildCoachPrompt(payload) {
  const context = payload.context && typeof payload.context === "object" ? payload.context : {};
  return [
    "你正在一个中文 H5 里扮演斯坦福人生设计师。现在只做一次关键节点追问，不要写完整报告。",
    "你的任务：温暖但犀利地指出一个关键观察，再给一个追问和一个低成本原型动作。",
    "你能看到用户在前面几站的回答，以及之前的追问和用户的回应。如果本步的回答和前面的内容有呼应或矛盾，优先把这条线点出来，可以引用用户自己的原话（不超过 15 个字）。不要重复之前已经问过的追问。",
    "如果用户文字里有明显的绝望、自伤或轻生信号，不做人生设计分析：safety 写 \"support\"，headline 和 reflection 只做温和的接住，question 问用户身边有没有可以马上联系的人；其他情况 safety 写 \"ok\"。",
    "必须输出严格 JSON，不要 Markdown，不要代码块。",
    "JSON 字段固定为：headline, reflection, question, prototype, watchout, safety。",
    "长度限制：headline 不超过 18 个汉字；reflection 不超过 90 个汉字；question 不超过 70 个汉字；prototype 不超过 70 个汉字；watchout 不超过 60 个汉字。",
    "",
    `【当前步骤】${STEP_NAMES[payload.stepId] || payload.stepId}`,
    `【本步关注】${COACH_STEP_FOCUS[payload.stepId]}`,
    "",
    "【本步回答 JSON】",
    JSON.stringify(payload.answers || {}, null, 2),
    "",
    "【此前各站的回答 JSON】",
    JSON.stringify(context.earlierAnswers || {}, null, 2),
    "",
    "【此前的关键追问和用户回应】",
    coachNotesText(context.earlierCoach),
    "",
    "【问题雷达】",
    JSON.stringify(payload.problemRadar || {}, null, 2)
  ].join("\n");
}

async function requestChatCompletion({ messages, temperature = 0.72, maxTokens }) {
  if (!AI_API_KEY) {
    throw Object.assign(new Error("服务器未配置 AI_API_KEY"), { status: 500 });
  }

  const body = {
    model: AI_MODEL,
    temperature,
    messages
  };
  if (maxTokens) body.max_tokens = maxTokens;

  const response = await fetch(`${AI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${AI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.error?.message || data.message || `模型接口返回 ${response.status}`;
    throw Object.assign(new Error(message), { status: response.status });
  }
  return data;
}

async function callModel(payload) {
  const data = await requestChatCompletion({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(payload) }
    ],
    temperature: 0.72
  });

  const analysisMarkdown = data.choices?.[0]?.message?.content || "";
  if (!analysisMarkdown.trim()) {
    throw Object.assign(new Error("模型没有返回分析内容"), { status: 502 });
  }

  return {
    analysisMarkdown,
    model: data.model || AI_MODEL,
    usage: data.usage || null
  };
}

function parseJsonObject(text) {
  const raw = String(text || "").trim();
  const unfenced = raw.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(unfenced.slice(start, end + 1));
  } catch (error) {
    return null;
  }
}

function limitText(value, maxLength) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeCoach(raw, fallbackText) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    headline: limitText(source.headline || "关键追问", 18),
    reflection: limitText(source.reflection || fallbackText || "这里值得再停一下：真正的问题可能不在表层选项，而在你一直试图保护的东西。", 120),
    question: limitText(source.question || "如果只允许你改变一个最小动作，你会先动哪一块？", 90),
    prototype: limitText(source.prototype || "找一位相关经历的人聊 20 分钟，只问真实一天、代价和转折点。", 90),
    watchout: limitText(source.watchout || "不要把一次原型误读成终身决定。", 70),
    safety: source.safety === "support" ? "support" : "ok"
  };
}

// ---------- safety ----------
// Plain signals of hopelessness or self-harm. When one appears, the service answers with support and
// help lines instead of life-design advice, without calling the model or spending the user's quota.
// The same list lives in index.html and planet/state.js for when this service can't be reached.
const RISK_PATTERN = /自杀|轻生|不想活|活不下去|活着没(?:有)?意思|活着没(?:有)?意义|结束(?:自己的)?生命|想死|去死|死了算了|不如死|自残|自伤|割腕|跳楼(?!价)|伤害自己/;
const SUPPORT_LINES = "全国心理援助热线 12356；北京心理危机研究与干预中心 010-82951332（24 小时）；如果有紧急危险，请立刻拨打 110 或 120，或者让身边信任的人陪着你。";

function hasRiskSignal(value) {
  return RISK_PATTERN.test(typeof value === "string" ? value : JSON.stringify(value || ""));
}

function supportCoach() {
  return {
    headline: "先照顾好你自己",
    reflection: "你写下的话里有很重的东西。人生设计可以先放一放，此刻你的感受更重要，你不需要一个人扛着。",
    question: "现在身边有没有一个你可以马上联系的人？",
    prototype: `今天先做一件事：联系一个信任的人，或拨打心理援助热线。${SUPPORT_LINES}`,
    watchout: "如果这只是一句随口的话，可以忽略这段，继续往下走。",
    safety: "support"
  };
}

function supportMarkdown() {
  return [
    "## 先照顾好你自己",
    "",
    "你写下的回答里，有一些很重的话。在这种时候，人生设计、五年计划都可以先放一放，你此刻的感受更重要。",
    "",
    "如果你现在很难受，或者有伤害自己的念头，请先找人一起扛：",
    "",
    "- 全国心理援助热线：12356",
    "- 北京心理危机研究与干预中心：010-82951332（24 小时）",
    "- 有紧急危险时：立刻拨打 110 或 120，或者让身边信任的人陪着你",
    "",
    "等你感觉稳一些，这份蓝图随时可以再生成。如果那只是一句随口的话，把那一句改写之后再生成就好。"
  ].join("\n");
}

async function callCoachModel(payload) {
  const data = await requestChatCompletion({
    messages: [
      {
        role: "system",
        content: "你是人生设计 H5 的关键节点教练。只输出可解析 JSON，不输出 Markdown。"
      },
      { role: "user", content: buildCoachPrompt(payload) }
    ],
    temperature: 0.55,
    maxTokens: 520
  });
  const content = data.choices?.[0]?.message?.content || "";
  if (!content.trim()) {
    throw Object.assign(new Error("模型没有返回关键追问内容"), { status: 502 });
  }
  const coach = normalizeCoach(parseJsonObject(content), content);
  // The model judged this a moment for support: keep its words, but always give the help lines.
  if (coach.safety === "support") {
    const fixed = supportCoach();
    coach.prototype = fixed.prototype;
    coach.watchout = fixed.watchout;
  }
  return {
    coach,
    model: data.model || AI_MODEL,
    usage: data.usage || null
  };
}

async function handleAnalyze(req, res, origin) {
  const ip = clientIp(req);
  const userId = requestUserId(req);
  if (!userId) {
    sendJson(res, 400, { error: "缺少匿名用户 ID" }, origin);
    return;
  }
  assertRateLimit(ip);
  const body = await readRequestBody(req);
  const payload = JSON.parse(body || "{}");
  validatePayload(payload);
  if (hasRiskSignal([payload.answers, payload.coachNotes])) {
    logUsage({ feature: "deep_report", userId, ipHash: ipHash(ip), status: "support" });
    sendJson(res, 200, { analysisMarkdown: supportMarkdown(), model: "safety-check", safety: "support", quota: quotaFor(userId) }, origin);
    return;
  }
  const startedAt = Date.now();
  const consumed = consumeQuota(userId);
  try {
    const result = await callModel(payload);
    const estimatedCostUsd = estimateCostUsd(result.usage);
    logUsage({
      feature: "deep_report",
      userId,
      ipHash: ipHash(ip),
      model: result.model,
      quotaSource: consumed.source,
      status: "success",
      usage: result.usage,
      estimatedCostUsd,
      latencyMs: Date.now() - startedAt
    });
    sendJson(res, 200, { ...result, quota: consumed.quota, estimatedCostUsd }, origin);
  } catch (error) {
    refundQuota(userId, consumed.source);
    logUsage({
      feature: "deep_report",
      userId,
      ipHash: ipHash(ip),
      model: AI_MODEL,
      quotaSource: consumed.source,
      status: "failed",
      error: error.message || "模型调用失败",
      latencyMs: Date.now() - startedAt
    });
    throw error;
  }
}

async function handleCoach(req, res, origin) {
  const ip = clientIp(req);
  const userId = requestUserId(req);
  if (!userId) {
    sendJson(res, 400, { error: "缺少匿名用户 ID" }, origin);
    return;
  }
  assertRateLimit(ip);
  const body = await readRequestBody(req);
  const payload = JSON.parse(body || "{}");
  validateCoachPayload(payload);
  // This step's own input and the user's replies to earlier questions; an earlier answer that raised a
  // signal was already met with support at its own step.
  if (hasRiskSignal([payload.answers, (payload.context?.earlierCoach || []).map(note => note?.reply)])) {
    logUsage({ feature: "coach_step", stepId: payload.stepId, userId, ipHash: ipHash(ip), status: "support" });
    sendJson(res, 200, { coach: supportCoach(), model: "safety-check", quota: quotaFor(userId) }, origin);
    return;
  }
  const startedAt = Date.now();
  const consumed = consumeCoachQuota(userId);
  try {
    const result = await callCoachModel(payload);
    const estimatedCostUsd = estimateCostUsd(result.usage);
    logUsage({
      feature: "coach_step",
      stepId: payload.stepId,
      userId,
      ipHash: ipHash(ip),
      model: result.model,
      quotaSource: consumed.source,
      status: "success",
      usage: result.usage,
      estimatedCostUsd,
      latencyMs: Date.now() - startedAt
    });
    sendJson(res, 200, { ...result, quota: quotaFor(userId), estimatedCostUsd }, origin);
  } catch (error) {
    refundQuota(userId, consumed.source);
    logUsage({
      feature: "coach_step",
      stepId: payload.stepId,
      userId,
      ipHash: ipHash(ip),
      model: AI_MODEL,
      quotaSource: consumed.source,
      status: "failed",
      error: error.message || "模型调用失败",
      latencyMs: Date.now() - startedAt
    });
    throw error;
  }
}

async function handleRedeem(req, res, origin) {
  const userId = requestUserId(req);
  if (!userId) {
    sendJson(res, 400, { error: "缺少匿名用户 ID" }, origin);
    return;
  }
  const body = await readRequestBody(req);
  const payload = JSON.parse(body || "{}");
  const quota = redeemActivationCode(userId, payload.code);
  sendJson(res, 200, { ok: true, quota }, origin);
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || "";

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders(origin));
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    sendJson(res, 200, { ok: true, model: AI_MODEL }, origin);
    return;
  }

  if (req.method === "GET" && req.url === "/api/quota") {
    const userId = requestUserId(req);
    if (!userId) {
      sendJson(res, 400, { error: "缺少匿名用户 ID" }, origin);
      return;
    }
    sendJson(res, 200, { ok: true, quota: quotaFor(userId) }, origin);
    return;
  }

  if (req.method === "POST" && req.url === "/api/redeem-code") {
    try {
      await handleRedeem(req, res, origin);
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message || "服务器错误" }, origin);
    }
    return;
  }

  if (req.method === "GET" && req.url === "/api/stats") {
    if (!canReadStats(req)) {
      sendJson(res, 401, { error: "需要统计令牌" }, origin);
      return;
    }
    sendJson(res, 200, { ok: true, stats: statsSummary() }, origin);
    return;
  }

  if (req.method === "POST" && req.url === "/api/analyze-life-design") {
    try {
      await handleAnalyze(req, res, origin);
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message || "服务器错误" }, origin);
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/coach-step") {
    try {
      await handleCoach(req, res, origin);
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message || "服务器错误", quota: error.quota || null }, origin);
    }
    return;
  }

  sendJson(res, 404, { error: "Not found" }, origin);
});

server.listen(PORT, HOST, () => {
  console.log(`Life Design AI backend listening on http://${HOST}:${PORT}`);
});
