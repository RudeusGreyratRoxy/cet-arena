# HANDOFF · 进度交接

> 新会话开始前先读本文件；每次任务结束、提交代码前更新「时间轴更新日志」「当前进度」与「待办事项」。

## 时间轴更新日志

> 强制格式（最新在最上）：`[YYYY-MM-DD HH:mm] 版本号 | 核心改动 | 遗留问题`
> 每次任务结束**必须**在此节点顶部新增一行，无需用户提醒。

- [2026-11-12 21:04] `20261112-vip12`（待部署） | 新增首页更新公告：`data/announcement.json`（运行时态、已 gitignore）+ `GET /api/announcement`（公开、`no-store`）+ `POST /api/admin/announcement`（`requireAdmin`、≤500 字、审计只记长度不记正文）；首页横幅按 `updatedAt` 去重（localStorage），`textContent` 渲染 + `pre-wrap` 保留换行；后台新增第三个 tab（`switchTab` 改三值枚举 + `dirty` 标记防 30s 轮询覆盖）；`APP_VERSION` → vip12；新增 announcement 测试，13 套全绿；预置首条维护公告 | 待部署，部署时需同时保留 `ADMIN_PASSWORD` 与 `VIP_UNLIMITED_CODES`
- [2026-11-12 20:48] `20261112-vip11`（版本不变） | 公告功能方案设计中：完成只读排查与设计——`data/announcement.json`（运行态、需 gitignore）+ `GET /api/announcement`（公开、no-store）+ `POST /api/admin/announcement`（requireAdmin）+ 首页横幅 + 后台第三个 tab + localStorage 按 `updatedAt` 防重 + 审计只记长度不记正文；未写任何代码、未改配置 | 待老板确认后进入 Phase 2 实现
- [2026-11-12 20:38] `20261112-vip11`（已上线） | 专属码已调整为易记安全组合（`CETWINNER2026` / `WORDMASTER888`，由环境变量 `VIP_UNLIMITED_CODES` 注入），上一组长串（`NEBULAORBIT27` / `QUARTZMEADOW88`）已失效；pm2 安全重启（pid 657327，↺19）并 `pm2 save`；线上实测新码 `kind=unlimited` 且免设备 Token、旧长串带/不带 Token 两路均 `INVALID`、审计日志脱敏为 `CE****26`/`WO****88` | 无
- [2026-11-12 20:22] `20261112-vip11`（已上线） | 专属码已替换为随机长串（两个新码由 PM2 环境变量 `VIP_UNLIMITED_CODES` 注入，`ADMIN_PASSWORD` 同步保留），旧测试码 `TEXTCODE001` 已失效；pm2 安全重启（pid 653262，↺18）并 `pm2 save`；线上实测新码 `kind=unlimited` 且免设备 Token、旧码 `INVALID`、`vip_verify` 审计日志脱敏正常 | 无
- [2026-11-12 19:52] `20261112-vip11`（已上线，专属码止血收尾完成） | 专属码止血改造已部署并完成真机验收：旧码（原两条站长码）已废弃、新码改由环境变量 `VIP_UNLIMITED_CODES` 注入并生效、`vip_verify` 审计日志已脱敏；服务器已同步文档 commit `7ed3ba3`，pm2 当前日志已 flush、历史归档已定向脱敏（明文旧码 0 命中） | 无（新码建议后续换成随机长串，当前为可猜的占位串）
- [2026-11-12 19:23] `20261112-vip11`（版本不变｜**Phase A 本地完成，未部署**） | 专属码止血：`src/vipCodes.js` 支持环境变量 `VIP_UNLIMITED_CODES`（逗号分隔）注入 unlimited 码，JSON 同码优先不覆盖、为空仅 warn 不崩；`data/vip_codes.json` 移除两条 unlimited 种子（仅剩 9 条 once）；`src/app.js` 新增 `maskCode()`，`vip_verify` 审计日志改为首2+****+末2（<6 位全星）；`.gitignore` 补 `.env.production`；solo/trial 测试改用临时 env 码（`TESTBOSS1`） | Phase B 必须在 PM2 注入 `VIP_UNLIMITED_CODES` 再重启，否则线上将**没有任何站长码**（后台密码不受影响）
- [2026-11-12 19:13] `20261112-vip11`（版本不变） | 只读排查专属卡密：两个专属码**不在源码硬编码**，来自 `data/vip_codes.json` 的 `type: "unlimited"`（种子文件入库）；`src/vipCodes.js` 的 `verify()` 在「设备 Token 校验」之前（L133-135）提前放行，故免绑设备；普通码与专属码**共用同一个 `verify()`**，仅由 `normalizeType()`（L74-76）按 type 分流；后台 `reset()`（L217-219）显式拒绝 unlimited、`public/admin.js` 状态渲染为「永久可用」（L168）且只在 `used` 时渲染解绑按钮（L228）→ **无法后台作废**，只能改种子文件 + 重启；另发现 `vip_verify` 审计日志记录了完整尝试码（`src/app.js:1327`，未脱敏） | 建议：专属码改由环境变量下发 + 增加「作废/启用」开关，审计日志对码做掩码
- [2026-11-12 18:05] `20261112-vip11`（已上线） | 上线单人限时闯关（3关*50词池，10题/局，限时10s/7s/5s递减）；免费用户封锁错词本；新增第4关占位；修复前端点击穿透Bug | 无
- [2026-11-12 18:00] `20261112-vip11`（已上线） | 部署 vip11 到腾讯云：`git pull` a261927 + `pm2 restart cet-arena --update-env`（从 /proc 读回并原样回注 `ADMIN_PASSWORD`，环境哈希前后一致）+ `pm2 save`；公网 healthz 返回 vip11，首页资源 `?v=vip11`，线上 `app.js` 已含 `trialPlay` 注册 | 无
- [2026-11-12 17:58] `20261112-vip11` | 修复手机端「点击第 1 关无反应」：`el` 映射漏注册 `trialPlay`，`startTrial` 里 `el.trialPlay.hidden = false` 抛 `TypeError`，且该行在 `setView('trial')` 之前，async 异常被吞 → 界面无任何反应（请求其实已发出）。补 `el.trialPlay`，新增「点击关卡进入答题页」回归用例（摘掉修复即可复现该 TypeError），`APP_VERSION` → vip11 破缓存 | 待部署
- [2026-11-12 17:40] `20261112-vip10` | 阶段 1&2：单人限时闯关（第 1/2/3 关每题 10/7/5 秒，服务端按 deadline 复核超时并判错）+ 错词本改为 VIP 专属（服务端 `solo:start` 加激活闸门）+ 关卡列表第 4 关灰色占位；levels.json 缩为每关 50 词，新增 trial 回归测试 | 线上仍 vip9（未部署）；关卡按 id 顺序（字母序）待人工选题优化
- [2026-11-12 17:32] `20261112-vip10` | 阶段 0：新增 `data/levels.json`（3 关 × 60 词）+ `src/levels.js`（读取/校验/`trialPoolFor`/`listLevels`）；修复断线重连后 VIP 假拦截（每次 connect 静默重验）；`APP_VERSION` 升至 vip10 | 关卡尚未接入对局（阶段 1 处理）
- [2026-11-12 17:31] `20261112-vip9`（版本不变） | README 新增 AI 深度思考与协作规约章节 | 无
- [2026-11-12 17:13] `20261112-vip9`（版本不变） | 线上后台密码已通过环境变量安全轮换，验证可用；确认专属卡密([已废弃-见环境变量])为无限免绑码，无过期机制，泄露无法后台解绑，需注意保密 | HTTP明文传输隐患待域名备案后解决
- [2026-11-12 16:19] `20261112-vip9`（版本不变） | 清理 HANDOFF 中 vip5/vip8 过期表述，修正服务器提交记录 | 无
- [2026-11-12 16:05] `20261112-vip9`（已上线） | 部署到腾讯云 4ad475f + `ADMIN_PASSWORD` 注入重启 + `pm2 save`；线上实测：连发 5 条成功、第 6 条被限流、标记已处理后额度归还、删除后计数下降，测试数据已清理 | 无
- [2026-11-12 16:04] `20261112-vip9` | 留言板限流改为**动态配额**：同一设备同时最多 5 条「未处理」留言，站长标记已处理/删除后额度自动归还；配额校验从「总数」改为「`status !== 'handled'` 计数」；前端弹窗提示与超限文案同步 | 无
- [2026-11-12 15:55] `20261112-vip8`（已上线） | 部署到腾讯云：`git pull` 471e4bd + `ADMIN_PASSWORD` 注入重启 + `pm2 save`；线上音频 2869 个文件、`/audio/abandon.mp3?v=2` 返回 9936B + immutable | 无
- [2026-11-12 15:43] `20261112-vip8` | 音频升级为 edge-tts `en-US-JennyNeural`（24kHz/48kbps，均 9.4KB、全量 26.38MB）；音频 URL 加 `?v=2` 破 immutable 缓存；清房宽限 10s→60s，`deleteRoom` 补 `io.socketsLeave` + 清理 `socketPlayers`/`socket.data` | 已随本次部署上线
- [2026-11-12 ~15:05] `20261112-vip7` | 发音彻底废弃 `speechSynthesis` 改本地 MP3（8kHz/24kbps）；新增「点击唤醒声音」静音 MP3；留言板 + 后台「留言管理」；删除 debug 面板 | 音质发闷，需换高质量 TTS（已在 vip8 解决）
- [2026-11-12 ~14:00] `20261112-vip5` | 卡密绑定主体从 IP 改为设备 Token，堵住校园网 NAT 白嫖；后台卡密表新增「绑定设备」列 | 无
- [2026-11-12 ~12:40] `d6e5c10` | 站长后台 `/admin` 上线：卡密列表、批量生成、解绑重置、密码登录 + 防爆破限流 | 无
- [2026-11-11 ~23:00] `1b60792` | VIP 付费墙三档套餐文案定稿（孤狼独行 / 双人成行 / 宿舍开黑） | 无

