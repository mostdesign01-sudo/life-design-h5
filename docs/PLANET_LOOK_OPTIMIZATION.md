# 小星球画面感优化报告

> 参考对象：littleprince.dev（Sac，《小王子：星辰之旅》）、MMMvinki/little-prince-planet-world、tingaidehua/little-prince-b612
> 评审方式：本地实机跑图 + 代码级定位 + 逐条验证（运行时补丁只在浏览器里，未改任何文件）

## 结论先行

问题不在"美术不够"或"模型不够精细"，而在三处**管线级的断裂**：

1. 天空着色器里有一行反序 `smoothstep`（GLSL 未定义行为），把黄昏渐变整片压成了同一个奶油色；
2. 全场景没有 `scene.environment`，所以所有材质（尤其是水）都在用"塑料"的方式接光；
3. 每个道具脚下的"泥土圈"比草地**更亮**，接触阴影贴片又被球面裁掉一半——这是"贴纸感/悬浮感"的真正来源。

前两条各 30 分钟以内，第三条 2 小时，做完画面会换一个档。

---

## ① 当前画面问题的诊断

| # | 症状 | 根因（代码位置） | 验证 |
|---|---|---|---|
| **D1** | 天空是一整块奶油色，没有蓝、没有晚霞、没有云、没有太阳 | `sky.js:133` `smoothstep(0.0, -0.25, h)` 参数反序（GLSL 未定义行为）→ 在 Metal/ANGLE 上恒返回 1 → 整片天 = `uBottom` | 运行时把 `uTop/uMid/uHorizon/uBottom` 改成红/绿/蓝/黄，只留天空渲染：整屏 255,255,32（纯 `uBottom` 黄）。改回 `1.0 - smoothstep(-0.25, 0.0, h)` 后立刻出现紫→粉→蜜桃的渐变 |
| **D2** | 无论如何配色，主镜头里都看不到"天空的上面" | 所有机位俯视 28°（intro `orbit.pitch = 0.5`）到 38°（`main.js:1031 ELEVATION`），FOV 34°。画面顶端仍在水平线**以下** 11°，太阳在水平线以上 18.6°——**太阳永远在画外** | 实拍：天空占画面 1/3 全是米白；相机贴地立刻能看到蓝色渐变，证明渐变本身是好的，是机位把它挡在画外 |
| **D3** | 全场景像哑光塑料，水像奶白色塑料片 | `props.js:10` 每个材质都写了 `envMapIntensity: 0.45`，但全项目没有 `scene.environment`——没有 IBL，`envMapIntensity` 完全无效 | 代码确认；水 `roughness 0.08 / metalness 0.15` 却没有任何东西可反射 |
| **D4** | 每个道具像站在一块"亮盘子"上 | `ground.js:48` `col = mix(col, dirt*0.92, apron*0.85)`，而 `dirt = (0.851,0.725,0.541)` 的明度**远高于**草地 `(0.44,0.63,0.27)` | 放大截图：木屋/长椅/灯柱/藤/泉各自脚下一块边界明显的浅米色椭圆。这是"贴纸感"最大来源，比缺 AO 更致命 |
| **D5** | 接触阴影"有一点点但很生硬、像贴片" | `props.js:28 addBlob` 用 `PlaneGeometry` 平铺在球面上，`y=0.025`。球面下垂量 `r²/2R`：半径 0.85 的圆盘边缘在切面下 0.082，整圈被深度裁掉，实际只显示到 r≈0.47 | 数学可验；视觉上是"深色圆点 + 一条硬切口" |
| **D6** | 水面像一块磨砂奶白贴片 | `props.js` 水面 `totalEmissiveRadiance += uHaze * fres * (0.15 + 0.35h)`，`fres = pow(1-dot(N,V), 3.0)` 且带 0.15 常数基线——整片水无条件糊一层白雾；同时水面 `y = 0.04` 高于岸石底部 | 近景截图：水面灰白，无蓝无反射 |
| **D7** | 烟是球体堆叠 | `props.js` 烟用 28 个 `IcosahedronGeometry(0.11,2)` 实例，没有软边贴图、没有排序、没有噪声 | 截图可见清晰圆球轮廓 |
| **D8** | 画面有"廉价噪点/脏"感 | ① `look.js:65` 全屏动态颗粒 `hash(vUv*900 + uTime)*0.012`——每帧在变，是视频噪点不是纸纹；② `ground.js:37` `vnoise(d*18.0)*0.04` 单频高频斑 | 草地呈"细密砂砾"质感 |
| **D9** | "每答一题星球变化"只体现在颜色上 | `world.js` 里太阳方向 `SUN` 是常量，`setMood` 只改颜色和强度；`sun.position` 从不移动 | 0 分和 10 分截图里光影方向完全一致 |

**核对后删掉的两条判断：**

