# AI 后端服务

这是给阿里云轻量服务器准备的最小 Node.js 后端。它只做一件事：接收 H5 里的结构化回答，调用 OpenAI 兼容的模型接口，返回一份 Markdown 版 AI 深度蓝图。

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
- 第一版只在最终报告处调用一次 AI，不做逐题实时调用
- API Key 只保存在服务器环境变量里，不要写进前端或 GitHub