> 说明：2026-11-11 及更早的改动为倒推补录，时刻为近似值；从 vip8 起为实时记录。

## 当前进度

- **【音质升级】发音改为微软神经网络语音（版本 `20261112-vip8`，已于 2026-11-12 15:55 随 vip8 上线）**：
  - 老板反馈旧版（Windows SAPI 8kHz/24kbps）"发闷像老式电话"。已换 `edge-tts` + **`en-US-JennyNeural`** 音色。
  - 参数：**24kHz / 48kbps / 单声道 MP3**，平均 **9.4KB**，全量 **26.38MB**（2868 词 + 1 静音，零失败）。
  - 生成脚本：`scripts/build_audio_edge.py`（异步并发 8，约 11.7 分钟跑完）。旧脚本 `build_audio.py` 保留作离线兜底。
  - **关键坑**：`/audio` 是 `immutable` 一年强缓存，换音源必须递增 `app.js` 里的 `AUDIO_VERSION`（当前 `2`），URL 变为 `/audio/<word>.mp3?v=2`，否则老设备一年内不会重新拉取。
  - **环境坑**：`edge-tts` 装在 `.tools/pylibs-tts`，该目录在沙箱下读不出来（DACL 无继承），必须用**全权限**运行生成脚本；`edge_tts.Communicate` 在全权限下可正常导入。
