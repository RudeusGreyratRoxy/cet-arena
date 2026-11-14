# CET Arena

## 【AI 开发规约】

**任何 AI 或开发者在完成新任务、新增功能、修复 Bug 后，必须自动同步更新本 README.md 文件的相应列表，保持文档与代码同步，无需用户提醒。**

需要同步的位置：第 2 节功能列表、第 6 节项目结构、第 7 节实现要点、第 8 节验收清单、第 9 节常见问题。

**每次任务开始前，必须先读取 HANDOFF.md 了解进度；每次任务结束、提交代码前，必须更新 HANDOFF.md 里的进度和待办。**

**每次任务结束、提交代码前，必须在 HANDOFF.md 的「时间轴更新日志」节点顶部新增一行，格式固定为 `[YYYY-MM-DD HH:mm] 版本号 | 核心改动 | 遗留问题`（最新在最上）。这一条与上面的进度更新同等强制，无需用户提醒。**

---

仅限两位好友通过 6 位房间码实时对战的大学英语词汇竞技 Web 应用，附带免费单人「限时闯关」与 VIP 专属「错词挑战」两种单机玩法。当前重点建设 CET-4 核心词库与闯关关卡。

- 后端：Node.js + Express + Socket.IO
- 前端：原生 HTML / CSS / JavaScript 单页，无构建工具，移动端友好
- 数据：房间、比分、会话全部保存在服务端内存；词库为本地 JSON
- 房间：6 位房间码，最多 2 人；房主控制模式和词库范围，双方准备后开始
- 抢答：10 题，15 秒倒计时，先答对 +10 分，答错 −5 分并锁题，超时无人得分
- 竞速：25 题，双方独立进度，答错 1 秒冷却；一方完成后等待，双方都完成后按总用时、错误数结算
- 词库：2868 个 CET-4 单词，每个词包含多个带词性、词频权重的释义；CET-6 建设中
- 题型：50% 英译中、30% 中译英、20% 听音选词；10 题固定 5/3/2，25 题固定 5 道听音选词
- 发音：**本地 MP3**（`/audio/<word>.mp3`，微软神经网络语音 `en-US-JennyNeural`，24kHz 单声道 48kbps，平均 ~9KB/词，全量 ~26MB）。听音选词自动播放一次（失败时点喇叭兜底），英译中可点喇叭。**已彻底废弃 `speechSynthesis`**——HTTP 环境下 `secureContext=false`，多数手机浏览器直接禁用该 API。
- 声音唤醒：进入准备页/对局后，页面顶部会出现「🔊 点击唤醒声音」；点一下播放 0.5 秒静音 MP3 换取移动端播放权限，成功后自动消失。
- 音频强缓存：`/audio/` 走 `Cache-Control: public, max-age=31536000, immutable`，手机下过一次后一年内不再回源（服务器带宽仅 4M，这层很关键）。
- 联系站长：首页右下角悬浮按钮，点开可写最多 50 字留言；按 `device_token` 做**动态配额**——同一设备**同时最多 5 条「未处理」**留言，站长标记已处理或删除后额度自动归还；服务器落 `data/messages.json`；后台「留言管理」标签页可按时间倒序查看、标记已处理、删除。**站长可对单条留言写回复（最多 100 字）**，回复后该条自动转为「已处理」；用户在同一个弹窗的「我的留言」区能看到自己的留言与站长回复（只按设备 Token 的哈希反查，看不到他人留言）。
- 复盘：展示单词拼写、词性、完整释义、对错/未作答；答错后纠正的题仍标红；竞速另含双方进度、用时、错误数
- 错词本（**VIP 专属**）：答错的单词自动存入浏览器 localStorage；单人「错词挑战」只考错词，**连续答对 3 次**才移出；免费用户入口显示「VIP 专属」，服务端 `solo:start` 同步拦截
- 网络：顶部实时显示 Ping；>200ms 黄色、>500ms 红色；断线自动快速重连
- 站长后台：访问 `/admin` 输入站长密码进入。分「卡密管理」与「留言管理」两个标签页，留言标签带待处理数量红点。卡密表展示类型、状态、绑定 IP、绑定设备（Token 前 8 位）与绑定时间，支持搜索；可一键批量生成新码、对已绑定卡密一键解绑重置；留言按时间倒序展示，可标记已处理 / 删除、**写/修改站长回复**。适配手机浏览器。所有管理接口在服务端强制校验站长密码，未登录一律 401。
- 部署：单实例内存房间，支持本地运行、Cloudflare Quick Tunnel 与腾讯云 + PM2 公网部署

## 1. 快速开始

环境要求：**Node.js 18.17+**（含 npm）。

```bash
cd cet-arena
npm install
npm start
```

默认访问：<http://localhost:3000>

修改端口（可选）：

```powershell
# PowerShell
$env:PORT=3001; npm start
```

```bash
# macOS / Linux
PORT=3001 npm start
```

健康检查：<http://localhost:3000/healthz>

站长后台：<http://localhost:3000/admin>（本地开发默认密码 `boss2026`，可用环境变量 `ADMIN_PASSWORD` 覆盖）。**生产环境必须注入 `ADMIN_PASSWORD`，缺失或为空时服务会直接拒绝启动**（见 §4.6 与 §7）。

> 如果 `node -v` 或 `npm -v` 报“找不到命令”，请先从 <https://nodejs.org/> 安装 Node.js LTS，或使用系统已有的 Node 版本管理器。不要用来源不明的运行时替代。

### 1.1 关掉 DSH 后最快重启

DSH 关闭后，它启动的后台任务会结束；本地依赖已经安装好，通常不需要重新 `npm install`。开两个 PowerShell 窗口，都进入项目目录：

```powershell
cd C:\Users\Yuan\Documents\deepseek-harness\default-workspace\cet-arena
```

**窗口 1：启动本地服务**

```powershell
& "C:\Users\Yuan\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" server.js
```

看到 `CET Arena 已启动` 后，用浏览器确认 <http://localhost:3000/healthz> 返回 `ok`。
如果系统 PATH 中已有 Node/npm，也可以直接运行 `npm start`。

**窗口 2：启动公网隧道**

```powershell
.\.tools\cloudflared.exe tunnel --url http://localhost:3000 --no-autoupdate --protocol http2 --edge-ip-version 4
```

复制输出中的 `https://xxxx.trycloudflare.com` 地址发给好友。两个窗口都要保持开启；每次重启隧道都会生成新域名，旧链接立即失效。

如果 `node_modules` 丢失，使用本机自带的 pnpm 恢复依赖：

```powershell
$env:CI="true"
& "C:\Users\Yuan\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" "C:\Users\Yuan\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs" install --shamefully-hoist
```

如果 `.tools/cloudflared.exe` 丢失，运行 `powershell -ExecutionPolicy Bypass -File .\scripts\start-tunnel.ps1` 重新下载并启动。

## 2. 功能与规则

- 首页：填写昵称，创建房间，或输入 6 位数字房间码加入；首页底部另有「限时闯关」（免费）与「错词挑战」（VIP 专属）两个单人入口。
- 房主在房间准备页通过“词库范围”下拉框选择词库，默认 **CET-4 核心**。
- 当前已录入 **2868 个 CET-4 单词**；CET-6 词库尚未加入。
- 选择 CET-6 会提示“六级词库正在建设中，请先体验四级”，并保持 CET-4。
- 没有“混合词库”选项；一局只会使用所选范围的单词。
- 一个房间最多 2 人；第三人会收到“房间已满”。
- 双方都准备后，只有房主可以开始。
- 房间准备页由房主选择对战模式，双方可实时看到当前模式。
- **抢答模式（10 题）**：
  - 双方同题抢答，服务端 15 秒倒计时。
  - 先答对者 **+10 分**，本题立即结束。
  - 答错 **−5 分**，该玩家本题不能再答，对手仍可作答；超时无人得分。
  - 10 题后按总分结算。
- **竞速模式（25 题）**：
  - 双方同时开始，各自独立答同一套 25 题，互不干扰。
  - 答错时选中项标红，其他选项变灰禁用，答题区显示小字“冷却中 1.0s”；冷却期间服务端拒绝作答。
  - 答错后停留在当前题，1 秒冷却结束可继续作答；每次答错累计错误数。
  - 顶部实时显示双方进度，如“你 5/25，对手 3/25”。
  - 一方先完成 25 题后进入“已完成，等待对手作答…”等待状态，另一方继续正常答题。
  - 只有双方都完成 25 题后才统一结算；按总用时、错误数判定胜负。
- 两种模式都会混合出题：英译中 50%，中译英 30%，听音选词 20%。
- **单人限时闯关（免费体验）**：
  - 入口在首页「限时闯关」，进入关卡列表：第 1/2/3 关各 50 词，全部免费；第 4 关及后续显示灰色占位「第 4 关及后续关卡（开发中...）」，不可点击。
  - 每关固定 10 题，题目只从该关词库抽取；每题限时：**第 1 关 10 秒、第 2 关 7 秒、第 3 关 5 秒**。
  - 前端有倒计时数字与进度条，到 0 自动提交；**超时判定以服务端 deadline 为准**，迟到的答案一律按超时答错处理（超时不计分），前端改时钟无法骗分。
  - 结算展示本关题数、答对数、答错或超时数。
