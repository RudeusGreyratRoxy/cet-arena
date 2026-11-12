'use strict';

/**
 * 站长后台前端。
 *
 * 所有数据都来自受密码保护的 /api/admin/*，登录态放在 HttpOnly Cookie 里，
 * 刷新页面不会掉线（由后端 token 判定）。
 */
(function () {
  const el = (id) => document.getElementById(id);

  const ui = {
    loginView: el('loginView'),
    adminView: el('adminView'),
    loginForm: el('loginForm'),
    loginPassword: el('loginPassword'),
    loginBtn: el('loginBtn'),
    loginError: el('loginError'),
    logoutBtn: el('logoutBtn'),
    liveLine: el('liveLine'),
    statTotal: el('statTotal'),
    statAvailable: el('statAvailable'),
    statUsed: el('statUsed'),
    statPlayers: el('statPlayers'),
    genCount: el('genCount'),
    genBtn: el('genBtn'),
    genResult: el('genResult'),
    genMessage: el('genMessage'),
    genList: el('genList'),
    copyGenBtn: el('copyGenBtn'),
    searchInput: el('searchInput'),
    tableHint: el('tableHint'),
    codeRows: el('codeRows'),
    emptyHint: el('emptyHint'),
    toast: el('toast'),
  };

  const state = {
    codes: [],
    stats: null,
    live: null,
    created: [],
    busy: false,
    pollTimer: null,
  };

  // ---------------------------------------------------------------- 工具

  let toastTimer = null;
  function toast(message) {
    if (!ui.toast) return;
    ui.toast.textContent = message;
    ui.toast.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      ui.toast.hidden = true;
    }, 2400);
  }

  async function request(path, options = {}) {
    const init = {
      method: options.method || 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
    };
    if (options.body !== undefined) {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(options.body);
    }
    try {
      const response = await fetch(path, init);
      let data = null;
      try {
        data = await response.json();
      } catch (error) {
        data = null;
      }
      return { status: response.status, ok: response.ok, data: data || {} };
    } catch (error) {
      return { status: 0, ok: false, data: { message: '网络异常，请检查连接' } };
    }
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (error) {
      /* 回退到 execCommand */
    }
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.top = '-9999px';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(area);
      return ok;
    } catch (error) {
      return false;
    }
  }

  function formatTime(iso) {
    if (!iso) return '—';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
      `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  // ---------------------------------------------------------------- 视图切换

  function showLogin(message) {
    ui.adminView.hidden = true;
    ui.loginView.hidden = false;
    ui.loginError.textContent = message || '';
    ui.loginPassword.value = '';
    stopPolling();
    ui.loginPassword.focus();
  }

  function showAdmin() {
    ui.loginView.hidden = true;
    ui.adminView.hidden = false;
    startPolling();
  }

  function setBusy(busy) {
    state.busy = busy;
    ui.genBtn.disabled = busy;
  }

  // ---------------------------------------------------------------- 渲染

  function renderStats() {
    const stats = state.stats || { total: 0, available: 0, used: 0 };
    ui.statTotal.textContent = String(stats.total);
    ui.statAvailable.textContent = String(stats.available);
    ui.statUsed.textContent = String(stats.used);

    const live = state.live || { rooms: 0, players: 0 };
    ui.statPlayers.textContent = String(live.players);
    ui.liveLine.textContent = `在线 ${live.players} 人 · ${live.rooms} 个房间`;
  }

  function statusOf(item) {
    if (item.kind === 'unlimited') return { text: '永久可用', cls: 'free', used: false };
    if (item.status === 'used') return { text: '已绑定', cls: 'used', used: true };
    return { text: '未使用', cls: 'free', used: false };
  }

  function sortCodes(list) {
    const rank = (item) => {
      if (item.kind === 'unlimited') return 0;
      return item.status === 'used' ? 1 : 2;
    };
    return [...list].sort((a, b) => {
      const diff = rank(a) - rank(b);
      if (diff !== 0) return diff;
      return String(a.code).localeCompare(String(b.code));
    });
  }

  function makeCell(label, content) {
    const td = document.createElement('td');
    td.dataset.label = label;
    if (typeof content === 'string') {
      td.textContent = content;
    } else {
      td.appendChild(content);
    }
    return td;
  }

  function textSpan(text, className) {
    const span = document.createElement('span');
    span.className = className;
    span.textContent = text;
    return span;
  }

  function buildRow(item) {
    const status = statusOf(item);
    const tr = document.createElement('tr');
    if (status.used) tr.classList.add('row-used');
    // 未绑定的行在手机端隐藏「绑定 IP / 绑定时间 / 操作」三行，卡片更紧凑。
    if (!item.boundIp) tr.classList.add('no-bind');

    const codeCell = textSpan(item.code, 'code-cell');
    codeCell.title = '点击复制';
    codeCell.dataset.code = item.code;
    tr.appendChild(makeCell('卡密', codeCell));

    const isAdmin = item.kind === 'unlimited';
    const typeTag = textSpan(isAdmin ? '管理员' : '普通', `tag ${isAdmin ? 'admin' : 'once'}`);
    tr.appendChild(makeCell('类型', typeTag));

    tr.appendChild(makeCell('状态', textSpan(status.text, `tag ${status.cls}`)));
    tr.appendChild(makeCell('绑定 IP', textSpan(item.boundIp || '—', 'mono')));
    tr.appendChild(makeCell('绑定时间', textSpan(formatTime(item.usedAt), 'mono')));

    const actionCell = makeCell('操作', '—');
    if (status.used) {
      actionCell.textContent = '';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn danger';
      button.textContent = '解绑 / 重置';
      button.dataset.reset = item.code;
      actionCell.appendChild(button);
    }
    tr.appendChild(actionCell);

    return tr;
  }

  function renderTable() {
    const keyword = ui.searchInput.value.trim().toUpperCase();
    const sorted = sortCodes(state.codes);
    const visible = keyword
      ? sorted.filter((item) =>
        String(item.code).toUpperCase().includes(keyword) ||
        String(item.boundIp || '').toUpperCase().includes(keyword))
      : sorted;

    ui.codeRows.textContent = '';
    for (const item of visible) {
      ui.codeRows.appendChild(buildRow(item));
    }

    ui.emptyHint.hidden = visible.length > 0;
    ui.tableHint.textContent = state.codes.length
      ? `共 ${state.codes.length} 张，当前显示 ${visible.length} 张`
      : '暂无卡密';
    if (!state.codes.length) {
      ui.emptyHint.hidden = true;
      ui.tableHint.textContent = '暂无卡密，可在上方一键生成。';
    }
  }

  function renderGenResult(created, message) {
    ui.genList.textContent = '';
    for (const code of created) {
      const li = document.createElement('li');
      li.textContent = code;
      ui.genList.appendChild(li);
    }
    ui.genMessage.textContent = message;
    ui.genResult.hidden = created.length === 0;
  }

  function render() {
    renderStats();
    renderTable();
  }

  // ---------------------------------------------------------------- 数据加载

  async function loadState() {
    const res = await request('/api/admin/state');
    if (res.status === 401) {
      showLogin('');
      return;
    }    if (!res.ok) {
      toast(res.data.message || '加载失败');
      return;
    }
    state.codes = Array.isArray(res.data.codes) ? res.data.codes : [];
    state.stats = res.data.stats || null;
    state.live = res.data.live || null;
    showAdmin();
    render();
  }

  function startPolling() {
    stopPolling();
    state.pollTimer = setInterval(() => {
      if (state.busy || document.hidden) return;
      loadState();
    }, 30_000);
  }

  function stopPolling() {
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  }

  // ---------------------------------------------------------------- 交互

  async function handleLogin(event) {
    event.preventDefault();
    const password = ui.loginPassword.value;
    if (!password) {
      ui.loginError.textContent = '请输入站长密码';
      return;
    }
    ui.loginBtn.disabled = true;
    ui.loginError.textContent = '';
    const res = await request('/api/admin/login', { method: 'POST', body: { password } });
    ui.loginBtn.disabled = false;
    if (!res.ok) {
      ui.loginError.textContent = res.data.message || '密码错误';
      ui.loginPassword.select();
      return;
    }
    ui.loginPassword.value = '';
    await loadState();
    toast('已进入站长后台');
  }

  async function handleLogout() {
    await request('/api/admin/logout', { method: 'POST', body: {} });
    showLogin('已退出登录');
  }

  async function handleGenerate() {
    const count = Number(ui.genCount.value);
    if (!Number.isFinite(count) || count < 1) {
      toast('请输入 1 以上的生成数量');
      ui.genCount.focus();
      return;
    }
    if (count > 100) {
      toast('一次最多生成 100 张');
      ui.genCount.focus();
      return;
    }
    setBusy(true);
    const res = await request('/api/admin/codes/generate', { method: 'POST', body: { count } });
    setBusy(false);
    if (res.status === 401) {
      showLogin('登录已过期，请重新登录');
      return;
    }
    if (!res.ok) {
      toast(res.data.message || '生成失败');
      return;
    }
    state.created = res.data.created || [];
    state.codes = Array.isArray(res.data.codes) ? res.data.codes : state.codes;
    state.stats = res.data.stats || state.stats;
    renderGenResult(state.created, res.data.message || `已生成 ${state.created.length} 张`);
    render();
    toast(`已生成 ${state.created.length} 张新卡密`);
  }

  async function handleReset(code) {
    if (!code || state.busy) return;
    const confirmed = window.confirm(
      `确定要解绑卡密「${code}」吗？\n\n解绑后它会变回「未使用」，可以在新设备上重新激活；原设备将失去授权。`
    );
    if (!confirmed) return;

    setBusy(true);
    const res = await request('/api/admin/codes/reset', { method: 'POST', body: { code } });
    setBusy(false);
    if (res.status === 401) {
      showLogin('登录已过期，请重新登录');
      return;
    }
    if (!res.ok) {
      toast(res.data.message || '解绑失败');
      return;
    }
    const index = state.codes.findIndex((item) => item.code === code);
    if (index !== -1 && res.data.code) state.codes[index] = res.data.code;
    if (res.data.stats) state.stats = res.data.stats;
    render();
    toast(`卡密 ${code} 已解绑，可重新激活`);
  }

  function bindEvents() {
    ui.loginForm.addEventListener('submit', handleLogin);
    ui.logoutBtn.addEventListener('click', handleLogout);
    ui.genBtn.addEventListener('click', handleGenerate);
    ui.searchInput.addEventListener('input', renderTable);

    ui.codeRows.addEventListener('click', (event) => {
      const resetButton = event.target.closest('button[data-reset]');
      if (resetButton) {
        handleReset(resetButton.dataset.reset);
        return;
      }
      const codeCell = event.target.closest('.code-cell');
      if (codeCell && codeCell.dataset.code) {
        copyText(codeCell.dataset.code).then((ok) => {
          toast(ok ? `已复制 ${codeCell.dataset.code}` : '复制失败，请手动选择');
        });
      }
    });

    ui.copyGenBtn.addEventListener('click', () => {
      if (!state.created.length) return;
      copyText(state.created.join('\n')).then((ok) => {
        toast(ok ? '已复制全部新卡密' : '复制失败，请长按选择');
      });
    });
  }

  // 首屏先静默探测登录态（200），避免未登录时控制台出现 401 报错。
  async function boot() {
    const res = await request('/api/admin/session');
    if (!res.ok || !res.data.authed) {
      showLogin('');
      return;
    }
    await loadState();
  }

  bindEvents();
  boot();
})();