- **【架构变更】发音从 `speechSynthesis` 全面切换为本地 MP3**：
  - 根因：真机 `secureContext=false`（HTTP 环境），多数手机浏览器直接禁用 `speechSynthesis`，导致"点了唤醒也没声音"，且按钮因能力检测被隐藏。
  - 服务端：`/audio` 单独挂 `express.static`，下发 `Cache-Control: public, max-age=31536000, immutable`。
  - 前端：`new Audio('/audio/<word>.mp3?v=2')` 播放，元素缓存上限 60；题目到达即 `preload`，200ms 后播放；唤醒按钮改为播放 `_silent.mp3`（0.5 秒静音），不再依赖任何 TTS 能力检测。
  - **整局预取不可行**：中译英/听音选词的单词就是答案，提前下发等于泄题，只能题目到达后再取。
  - `public/debug-panel.js` 与 `window.__cetDebug` 已彻底删除。
  - 测试：`solo-ui` 的假 TTS 已改为假 `Audio` 并断言播放地址；全量 **11 套** 通过；无头 Chrome 实测"进房间→按钮出现→点击解锁→单词播放成功→控制台 0 报错"。
- **【新功能 1】声音唤醒引导（已随 vip8 于 2026-11-12 15:55 上线）**：准备页/对局页顶部显示「🔊 点击唤醒声音」，点击后在同步手势里播放 0.5 秒静音 MP3；`play()` resolve 即解锁并隐藏按钮，reject 则保留按钮提示重试。
- **【新功能 2】联系站长留言板（vip9 起为动态配额）**：首页右下角悬浮按钮 → 弹窗输入（原生 `maxlength=50` + 实时字数）→ socket `message:create`。服务端按 `device_token` 的 SHA-256 **实时统计「未处理」条数**，同一设备**同时最多 5 条未处理**留言；站长标记已处理或删除后额度自动归还。另加 5 秒冷却防连点，落 `data/messages.json`（已 gitignore）。后台「留言管理」标签页（带待处理红点），按时间倒序，可标记已处理 / 恢复 / 删除。
- **【重要机制变更】卡密绑定主体从「IP」改为「设备 Token」**（已上线，版本 `20261112-vip5`）：
  - 背景：原方案按首个验证 IP 绑定，但大学校园网普遍是 NAT，全校共用一个公网 IP，等于「一人买码、全校白嫖」，是致命业务漏洞。
  - 现在：前端首次打开页面即在 `localStorage` 的 `cetArena.deviceToken.v1` 生成 32 位随机 Token（`crypto.randomUUID()` 优先），每次 `vip:verify` 一并上传；后端把它作为唯一绑定主体，Token 不一致直接拒绝「该卡密已绑定其他设备」。
  - 同一台设备换网络（宿舍 Wi-Fi ↔ 手机热点）**放行**；换设备（哪怕还在同一个校园网、同一个 IP）**拦截**。
  - IP 降为风控参考：记录 `boundIp`（首次）与 `lastIp`（最近），不参与放行判断。
  - 老数据（只有 `boundIp`）可在同 IP 首次带 Token 时平滑迁移；线上当前无已绑定卡，无迁移包袱。