- **单人错词挑战（VIP 专属）**（首页入口，不需要房间、不需要对手）：
  - 免费用户入口显示「VIP 专属 · 激活后可用」，点击引导激活；服务端 `solo:start` 也会拒绝未激活连接（`VIP_REQUIRED`），绕过前端无效。
  - 只从错词本抽题，题型仍按 50/30/20 混合，干扰项来自全部词库；相邻两题不会重复同一个词。
  - 每个词必须**连续答对 3 次**才移出错词本；中途答错则该词连对计数清零、单词保留。
  - 界面显示剩余错词数、本轮已掌握数、已答题数，以及当前单词的 3 个连对圆点。
  - 错词全部掌握后显示总结（作答数、答对数、掌握数），可「再来一轮」或返回首页。
  - 错词本为空时点击入口提示「当前没有错词，快去打一局吧」，不进入挑战页。
- **英译中**：题干显示英文单词，选项显示带词性的中文释义，提示“选择正确的中文释义”；题干旁有喇叭按钮。
- **中译英**：题干显示带词性的最高频中文释义，选项显示四个纯英文单词，提示“选择正确的英文单词”。
- **听音选词**：题干区域只显示一个大喇叭，不显示英文单词或中文释义；题目出现后**自动播放一次**发音（浏览器拦截自动播放时，喇叭按钮会轻微跳动提示手动点击），选项为四个纯英文单词；作答后立即展示该单词的中文释义。
- 每局按 50/30/20 配额随机决定题型并打乱顺序：10 题固定 5 道英译中 + 3 道中译英 + 2 道听音选词；25 题固定 5 道听音选词，英译中 12/13 道、中译英 7/8 道随机，长期比例保持 50/30/20。
- 三种题型的单词都不重复，且干扰项来自其他单词。
- **发音**：**使用本地 MP3**，`/audio/<word>.mp3`，由 `new Audio()` 播放，**不再使用 `speechSynthesis`**（HTTP 下 `secureContext=false`，多数手机浏览器禁用该 API，曾是"手机没声音"的根因）。听音选词出题后自动播一次；自动播放被拦截时不弹错误，只让 🔊 按钮跳动引导手动点击；英译中可点喇叭。同一单词的 `<audio>` 元素会缓存复用，最多缓存 60 个。
- **答后释义**：听音选词作答后，选项下方展示「中文含义」卡片（如 `breast — n. 乳房；胸脯，胸膛`）——抢答模式在作答 ack 中即时返回，竞速模式在答错后的 1 秒冷却期展示，单人挑战答完即显示，下一题自动清除。
- **复盘**：始终展示单词拼写、词性、完整释义和你的对错/未作答标记；答错后纠正的题仍显示为答错。竞速复盘还包含双方进度、用时和错误数。
- **误词自动入库**：结算复盘渲染时，把「答错」或「曾答错后改正」的单词写入浏览器 localStorage（键 `cetArena.wrongBook.v1`），复盘标题会提示「N 个新错词已存入错词本」；重复答错不重复入库，但连对清零、错误次数 +1。错词本本身只对 VIP 开放。
- **首页更新公告**：站长在 `/admin` →「公告管理」发布（最多 500 字，保留换行，留空即下架）；首页顶部显示横幅（`textContent` 渲染 + `white-space: pre-wrap`，不解析 HTML）。前端按 `updatedAt` 去重：同一版本关闭后不再弹出，发布新版本才会再次出现。`GET /api/announcement` 公开且 `no-store`，`POST /api/admin/announcement` 需站长登录。
- **VIP 激活码闸门**：点「创建房间」或「加入房间」都会先弹同一个全屏激活码遮罩；**验证通过后既能建房也能加入**，未验证则两者都被拦截。遮罩内「查看套餐」进入价格页，提供三档：**孤狼独行 ￥19.9（1 个码）/ 双人成行 ￥29.9（2 个码）/ 宿舍开黑 ￥59.9（6 个码）**，点任一购买按钮只提示「支付通道维护中，请联系站长获取激活码」，**不接真实支付、不出现收款码**。验证成功写入 `localStorage`（键 `cetArena.vip.v1`），刷新后自动静默重验；首页底部有「清除激活状态」小字按钮，点击即清空本地激活态并刷新，便于换人使用。；所有套餐**有效期 1 年**，卡密输入框下方标注「⭐ 增值服务：专属定制卡密 +9.9元（需联系站长人工审核生成）」
- **关于我们**：首页 Footer 新增「关于我们」入口，点击弹出轻量模态框（复用留言弹窗的遮罩/卡片样式）；文案为静态常量，渲染只用 `textContent`，不拼 HTML。
- **一码一人**：每个普通激活码只能绑定一台设备。绑定主体是浏览器首次打开页面时生成并持久化在 `localStorage` 的 **device_token**，**不是 IP** —— 大学校园网普遍是 NAT，全校共用一个公网 IP，按 IP 绑定等于「一人买码、全校白嫖」。同一台设备换网络（宿舍 Wi-Fi ↔ 手机热点）照样放行，换设备一律提示「该卡密已绑定其他设备」。IP 只作为风控参考记录。房主建房后，加入者必须**自己**输入有效激活码，没有免码席位。`[已废弃-见环境变量]` 为专属码（现由环境变量 `VIP_UNLIMITED_CODES` 注入），不限次、不绑设备。**后台三种操作**：①「解绑 / 封禁」= 该码对**所有设备**立即失效（原设备进 `revokedDevices` 永久拉黑，且封禁期间**换任何设备/token 都绑不上**）；②「允许换机」= 封禁 → 未使用，**新设备**可重新激活，但原设备仍被永久拉黑；③「彻底删除」= 仅对运行时生成的码（`vip_codes.custom.json`）生效，删除后该码永久消失，种子码受保护。
- **选项着色**：答对时正确选项标绿、其余弱化；答错时错选标红、正确选项标绿。服务端只在**作答后**才下发 `correctIndex`，避免提前泄题。
- 刷新页面时，浏览器用 localStorage 中的 `sessionId` 自动尝试重连；失败则回首页。

## 3. 本地双人测试

用两个浏览器窗口（其中一个可用无痕窗口）测试，避免共用同一份 localStorage：

1. 窗口 A 打开 <http://localhost:3000>，输入昵称，点击“创建房间”。
2. 记下 6 位房间码，点击“复制邀请链接”。
3. 窗口 B 打开同一链接（或首页手动输入房间码），填写另一个昵称并加入。
4. 双方点击“准备”。
5. 房主在房间准备页查看/选择“词库范围”，选择模式，然后点击开始。

**抢答模式需要确认：**

- 完整答完 10 题，所有题目来自同一级别词库；
- 题型比例：10 题固定 5 道英译中 + 3 道中译英 + 2 道听音选词，且顺序随机；
- 英译中选项带词性，如 `v. 放弃；抛弃`，题干旁喇叭可发音；
- 中译英题干带词性，选项是四个纯英文单词；
- 听音选词只显示大喇叭，点击后才播放，选项为四个纯英文单词；
- 倒计时同步；先答对立即结束本题；
- 答错扣 5 分、本题锁定、对手仍可作答；
- 双方比分实时更新；
- 结算页显示胜负、分数，以及 10 个单词的复盘。

**竞速模式需要确认：**

- 题目总数为 25，双方进度独立，顶部同步显示 `你 5/25`、`对手 3/25`；
- 答错后选中项变红、其余选项变灰禁用，答题区显示 1 秒冷却提示；
- 1 秒后按钮恢复，可以继续当前题；
- 一方完成后显示等待提示，另一方继续作答；
- 双方都完成 25 题后才统一跳转结算页，按总用时、错误数判定胜负；
- 结算页显示双方进度、用时、错误数；
- 复盘列表包含 25 个单词、完整释义，以及你的答对/答错/未作答标记；答错后纠正的题显示为答错。

6. 对局中刷新其中一个窗口，确认自动回到原房间，进度和状态保留。

自动化本地回归：

```bash
npm test
```

该命令会运行十五套测试：

- `test/wrongbook.test.js`：错词本纯逻辑（入库、去重、连对、清零、掌握移除、脏数据容错）。
- `test/dom-contract.test.js`：`app.js` 引用的 DOM id 全部存在、脚本加载顺序正确。
- `test/solo-ui.test.js`：假 DOM 真跑前端脚本，覆盖错词写入、连对 3 次移除、选项着色、自动发音、答后释义、免费用户错词本锁定与第 4 关占位。
- `test/solo.test.js`：单人挑战服务端协议（VIP 闸门、出题范围、判分、退出、异常）。
- `test/trial.test.js`：限时闯关协议（关卡清单与限时、判分、超时与跳过计错、结算、VIP 闸门）。
- `test/e2e.test.js`：抢答模式完整 10 题、模式切换、比分、复盘、重连。
- `test/race.test.js`：竞速模式 25 题、双人独立进度、一方完成后等待、双方完成后结算、1 秒冷却锁题、复盘、再来一局。
- `test/mixed.test.js`：压力生成 3 万+ 道题，校验英译中/中译英/听音选词题干与选项零错配。
- `test/admin-ui.test.js`：假 DOM 真跑 `admin.js`，校验卡密列表渲染（拉黑数在 available/used/revoked 三种状态都必须显示）。
- `test/env-guard.test.js`：站长密码失效保护——`NODE_ENV=production` 且 `ADMIN_PASSWORD` 缺失或 trim 后为空时，子进程跑 `server.js` 必须以退出码 1 结束并在 stderr 给出明确提示；同时覆盖「完全未设置才回落本地默认值」「空白值抛错」两条解析规则。

