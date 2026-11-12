# HANDOFF · 进度交接

> 新会话开始前先读本文件；每次任务结束、提交代码前更新「当前进度」与「待办事项」。

## 当前进度

- **【重要机制变更】卡密绑定主体从「IP」改为「设备 Token」**（本地已完成，**尚未推线上**）：
  - 背景：原方案按首个验证 IP 绑定，但大学校园网普遍是 NAT，全校共用一个公网 IP，等于「一人买码、全校白嫖」，是致命业务漏洞。
  - 现在：前端首次打开页面即在 `localStorage` 的 `cetArena.deviceToken.v1` 生成 32 位随机 Token（`crypto.randomUUID()` 优先），每次 `vip:verify` 一并上传；后端把它作为唯一绑定主体，Token 不一致直接拒绝「该卡密已绑定其他设备」。
  - 同一台设备换网络（宿舍 Wi-Fi ↔ 手机热点）**放行**；换设备（哪怕还在同一个校园网、同一个 IP）**拦截**。
  - IP 降为风控参考：记录 `boundIp`（首次）与 `lastIp`（最近），不参与放行判断。
  - 后端校验 Token 规范（16–128 位、仅 `[A-Za-z0-9_-]`），缺失/非法返回 `DEVICE_REQUIRED`；socket 审计日志只记录 Token 前 8 位。
  - 老数据（只有 `boundIp`）可在同 IP 首次带 Token 时平滑迁移，不会让老客户集体失效。
  - 版本号已升到 `20261112-vip5`（`src/version.js` + `public/app.js` + `index.html` 的 `?v=`）。
- 站长后台同步升级：卡密列表新增「绑定设备」列（只显示 Token 前 8 位，接口不下发完整 Token）；解绑会同时清空设备 Token、IP 与绑定时间。
- 测试：`test/vip.test.js` 重写为设备绑定语义（36 项断言），`test/admin.test.js` 增至 48 项；另做了**真机双浏览器验收**（同一 IP、两个独立浏览器配置 = 两个不同 device_token），第一台验证成功、第二台被拦截。
- 站长专属后台已上线：<http://1.15.152.160:3000/admin>，可查看全部卡密、一键批量生成新码、解绑重置；移动端表格自动转卡片。
- 线上站长密码**由 PM2 环境变量 `ADMIN_PASSWORD` 提供**（不是代码里的默认值），已执行 `pm2 save` 持久化。密码明文**不写入仓库**。
- VIP 仿真付费墙已上线：**孤狼独行 ￥19.9（1 码）/ 双人成行 ￥29.9（2 码）/ 宿舍开黑 ￥59.9（6 码）**，点任一购买按钮只提示「支付通道维护中，请联系站长获取激活码」，不接真实支付、无收款码。
- 激活码为**单一类型**：一码绑定一台设备、同设备可复用、并发加锁；`BOSS888` / `080323` 为站长码，不限次、不绑设备。验证通过后既能建房也能加入，未验证两者全拦截，房主房间没有免码席位。
- 本地通过全部 **10 套测试**；线上仍是旧版（IP 绑定），**等确认后再部署**。

## 线上版本

- 服务器提交：`d6e5c10 feat: 站长专属后台管理上线`（另有文档提交 `f04dd91`）
- 前端版本号：`20261111-vip4`（**本地已升到 `20261112-vip5`，尚未部署**）
- 地址：<http://1.15.152.160:3000>　后台：<http://1.15.152.160:3000/admin>
- 卡密状态：`/opt/cet-arena/data/vip_codes.state.json` 不存在（全新，无迁移包袱）
- 进程环境：`ADMIN_PASSWORD` 已注入并 `pm2 save` 持久化（可用 `pm2 pid cet-arena` + `tr '\0' '\n' < /proc/<pid>/environ | grep ADMIN` 复核）

## 待办事项

- **把设备 Token 绑定推线上**（老板确认后）：`git pull && ADMIN_PASSWORD=... pm2 restart cet-arena --update-env`。注意线上 `data/vip_codes.state.json` 目前不存在（10 张普通码全部未使用），所以**没有迁移包袱**。
- 上线后提醒：客户清空浏览器数据 / 换无痕窗口会生成新 device_token，需要站长解绑一次（预期行为）。
- 安全加固建议：生产环境若缺少 `ADMIN_PASSWORD` 应拒绝启动或强制报错，避免静默回落到代码里的默认占位密码。
- 轮换密码方式：`ADMIN_PASSWORD='新密码' pm2 restart cet-arena --update-env && pm2 save`（变量名固定，值只存在于服务器）。
- 后续可选：卡密按批次打标签、导出 CSV、生成记录里显示创建时间。

## 环境坑位

- 本地 3000 端口易被旧进程占用，需强杀（`netstat -ano | findstr :3000` → `taskkill /PID xxx /F`）。
- `data/vip_codes.state.json` 不入库（已 gitignore），删掉对应键即可重置某张卡密的绑定；删文件后需重启服务才生效（状态在启动时加载）。
- **设备 Token 存在浏览器 `localStorage` 的 `cetArena.deviceToken.v1`**：清空浏览器数据、换无痕窗口、换浏览器都会生成新 Token，导致已绑定的码失效（需后台解绑）。排查时可在 DevTools → Application → Local Storage 里看这个键的值，与后台「绑定设备」列的前 8 位比对。
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