- 站长专属后台已上线：<http://1.15.152.160:3000/admin>，分「卡密管理」「留言管理」两个标签页。
- 线上站长密码**由 PM2 环境变量 `ADMIN_PASSWORD` 提供**（不是代码里的默认值），已执行 `pm2 save` 持久化。密码明文**不写入仓库**。
- VIP 仿真付费墙已上线：**孤狼独行 ￥19.9（1 码）/ 双人成行 ￥29.9（2 码）/ 宿舍开黑 ￥59.9（6 码）**，点任一购买按钮只提示「支付通道维护中，请联系站长获取激活码」，不接真实支付、无收款码。
- 激活码为**单一类型**：一码绑定一台设备、同设备可复用、并发加锁；`[已废弃-见环境变量]` 为站长码，不限次、不绑设备。验证通过后既能建房也能加入，未验证两者全拦截，房主房间没有免码席位。
- 线上运行 `20261112-vip9`（设备 Token 版 + 高清神经网络音频 + 声音唤醒 + 留言板动态配额 + 清房防误杀）；**vip8 的高清音频、声音唤醒、留言板与清房防误杀改造均已随 vip8（`471e4bd`）与 vip9（`4ad475f`）部署上线**；本地已到 `20261112-vip10`（未部署）。

## 线上版本

- 服务器提交：功能提交 `4ad475f feat: 留言板改为动态配额（同时最多 5 条未处理）（vip9）`，随后文档提交 `984c050 docs: 记录 vip9 上线与配额验收结果` 为分支 HEAD
- 前端版本号：本地 `20261112-vip11` / 线上 `20261112-vip11`（已同步）
- 地址：<http://1.15.152.160:3000>　后台：<http://1.15.152.160:3000/admin>
- 音频：`public/audio/` 2869 个文件（26.38MB），`/audio/<word>.mp3?v=2` 走 immutable 强缓存
- 留言：`data/messages.json`，当前 0 条（验收数据已清理）
- 卡密状态：`/opt/cet-arena/data/vip_codes.state.json` 不存在（全新，11 张卡 → 9 可用 / 0 已绑定）
- 进程环境：`ADMIN_PASSWORD` 已注入并 `pm2 save` 持久化（可用 `pm2 pid cet-arena` + `tr '\0' '\n' < /proc/<pid>/environ | grep ADMIN` 复核）