（另有 `room-lifecycle`、`vip`、`admin`、`messages`、`announcement` 五套，覆盖房间回收、激活码、站长后台接口、留言板与首页公告；`admin-ui` 与 `env-guard` 已在上面单列，不重复计数。连同上面 10 套共 **15 套**。）

覆盖内容：

- 创建/加入、第三人已满、房主权限、准备校验
- 词库范围默认 CET-4，选择 CET-6 提示建设中并回退
- 2868 个 CET-4 单词全部唯一，每次开局重新随机洗牌
- 竞速模式每局 25 个不重复单词；抢答模式保持原规则 10 题
- 每道题按 `en2zh` / `zh2en` / `listen` 类型使用正确格式：
  - 英译中：四个带词性的中文释义；
  - 中译英：四个纯英文单词；
  - 听音选词：无题干文字，四个纯英文单词；
- 正确项来自 `frequencyRank: 1`
- 抢答 10 题固定 5/3/2；竞速 25 题固定 5 道听音选词，英译中 12/13 道随机，长期比例 50/30/20
- 答错扣分/锁题、对手继续作答、超时
- 抢答模式 10 题结算与复盘
- 竞速模式 25 题独立进度、双方都完成后结算、惩罚期间拒绝作答
- 竞速模式双方进度、错误数、结算与 25 词复盘
- 断线后用 `sessionId` 恢复并继续作答

## 4. 远程访问（Cloudflare Tunnel）

这是本项目优先验证的远程方案。无需公网 IP、无需路由器端口映射、无需注册 Cloudflare 账号。

### 4.1 启动顺序

需要两个终端，且都要保持运行：

**终端 1：启动游戏服务**

```powershell
cd cet-arena
npm install
npm start
```

保持 `http://localhost:3000` 可访问。

**终端 2：启动临时 HTTPS 隧道**

项目提供脚本：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-tunnel.ps1
```

脚本会：

- 把便携版 `cloudflared.exe` 下载到项目下 `.tools/`（不会安装系统服务）；
- 使用 Cloudflare Quick Tunnel 暴露本机 3000 端口；
- 在输出中打印类似下面的公网地址：

```text
https://random-words-here.trycloudflare.com
```

也可以先安装 cloudflared 后手动运行：

```powershell
cloudflared tunnel --url http://localhost:3000 --no-autoupdate --protocol http2
```

如果脚本自动下载被网络拦截，可先从 Cloudflare 官方发布页手动下载
`cloudflared-windows-amd64.exe`，再指定路径启动（仍不会安装系统服务）：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-tunnel.ps1 `
  -CloudflaredPath "C:\path\to\cloudflared-windows-amd64.exe"
```

macOS / Linux（已安装 cloudflared 时）：

```bash
cloudflared tunnel --url http://localhost:3000 --no-autoupdate
```

### 4.2 发给远程好友

1. 保持两个终端都运行。
2. 复制终端 2 输出的 `https://*.trycloudflare.com` 地址。
3. 你先在该公网地址打开网站，创建房间，拿到 6 位房间码。
4. 把公网地址和房间码发给好友。
5. 好友用手机或另一台电脑打开公网地址，输入昵称和房间码加入。
6. 双方准备，房主选择模式并开始，按所选模式完整打完一局。

注意：

- 好友必须使用 **公网地址**，不能使用你电脑上的 `localhost:3000`。
- 每次重启 cloudflared，临时域名都会变化；旧链接立即失效。
- 关闭本机、关闭服务、关闭隧道，都会导致远程对局中断。
- 房间和比分在内存中，服务重启后会被清空。

### 4.3 公网自动化验收

项目提供 `test:remote`，通过公网 URL 建立两个真实 WebSocket 客户端，完整打完一局抢答模式 10 题，再测试对局中重连：

```bash
npm run test:remote -- https://你的临时域名.trycloudflare.com
```

它会检查：

- 公网 HTTPS 首页和 `/healthz` 可访问；
- WebSocket 成功握手（不是只验证 HTTP）；
- 两名玩家通过公网创建/加入同一房间；
- 完整 10 题、比分与结算正确；
- 中途断开后通过 `sessionId` 重连并继续作答。

本次交付已用该脚本在 Cloudflare Quick Tunnel 公网地址上完成抢答模式 10 题测试，
并另外通过公网完成竞速模式 25 题、1 秒冷却和 25 词复盘测试；临时域名会随隧道重启变化，不建议写死到文档里。

### 4.4 免费方案限制

Cloudflare Quick Tunnel 适合开发和临时验收，不适合长期线上服务：

- 域名随机，重启即变；
- 无可用性/SLA 保证，Cloudflare 可随时限制或中断；
- 无固定带宽/并发承诺，受你本机上行带宽和链路质量影响；
- 你的电脑必须开机，两个终端必须持续运行；
- 免费隧道可能被部分公司/校园网络拦截；
- 本应用只靠 6 位房间码和 sessionId 维持会话，没有账号体系；不要把链接发到公开群聊；
- 房间状态在内存中，服务重启全部丢失。

### 4.5 更稳定的部署建议

如果只是和固定好友长期玩，优先使用 **Cloudflare Named Tunnel**：

1. 注册 Cloudflare 账号并准备一个自己的域名；
2. 安装 cloudflared；
3. `cloudflared tunnel login` 完成浏览器授权；
4. `cloudflared tunnel create cet-arena` 创建命名隧道；
5. 配置 DNS 路由到 `localhost:3000`，用 systemd/Windows 服务常驻。

命名隧道需要登录和域名，属于账户级操作；本项目没有自动执行这一步。

如果部署到支持 WebSocket 的云平台（Render / Railway / Fly.io 等）：

- 使用单实例部署。本项目房间状态在内存中，多实例会互相看不见房间；
- 确认平台支持 WebSocket，并关闭会中断长连接的强制超时；
- 平台休眠/重启会清空所有房间，这是当前内存架构的预期行为；
- 免费实例可能有休眠、冷启动和流量限制；
- 启动命令：`npm install && npm start`；
- 健康检查路径：`/healthz`；
- 端口读取 `PORT` 环境变量；
- 若需要长期稳定使用，建议后续再引入 Redis 等共享状态和正式身份验证，但这超出本 MVP 范围。

### 4.6 腾讯云服务器部署与更新（当前线上环境）

线上环境：腾讯云 Ubuntu 22.04（2 核 2G），项目目录 `/opt/cet-arena`，PM2 进程名 `cet-arena`，访问地址 `http://1.15.152.160:3000`。

**日常更新（推荐流程）**

```bash
cd /opt/cet-arena && git pull && pm2 restart cet-arena
```

**为什么需要 Deploy Key**

这台机器直连 `github.com` 的 HTTPS 会被阻断（连接超时），因此仓库改用 **Deploy Key + `ssh.github.com:443`** 拉取：

- 仓库级只读 Deploy Key：`~/.ssh/cet_arena_deploy`（ed25519，仅该仓库可读）；
- `~/.ssh/config` 把 `github.com` 重定向到 `ssh.github.com:443`，这样 `git pull` 与普通用法完全一致；
- 首次部署还要 `git init -b main && git remote add origin git@github.com:RudeusGreyratRoxy/cet-arena.git`，之后只用 `git pull`。

**运维要点**

- 进程守护：`pm2 save` + `pm2 startup systemd -u ubuntu`，服务器重启后自动拉起；
- 日志轮转：`pm2-logrotate`（10M 上限、保留 5 份）；
- 审计日志：`pm2 logs cet-arena --nostream | grep '\[audit\]'` 可查连接/IP/昵称/房间码/断开原因；
- 激活码：新增卡密改 `data/vip_codes.json`，`type` 为 `unlimited`（站长/专属，不限次不绑设备）或 `once`（普通单人码，一码绑定一台设备）；重置某个码的「已用/绑定」状态，删 `data/vip_codes.state.json` 里对应键即可，改完重启 PM2；**线上已改为直接在 `/admin` 后台操作，无需再登录服务器改文件**；
- 站长后台密码：由 PM2 环境变量 `ADMIN_PASSWORD` 提供，**不写进代码和仓库**（`src/adminAuth.js` 里的默认值仅本地开发占位）。轮换密码时务必带上该变量，否则 **`NODE_ENV=production` 下缺失密码会让服务拒绝启动**（进程直接退出、PM2 显示 errored），而不会静默回落到默认占位密码。轮换：`ADMIN_PASSWORD='新密码' pm2 restart cet-arena --update-env && pm2 save`；复核是否生效：`PID=$(pm2 pid cet-arena)` 后 `tr '\0' '\n' < /proc/$PID/environ | grep ADMIN_PASSWORD`；
- 健康检查：`curl http://127.0.0.1:3000/healthz`，返回 `{"ok":true,"words":2868,...}`；
- 词库/代码更新后必须重启 PM2，服务只在启动时读取 `data/words.json`。

## 5. 替换或导入词库

词库文件：`data/words.json`

