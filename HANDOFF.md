# HANDOFF · 进度交接

> 新会话开始前先读本文件；每次任务结束、提交代码前更新「当前进度」与「待办事项」。

## 当前进度

- 商业模型已简化为**单一码类型**：任何有效激活码验证后既能建房也能加入；未验证两者都拦截；房主房间没有免码席位。
- 支付弹窗改为三档套餐：孤狼独行 ￥19.9（1 码）/ 双人成行 ￥29.9（2 码）/ 宿舍开黑 ￥59.9（6 码），点任一按钮只提示「支付通道维护中，请联系站长获取激活码」。
- 验证底层未动：一码一用、IP 绑定、并发锁、原子持久化；特殊码 `BOSS888`/`080323` 不限次、不绑 IP。
- 9 套测试全部通过；本地服务跑 `20261111-vip4`，`data/vip_codes.state.json` 已清空（卡密全新）。
- 线上仍是 `20261111-vip2`，等待确认后再推。

## 待办事项

- 验收通过后：`git push` → 服务器 `git pull && pm2 restart cet-arena` → 确认线上 `vip_codes.state.json` 为空。

## 环境坑位

- 本地 3000 端口易被旧进程占用，需强杀（`netstat -ano | findstr :3000` → `taskkill /PID xxx /F`）。
- `data/vip_codes.state.json` 不入库（已 gitignore），删掉对应键即可重置某张卡密的绑定。
- 线上部署走 Deploy Key + `ssh.github.com:443`：`cd /opt/cet-arena && git pull && pm2 restart cet-arena`。
- 改动前端资源后必须升 `APP_VERSION`，否则浏览器会用 7 天缓存里的旧脚本（`dom-contract.test.js` 会校验 `?v=` 与版本号一致）。