- ~~"阴影太硬"~~：实际是 `VSMShadowMap` + `radius 6` + `blurSamples 12`，已经够柔。真正的问题是**接地关系断了**（D4+D5）。
- ~~"没有 bloom / 没有后处理"~~：管线是全的（HDR multisample → UnrealBloom 0.42 → ACES + tilt-shift + grain）。问题是**高光太暗达不到 bloom 阈值**（`threshold 0.97`，灯/窗 emissive 只有 0.9–2.0，曝光 0.95）。

---

## ② 从 littleprince.dev / 参考项目能借什么

### 能借的视觉语言

| 手法 | 参考图里的样子 | 怎么落地 |
|---|---|---|
| **冷暖对冲**：冷背景 + 暖主体 | keyart 用深蓝夜空托住暖黄星球 | 天空顶部压到 `#6b6bb0` 紫蓝，草地自然前移 |
| **单一强光源 + 明确方向** | 一眼看出光从左上 | 让太阳圆盘落在星球左上方空域 |
| **纸张质感做在屏幕层** | 水彩纸纹全图统一 | grain 改静态、低频、0.006 |
| **色块化：纯色 + AO，少贴图噪点** | 参考项目全是纯色 + 环境光遮蔽 | 地面高频噪声要减，不是加 |
| **道具沿法线"长"出来** | 每个物件底部一圈自然变暗 | 现在底部是**变亮**，要改成压暗 + 脏边 |
| **留白与负空间** | keyart 星球偏右 2/3 | intro 试 55/45 偏置 |
| **星球边缘稀薄大气 + 轮廓光** | keyart 边缘一圈亮边把星球分离 | `buildAtmosphere` 强度 0.28–0.46 太弱，颜色应用太阳色 |

### 借不了的管线

| Sac 的流程 | 为什么不建议 |
|---|---|
| T-pose 四视图 → Tripo → Blender 绑骨 → Mixamo → IK | 旅行者是程序化拼的，换真骨骼动画要重写一整块，收益远小于成本 |
| 每个道具单独高质量生成 | 6 个 stop + 11 棵树 + 26 丛灌木，资产数量够了，问题在光照和接地 |
| Blender 烘焙 AO/光照贴图 | 球面 + 程序化布局，烘焙比 shader 贵 10 倍；ground shader 的 apron AO 一下午就能拿到同样效果 |
| 参考图先行 + 固定色板 | **值得借，零成本**：把 keyart 当调色参照 |
| 固定三机位验收循环 | **值得借**：加固定机位基准图才能像素级对比 |

---

## ③ 按性价比排序的优化清单

### P0-1　修天空（收益★★★★★ / 30 分钟）

1. `sky.js:133` 改成 `col = mix(col, uBottom, 1.0 - smoothstep(-0.28, -0.04, h));`
2. 按可见区间重分配渐变：`float hz = h + 0.26;` 再用 `smoothstep(-0.06, 0.20, hz)` / `smoothstep(0.20, 0.58, hz)` / `1.0 - smoothstep(-0.30, -0.06, hz)` 三段混合。
3. 色板往黄昏推一档：`day` 保持 top `#5b73c8` / mid `#8fb4e8` / horizon `#ffd9a8`；新增 `golden`（play>0.75）：top `#7a6fc0` / mid `#f2a184` / horizon `#ffb072`。
4. 太阳独立于光照：sky 加 `uSunDiscDir`（`y≈0.06`，方位跟 `SUN.xz`），光照仍用 `SUN`——光从左上打进来，同时画面上方有空中的低垂太阳。

**动**：`planet/sky.js`
**验收**：intro 截图天空出现"上紫蓝 → 中蜜桃 → 下暖橙"三段，太阳圆盘在星球左上方可见。

### P0-2　接地三件套（收益★★★★★ / 1.5–2 小时）

**(a) `addBlob` 贴合球面**（`props.js:28`）
```js
const geo = new THREE.CircleGeometry(radius, 40);
const p = geo.attributes.position;
for (let i = 0; i < p.count; i++) {
  const x = p.getX(i), y = p.getY(i);
  const r2 = x * x + y * y;
  p.setZ(i, 0.014 - r2 / (2 * R));
}
geo.rotateX(-Math.PI / 2);
geo.computeVertexNormals();
```
同时 `blobTexture()` 渐变改两层（中心 0.7 → 0.45 处 0.22 → 边缘 0），叠一点正弦扰动做不规则边。

**(b) apron 从"提亮"改成"压暗+脏边"**（`ground.js:44-49`）
```glsl
float k = 1.0 - smoothstep(aprons[i].w * 0.45, aprons[i].w, chordTo(d, aprons[i].xyz));
col = mix(col, dirt * 0.74, k * 0.55);
col *= 1.0 - 0.22 * (1.0 - smoothstep(0.0, aprons[i].w * 0.9, chordTo(d, aprons[i].xyz)));
```
`dirt` 从 `(0.851,0.725,0.541)` 降到 `(0.62,0.52,0.38)`，边缘叠 `vnoise(d*90)` 打碎边界。