每条格式（`pos` 即 partOfSpeech）：

```json
{
  "id": "cet4_001",
  "level": "CET4",
  "word": "abandon",
  "meanings": [
    { "pos": "v.", "meaning": "放弃；抛弃", "frequencyRank": 1 },
    { "pos": "n.", "meaning": "放任；狂热", "frequencyRank": 2 }
  ]
}
```

要求：

- `level` 只能是 `"CET4"` 或 `"CET6"`；当前实际数据只有 `CET4`；
- `id` 全局唯一；
- 每个单词至少 2 个释义；
- 每个释义必须有 `pos`、`meaning`、`frequencyRank`；
- `frequencyRank` 为正整数，同一个单词内不能重复；
- 每个单词必须有且只有一个 `frequencyRank: 1`，作为该词的“最高频释义”；
- 抢答模式每局 10 题；竞速模式每局 25 题，因此所选级别至少需要 25 个词；
- 当前词库：**CET-4 2868 条，CET-6 0 条（建设中）**；
- 每次开局都会重新随机抽题和洗牌，同一局内单词不重复；
- 修改后重启服务生效；
- 服务端启动时校验词库，格式错误会直接报错。

出题规则：

1. 随机选目标单词；
2. 取该单词 `frequencyRank: 1` 的释义作为正确答案；
3. 从其他单词的 `frequencyRank: 1` 释义中随机取 3 个不同释义作为干扰项；
4. 按本局题型配额决定英译中/中译英/听音选词，再随机打乱题目顺序；
5. 英译中：正确项为“词性 + 最高频释义”，干扰项来自其他单词最高频释义；
6. 中译英：正确项为英文单词，干扰项来自其他单词拼写；
7. 听音选词：正确项为发声单词，题干不显示文字，干扰项来自其他单词拼写；
8. 服务端打乱 4 个选项后再下发。

不要直接抓取有版权的商业词库。建议使用自己整理、开源许可明确的词表，或仅使用本项目示例。

从 CSV 导入时，可以先整理成如下列（示例只含两个释义，可自行扩展）：

```csv
id,level,word,pos1,meaning1,rank1,pos2,meaning2,rank2
cet4_101,CET4,ability,n.,能力；才能,1,n.,天赋；本领,2
```

再用一个一次性 Node 脚本转换（不随服务启动）：

```js
const fs = require('fs');
const rows = fs.readFileSync('my-words.csv', 'utf8').trim().split(/\r?\n/);
const headers = rows.shift().split(',');
const words = rows.map((line) => {
  const cells = line.split(',');
  const row = Object.fromEntries(headers.map((key, i) => [key.trim(), (cells[i] || '').trim()]));
  return {
    id: row.id,
    level: row.level,
    word: row.word,
    meanings: [
      { pos: row.pos1, meaning: row.meaning1, frequencyRank: Number(row.rank1) },
      { pos: row.pos2, meaning: row.meaning2, frequencyRank: Number(row.rank2) },
    ],
  };
});
fs.writeFileSync('data/words.json', JSON.stringify(words, null, 2));
```

CSV 含逗号或释义数量更多时，请改用成熟 CSV 解析库，或直接维护 JSON。

### 5.1 词库体检（拼写 / 错别字排查）

```bash
python scripts/check_typos.py
```

- **只读** `data/words.json`，只写 `reports/typo_report.csv`，不会改动词库；
- 检查项：英文拼写（pyspellchecker，含英式拼法白名单）、非 a-z 字符 / 空白 / 大小写 / 异常长度 / 连续重复字母、中文常见错别字对照表、繁体字混入、词性黏连（如 `n自行车`）、括号不匹配、空释义、词频与 id 重复；
- 报告字段：`单词, 问题类型, 可疑内容, 建议, 置信度`（置信度分 高/中/低，按置信度排序）；
- 依赖：`pip install pyspellchecker`；未安装时脚本自动降级为纯规则检查，仍可运行。

## 6. 项目结构

```text
cet-arena/
├─ data/
│  ├─ words.json           # CET-4 词库（2868 词，多释义 + 词性 + 词频）
│  ├─ levels.json          # 闯关关卡（3 关 × 50 词，只存词条 id）
│  ├─ announcement.json    # 首页公告（运行时状态，不入库，由后台发布）
│  ├─ vip_codes.json       # 激活码种子（只读、入库）
│  └─ vip_codes.custom.json  # 运行时新增卡密（批量/自定义生成，不入库）
├─ public/
│  ├─ index.html            # 单页视图（首页/房间/答题/结算/错词/关卡/闯关）+ 模式选择 + 复盘
│  ├─ styles.css            # 深色桌面/移动端样式
│  ├─ app.js                # Socket.IO 客户端、双模式状态、单人挑战、发音
│  ├─ wrongbook.js          # 错词本纯逻辑（localStorage 适配，可独立单测）
│  ├─ admin.html            # 站长后台（登录 + 卡密表格 + 生成/解绑）
│  ├─ admin.css             # 后台样式（移动优先，窄屏表格转卡片）
│  ├─ admin.js              # 后台前端：登录态探测、列表渲染、生成、解绑
│  └─ audio/                # 2868 个单词发音 MP3（24kHz/48kbps，均 ~9KB）+ _silent.mp3
├─ scripts/
│  ├─ build_audio_edge.py   # 批量生成单词 MP3（微软神经网络语音 edge-tts）
│  ├─ build_audio.py        # 旧版离线方案（Windows SAPI，仅作无网络兜底）
│  ├─ synth_wav.ps1         # SAPI 合成 WAV 的 PowerShell 后端
│  ├─ make_silent_mp3.py    # 生成唤醒用的 0.5 秒静音 MP3
│  ├─ start-tunnel.ps1      # 便携版 Cloudflare Quick Tunnel
│  └─ check_typos.py        # 词库拼写/错别字体检（只读，输出 CSV 报告）
├─ src/
│  ├─ app.js                # Express + Socket.IO 房间/抢答/竞速/单人挑战状态机
│  ├─ levels.js             # 闯关关卡读取与校验（trialPoolFor / listLevels / 每题限时）
│  ├─ adminAuth.js          # 站长后台鉴权（密码校验 / token / 爆破限流）
│  ├─ messages.js           # 联系站长留言存储（内容校验 / 设备限流 / 原子持久化）
│  ├─ announcement.js       # 首页公告存储（500 字上限 / 保留换行 / 原子持久化）
│  ├─ vipCodes.js           # 激活码校验（一次性 / 设备 Token 绑定 / 并发锁 / 原子持久化 / 生成 / 解绑）
│  └─ wordBank.js           # 词库校验、单题生成、抽题、选项打乱
├─ test/
│  ├─ e2e.test.js           # 抢答模式双客户端回归
│  ├─ race.test.js          # 竞速模式双客户端回归
│  ├─ mixed.test.js         # 混合题型压力测试（3 万+ 题）
│  ├─ wrongbook.test.js     # 错词本纯逻辑（入库/连对/掌握/容错）
│  ├─ solo.test.js          # 单人挑战服务端协议（出题/判分/退出）
│  ├─ vip.test.js           # 激活码（特殊码/一码一设备/设备 Token/并发/建房闸门）
│  ├─ admin.test.js         # 站长后台（鉴权/列卡密/生成/解绑/爆破锁定）
│  ├─ messages.test.js      # 留言板（内容校验/动态配额/额度归还/落盘/后台处理）
│  ├─ announcement.test.js  # 首页公告（存储校验/接口鉴权/长度上限/no-store）
│  ├─ admin-ui.test.js     # 后台列表渲染（拉黑数/操作按钮）
│  ├─ solo-ui.test.js       # 前端假 DOM 集成（错词写入、着色、自动发音、答后释义）
│  ├─ trial.test.js         # 限时闯关协议（关卡清单/限时/超时判定/结算/VIP 闸门）
│  ├─ dom-contract.test.js  # DOM id 与脚本加载顺序契约
│  ├─ env-guard.test.js     # 生产环境缺 ADMIN_PASSWORD 必须拒绝启动（失效保护）
│  └─ remote-smoke.js       # 公网 WebSocket 完整验收
├─ server.js                # 启动入口
├─ package.json
└─ README.md
```

## 7. 实现要点

- **答案不提前泄露**：抢答模式的题目事件、竞速模式的个人题目事件，以及重连快照，都不包含 `correctIndex` 或释义；服务端判分后才在结算事件中下发正确答案与完整释义。
- **双模式事件隔离**：
  - 抢答模式使用 `question:start`、`question:end`、`game:answer`。
  - 竞速模式使用 `race:sync`、`race:question`、`race:progress`、`race:locked`、`race:unlocked`、`race:answer`。
  - 两套事件由 `room.mode` 和 `game.mode` 双重校验，避免串场。
