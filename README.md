# CET Arena

仅限两位好友通过 6 位房间码实时对战的大学英语词汇竞技 Web 应用。当前重点建设 CET-4 核心词库。

- 后端：Node.js + Express + Socket.IO
- 前端：原生 HTML / CSS / JavaScript 单页，无构建工具，移动端友好
- 数据：房间、比分、会话全部保存在服务端内存；词库为本地 JSON
- 房间：6 位房间码，最多 2 人；房主控制模式和词库范围，双方准备后开始
- 抢答：10 题，15 秒倒计时，先答对 +10 分，答错 −5 分并锁题，超时无人得分
- 竞速：25 题，双方独立进度，答错 1 秒冷却；一方完成后等待，双方都完成后按总用时、错误数结算
- 词库：200 个 CET-4 核心词，每个词包含多个带词性、词频权重的释义；CET-6 建设中
- 题型：50% 英译中、30% 中译英、20% 听音选词；10 题固定 5/3/2，25 题固定 5 道听音选词
- 发音：原生 `speechSynthesis`，优先 en-US；英译中题干旁喇叭，听音选词大喇叭，点击才播放，不自动播放
- 复盘：展示单词拼写、词性、完整释义、对错/未作答；答错后纠正的题仍标红；竞速另含双方进度、用时、错误数
- 网络：顶部实时显示 Ping；>200ms 黄色、>500ms 红色；断线自动快速重连
- 部署：单实例内存房间，支持本地运行和 Cloudflare Quick Tunnel 公网访问

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

- 首页：填写昵称，创建房间，或输入 6 位数字房间码加入。
- 房主在房间准备页通过“词库范围”下拉框选择词库，默认 **CET-4 核心**。
- 当前已录入 **200 个 CET-4 高频核心词**；CET-6 词库尚未加入。
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
- **英译中**：题干显示英文单词，选项显示带词性的中文释义，提示“选择正确的中文释义”；题干旁有喇叭按钮。
- **中译英**：题干显示带词性的最高频中文释义，选项显示四个纯英文单词，提示“选择正确的英文单词”。
- **听音选词**：题干区域只显示一个大喇叭，不显示英文单词或中文释义；进入题目不自动播放，必须点击喇叭才会发音，选项为四个纯英文单词。
- 每局按 50/30/20 配额随机决定题型并打乱顺序：10 题固定 5 道英译中 + 3 道中译英 + 2 道听音选词；25 题固定 5 道听音选词，英译中 12/13 道、中译英 7/8 道随机，长期比例保持 50/30/20。
- 三种题型的单词都不重复，且干扰项来自其他单词。
- **发音**：只使用浏览器原生 `speechSynthesis`，优先 en-US 音色；英译中和听音选词点击喇叭才播放，不会自动播放。浏览器不支持或播放报错时，底部提示“当前浏览器不支持发音，请尝试在外部 Safari/Chrome 中打开”。
- **复盘**：始终展示单词拼写、词性、完整释义和你的对错/未作答标记；答错后纠正的题仍显示为答错。竞速复盘还包含双方进度、用时和错误数。
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

该命令会运行三套测试：

- `test/e2e.test.js`：抢答模式完整 10 题、模式切换、比分、复盘、重连。
- `test/race.test.js`：竞速模式 25 题、双人独立进度、一方完成后等待、双方完成后结算、1 秒冷却锁题、复盘、再来一局。
- `test/mixed.test.js`：压力生成 3 万+ 道题，校验英译中/中译英/听音选词题干与选项零错配。

覆盖内容：

- 创建/加入、第三人已满、房主权限、准备校验
- 词库范围默认 CET-4，选择 CET-6 提示建设中并回退
- 200 个 CET-4 单词全部唯一，每次开局重新随机洗牌
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
- 当前词库：**CET-4 200 条，CET-6 0 条（建设中）**；
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

## 6. 项目结构

```text
cet-arena/
├─ data/
│  └─ words.json           # 本地多释义词库（CET-4 200 词）
├─ public/
│  ├─ index.html            # 单页四视图 + 模式选择 + 复盘列表
│  ├─ styles.css            # 深色桌面/移动端样式
│  └─ app.js                # Socket.IO 客户端、双模式状态、倒计时/惩罚
├─ scripts/
│  └─ start-tunnel.ps1      # 便携版 Cloudflare Quick Tunnel
├─ src/
│  ├─ app.js                # Express + Socket.IO 房间/抢答/竞速状态机
│  └─ wordBank.js           # 词库校验、最高频释义、抽题、选项打乱
├─ test/
│  ├─ e2e.test.js           # 抢答模式双客户端回归
│  ├─ race.test.js          # 竞速模式双客户端回归
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
- **发音**：前端只使用浏览器原生 Web Speech API（`window.speechSynthesis`）。每次 `speak()` 前先 `cancel()` 清空队列；优先选择 en-US 音色，找不到时使用任意英文音色。`speak()` 直接在 click/touchend 的同步回调中调用，不经过异步请求或定时器。若浏览器不支持或播放报错，底部提示“当前浏览器不支持发音，请尝试在外部 Safari/Chrome 中打开”。不使用任何外部音频链接。
- **题型防错配**：`assertQuestionShape` 在出题阶段强校验题型、题干、提示和四个选项；任何错配会直接抛错，不会发到前端。
- **前后端版本握手**：Socket.IO 连接必须携带 `APP_VERSION`。旧页面无法连入新后端，会提示刷新，避免旧渲染逻辑误读新题型数据。
- **复盘数据**：服务端在对局结束时生成完整 review，包含单词、所有释义、词性、词频、双方每题状态和 `mistakes` 标记；竞速模式中只要某题选错过一次，`hasMistake` 就保持为 true，答错后纠正也会在复盘中显示为答错。前端只展示“你”的状态。
- **重连**：创建/加入时返回随机 `sessionId`，刷新后 `room:resume` 恢复；竞速模式还会补发个人当前题、进度与惩罚截止时间。
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
- [x] 词库包含 200 个不重复 CET-4 单词，每个单词双释义
- [x] 房间准备页有“词库范围”下拉框，默认 CET-4
- [x] 选择 CET-6 会提示“六级词库正在建设中，请先体验四级”并回退
- [x] 没有混合词库选项
- [x] 竞速模式每局从 200 词中重抽 25 个不重复单词，重新开局重新洗牌
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
- [x] 听音选词只显示喇叭、点击后才播放，选项为纯英文单词
- [x] 英译中题干旁喇叭可播放 en-US 发音
- [x] 使用原生 `speechSynthesis`，每次播放前清空队列
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
- [x] 自动化 `npm test` 通过（抢答 + 竞速 + 混合题型三套）

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
