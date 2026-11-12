# HANDOFF · 进度交接

> 新会话开始前先读本文件；每次任务结束、提交代码前更新「当前进度」与「待办事项」。

## 当前进度

- **站长专属后台已开发完成（本地已验证，尚未推线上）**：`/admin` 输入站长密码（默认 `boss2026`，可用 `ADMIN_PASSWORD` 覆盖）进入，可查看全部卡密的类型/状态/绑定 IP/绑定时间与在线人数、一键批量生成新码、对已绑定卡密一键解绑重置；移动端表格自动转卡片。
- 后台所有数据与写操作接口都在服务端强制校验站长密码（HttpOnly Cookie + 随机 token，12 小时有效），未登录一律 401；同一 IP 连续错 5 次锁 10 分钟。
- 生成的新码立刻生效无需重启（同时写内存与 `vip_codes.json`）；解绑会删除 `vip_codes.state.json` 中对应记录并原子落盘，客户可换设备重新激活。
- VIP 仿真付费墙已上线：**孤狼独行 ￥19.9（1 码）/ 双人成行 ￥29.9（2 码）/ 宿舍开黑 ￥59.9（6 码）**，点任一购买按钮只提示「支付通道维护中，请联系站长获取激活码」，不接真实支付、无收款码。
- 激活码为**单一类型**：一码一用、首次验证绑定 IP、同 IP 可复用、并发加锁；`BOSS888` / `080323` 为站长码，不限次、不绑 IP。验证通过后既能建房也能加入，未验证两者全拦截，房主房间没有免码席位。
- 本地已通过全部 **10 套测试**（新增 `test/admin.test.js`，44 项断言）；线上仍为上一版，卡密状态文件为空。

## 线上版本

- 服务器提交：`1b60792 feat: 支付套餐文案定稿`
- 前端版本号：`20261111-vip4`（本次未改动主站前端资源，故**未升版本号**；后台资源走 `no-store`，不参与版本机制）
- 地址：<http://1.15.152.160:3000>
- 卡密状态：`/opt/cet-arena/data/vip_codes.state.json` 不存在（全新）

## 待办事项

- 等老板确认后台 UI 与交互后，把后台推线上（`git pull` + `pm2 restart cet-arena`）。
- 上线前建议：把站长密码从写死改为服务器环境变量 `ADMIN_PASSWORD`，并在 PM2 里配置。
- 后续可选：卡密按批次打标签、导出 CSV、生成记录里显示创建时间。

## 环境坑位

- 本地 3000 端口易被旧进程占用，需强杀（`netstat -ano | findstr :3000` → `taskkill /PID xxx /F`）。
- `data/vip_codes.state.json` 不入库（已 gitignore），删掉对应键即可重置某张卡密的绑定；删文件后需重启服务才生效（状态在启动时加载）。
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