- **竞速个人状态**：每个玩家单独保存题号、错误数、锁定截止时间、每题作答状态；进度只广播双方摘要，不泄露对方当前题目答案。
- **服务端权威计时**：抢答模式每题由服务端 deadline 结束；竞速模式由服务端维护 1 秒冷却锁，前端小字提示只负责显示。
- **词库筛选**：`buildQuestions(words, count, level)` 先按 CET-4/CET-6 过滤，再抽题；当前数据只有 CET-4，CET-6 会被服务端拒绝并提示建设中。
- **抽题稳定**：每次 `game:start` 都重新随机洗牌；同一局内 25 个竞速词或 10 个抢答词不重复。
- **词库范围**：房间准备页的 `room:level` 由房主控制，CET-6 请求返回“建设中”且不改变房间设置。
- **混合题型**：服务端按 50/30/20 配额生成题型序列并随机打乱；英译中题干为英文、选项为带词性中文；中译英题干为带词性中文、选项为纯英文；听音选词题干为空、只播放 en-US 发音，选项为纯英文。
- **发音**：前端使用**本地 MP3**（`new Audio('/audio/<word>.mp3?v=2')`），**不使用 `speechSynthesis`**——HTTP 环境 `secureContext=false`，多数手机浏览器直接禁用该 API，曾是「手机没声音」的根因。每次播放前先 `pause()` 并归零上一条，同一单词的 `<audio>` 元素缓存复用（上限 60 个），音频元素缓存上限之外按 LRU 淘汰。`play()` 被自动播放策略拒绝时不弹错误，只给 🔊 按钮加 `is-nudge` 动画引导手动点击；`play()` 成功才把 `audioUnlocked` 置真。音频全部由本服务 `/audio/` 提供，不请求任何外部音频链接。
- **题型防错配**：`assertQuestionShape` 在出题阶段强校验题型、题干、提示和四个选项；任何错配会直接抛错，不会发到前端。
- **前后端版本握手**：Socket.IO 连接必须携带 `APP_VERSION`。旧页面无法连入新后端，会提示刷新，避免旧渲染逻辑误读新题型数据。
- **复盘数据**：服务端在对局结束时生成完整 review，包含单词、所有释义、词性、词频、双方每题状态和 `mistakes` 标记；竞速模式中只要某题选错过一次，`hasMistake` 就保持为 true，答错后纠正也会在复盘中显示为答错。前端只展示“你”的状态。
- **错词本存储**：`localStorage` 键 `cetArena.wrongBook.v1`，结构为 `{ version: 1, words: [{ word, level, streak, wrongCount, addedAt, updatedAt }] }`。**以单词为唯一键**——服务端复盘条目只有 `word`、没有 `id`（早期版本用 `id` 做键导致写入空数组，已修复并固化为回归测试）；读取时兼容纯字符串数组与带 `id` 的旧格式，损坏数据视为空错词本。
- **单人挑战协议**：`solo:start / solo:next / solo:answer / solo:quit`。客户端只上传「当前仍未掌握」的单词列表，服务端按单词查词表（大小写不敏感）复现题目并判分；学习进度（连对次数、掌握状态）只存在浏览器，服务端不落库，换设备不互通。**该协议仅对 `socket.data.vip === true` 开放**，未激活连接一律返回 `VIP_REQUIRED`。
- **限时闯关协议**：`trial:levels / trial:start / trial:answer / trial:next / trial:quit`，与错词挑战完全分离，免费可用。题目由服务端按关卡词池生成（客户端不能指定单词），每题下发 `deadline` 与 `timeLimitMs`；前端倒计时只负责展示与到点自动提交，**服务端按 `deadline + 300ms` 网络宽限复核**，迟到或 `index=null` 一律判超时答错，未作答直接点下一题同样记为错误。
- **关卡数据**：`data/levels.json` 只存「关卡 → 词条 id 列表」，不往 `words.json` 里加 chapter 字段——词库是扁平的 2868 词，闯关只是它的一种视图，避免污染词库结构与音频/体检脚本。启动时校验：关卡 id 唯一、单关 ≥4 词（够 3 个干扰项）、引用的 id 必须存在于词库、免费关卡合集 ≥25 词（够竞速 25 题）。
- **单题生成复用**：把 `buildQuestion(entry, pool, type)` 从 `buildQuestions` 中抽出，单人挑战与双人对战共用同一套题型判定、干扰项与选项打乱逻辑，避免两套出题规则漂移。
- **作答后才下发答案**：`game:answer` 与 `solo:answer` 的 ack 才携带 `correctIndex`；听音题的中文释义只在作答后以 `reveal` 字段下发（竞速模式在答错冷却期展示，抢答与单人即时展示）。题目事件本身仍然不含答案。
- **音频离线化**：2868 个单词音频由 `scripts/build_audio_edge.py` 用 **微软神经网络语音 `en-US-JennyNeural`**（edge-tts）批量生成，输出 **24kHz / 48kbps / 单声道 MP3**，平均 **~9KB/词**、全量 **~26MB**。听感接近真实四级听力。旧的 `scripts/build_audio.py`（Windows SAPI 8kHz）仅作离线兜底保留。另有 `scripts/make_silent_mp3.py` 生成 0.5 秒静音 `_silent.mp3` 供唤醒用。
- **音频 URL 版本化**：`/audio` 使用 `immutable` 一年强缓存，因此换音源时必须递增 `app.js` 里的 `AUDIO_VERSION`（当前 `2`），让 URL 变为 `/audio/<word>.mp3?v=2`，否则已缓存的老设备一年内不会重新拉取。
- **音频强缓存**：`src/app.js` 单独为 `/audio` 挂了一层 `express.static`（在通用静态之前），下发 `Cache-Control: public, max-age=31536000, immutable`。单词音频按内容命名、永不改写，可以放心 immutable。
- **预加载策略**：题目到达时立刻 `preload="auto"` 拉取该词音频，200ms 后再播放，通常首帧已在本地。**不做整局预取**——`中译英`/`听音选词` 的单词就是答案，提前下发会泄露答案，只能在题目到达后取。
- **自动播放兜底**：`audio.play()` 返回的 Promise 被拒（自动播放策略）时不弹错误，只给 🔊 按钮加 `is-nudge` 动画；`play()` 成功才把 `audioUnlocked` 置真。
- **声音唤醒引导**：微信内置 / UC / 部分 Android 浏览器在用户手势前禁止播放。准备页/对局页顶部显示「🔊 点击唤醒声音」，点击后在同步手势调用链里播放 0.5 秒静音 MP3；`play()` resolve 即解锁并隐藏按钮，reject 则保留按钮提示重试。
- **留言板存储与动态配额**：`data/messages.json`（已 gitignore）保存 `{ id, content, deviceHash, devicePrefix, ip, createdAt, status, reply, repliedAt }`；内容去掉控制字符并压缩空白，按 **码点** 计算长度，超过 50 字拒绝。配额按 `device_token` 的 SHA-256 **实时统计「未处理」条数**（`status !== 'handled'`），同一设备**同时最多 5 条未处理**留言；站长标记已处理或删除后，未处理数下降，额度自动归还。另加 5 秒冷却防连点。只落设备 Token 前 8 位与哈希，不保存完整凭据。公开入口走 socket `message:create`（无需激活码），后台读取/处理/删除/回复走受密码保护的 `/api/admin/messages*`。
- **站长回复（vip18）**：`POST /api/admin/messages/reply`（`requireAdmin`，body `{id, reply}`）调用 `messages.reply()`；回复内容同样走 `cleanContent`，按码点 **≤100 字**，空回复与超长分别返回 `EMPTY_REPLY` / `REPLY_TOO_LONG`（HTTP 400），id 不存在返回 `NOT_FOUND`（HTTP 404）。**回复即处理**：写入 `reply` + `repliedAt` 的同时把 `status` 置为 `handled` 并补 `handledAt`，因此该设备的待处理额度立即释放。用户端通过 socket `message:mine`（payload `{deviceToken}`）拉自己的留言：服务端自己算 `sha256(deviceToken)` 再 `listByDevice()`，**客户端无法指定他人设备**，且只回 `{id, content, reply, repliedAt, createdAt, status}` 白名单字段。三处渲染（后台列表、后台回复区、用户端「我的留言」）全部 `createElement` + `textContent`，不拼 `innerHTML`。
- **重连**：创建/加入时返回随机 `sessionId`，刷新后 `room:resume` 恢复；竞速模式还会补发个人当前题、进度与惩罚截止时间。
- **房间回收**：双方都离线时不再死等 30 分钟——对局已结束的房间**立即删除**；进行中的对局保留 `emptyRoomGraceMs`（默认 **60 秒**，移动端切后台/弱网重连留足时间）供「刷新重连」，期间有人通过 `room:resume` 回来就取消回收；60 秒兜底扫描仅作为最后保险。`deleteRoom` 会一并清理子定时器、`sessions`、`socketPlayers`、`socket.data.roomCode` 并 `io.socketsLeave(room.code)`，不留幽灵连接。
- **激活码存储**：`data/vip_codes.json` 只存放种子卡密（入库、只读，`type` 为 `unlimited` 或 `once`）；后台批量生成/自定义生成的卡密写入 `data/vip_codes.custom.json`（已 gitignore），启动时合并进内存，避免线上生成卡密导致 `git pull` 冲突；运行状态（`used` / `boundDevice` / `boundIp` / `lastIp` / `usedAt`）写入 `data/vip_codes.state.json`（已 gitignore），先写临时文件再 rename，保证原子性，也避免 `git pull` 与线上状态冲突。
- **激活码绑定主体是设备 Token，不是 IP**：早期版本按「首个验证 IP」绑定，但大学校园网普遍是 NAT，全校共用一个公网 IP，等于「一人买码、全校白嫖」。现在前端 `localStorage` 的 `cetArena.deviceToken.v1` 保存一个 32 位随机 Token（优先 `crypto.randomUUID()`，回退 `crypto.getRandomValues()` / `Math.random()`），首次打开页面即生成并在每次 `vip:verify` 时上传；后端把它作为唯一绑定主体，换设备一律拒绝，同设备换网络（宿舍 Wi-Fi ↔ 热点）照样放行。IP 降级为风控参考，只记录 `boundIp`（首次）与 `lastIp`（最近），不参与放行判断。后端会对 Token 做规范化（16–128 位、仅 `[A-Za-z0-9_-]`），缺失或非法直接返回 `DEVICE_REQUIRED`。
- **激活码校验**：验证逻辑全同步执行，进入临界区前加内存锁，同一毫秒的并发请求只有一个能完成「校验 + 标记已用 + 落盘」；普通码首次使用即绑定设备 Token，Token 不一致直接拒绝。`room:create` 与 `room:join` 都要求 `socket.data.vip === true`，服务端二次校验，绕过前端也无效。；**静默重验**（`silent: true`，用于刷新/重连）绝不允许首次绑定，避免解绑后本地残留的码被静默绑回原设备；`vip:status` 按 deviceToken 返回权威授权状态，前端 init 用它兜底降级；后台解绑后服务端会向该设备的所有在线连接推送 `vip:revoked`，只清 `socket.data.vip` 与本地激活态（不断线、不打断当前对局），下次需要 VIP 权限时被拦截。；**封禁语义**：`reset` 只标记 revoked 并永久记录 `revokedDevices`，`verify` 对 revoked 码拒绝所有设备；换机需站长调用 `POST /api/admin/codes/allow-rebind`（保留黑名单）；`POST /api/admin/codes/delete` 仅删除运行时新增的码。设备指纹在 Socket.IO 握手 `auth.deviceToken` 与 `vip:verify` / `vip:status` 入口统一记录，保证「已封禁设备」的在线连接也能被精准踢线。
- **旧数据兼容**：历史记录只有 `boundIp`、没有 `boundDevice`。这种记录在「同 IP 首次带 Token 请求」时会被平滑迁移（补写设备 Token），避免老客户突然全部失效；换 IP 则仍然拒绝。
- **站长后台鉴权**：`/admin` 页面本身不含数据，进入后需提交站长密码。密码来源优先级为 显式传入 > 环境变量 `ADMIN_PASSWORD` > 本地默认占位值 `boss2026`；**生产环境（`NODE_ENV=production`）下若 `ADMIN_PASSWORD` 缺失或 trim 后为空，`server.js` 会在监听端口之前 `process.exit(1)` 并打印明确原因，绝不静默降级成默认口令**——本地开发与自动化测试（不设 `NODE_ENV`）保持原有默认值行为，不受影响。校验成功后签发 32 字节随机 token 存于服务端内存，并通过 `HttpOnly` + `SameSite=Strict` Cookie 下发，刷新不掉线、JS 读不到；token 有效期 12 小时，服务重启后失效需重新登录。比较密码使用 `crypto.timingSafeEqual`（长度不等也走一次等长比较），同一 IP 连续错 5 次锁定 10 分钟。所有 `/api/admin/*` 数据与写操作接口在服务端二次校验，未登录统一返回 401，普通玩家即使猜到路径也拿不到任何卡密。
- **后台登录态探测**：`GET /api/admin/session` 只返回 `{ authed: true|false }`（状态码恒为 200），供首屏静默判断，避免未登录时浏览器控制台刷 401 报错；真正的数据接口 `/api/admin/state` 仍严格 401。
- **卡密生成**：`POST /api/admin/codes/generate` 按数量（1–100，超出拒绝）生成 6 位随机码，字符集去掉 `I/O/0/1` 以免客户手输混淆；生成前查重、批量内也去重。新码同时写入内存 `codes` 与 `data/vip_codes.json`（先写临时文件再 rename），因此**无需重启**即可被 `vip:verify` 校验使用。
- **自定义卡密**：`POST /api/admin/codes/generate-custom`（需站长登录），只生成 `once` 码；归一化为大写后按 `/^[A-Z0-9_]{6,16}$/` 校验，查重覆盖三处——内存 `codes`（种子 + 运行时新增 + 环境变量专属码）、`vip_codes.state.json` 的历史绑定记录、写入前双检；命中一律拒绝、绝不覆盖，审计日志对码打码（`maskCode`）。
- **卡密解绑**：`POST /api/admin/codes/reset` 删除 `data/vip_codes.state.json` 中该卡密的记录并原子落盘，卡片立即回到「未使用」；客户换电脑后可用同一张码在新 IP 重新激活。站长码（`unlimited`）不参与绑定，接口直接拒绝；对未使用的码重复解绑返回 `NOT_BOUND`，避免前端误操作。
- **后台缓存策略**：`/admin`、`/admin.js`、`/admin.css` 一律 `Cache-Control: no-store` 且带 `X-Robots-Tag: noindex`，防止改了后台脚本后手机浏览器仍跑 7 天缓存里的旧版本，所以后台资源不需要参与 `APP_VERSION` 版本号机制。
- **审计日志**：连接、绑定玩家、断开、房间关闭都会输出一行 `[audit] {json}` 到 stdout（由 PM2 收集进 `cet-arena-out.log`，受 pm2-logrotate 10M×5 管理），字段含 ISO 时间、IP、昵称、房间码、在线时长、断开原因与剩余在线人数，便于排查异常与作弊。后台登录、生成卡密、解绑卡密同样记录 `admin_login` / `admin_generate_codes` / `admin_reset_code` 审计事件。
- **第三人限制**：房间固定最多 2 个玩家槽位；掉线玩家在房间清理前仍占位。
- **内存清理**：双方都断线且超过 30 分钟的房间会被清理；正常退出会立即删除或转移房主。

