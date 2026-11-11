# HANDOFF · 进度交接

> 新会话开始前先读本文件；每次任务结束、提交代码前更新「当前进度」与「待办事项」。

## 当前进度

- 本地已通过 VIP 仿真付费墙测试（防白嫖、IP 绑定、并发锁、支付维护提示），尚未推线上。

## 待办事项

- 重构 VIP 分级收费（房主码 vs 单人码），本地测通后等确认再推线上。

## 环境坑位

- 本地 3000 端口易被旧进程占用，需强杀（`netstat -ano | findstr :3000` → `taskkill /PID xxx /F`）。
- `data/vip_codes.state.json` 不入库（已 gitignore），删掉对应键即可重置某张卡密的绑定。
- 线上部署走 Deploy Key + `ssh.github.com:443`：`cd /opt/cet-arena && git pull && pm2 restart cet-arena`。
