const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

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

const rateLimitBuckets = new Map();
const promptPath = path.join(__dirname, "..", "prompts", "life-design-system-prompt.md");
const SYSTEM_PROMPT = fs.readFileSync(promptPath, "utf8");

function corsHeaders(origin) {
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0] || "*";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
    "Access-Control-Allow-Headers": "Content-Type",
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
    "请按系统提示输出 Markdown。"
  ].join("\n");
}

async function callModel(payload) {
  if (!AI_API_KEY) {
    throw Object.assign(new Error("服务器未配置 AI_API_KEY"), { status: 500 });
  }

  const response = await fetch(`${AI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${AI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: AI_MODEL,
      temperature: 0.72,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(payload) }
      ]
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.error?.message || data.message || `模型接口返回 ${response.status}`;
    throw Object.assign(new Error(message), { status: response.status });
  }

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

async function handleAnalyze(req, res, origin) {
  assertRateLimit(clientIp(req));
  const body = await readRequestBody(req);
  const payload = JSON.parse(body || "{}");
  validatePayload(payload);
  const result = await callModel(payload);
  sendJson(res, 200, result, origin);
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

  if (req.method === "POST" && req.url === "/api/analyze-life-design") {
    try {
      await handleAnalyze(req, res, origin);
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message || "服务器错误" }, origin);
    }
    return;
  }

  sendJson(res, 404, { error: "Not found" }, origin);
});

server.listen(PORT, HOST, () => {
  console.log(`Life Design AI backend listening on http://${HOST}:${PORT}`);
});