### 7.1 网络与性能优化

- **前端资源审计**：
  - 不使用外部字体，全部使用系统字体；
  - 不使用图片；图标均为 CSS 或 emoji/文本；
  - 没有 React/Vue、动画库、图标库等第三方前端依赖；
  - 唯一第三方客户端脚本是 Socket.IO，已改用压缩版 `socket.io.min.js`（约 47KB，原版约 153KB）。
- **传输压缩**：
  - Express 对 HTML/CSS/JS 启用 gzip/deflate（`compression` 中间件）；
  - Cloudflare Tunnel 侧也会对文本资源进行边缘压缩。
- **缓存策略**：
  - 首页 `Cache-Control: no-cache`，保证更新后能拿到新 HTML；
  - CSS/JS 静态资源缓存 7 天，HTML 通过 `?v=...` 版本号更新；
  - 修改 `public/app.js` 或 `styles.css` 后，请同时修改 `index.html` 里的 `?v=` 版本号，并递增 `src/version.js` 中的 `APP_VERSION`。
- **版本号与缓存规约（长期规则，务必遵守）**：
  - **index 前端**（`public/index.html`、`public/app.js`、`public/wrongbook.js`、`public/styles.css`）：改动其中任何一个，必须同时改 **三处** `index.html` 的 `?v=`（styles.css / wrongbook.js / app.js）和 **两处** `APP_VERSION`（`src/version.js`、`public/app.js`），三者保持一致；`test/dom-contract.test.js` 会强制校验，不一致直接测试失败。`APP_VERSION` 同时是 Socket.IO 握手版本——递增会让旧页面连不上新后端并提示刷新，这是特性不是 bug。
  - **admin 前端**（`public/admin.html`、`public/admin.js`、`public/admin.css`）：`/admin`、`/admin.js`、`/admin.css` 一律 `Cache-Control: no-store, no-cache, must-revalidate`，**不需要**递增 `APP_VERSION`（它不影响握手）；但每次改 `admin.js` / `admin.css`，必须把 `admin.html` 里对应的 `?v=` 换成**新值**（建议与当前 `APP_VERSION` 同步，如 `?v=20261113-vip18`），用于个别仍按 URL 缓存的手机浏览器/代理。
  - 只改文档、只改后端（`src/` 下非 `version.js`）、只改 `data/*`：**不需要**动任何版本号。
  - 排查"手机上还是旧界面"的顺序：① 看 `index.html`/`admin.html` 里的 `?v=` 是否已变；② 让用户完全关掉标签页重开（bfcache 会绕过 `no-store`）；③ 最后才怀疑服务端没重启。
- **Ping 显示**：
  - 客户端每秒通过自定义 `latency:ping` 事件做一次 Socket.IO 往返测速；
  - 顶部显示 `PING xx ms`；
  - `≤200ms` 绿色，`>200ms` 黄色，`>500ms` 红色；
  - 页面切到后台时暂停测速，回到前台继续。
- **Socket.IO 稳定性**：
  - 客户端优先 WebSocket，失败时回落 polling；
  - `reconnectionAttempts: 50`；
  - 连接超时 `20s`；
  - 重连延迟 0.5-4s 自适应随机；
  - 服务端 `pingInterval: 25s`、`pingTimeout: 30s`，对移动网络抖动更宽容；
  - 原有 `sessionId` 房间恢复逻辑保留。
- **注意**：这些优化能减少资源体积和连接断开，但无法消除 Cloudflare Quick Tunnel 或手机运营商网络本身的抖动。

