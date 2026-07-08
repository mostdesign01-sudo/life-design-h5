# AI 深度蓝图接入方案

## 目标

当前 H5 已经能完成结构化问答和固定模板报告。AI 接入的目标不是替代这套结构，而是在用户完成材料收集后，生成更细的洞察：

- 更准确地重定义真问题
- 识别重力问题与可设计问题
- 点出语言与行为之间的矛盾
- 重写三个奥德赛计划
- 给出 90 天原型验证计划

## 推荐产品形态

第一版采用“最终分析一次调用”：

1. 用户完成 H5 问答；
2. H5 生成固定模板蓝图；
3. 用户点击“AI 深度蓝图”；
4. 前端把结构化回答和固定报告发给后端；
5. 后端调用模型；
6. 返回 Markdown；
7. H5 展示 AI 深度蓝图，并支持复制、下载。

暂时不做逐题 AI 对话，因为逐题调用成本更高、延迟更明显，也更容易让流程失控。

## 技术架构

```text
GitHub Pages H5
  -> POST https://你的域名/api/analyze-life-design
  -> 阿里云轻量服务器 Node.js 后端
  -> OpenAI 兼容模型 API
```

API Key 只放在服务器环境变量中，不进入前端和 GitHub。

## 前端配置

线上 H5：

```text
https://mostdesign01-sudo.github.io/life-design-h5/
```

点击“AI 接口”，填入后端地址：

```text
https://你的域名/api/analyze-life-design
```

## 后端接口

`POST /api/analyze-life-design`

请求体：

```json
{
  "version": "life-design-h5-v1",
  "answers": {},
  "problemRadar": {},
  "fixedReportText": "",
  "request": {
    "goal": "请基于结构化回答生成一份更深入、更具体、更个性化的个人人生设计蓝图。"
  }
}
```

返回：

```json
{
  "analysisMarkdown": "## 一句话看见你\n...",
  "model": "gpt-4.1-mini",
  "usage": {}
}
```

## 成本控制

- 每个用户最后只调用一次；
- 后端内置简单 IP 限流；
- 可以优先使用性价比模型；
- 后续再根据效果决定是否加逐题追问。

## 风险边界

- 不做医疗、法律、金融等专业判断；
- 不承诺人生决策正确；
- 不上传或长期存储用户回答；
- 如果未来要做账号和历史记录，需要另行设计隐私策略。
