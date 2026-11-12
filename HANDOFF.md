# HANDOFF · 进度交接

> 新会话开始前先读本文件；每次任务结束、提交代码前更新「当前进度」与「待办事项」。

## 当前进度

- **站长专属后台已上线**：<http://1.15.152.160:3000/admin>，可查看全部卡密的类型/状态/绑定 IP/绑定时间与在线人数、一键批量生成新码、对已绑定卡密一键解绑重置；移动端表格自动转卡片。
- 线上站长密码**由 PM2 环境变量 `ADMIN_PASSWORD` 提供**（不是代码里的默认值），已执行 `pm2 save` 持久化，服务器重启后依然生效。密码明文**不写入仓库**；需要查看或轮换见下方运维说明。
- 代码里的 `DEFAULT_PASSWORD`（`boss2026`）只是本地开发占位值；线上若环境变量丢失会回落到它，属于已知风险，后续可改成「生产环境缺失即拒绝启动」。
- 后台所有数据与写操作接口都在服务端强制校验站长密码（HttpOnly Cookie + 随机 token，12 小时有效），未登录一律 401；同一 IP 连续错 5 次锁 10 分钟。
- 生成的新码立刻生效无需重启（同时写内存与 `vip_codes.json`）；解绑会删除 `vip_codes.state.json` 中对应记录并原子落盘，客户可换设备重新激活。
- VIP 仿真付费墙已上线：**孤狼独行 ￥19.9（1 码）/ 双人成行 ￥29.9（2 码）/ 宿舍开黑 ￥59.9（6 码）**，点任一购买按钮只提示「支付通道维护中，请联系站长获取激活码」，不接真实支付、无收款码。
- 激活码为**单一类型**：一码一用、首次验证绑定 IP、同 IP 可复用、并发加锁；`BOSS888` / `080323` 为站长码，不限次、不绑 IP。验证通过后既能建房也能加入，未验证两者全拦截，房主房间没有免码席位。
- 本地与线上均通过全部 **10 套测试**（含 `test/admin.test.js` 44 项断言）；线上卡密状态文件为空，11 张卡（2 站长码 + 9 普通码）全部可用。

## 线上版本

- 服务器提交：`d6e5c10 feat: 站长专属后台管理上线`（另有文档提交 `f04dd91`）
- 前端版本号：`20261111-vip4`（本次未改动主站前端资源，故**未升版本号**；后台资源走 `no-store`，不参与版本机制）
- 地址：<http://1.15.152.160:3000>　后台：<http://1.15.152.160:3000/admin>
- 卡密状态：`/opt/cet-arena/data/vip_codes.state.json` 不存在（全新）
- 进程环境：`ADMIN_PASSWORD` 已注入并 `pm2 save` 持久化（可用 `pm2 pid cet-arena` + `tr '\0' '\n' < /proc/<pid>/environ | grep ADMIN` 复核）

## 待办事项

- 等老板验收线上后台；有问题随时回滚（`git revert` 或退回 `3131af8` 后重启）。
- 安全加固建议：生产环境若缺少 `ADMIN_PASSWORD` 应拒绝启动或强制报错，避免静默回落到代码里的默认占位密码。
- 轮换密码方式：`ADMIN_PASSWORD='新密码' pm2 restart cet-arena --update-env && pm2 save`（变量名固定，值只存在于服务器）。
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