## 8. 验收清单

### 本地测试清单

- [x] `npm install` 依赖可安装（标准 Node/npm 环境）
- [x] `npm start` 后 `http://localhost:3000` 可访问
- [x] 词库包含 2868 个不重复 CET-4 单词，每个单词至少 2 个带词性释义
- [x] 房间准备页有“词库范围”下拉框，默认 CET-4
- [x] 选择 CET-6 会提示“六级词库正在建设中，请先体验四级”并回退
- [x] 没有混合词库选项
- [x] 竞速模式每局从 2868 词中重抽 25 个不重复单词，重新开局重新洗牌
- [x] 创建房间并得到 6 位房间码
- [x] 房主可以选择抢答模式或竞速模式，非房主不能切换
- [x] 第二个浏览器窗口用房间码加入
- [x] 第三人加入提示房间已满
- [x] 双方准备后房主可以开始
- [x] 抢答模式完整打完 10 题
- [x] 抢答模式答对 +10、答错 −5、锁题、对手仍可作答
- [x] 抢答模式 15 秒超时无人得分
- [x] 竞速模式双方独立答 25 题，进度实时同步
- [x] 竞速模式答错选中项变红、其余选项变灰禁用，1 秒冷却期间服务端拒绝作答
- [x] 竞速模式一方完成后等待，双方都完成后结算，显示进度、用时、错误数
- [x] 英译中/中译英/听音选词混合出题，10 题按 5/3/2 配额随机打乱
- [x] 中译英题干带词性，选项为纯英文单词
- [x] 听音选词只显示喇叭，题目出现后自动播放一次发音；被浏览器拦截时点喇叭可手动播放
- [x] 听音选词作答后立即展示该单词的中文含义（抢答/竞速/单人三种场景）
- [x] 英译中题干旁喇叭可播放 en-US 发音
- [x] 使用本地 MP3 发音（24kHz/48kbps 神经网络语音），每次播放前先停掉上一条，同一单词复用 audio 元素
- [x] 音频 URL 带 `?v=` 版本参数，换音源后老设备能拿到新文件
- [x] 2868 个单词音频零缺失、零多余，`_silent.mp3` 存在
- [x] `/audio/*.mp3` 返回 `Cache-Control: public, max-age=31536000, immutable`
- [x] 移动端「点击唤醒声音」播放静音 MP3 后按钮自动消失
- [x] 不支持发音时提示改用外部 Safari/Chrome，不依赖任何外部音频接口
- [x] 压力测试 3 万+ 道题，三种题型与选项零错配
- [x] 旧版本页面会被版本握手拒绝，避免前后端数据错配
- [x] 复盘列表保持显示单词拼写、词性和完整中文释义
- [x] 两种模式结算页均展示完整复盘列表
- [x] 复盘包含单词拼写、词性、全部释义、个人对错标记；答错后纠正仍标记为答错
- [x] 再来一局回到准备状态
- [x] 答题中刷新可自动重连
- [x] 顶部 Ping 每秒更新，>200ms 黄色、>500ms 红色
- [x] 静态 CSS/JS 启用 gzip 与缓存，Socket.IO 使用压缩客户端
- [x] Socket.IO 使用更高重连次数、20 秒超时与 WebSocket 优先
- [x] 结算复盘完成后，答错（含答错后改正）的单词自动写入 `localStorage`，复盘标题提示新增数量
- [x] 首页「错词挑战」在 VIP 激活后显示待复习词数；错词本为空时提示「当前没有错词，快去打一局吧」
- [x] 免费用户的错词挑战入口显示「VIP 专属」，点击弹出激活码遮罩；未激活时 `solo:start` 被服务端拒绝（`VIP_REQUIRED`）
- [x] 首页「限时闯关」免费可进，关卡列表 3 关各 50 词，第 4 关显示灰色占位「第 4 关及后续关卡（开发中...）」且不可点击
- [x] 闯关每题限时 10 / 7 / 5 秒（第 1/2/3 关），倒计时到 0 自动提交并按超时判错
- [x] 超时判定以服务端 deadline 为准：迟到答案与 `index=null` 均判超时、不计分，但仍返回正确答案
- [x] 闯关每关 10 题，题目只来自该关词库，结算显示题数/答对/答错或超时
- [x] 错词挑战只考错词，同一单词连续答对 3 次后移出错词本，答错则连对清零
- [x] 后台「公告管理」可发布 / 下架公告，首页横幅按 `updatedAt` 去重，关闭后同版本不再弹出
- [x] 公告渲染使用 `textContent`（含换行保留），未登录调用 `POST /api/admin/announcement` 返回 401
- [x] 购买页三档套餐均标注「有效期：1年」，卡密输入框下方有「⭐ 增值服务：专属定制卡密 +9.9元」说明
- [x] 后台可自定义生成卡密（6–16 位字母/数字/下划线），重复码被拒，写入 `vip_codes.custom.json` 而非种子文件
- [x] 首页 Footer「关于我们」可打开模态框，文案用 `textContent` 渲染
- [x] 单人模式选项着色正确：答对标绿、答错标红并同时高亮正确项（回归用例）
- [x] 点「创建房间」弹房主通道、点「加入房间」弹单人通道，两个弹窗文案与校验独立
- [x] 价格页提供三档套餐：孤狼独行 ￥19.9（1 码）/ 双人成行 ￥29.9（2 码）/ 宿舍开黑 ￥59.9（6 码），点任一按钮只提示维护中且无收款码
- [x] 任意有效激活码验证后既能建房也能加入；未验证两者都被拦截
- [x] 特殊码（[已废弃-见环境变量]）不限次、不绑设备
- [x] 普通码必须携带 `device_token`，缺失或格式非法一律拒绝
- [x] 后台封禁后，原设备与任何新设备/token 均无法激活（`REVOKED`），只能由站长「允许换机」后新设备才可绑
- [x] 静默重验（silent）不会自动首次绑定，未绑定设备返回 `SILENT_UNBOUND`
- [x] 封禁/删除时在线设备收到 `vip:revoked` 并立即降级，当前对局不被强制断开
- [x] 后台「允许换机」后新设备可激活、原设备仍被拒；「彻底删除」后码从列表消失且无法再激活，种子码删除被拒
- [x] **同一公网 IP 下两台不同设备（校园网 NAT）用同一个码：第一台成功，第二台被拦截**
- [x] 同一台设备换 IP（宿舍 Wi-Fi ↔ 手机热点）仍可正常验证
- [x] 旧数据（只有 boundIp、没有设备 Token）在同 IP 首次带 Token 时可平滑迁移
- [x] 真机双浏览器验收：两个独立浏览器配置（不同 `device_token`、同一 IP）跑通上述拦截流程
- [x] 自动化 `npm test` 通过（错词本 + DOM 契约 + 单人 UI + 单人协议 + 限时闯关 + 房间生命周期 + 激活码 + 抢答 + 竞速 + 混合题型 + 站长后台 + 留言板 + 生产环境密码守卫，共 15 套）

### 声音唤醒与留言板测试清单

- [x] 进入准备页/对局页后，顶部出现「🔊 点击唤醒声音」，点击后发出真实发音并自动隐藏
- [x] 被静默拦截时按钮保留并提示重试，不会误报成功
- [x] 任意一次手动点喇叭成功后，唤醒按钮自动消失
- [x] 自动播放被拦截时不报错，只让 🔊 按钮跳动提示手动点击；唤醒按钮不依赖任何 TTS 能力检测（统一播 `_silent.mp3`）
- [x] 首页右下角显示「遇到问题？联系站长」，其他视图不显示
- [x] 留言内容为空 / 超过 50 字被前端与服务端双重拦截
- [x] 输入框实时显示 `n / 50` 字数
- [x] 同一 `device_token` 同时最多 5 条未处理留言，第 6 条被拒
- [x] 站长标记已处理 / 删除后，该设备额度自动归还 1 次
- [x] 5 秒内重复提交被拒（防连点）
- [x] 留言写入 `data/messages.json`，重读服务后仍在
- [x] 后台「留言管理」按时间倒序展示，含待处理状态、设备前 8 位、IP、时间
- [x] 后台可标记已处理 / 恢复待处理 / 删除，标签页红点数字同步
- [x] 未登录访问 `/api/admin/messages` 返回 401
- [x] 留言接口不需要激活码（没码的用户也能反馈问题）
- [x] 站长可对单条留言写回复（最多 100 字），回复后该条自动变为「已处理」并释放额度
- [x] 回复超 100 字返回 400、目标留言不存在返回 404、未登录调回复接口返回 401
- [x] 用户端弹窗「我的留言」能显示本设备留言与「站长回复」，打开弹窗即拉取
- [x] `message:mine` 只返回本设备记录（换设备 Token 查不到他人留言），且只回白名单字段
- [x] 留言正文、站长回复全部用 `textContent` 渲染，无 `innerHTML` 拼接

### 站长后台测试清单