## 待办事项

- 线上已全量同步 vip9，暂无阻塞项；今晚收工。
- 观察项：新 `emptyRoomGraceMs` = 60 秒是否够用（原 10 秒易误杀），若仍有玩家反馈对局中掉线后回不来可再放宽。
- 安全加固建议：生产环境若缺少 `ADMIN_PASSWORD` 应拒绝启动或强制报错，避免静默回落到代码里的默认占位密码。
- 轮换密码方式：`ADMIN_PASSWORD='新密码' pm2 restart cet-arena --update-env && pm2 save`（变量名固定，值只存在于服务器）。
- 后续可选：留言按「已处理/待处理」分页、卡密按批次打标签、导出 CSV。
- 重做音频：`PYTHONPATH=<.tools/pylibs-tts> python scripts/build_audio_edge.py --skip-existing`（需全权限 + 联网），换音源记得递增 `AUDIO_VERSION`。

## 环境坑位

- 本地 3000 端口易被旧进程占用，需强杀（`netstat -ano | findstr :3000` → `taskkill /PID xxx /F`）。
- `data/vip_codes.state.json` 不入库（已 gitignore），删掉对应键即可重置某张卡密的绑定；删文件后需重启服务才生效（状态在启动时加载）。
- `data/messages.json` 同样不入库（已 gitignore）。想清空所有留言就删这个文件，但**服务启动时已把内容读进内存**，删完必须重启才能生效。
- **重新生成单词音频**：`edge-tts` 装在 `.tools/pylibs-tts`，该目录在沙箱下**读不出来**（DACL 无继承、缺 DSH 包授权），必须用**全权限**运行；普通沙箱下 `import edge_tts` 会得到命名空间包并报 `no attribute 'Communicate'`。命令：`PYTHONPATH=<...>\.tools\pylibs-tts python scripts/build_audio_edge.py`（并发 8，约 12 分钟）。旧方案 `build_audio.py` 依赖 `lameenc`（`.tools/pylibs-enc`，加载 `.pyd` 也需全权限）。
- **`public/audio/` 要入库**（2869 个文件 / **26.38MB**），提交和 `git pull` 都会明显变慢，属正常。
- **设备 Token 存在浏览器 `localStorage` 的 `cetArena.deviceToken.v1`**：清空浏览器数据、换无痕窗口、换浏览器都会生成新 Token，导致已绑定的码失效（需后台解绑），留言的 20 条额度也会重置。排查时可在 DevTools → Application → Local Storage 里看这个键的值，与后台「绑定设备」列的前 8 位比对。
- 线上部署走 Deploy Key + `ssh.github.com:443`：`cd /opt/cet-arena && git pull && pm2 restart cet-arena`。
- 改动前端资源后必须升 `APP_VERSION`，否则浏览器会用 7 天缓存里的旧脚本（`dom-contract.test.js` 会校验 `?v=` 与版本号一致）。
- `git` 不在系统 PATH 里，直接敲 `git` 会报「无法识别」。需用工作区自带的 portable git：
  ```powershell
  cd C:\Users\Yuan\Documents\deepseek-harness\default-workspace\cet-arena
  & "..\.tools\portablegit\cmd\git.exe" status
  ```
  也可先用 `$env:PATH = "..\.tools\portablegit\cmd;$env:PATH"` 临时注入，之后就能正常用 `git`。
- `node` 也不在系统 PATH 里，要用 DSH 自带的运行时：
  `C:\Users\Yuan\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`（v24.21.0），
  例如 `& $node test/admin.test.js`。`npm` 同理不可直接用。
- **沙箱禁止创建命名管道**，凡是依赖它的操作都会被拦（`Win32 error 5`）：
  - `git push / fetch` 走 ssh 时要 `sh.exe` 建信号管道 → 需放宽沙箱权限重试一次；
  - 无头 Chrome/Edge 的 mojo IPC 也走命名管道 → 截图脚本同样需要放宽权限。
  这不是密钥或权限配置问题，报错里看到 `couldn't create signal pipe` / `platform_channel.cc` 就是这个原因。
