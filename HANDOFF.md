# HANDOFF · 进度交接

> 新会话开始前先读本文件；每次任务结束、提交代码前更新「当前进度」与「待办事项」。

## 当前进度

- VIP 分级收费已完成并本地测通：`super_admin`（BOSS888/080323）不限次不绑 IP，`host` 房主码可建房可加入，`player` 单人码只能加入；建房与加入走各自弹窗，价格页同时展示房主 ￥19.9 / 单人 ￥9.9，支付仅提示维护中。
- 9 套测试全部通过（含新增的分级断言与「单人码不能建房」用例）；本地服务跑 `20261111-vip3`。
- 线上仍是上一版 `20261111-vip2`（无分级），等待确认后再推。

## 待办事项

- 等老板本地验收通过后：`git push` → 服务器 `git pull && pm2 restart cet-arena` → 确认线上 `vip_codes.state.json` 为空（卡密全新）。

## 环境坑位

- 本地 3000 端口易被旧进程占用，需强杀（`netstat -ano | findstr :3000` → `taskkill /PID xxx /F`）。
- `data/vip_codes.state.json` 不入库（已 gitignore），删掉对应键即可重置某张卡密的绑定。
- 线上部署走 Deploy Key + `ssh.github.com:443`：`cd /opt/cet-arena && git pull && pm2 restart cet-arena`。
- 改动前端资源后必须升 `APP_VERSION`，否则浏览器会用 7 天缓存里的旧脚本（`dom-contract.test.js` 会校验 `?v=` 与版本号一致）。
