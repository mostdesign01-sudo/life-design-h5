# AI 后端服务

这是给阿里云轻量服务器准备的最小 Node.js 后端。它接收 H5 里的结构化回答，调用 OpenAI 兼容的模型接口，返回关键节点短追问或 Markdown 版 AI 深度蓝图。

## 要求

- Node.js 18 或更高版本
- 一个 OpenAI 兼容的模型 API Key

## 本地启动

```bash
cd server
cp .env.example .env
```

编辑 `.env` 后启动：

```bash
set -a
source .env
set +a
node index.js
```

健康检查：

```bash
curl http://127.0.0.1:8787/health
```

## 阿里云轻量服务器部署建议

1. 安装 Node.js 18+
2. 上传整个仓库，或至少上传 `server/` 和 `prompts/`
3. 配置 `.env`
4. 用 `pm2` 或 systemd 守护 `node server/index.js`
5. 用 Nginx 反向代理到 `127.0.0.1:8787`
6. 给域名配置 HTTPS

Nginx 反代示例：

```nginx
location /api/ {
  proxy_pass http://127.0.0.1:8787;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}

location /health {
  proxy_pass http://127.0.0.1:8787;
}
```

前端 H5 里点击“AI 接口”，填入：

```text
https://你的域名/api/analyze-life-design
```

## 成本控制

- 默认每个 IP 每小时最多 20 次
- 默认每个浏览器每天免费 4 次 AI 关键追问
- 默认每个浏览器每天免费 1 次 AI 深度蓝图
- 默认按北京时间自然日计算每日额度
- 超出深度蓝图免费次数后，需要激活码增加可用次数
- 关键追问只返回短 JSON，避免逐题长篇分析导致成本失控
- API Key 只保存在服务器环境变量里，不要写进前端或 GitHub

## 激活码

在 `.env` 里配置激活码：

```bash
DAILY_FREE_AI_CALLS=1
DAILY_FREE_COACH_CALLS=4
QUOTA_TIMEZONE_OFFSET_MINUTES=480
ACTIVATION_CODES=FRIEND2026:5,SEEDUSER2026:20
```

上线前请把示例码换成随机、不容易猜到的字符串。

含义：

- `FRIEND2026:5`：兑换后给当前浏览器增加 5 次 AI 调用
- `SEEDUSER2026:20`：兑换后增加 20 次

激活码默认只能被一个浏览器匿名用户兑换一次。适合先手动发给朋友或种子用户。

## 使用次数与日志

后端会在 `server/data/usage-db.json` 里记录：

- 匿名浏览器用户
- 每日免费次数使用情况
- 激活码兑换情况
- AI 调用日志
- 模型 tokens
- 估算成本
- 成功 / 失败状态
- 响应耗时

查看汇总：

```bash
curl http://127.0.0.1:8787/api/stats
```

第一版默认不保存用户回答原文，只保存调用统计和成本信息。后续如果要“保存我的蓝图”，建议做成用户明确选择的功能。
