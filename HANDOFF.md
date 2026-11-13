# HANDOFF · 进度交接

> 新会话开始前先读本文件；每次任务结束、提交代码前更新「时间轴更新日志」「当前进度」与「待办事项」。

## 时间轴更新日志

> 强制格式（最新在最上）：`[YYYY-MM-DD HH:mm] 版本号 | 核心改动 | 遗留问题`
> 每次任务结束**必须**在此节点顶部新增一行，无需用户提醒。

- [2026-11-13 17:51] `20261112-vip17`（版本不变·本地凭据收尾） | **凭据迁移闭环**：`.tools/srvkey` 7 个文件迁至 `C:\Users\Yuan\.dsh\srvkey\`（工作区外、非任何 git 仓库），三个脚本内私钥路径已改、`rsh.py` 实测连通（回显 `MIGRATE_OK`）；服务器拉齐 `8d78468 → 54a02af`（纯文档，未重启，restarts 26）；顺带修正 `现为 14 套 → 15 套` | 无
- [2026-11-13 17:43] `20261112-vip17`（版本不变·本地凭据迁移收尾） | 余下三个配套文件 `authorized_line.txt` / `id_ed25519.pub` / `known_hosts` 移入 `C:\Users\Yuan\.dsh\srvkey\`，旧 `.tools\srvkey\` 已空并删除；复核工作区无脚本残留旧路径（三个脚本均用 `AutoAddPolicy`、不读 `known_hosts`，行为不变）；工作区剩余 `srvkey` 字样仅本文件的新位置说明 | 无
- [2026-11-13 17:41] `20261112-vip17`（版本不变·本地凭据迁移，仅文档入库） | 服务器凭据迁出工作区：`rsh.py` / `authtest.py` / `put.py` + 私钥 `id_ed25519` 移至 `C:\Users\Yuan\.dsh\srvkey\`（工作区外、不属于任何 git 仓库），三者内部私钥路径改为 `C:/Users/Yuan/.dsh/srvkey/id_ed25519`（逐字节替换，`rsh.py` 的 UTF-8 BOM 保留，字节 2684 → 2637）；实测 `rsh.py "echo MIGRATE_OK"` 回显 `MIGRATE_OK`（需 `PYTHONPATH=.tools/pylibs` + 全权限）；文档侧原本**没有任何凭据路径记录**，故改为新增运行方式说明而非改路径；未重启服务 | 旧 `.tools\srvkey\` 仍余 `authorized_line.txt` / `id_ed25519.pub`(0B) / `known_hosts` 三个非凭据文件，未 `rmdir`
- [2026-11-13 17:25] `20261112-vip17`（版本不变·仅后端） | **安全项落地：生产环境密码失效保护**。`server.js` 新增 `assertAdminPasswordInProduction()`：`NODE_ENV=production` 且 `ADMIN_PASSWORD` 缺失或 trim 后为空时，用 `fs.writeSync(2, …)` 写清原因再 `process.exit(1)`，绝不静默降级；`src/adminAuth.js` 的密码解析从 `a || b || c` 改为显式判断（「已设置但为空」直接抛错，只有完全未设置才回落本地默认值）；新增 `test/env-guard.test.js`（14 项断言，已验证摘掉守卫即失败）；测试链 14 → 15 套全绿；已部署：`git pull` 到 `44ed2fd` + **显式回注 `ADMIN_PASSWORD`/`VIP_UNLIMITED_CODES`/`NODE_ENV`/`PORT` 重启**（非裸 restart），restarts 25 → 26，线上实测守卫 exit=1、healthz 正常、两个变量长度不变 | 无
- [2026-11-13 17:13] `20261112-vip17`（版本不变·纯文档） | 文档对齐：HANDOFF 正文三节（当前进度 / 线上版本 / 待办事项）改到 vip17 实测现状、与顶部时间轴消除矛盾，补 vip15–vip17 安全闭环摘要与 PM2/卡密实测值；README 修 4 处过期条目（§3 测试套数改 14 套且 `admin-ui` 不重复计数、§7 发音改本地 MP3、声音唤醒清单不再依赖 TTS 能力检测、§9 音频重跑脚本改 `build_audio_edge.py`）；未动代码、未改 `APP_VERSION`/`?v=`、未重启 | 无
- [2026-11-13 17:05] `20261112-vip17`（已上线） | 收尾：把「前端缓存与版本号规约」写进 README（index 用 `APP_VERSION` + 三处 `?v=`；admin 用 `admin.html` 的 `?v=` + 服务端 no-store，不递增 APP_VERSION）；补全「未验证清单」；核对本轮版本 `vip16 → vip17` 已递增、`admin.html` 资源版本号 `vip14 → vip17` 已对齐；工作区干净，4 个 data 运行时文件均被 gitignore | 无
- [2026-11-13 13:50] `20261112-vip17`（待部署） | 修复后台「拉黑 N 台」不显示：`statusOf()` 原先把拉黑数拼在 `revoked` 分支内，`allow-rebind` 把状态改回 `available` 后提示就消失；改为**任何状态**只要 `revokedDeviceCount > 0` 都渲染「· 拉黑 N 台」；新增 `test/admin-ui.test.js`（假 DOM 真跑 `admin.js`：available/used/revoked 三态 + 0 台不显示 + 按钮渲染），已验证「删掉修复该用例立即失败」；测试链 13 → 14 套全绿；`APP_VERSION → vip17` | 待部署
- [2026-11-12 22:45] `20261112-vip16`（待部署） | **解绑重构为封禁机制（补齐换 token 绕过漏洞）**：`reset` 后该码对**所有设备**返回 `REVOKED`（清缓存/换浏览器也无效）；新增 `POST /api/admin/codes/allow-rebind`（封禁→未使用，保留 `revokedDevices` 永久拉黑原设备）；新增 `POST /api/admin/codes/delete`（彻底删除运行时新增的码，种子码 `SEED_PROTECTED`）；踢线修复：设备指纹改在 **Socket.IO 握手 `auth.deviceToken`** + `vip:verify`/`vip:status` 入口统一记录（验证失败也记录）；`describe()` 增加 `revokedDeviceCount`/`deletable`，`stats()` 增 `revoked` 且封禁码不计入可用；后台按状态显示「解绑/封禁」「允许换机」「彻底删除」；`APP_VERSION → vip16`；13 套全绿（vip 80 / admin 96） | 待部署
- [2026-11-12 22:40] `20261112-vip15`（待部署） | **修复解绑后原设备自动复活（白嫖漏洞）**：根因是 `reset()` 删除 state 记录 → 原设备刷新静默重验命中「首次使用」→ 自动重新绑定。改为 **revoked 语义**（保留记录 + `revokedDevices` 永久拉黑原设备，新设备仍可换机激活）；`verify()` 增加 `silent` 模式（刷新/重连重验**绝不允许首次绑定**）；新增 `vip:status` 按 deviceToken 做权威授权判定；`vip:verify` 记录 `socket.data.deviceToken`，后台解绑时向该设备所有在线连接推送 `vip:revoked`（只清 `socket.data.vip`，不断线、不打断对局）；后台确认文案同步；`APP_VERSION → vip15`；新增 20+ 断言（vip 65 / admin 79），13 套全绿 | 待部署
- [2026-11-12 21:47] `20261112-vip14`（待部署） | 修复后台「看不到自定义生成」：实测线上 `/admin` DOM 本已含 `customCodeInput`/`customGenBtn`，属**手机端缓存旧页面**（旧标签/bfcache）；加固为 `Cache-Control: no-store, no-cache, must-revalidate` + `Pragma`/`Expires`，`admin.html` 内 `admin.js/css` 加 `?v=vip14` 并加 no-store meta；同时修正说明文案为「写入 `vip_codes.custom.json`，种子文件只读」；公告时间改为只显示 `YYYY-MM-DD`，并覆盖线上公告正文（去掉末尾「2026年11月12日」）；新增 5 条后台 UI 回归断言（admin 69 项），13 套全绿 | 待部署
- [2026-11-12 21:35] `20261112-vip13`（待部署） | 购买页三档套餐加「有效期：1年」、卡密框下加「⭐ 增值服务：专属定制卡密 +9.9元」；首页 Footer 新增「关于我们」模态（复用留言弹窗样式、`textContent` 防 XSS）；后台新增自定义卡密生成（`POST /api/admin/codes/generate-custom`，6–16 位 `A-Z/0-9/_`，大小写归一，三级查重：内存 codes / state 历史绑定 / 写前双检，审计 `maskCode` 打码）；**架构调整**：批量与自定义生成的码改存 `data/vip_codes.custom.json`（已 gitignore、启动合并），种子 `vip_codes.json` 恢复只读，彻底消除 pull 冲突；`APP_VERSION → vip13`；13 套测试全绿（vip 50 / admin 64） | 待部署
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

- **【安全加固 · 已上线】生产环境站长密码失效保护（版本仍为 `20261112-vip17`，仅后端、不动前端）**：
  - **问题**：`src/adminAuth.js` 原来写 `options.password || process.env.ADMIN_PASSWORD || DEFAULT_PASSWORD`，`||` 把空串当假值，因此 `ADMIN_PASSWORD=""`（注入失败/变量名写错/漏传值）会**静默降级**成仓库与 README 里都公开的 `boss2026`，且线上无任何告警。属于「失效保护缺失」，不是可用性优化。
  - **修法（方案 A：守卫放单入口，爆炸半径最小）**：
    - `server.js` 新增 `assertAdminPasswordInProduction()`，在 `createArenaServer()` 与 `listen()` 之前执行。仅当 `NODE_ENV === 'production'` 且 `ADMIN_PASSWORD` 为 null 或 trim 后为空时 → 打印明确中文原因 + `process.exit(1)`。用 `fs.writeSync(2, …)` 而不是 `console.error`，避免管道下异步写被 `process.exit` 截断（否则测试与 PM2 日志都看不到失败原因）。
    - `src/adminAuth.js`：抽出 `resolvePassword()` 做显式判断——显式传入 > `ADMIN_PASSWORD` > 本地默认值；**「已设置但为空」抛错**，不再回落默认值；有效值按 trim 后使用。完全未设置时才用 `DEFAULT_PASSWORD`，保证 `npm run dev` 与既有测试不受影响（守卫只写在 `server.js`，测试不经该文件，故 14 套既有测试零改动全绿）。
  - **测试**：新增 `test/env-guard.test.js`（14 项断言，已接入 `npm test`）。子进程 stderr 走**临时文件**而非 `stdio:'pipe'`，规避 DSH 沙箱的命名管道限制。已验证「摘掉守卫即失败」（无守卫时进程不退出，`status=null`）。测试链 **14 → 15 套全绿**。
  - **`APP_VERSION` 未动**（纯后端，不涉及前端缓存）；`?v=` 未动；`ADMIN_PASSWORD` 线上一直存在（长度 11 ≠ 默认值 8 位），本次是补齐失效保护、不是修已被利用的漏洞。
  - **部署**：`git pull` 到 `44ed2fd` → 从 `/proc` 读回 `ADMIN_PASSWORD`/`VIP_UNLIMITED_CODES`/`NODE_ENV`/`PORT` 后**显式回注** `pm2 restart --update-env`（非裸 restart）→ `pm2 save`。restarts 25 → 26，守卫在线上实测 `exit=1` 且服务未受冒烟影响，变量长度前后一致。
- **【当前线上状态】`20261112-vip17` 已上线（2026-11-13 13:47 部署，PM2 在线、restarts 25；17:05 完成文档收尾）**：本轮 vip15 → vip17 三版全部是**激活码安全闭环**，没有新功能。
  - **vip15 · 堵「解绑后原设备自动复活」白嫖漏洞**：根因是 `reset()` 删掉 state 记录 → 原设备刷新时静默重验命中「首次使用」→ 自动重新绑定。改为 **revoked 语义**（保留记录 + `revokedDevices` 永久拉黑原设备，新设备仍可换机激活）；`verify()` 增加 `silent` 模式（刷新/重连**绝不允许首次绑定**）；新增 `vip:status` 按 deviceToken 做权威授权判定；后台解绑时向该设备所有在线连接推送 `vip:revoked`（只清 `socket.data.vip`，不断线、不打断当前对局）。
  - **vip16 · 补齐「换 token 绕过」漏洞**：封禁后该码对**所有设备**返回 `REVOKED`（清缓存/换浏览器也无效）；新增 `POST /api/admin/codes/allow-rebind`（封禁 → 未使用，保留 `revokedDevices` 黑名单）与 `POST /api/admin/codes/delete`（只删运行时新增码，种子码返回 `SEED_PROTECTED`）；设备指纹前移到 Socket.IO 握手 `auth.deviceToken`，保证被拉黑的在线设备也能被精准踢线。
  - **vip17 · 修后台「拉黑 N 台」不显示**：`statusOf()` 原先把拉黑数拼在 `revoked` 分支内，`allow-rebind` 把状态改回 `available` 后提示就消失；改为**任何状态**只要 `revokedDeviceCount > 0` 都渲染；新增 `test/admin-ui.test.js`（available/used/revoked 三态 + 0 台不显示 + 按钮渲染），已验证「删掉修复该用例立即失败」。
  - 测试链 **13 → 14 套全绿**；`APP_VERSION vip16 → vip17`，`admin.html` 资源版本号 `vip14 → vip17` 已对齐；本地与服务器工作区均干净。
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
  - 测试：`solo-ui` 的假 TTS 已改为假 `Audio` 并断言播放地址；**当时**全量 11 套通过（现为 15 套）；无头 Chrome 实测"进房间→按钮出现→点击解锁→单词播放成功→控制台 0 报错"。
- **【新功能 1】声音唤醒引导（已随 vip8 于 2026-11-12 15:55 上线）**：准备页/对局页顶部显示「🔊 点击唤醒声音」，点击后在同步手势里播放 0.5 秒静音 MP3；`play()` resolve 即解锁并隐藏按钮，reject 则保留按钮提示重试。
- **【新功能 2】联系站长留言板（vip9 起为动态配额）**：首页右下角悬浮按钮 → 弹窗输入（原生 `maxlength=50` + 实时字数）→ socket `message:create`。服务端按 `device_token` 的 SHA-256 **实时统计「未处理」条数**，同一设备**同时最多 5 条未处理**留言；站长标记已处理或删除后额度自动归还。另加 5 秒冷却防连点，落 `data/messages.json`（已 gitignore）。后台「留言管理」标签页（带待处理红点），按时间倒序，可标记已处理 / 恢复 / 删除。
- **【重要机制变更】卡密绑定主体从「IP」改为「设备 Token」**（已上线，版本 `20261112-vip5`）：
  - 背景：原方案按首个验证 IP 绑定，但大学校园网普遍是 NAT，全校共用一个公网 IP，等于「一人买码、全校白嫖」，是致命业务漏洞。
  - 现在：前端首次打开页面即在 `localStorage` 的 `cetArena.deviceToken.v1` 生成 32 位随机 Token（`crypto.randomUUID()` 优先），每次 `vip:verify` 一并上传；后端把它作为唯一绑定主体，Token 不一致直接拒绝「该卡密已绑定其他设备」。
  - 同一台设备换网络（宿舍 Wi-Fi ↔ 手机热点）**放行**；换设备（哪怕还在同一个校园网、同一个 IP）**拦截**。
  - IP 降为风控参考：记录 `boundIp`（首次）与 `lastIp`（最近），不参与放行判断。
  - 老数据（只有 `boundIp`）可在同 IP 首次带 Token 时平滑迁移；线上当前**没有在用绑定**（`vip_codes.state.json` 仅 2 条已被封禁的历史记录），无迁移包袱。
- 站长专属后台已上线：<http://1.15.152.160:3000/admin>，分「卡密管理」「留言管理」「公告管理」三个标签页（公告管理为 vip12 新增，带待处理红点的只有留言页）。
- 线上站长密码**由 PM2 环境变量 `ADMIN_PASSWORD` 提供**（不是代码里的默认值），已执行 `pm2 save` 持久化。密码明文**不写入仓库**。
- VIP 仿真付费墙已上线：**孤狼独行 ￥19.9（1 码）/ 双人成行 ￥29.9（2 码）/ 宿舍开黑 ￥59.9（6 码）**，点任一购买按钮只提示「支付通道维护中，请联系站长获取激活码」，不接真实支付、无收款码。
- 激活码为**单一类型**：一码绑定一台设备、同设备可复用、并发加锁；`[已废弃-见环境变量]` 为站长码，不限次、不绑设备。验证通过后既能建房也能加入，未验证两者全拦截，房主房间没有免码席位。
- 线上运行 `20261112-vip17`（设备 Token 版 + 高清神经网络音频 + 声音唤醒 + 留言板动态配额 + 清房防误杀 + **封禁 / 允许换机 / 彻底删除** 的完整卡密生命周期）；vip8 音质升级（`471e4bd`）、vip9 留言动态配额（`4ad475f`）、vip11 限时闯关与专属码环境变量化、vip12–vip17 的首页公告 / 自定义卡密 / 封禁机制均已上线；**本地与线上版本号一致，无未部署改动**。

## 线上版本

- 服务版本：`20261112-vip17`，`GET /healthz` 实测 `{"ok":true,"rooms":0,"players":0,"words":2868,"version":"20261112-vip17"}`；PM2 进程 online、**restarts 26**、2026-11-13 17:25 因安全加固部署重启（此前 13:47 那次是 25）
- 服务器代码提交：`44ed2fd fix: 生产环境缺少 ADMIN_PASSWORD 时拒绝启动，堵住静默回落默认口令`
- 服务器 HEAD：与本地一致（该提交含 `server.js`，**必须重启才生效，已显式回注环境变量重启**；只改 README/HANDOFF 的文档提交则 `git pull` 即可，不需要 `pm2 restart`）
- 前端版本号：本地 `20261112-vip17` / 线上 `20261112-vip17`（已同步）；`index.html` 三处 `?v=`、`admin.html` 两处 `?v=` 均为 `20261112-vip17`
- 地址：<http://1.15.152.160:3000>　后台：<http://1.15.152.160:3000/admin>
- 音频：`public/audio/` 2869 个文件（26.38MB），`/audio/<word>.mp3?v=2` 走 immutable 强缓存
- 留言：`data/messages.json`，验收数据已清理；最新状态以 `/admin` →「留言管理」为准
- 卡密状态：种子 `data/vip_codes.json` 9 条 `once` + 环境变量 `VIP_UNLIMITED_CODES` 注入 2 条 `unlimited`；`data/vip_codes.state.json` 现存 **2 条历史绑定记录，均处于封禁态**（`revoked` + `revokedDevices` + `rebindAllowedAt`，来自 11-12 / 11-13 的封禁验收），当前没有在用绑定；运行时自定义码落 `data/vip_codes.custom.json`
- 进程环境：`ADMIN_PASSWORD` 与 `VIP_UNLIMITED_CODES` 均已注入并由 `pm2 save` 持久化（复核：`PID=$(pm2 pid cet-arena)` 后 `tr '\0' '\n' < /proc/$PID/environ | grep -E '^(ADMIN_PASSWORD|VIP_UNLIMITED_CODES)='`，只输出键名、不输出值）

## 待办事项

- 线上已全量同步 vip17，暂无阻塞项；vip15–vip17 的卡密安全闭环已完成并上线。
- 真机待点 6 项见下方「未验证清单」，均不影响线上可用性，属「下次用手机顺手点一下」的范围。
- 观察项：`emptyRoomGraceMs` = 60 秒是否够用（原 10 秒易误杀），若仍有玩家反馈对局中掉线后回不来可再放宽。
- **安全硬伤已闭环（2026-11-13 17:25 上线）**：生产环境缺少 `ADMIN_PASSWORD` 时 `server.js` 直接拒绝启动，不再静默回落到默认占位密码；详见「当前进度 → 安全加固」。
- 轮换密码注意：`--update-env` 会以当前 shell 环境覆盖进程环境，必须同时带上 `VIP_UNLIMITED_CODES`（以及 `NODE_ENV=production`），否则重启后服务会因守卫而**拒绝启动**。安全做法是从 `/proc/<旧 pid>/environ` 读回全部应用变量再回注，别裸敲 `pm2 restart`。
- 轮换密码方式：`ADMIN_PASSWORD='新密码' pm2 restart cet-arena --update-env && pm2 save`（变量名固定，值只存在于服务器）。
- 后续可选：留言按「已处理/待处理」分页、卡密按批次打标签、导出 CSV。
- 重做音频：`PYTHONPATH=<.tools/pylibs-tts> python scripts/build_audio_edge.py --skip-existing`（需全权限 + 联网），换音源记得递增 `AUDIO_VERSION`。

## 未验证清单（截至 2026-11-13 17:05）

**已真机验证（老板确认过）**：

- 错词本 VIP 拦截、限时闯关（倒计时 / 超时判错 / 第 4 关占位）。
- 首页公告横幅、正文、时间显示。
- 后台：解绑 / 封禁、允许换机、vip17 三种状态均显示「拉黑 N 台」。
- 封禁后原设备 A 手动重输同一张码被拒（`REVOKED`），换设备也绑不上。

**仅代码 + 自动化测试通过、尚未收到手机真机点击确认**：

- 「彻底删除」按钮（含删除时踢线、删除后无法再激活、种子码删除被拒）——`admin.test.js` 96 项覆盖。
- 在线踢线的前端表现：服务端日志有 `vip_revoked kicked=1`，但手机上没有确认过红色 toast 与自动降级。
- 自定义卡密生成 UI（vip14 修复后）及「生成后立即激活」。
- 购买页「有效期：1年」与「⭐ 增值服务：专属定制卡密 +9.9元」文案。
- 首页 Footer「关于我们」弹窗。
- 公告时间改为只显示 `YYYY-MM-DD` 的最终效果。

> 这些项都不影响当前线上可用性，属于「下次真机顺手点一下」的清单。

## 环境坑位

- 本地 3000 端口易被旧进程占用，需强杀（`netstat -ano | findstr :3000` → `taskkill /PID xxx /F`）。
- `data/vip_codes.state.json` 不入库（已 gitignore），删掉对应键即可重置某张卡密的绑定；删文件后需重启服务才生效（状态在启动时加载）。
- `data/messages.json` 同样不入库（已 gitignore）。想清空所有留言就删这个文件，但**服务启动时已把内容读进内存**，删完必须重启才能生效。
- **重新生成单词音频**：`edge-tts` 装在 `.tools/pylibs-tts`，该目录在沙箱下**读不出来**（DACL 无继承、缺 DSH 包授权），必须用**全权限**运行；普通沙箱下 `import edge_tts` 会得到命名空间包并报 `no attribute 'Communicate'`。命令：`PYTHONPATH=<...>\.tools\pylibs-tts python scripts/build_audio_edge.py`（并发 8，约 12 分钟）。旧方案 `build_audio.py` 依赖 `lameenc`（`.tools/pylibs-enc`，加载 `.pyd` 也需全权限）。
- **`public/audio/` 要入库**（2869 个文件 / **26.38MB**），提交和 `git pull` 都会明显变慢，属正常。
- **设备 Token 存在浏览器 `localStorage` 的 `cetArena.deviceToken.v1`**：清空浏览器数据、换无痕窗口、换浏览器都会生成新 Token，导致已绑定的码失效（需后台解绑），留言的 20 条额度也会重置。排查时可在 DevTools → Application → Local Storage 里看这个键的值，与后台「绑定设备」列的前 8 位比对。
- 线上部署走 Deploy Key + `ssh.github.com:443`：`cd /opt/cet-arena && git pull && pm2 restart cet-arena`。
- **服务器凭据已迁出工作区（2026-11-13）**：`rsh.py` / `authtest.py` / `put.py` 三个部署脚本与私钥 `id_ed25519` 现在 `C:\Users\Yuan\.dsh\srvkey\`，**位于工作区之外、不在任何 git 仓库管辖内**（向上到 `C:\` 无 `.git`），旧位置 `default-workspace\.tools\` 下的副本已移除，**不要再放回工作区**。三者内部的私钥路径均已改为 `C:/Users/Yuan/.dsh/srvkey/id_ed25519`。
  - 运行方式：`cd C:\Users\Yuan\.dsh\srvkey` 后 `$env:PYTHONPATH='<工作区>\.tools\pylibs'`，再 `<python> rsh.py "<远程命令>"`（`rsh.py` 收第一个参数当远程命令，`--sudo` 前置表示 sudo 执行）。
  - `paramiko`（5.1.0）装在 `.tools/pylibs`，该目录在普通沙箱下直接 `import` 会 `PermissionError: [Errno 13]`（DACL 无继承），**必须用全权限运行**；同理读取 `.dsh\srvkey\` 也在工作区外，需放宽。已实测 `rsh.py "echo MIGRATE_OK"` 返回 `MIGRATE_OK`、`[exit=0]`。
  - 旧目录 `.tools\srvkey\` 已清空并删除：`authorized_line.txt`、`id_ed25519.pub`（0 字节）、`known_hosts` 已同批移入新目录。三者都不参与脚本逻辑（三个脚本均用 `AutoAddPolicy`，不读 `known_hosts`），移走不改变行为。
- **版本号规约**：改 `index/app/wrongbook/styles` 必须升 `APP_VERSION` + `index.html` 三处 `?v=`；改 `admin.js/admin.css` **不用**升 `APP_VERSION`，但要改 `admin.html` 里对应 `?v=`。详见 README §7.1「版本号与缓存规约」。
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