**(c)** 泉水 apron 半径 ×1.5、颜色 ×0.8，做"湿土"。

**动**：`props.js`、`look.js`（`blobTexture`）、`ground.js`

### P0-3　开 IBL（收益★★★★★ / 1.5 小时）

`world.js` 里 `buildSky` 之后用 `PMREMGenerator.fromScene` 烘天空球成环境图，赋给 `scene.environment`；`setMood` 后节流重烘（play 变化 >0.04 且 400ms 防抖）。配套：水 `envMapIntensity 1.1` / `roughness 0.06`；树冠草地 0.35；房石木 0.5。

**验收**：泉水近景能看到天空的暖色反射和地平线亮带；所有物体暗部从"灰黑"变"偏蓝紫"。

### P1-4　水三重修正（★★★★ / 1 小时）
`fres` 改 `pow(...,5.0)` 并删 0.15 常数基线；岸线湿土过渡；`water.position.y` 0.04 → -0.005 让岸石压住水面；波纹法线 0.08/0.06 → 0.14/0.10，中心加常驻低频泉眼扩散环。

### P1-5　烟：球堆 → 软片（★★★☆ / 1.5 小时）
`smokeMaterial` 加 `alphaMap: softTexture()`；alpha 曲线换 `smoothstep(0,0.15,k)*(1-smoothstep(0.55,1.0,k))`；每个 puff 随机朝向 + 生命期内缓慢自转；尺寸 `0.7 + 3.2*pow(k,0.55)`；顶点着色器加 `sin(k*6+seed)` 横向摆动。不够软再换 billboard quad。

### P1-6　去噪：视频噪点 → 纸（★★★★ / 20 分钟）
`look.js:65` `hash(vUv*900 + uTime)*0.012` → `hash(vUv*420)*0.0055`（去掉 uTime）；`ground.js:37` 拆成 `vnoise(d*5.5)*0.055 + vnoise(d*26.0)*0.012`；`look.js:13` `uBlur 2.2 → 1.6`。

### P2-7　构图与大气（★★★★ / 1 小时）
`orbit.pitch 0.5 → 0.40`，天空占 45%；大气强度 0.55+vivid*0.25，颜色混 30% 太阳色；地面 haze 改 `pow(1-dot(N,V),2.0)*0.35`，星球下缘融进背景。

### P2-8　让太阳真的动（★★★★ / 1 小时）
`sunElev = lerp(0.10, 0.42, play)`，`sun.position = dir(SUN.xz, sunElev)*28`，sky `uSunDir` 同步；`hemi.intensity` `lerp(1.35, 0.85, play)`——0 分和 10 分的光影方向明显不同。

### P2-9　人物与背包（★★★ / 40 分钟）
`pack.scale 0.86`、`position.z -0.155`；加两条绕肩的 `taperedTube` 肩带（半径 0.02→0.016，色 `0x5f5236`）；包体贴背一面压暗 0.8。

### P3-10（可选）引入 glTF
只建议旅行者：`GLTFLoader` + 8k 面低模 + 顶点色，`vendor/models/traveler.glb`，保留现有 `legs/arms/head` 接口名，动画仍代码驱动。收益 ★★☆ / 1–2 天。

### 不要做
- 不要加全屏 SSAO：球面 + 薄草叶上全是噪点和漏光，成本 > 收益。
- 不要给道具加更多贴图：现在是噪点太多，不是太少。
- 不要换渲染器/引擎：瓶颈在光照，不在资产精度。

---

## ④ 最小改造顺序

1. **天空（P0-1）** 30 分钟 —— 只改 `sky.js` 3 行 + `MOODS`。若不见太阳，只调 `orbit.pitch` 0.5→0.44。
2. **接地三件套（P0-2）** 2 小时 —— 验收：道具脚下不再有米色圆盘，缩小到 390 宽仍成立。
3. **IBL（P0-3）** 1.5 小时 —— 验收：泉水映出天空；暗部偏蓝紫。过曝就把 `envMapIntensity` 降到 0.3。

之后：去噪（20 分钟）→ 水 → 烟 → 构图大气 → 太阳驱动分数 → 背包。

### 验收方法（借 Sac 的循环）
`scripts/` 加固定三机位截图脚本（Playwright + `window.__planet` 的 `goTo/setOverview`）：A intro 首帧（1280×800 + 390×844）、B overview、C spring 近景。每轮只改前三项 → 同机位重拍 → 三张并排看。第一轮看位置比例和接地，第二轮看遮挡与明暗层次，第三轮才看材质。

---

**一句话**：先修那行 `smoothstep` 和那块比草地还亮的泥土地，再给场景一盏"天空"——不到四小时，但决定了后面所有美术调参是否值得做。