- [x] 访问 `/admin` 未登录只显示密码框，不展示任何卡密数据
- [x] 错误密码被拒并提示剩余次数；同一 IP 连续错 5 次锁定 10 分钟（锁定期间正确密码也拒绝）
- [x] 正确密码登录成功，刷新页面不掉线
- [x] 表格展示全部卡密，字段含卡密、类型（普通/管理员）、状态（未使用/已绑定）、绑定 IP、绑定设备（Token 前 8 位）、绑定时间
- [x] 列表只回传设备 Token 前 8 位，响应体中不含完整 Token
- [x] 顶部显示当前在线玩家数与房间数
- [x] 输入数量一键生成新卡密，6 位大写字母 + 数字、批量内与库内均不重复
- [x] 新生成的卡密立即出现在表格中，且**不重启服务**就能通过 `vip:verify` 验证成功
- [x] 生成的卡密已写入 `data/vip_codes.custom.json`（种子文件保持只读），重启进程后仍在
- [x] 已绑定卡密显示红色「解绑 / 重置」按钮，其余状态不显示
- [x] 解绑后该卡密立即变为「未使用」，**设备 Token、绑定 IP、绑定时间一并清空**，`vip_codes.state.json` 中记录被删除
- [x] 解绑后可用同一张卡密在**另一台设备**重新激活成功（换电脑/换手机场景）
- [x] 站长码（[已废弃-见环境变量]）不出现解绑按钮，接口层也拒绝解绑
- [x] 未登录直接调用 `/api/admin/codes/generate`、`/api/admin/codes/reset`、`/api/admin/state` 均返回 401，且不会写入任何数据
- [x] 手机浏览器（390px 宽）下表格自动转为卡片，按钮可正常点击

### 远程好友测试清单

- [ ] 本机 `npm start` 正常运行
- [ ] 另一个终端启动 Cloudflare Tunnel，得到公网 HTTPS 地址
- [ ] 本机先用公网地址打开，创建房间并拿到 6 位房间码
- [ ] 房间准备页的词库范围默认为 CET-4；选择 CET-6 时出现建设中提示
- [ ] 把公网地址 + 房间码发给远程好友
- [ ] 好友用手机或另一台电脑打开公网地址（不是 localhost）
- [ ] 好友输入昵称和房间码，成功进入同一房间
- [ ] 房主切换抢答/竞速模式，双方模式显示一致
- [ ] 双方准备，房主开始
- [ ] **抢答模式**：双方看到同一道题、倒计时同步，答题结果和比分实时变化，10 题后结算一致
- [ ] **竞速模式**：双方进度独立同步；答错显示 1 秒冷却；双方都完成 25 题后结算
- [ ] 两种模式结算页都能看到完整复盘列表
- [ ] 再来一局可回到准备状态
- [ ] 顶部 Ping 正常显示，网络差时能变黄/变红
- [ ] 对局中任一端刷新/断网，重连后能恢复原房间和状态

> 技术层面的公网验证可以运行 `npm run test:remote -- <公网地址>`；它不能替代“真人用手机/另一台电脑实际加入”的最终人工验收。

## 9. 常见问题

**好友打不开公网地址**

- 检查本机和 tunnel 终端是否仍在运行；
- 确认复制的是最新一次 `trycloudflare.com` 地址；
- 公司/校园网络可能拦截 `trycloudflare.com`，换手机热点试试；
- 隧道重启后旧域名一定失效。

**能打开首页但进入房间后实时不动**

- 公网地址必须是 HTTPS；Socket.IO 默认走同源 WebSocket；
- 检查 tunnel 输出是否有连接报错；
- 用 `npm run test:remote -- <公网地址>` 验证公网 WebSocket。

**刷新后回首页**

- 服务重启、房间超过 30 分钟无人连接、或 sessionId 失效都会导致无法恢复；
- 这是预期行为，不是浏览器缓存问题。

**手机无法点击选项**

- 请使用最新版 Chrome/Safari/Edge；
- 页面必须通过公网 HTTPS 或 localhost 打开；
- 如果倒计时已到 0，选项会锁定，等待服务端结算。

**听音选词没有自动发音**

- **先点页面顶部的「🔊 点击唤醒声音」**：微信内置、UC 等浏览器在用户手势前禁止播放，这一步就是换取播放权限，点完会听到一声「Ready」似的短音，之后听音题就能正常播报；
- iOS Safari 和部分手机浏览器会拦截自动播放，此时点一下题目里的 🔊 即可；喇叭轻微跳动就是在提示手动播放；
- 确认系统媒体音量未被静音、浏览器未禁止该站点声音；
- 发音来自服务器上的本地 MP3（`/audio/<单词>.mp3`），不是浏览器 TTS。若某个词没声音，先在浏览器直接打开 `http://<地址>/audio/<单词>.mp3` 看是否 200；404 说明该词条缺少音频，需要重跑 `scripts/build_audio_edge.py`（联网 + 全权限，见 §7「音频离线化」）。

**联系站长的留言发不出去**

- 每台设备**同时最多 5 条未处理**留言，用满后需等站长处理（或删除）后额度才恢复；同一台设备两次留言至少间隔 5 秒（防连点）；
- 内容不能为空、最多 50 字，输入框下方有实时字数；
- 留言写入服务器 `data/messages.json`（不入库），站长在后台「留言管理」标签页查看。

**错词本为什么是空的 / 换设备后错词没了**

- 错词本保存在浏览器 `localStorage`，按域名隔离：`localhost:3000` 与线上 `1.15.152.160:3000` 互不相通，清理浏览器数据也会一并清空；
- 只有**走到结算页并渲染复盘**时才会入库，对局中途退出不会记录；
- 想核对是否写入：F12 → Application → Local Storage → `cetArena.wrongBook.v1`，正常应为 `{"version":1,"words":[{"word":"breast","streak":0,"wrongCount":1,...}]}`。

**激活码提示「该卡密已绑定其他设备」**

- 一次性卡密首次验证成功即绑定**当前浏览器的设备 Token**（存在 `localStorage` 的 `cetArena.deviceToken.v1`），不是绑定 IP；
- 因此**在同一个校园网/同一个公网 IP 下换一台电脑或换一个浏览器，也会被拦截**——这正是设计目标（防全校白嫖）；
- 同一台设备换网络（宿舍 Wi-Fi ↔ 手机热点 ↔ 流量）**不会**触发，刷新页面会自动静默重验，不重复消耗；
- 清空浏览器数据 / 换无痕窗口会生成新的设备 Token，旧码随之失效；
- 需要换设备使用，请在后台 `/admin` 点「解绑 / 重置」，客户即可在新设备上重新激活。

**站长后台进不去 / 忘了密码**

- 默认密码在 `src/adminAuth.js` 的 `DEFAULT_PASSWORD`（**仅本地开发与测试占位**），线上通过环境变量 `ADMIN_PASSWORD` 覆盖，改完需重启服务；**生产环境必须注入 `ADMIN_PASSWORD`，缺失或为空白时服务会拒绝启动**（`NODE_ENV=production` 下启动即退出，代码见 `server.js` 的 `assertAdminPasswordInProduction`）；
- 连续输错 5 次会锁定 10 分钟，等一会儿再试，或重启服务立即解锁（锁定状态只在内存里）；
- 登录态存在服务端内存，服务重启后需要重新登录，属预期行为。

**后台生成/解绑点击后没反应**

- 先确认是否还处于登录状态（页面会自动回到密码框即表示登录过期）；
- 生成数量必须在 1–100 之间，超出会被服务端拒绝并提示；
- 后台素材使用 `Cache-Control: no-store`，若界面明显陈旧，强制刷新一次即可。

**朋友进不来 / 提示需要激活码**

- 本项目没有免码席位：建房和加入都必须各自输入一个有效激活码，房主无法替朋友放行；
- 每个普通码绑定首次验证的那台设备（device_token），朋友用自己的码才能进场；如果朋友拿的是别人的码，会被判定「已绑定其他设备」，请联系站长解绑或补发。

**本地执行命令提示「沙箱后端不可用」**

- 原因：DSH 会话私有的沙箱临时目录（`%TEMP%\dsh-xxxxxx`）被清理工具删除后，命令执行器会 fail-closed 退出；
- 处理：重建该目录，或把用户级 `TMP`/`TEMP` 指向不会被清理的固定目录（如 `C:\Users\Yuan\.dsh\tmp`）后重启 DSH；
- 若某个目录在沙箱内报「拒绝访问」而资源管理器能打开，多半是它丢失了从上级目录继承的权限，可用 `icacls <目录> /inheritance:e /T` 恢复继承。

## 10. 【AI 深度思考与协作规约】

- 【全局推演，主动思考】: 不要只做“指哪打哪”的机械执行者。遇到新需求或新问题，请先在大脑中进行全局推演（前端渲染、后端逻辑、数据结构、业务闭环），主动发现并预警可能存在的连锁 Bug。你的聪明才智请尽情发挥在这里。
- 【方案前置，透明决策】: 遇到非显而易见的 Bug 或架构选择时，请给出 1-2 个可行的实现方案（包含优缺点和你的推荐），先汇报给我和顾问。未经确认前，绝不擅自盲目大改。
- 【及时熔断，拒绝死磕】: 如果修复同一处 Bug 超过 3 次仍失败，请立刻停止尝试，原原本本地汇报报错和你的推测，请求人工介入。禁止无脑重试烧 Token。
- 【思路透明化】: 在关键代码改动或架构调整前，请在对话中简要说明：“我为什么这么做”、“这会影响什么”。让我知道我在想什么。
