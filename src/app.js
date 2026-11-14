'use strict';

const http = require('http');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const compression = require('compression');
const { Server } = require('socket.io');
const { loadWords, buildQuestions, buildQuestion } = require('./wordBank');
const { createVipStore, normalizeDeviceToken } = require('./vipCodes');
const { createAdminAuth } = require('./adminAuth');
const { createMessageStore, MAX_CONTENT } = require('./messages');
const { createAnnouncementStore } = require('./announcement');
const { createLevelStore } = require('./levels');
const { APP_VERSION } = require('./version');

const DEFAULT_CONFIG = {
  questionMs: 15_000,
  revealMs: 1_800,
  startDelayMs: 900,
  racePenaltyMs: 1_000,
  raceAdvanceDelayMs: 250,
  roomTtlMs: 30 * 60 * 1000,
  // 双方都离线后，未结束的对局保留多久用于「刷新重连」；结束后立即回收。
  // 60 秒：移动端切后台会被系统挂起、弱网重连也更慢，10 秒太容易误杀。
  emptyRoomGraceMs: 60 * 1000,
  // 创建房间 / 加入房间 / 错词挑战都需要激活码；单人限时闯关对所有人开放。
  vipRequired: true,
  // 单人限时闯关：每关固定抽多少题；超时判定给客户端留一点网络宽限。
  trialQuestionCount: 10,
  trialGraceMs: 300,
  cleanupIntervalMs: 60 * 1000,
  maxNicknameLength: 20,
};

const SESSION_MISSING = 'SESSION_MISSING';

/**
 * 卡密脱敏，用于审计日志：
 * - 长度 < 6 全打星；
 * - 否则保留首 2 位 + **** + 末 2 位。
 * 避免完整卡密（含站长码/用户输入的错码）落进 pm2 日志。
 */
function maskCode(raw) {
  const code = String(raw == null ? '' : raw);
  if (!code) return '';
  if (code.length < 6) return '*'.repeat(code.length);
  return `${code.slice(0, 2)}****${code.slice(-2)}`;
}

/**
 * 创建完整的 HTTP + Socket.IO 服务，但不自动 listen，便于测试。
 */
function createArenaServer(options = {}) {
  const config = { ...DEFAULT_CONFIG, ...options };
  const words = options.words || loadWords();
  const wordById = new Map(words.map((entry) => [entry.id, entry]));
  const wordByName = new Map(words.map((entry) => [entry.word.toLowerCase(), entry]));
  const vip = options.vip || createVipStore(options.vipOptions);
  const messages = options.messages || createMessageStore(options.messageOptions);
  const announcement =
    options.announcementStore || createAnnouncementStore(options.announcementOptions);
  const levels = options.levels || createLevelStore({ words });
  const app = express();
  const httpServer = http.createServer(app);
  const io = new Server(httpServer, {
    serveClient: true,
    pingInterval: 25_000,
    pingTimeout: 30_000,
    upgradeTimeout: 10_000,
    transports: ['websocket', 'polling'],
    maxHttpBufferSize: 1e5,
  });

  // 防止旧版前端在新版后端上继续运行，导致题型字段与渲染逻辑错配。
  io.use((socket, next) => {
    if (socket.handshake.auth?.clientVersion !== APP_VERSION) {
      const error = new Error('客户端版本已更新，请刷新页面');
      error.data = { code: 'CLIENT_OUTDATED', version: APP_VERSION };
      next(error);
      return;
    }
    // 握手时就把设备指纹记到连接上：这样即使该设备后续验证失败（例如已被封禁），
    // 后台解绑/删除时也能精准踢到它的在线连接。
    const handshakeDevice = normalizeDeviceToken(socket.handshake.auth?.deviceToken);
    if (handshakeDevice) socket.data.deviceToken = handshakeDevice;
    next();
  });

  /** @type {Map<string, Room>} */
  const rooms = new Map();
  /** @type {Map<string, { roomCode: string, playerId: string }>} */
  const sessions = new Map();
  /** @type {Map<string, { roomCode: string, playerId: string }>} */
  const socketPlayers = new Map();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(compression({ threshold: 1024 }));
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data:; font-src 'self'; connect-src 'self' ws: wss:; " +
        "base-uri 'self'; form-action 'self'"
    );
    next();
  });

  app.get('/healthz', (req, res) => {
    res.json({
      ok: true,
      rooms: rooms.size,
      players: [...rooms.values()].reduce((sum, room) => sum + room.players.length, 0),
      words: words.length,
      version: APP_VERSION,
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  // 首页更新公告：公开只读。必须 no-store，否则浏览器/边缘缓存会让站长发了公告看不到。
  app.get('/api/announcement', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const snapshot = announcement.get();
    res.json({ ok: true, content: snapshot.content, updatedAt: snapshot.updatedAt });
  });

  const publicDir = path.join(__dirname, '..', 'public');
  const indexFile = path.join(publicDir, 'index.html');

  // ------------------------------------------------------------------
  // 站长后台：/admin 页面 + /api/admin/* 管理接口
  // 所有会改动卡密的接口都必须先通过站长密码校验。
  // ------------------------------------------------------------------
  const adminAuth = options.adminAuth || createAdminAuth({ password: options.adminPassword });
  const adminHtml = path.join(publicDir, 'admin.html');
  const adminAssets = {
    '/admin.js': path.join(publicDir, 'admin.js'),
    '/admin.css': path.join(publicDir, 'admin.css'),
  };
  const ADMIN_COOKIE = 'cet_admin';

  app.get('/', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexFile);
  });

  function httpIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    const raw = (Array.isArray(forwarded) ? forwarded[0] : forwarded) || req.socket?.remoteAddress || '';
    return String(raw).split(',')[0].trim().replace(/^::ffff:/, '');
  }

  function readCookie(req, name) {
    const header = req.headers.cookie;
    if (!header) return '';
    for (const part of String(header).split(';')) {
      const index = part.indexOf('=');
      if (index === -1) continue;
      if (part.slice(0, index).trim() === name) {
        return decodeURIComponent(part.slice(index + 1).trim());
      }
    }
    return '';
  }

  function setAdminCookie(req, res, token, maxAgeSeconds) {
    const pieces = [
      `${ADMIN_COOKIE}=${encodeURIComponent(token)}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Strict',
      `Max-Age=${maxAgeSeconds}`,
    ];
    if (req.secure) pieces.push('Secure');
    res.setHeader('Set-Cookie', pieces.join('; '));
  }

  function isAdmin(req) {
    return adminAuth.check(readCookie(req, ADMIN_COOKIE));
  }

  function requireAdmin(req, res, next) {
    if (isAdmin(req)) {
      next();
      return;
    }
    res.status(401).json({ ok: false, code: 'UNAUTHORIZED', message: '请先登录站长后台' });
  }

  app.use('/api/admin', express.json({ limit: '16kb' }));

  app.get('/admin', (req, res) => {
    // 三重禁缓存：部分手机浏览器/代理对 no-store 处理不一致，旧版后台页面会一直显示旧 UI。
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.sendFile(adminHtml);
  });

  // 后台资源必须禁缓存：否则改了后台脚本，站长手机还会跑旧版本。
  for (const [route, file] of Object.entries(adminAssets)) {
    app.get(route, (req, res) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      res.sendFile(file);
    });
  }

  app.post('/api/admin/login', (req, res) => {
    const body = req.body || {};
    const ip = httpIp(req);
    const result = adminAuth.login(body.password, ip);
    audit('admin_login', { ip, ok: result.ok, code: result.code || null });
    if (!result.ok) {
      res.status(result.code === 'LOCKED' ? 429 : 401).json(result);
      return;
    }
    setAdminCookie(req, res, result.token, Math.floor(adminAuth.ttlMs / 1000));
    res.json({ ok: true, expiresAt: result.expiresAt });
  });

  app.post('/api/admin/logout', (req, res) => {
    adminAuth.logout(readCookie(req, ADMIN_COOKIE));
    setAdminCookie(req, res, '', 0);
    res.json({ ok: true });
  });

  app.get('/api/admin/session', (req, res) => {
    // 只回答「是否已登录」，不泄露任何卡密信息，供后台首屏静默探测登录态。
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, authed: isAdmin(req) });
  });

  app.get('/api/admin/state', (req, res) => {
    if (!isAdmin(req)) {
      res.status(401).json({ ok: false, code: 'UNAUTHORIZED', message: '请先登录站长后台' });
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ok: true,
      codes: vip.list(),
      stats: vip.stats(),
      live: {
        rooms: rooms.size,
        players: [...rooms.values()].reduce((sum, room) => sum + room.players.length, 0),
      },
      messages: messages.stats(),
      announcement: announcement.get(),
    });
  });

  // 在线踢人：把该设备所有在线连接降级为普通用户（不断线、不打断当前对局）。
  function kickDevice(deviceToken, message) {
    if (!deviceToken) return 0;
    let kicked = 0;
    for (const client of io.sockets.sockets.values()) {
      if (client.data && client.data.deviceToken === deviceToken) {
        client.data.vip = false;
        client.data.vipCode = null;
        client.emit('vip:revoked', { message });
        kicked += 1;
      }
    }
    return kicked;
  }

  app.post('/api/admin/codes/reset', requireAdmin, (req, res) => {
    const body = req.body || {};
    const result = vip.reset(body.code);
    audit('admin_reset_code', {
      ip: httpIp(req),
      code: String(body.code || '').toUpperCase(),
      ok: result.ok,
      code4: result.code || null,
    });
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }

    const kicked = kickDevice(
      result.previousDevice,
      '您的 VIP 授权已被站长撤销，请重新获取激活码'
    );
    if (result.previousDevice) {
      audit('vip_revoked', {
        ip: httpIp(req),
        code: String(body.code || '').toUpperCase(),
        device: String(result.previousDevice).slice(0, 8),
        kicked,
      });
    }

    res.json({
      ok: true,
      message: result.message,
      code: result.record,
      stats: vip.stats(),
      kicked,
    });
  });

  // 允许换机：封禁 → 未使用；原设备仍在 revokedDevices 黑名单里。
  app.post('/api/admin/codes/allow-rebind', requireAdmin, (req, res) => {
    const body = req.body || {};
    const result = vip.allowRebind(body.code);
    audit('admin_allow_rebind', {
      ip: httpIp(req),
      code: String(body.code || '').toUpperCase(),
      ok: result.ok,
      code4: result.code || null,
    });
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.json({
      ok: true,
      message: result.message,
      code: result.record,
      codes: vip.list(),
      stats: vip.stats(),
    });
  });

  // 彻底删除：仅对运行时新增的卡密生效（种子码由仓库维护）。
  app.post('/api/admin/codes/delete', requireAdmin, (req, res) => {
    const body = req.body || {};
    const result = vip.removeCode(body.code);
    audit('admin_delete_code', {
      ip: httpIp(req),
      code: String(body.code || '').toUpperCase(),
      ok: result.ok,
      code4: result.code || null,
    });
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    const kicked = kickDevice(
      result.previousDevice,
      '您的 VIP 卡密已被站长删除，如已付费请联系站长重新获取'
    );
    res.json({
      ok: true,
      message: result.message,
      codes: vip.list(),
      stats: vip.stats(),
      kicked,
    });
  });

  app.post('/api/admin/codes/generate', requireAdmin, (req, res) => {
    const body = req.body || {};
    const result = vip.generate(body.count, { label: body.label });
    audit('admin_generate_codes', {
      ip: httpIp(req),
      requested: Number(body.count) || 0,
      created: result.created ? result.created.length : 0,
      ok: result.ok,
    });
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.json({
      ok: true,
      created: result.created,
      message: result.message,
      codes: vip.list(),
      stats: vip.stats(),
    });
  });

  // 自定义卡密：固定生成 once 码，查重（内存/状态文件）后写入运行时新增文件。
  app.post('/api/admin/codes/generate-custom', requireAdmin, (req, res) => {
    const body = req.body || {};
    const result = vip.generateCustom(body.code);
    audit('admin_generate_custom_code', {
      ip: httpIp(req),
      code: maskCode(result.ok ? result.code : body.code),
      ok: result.ok,
      reason: result.ok ? null : result.code || null,
    });
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.json({
      ok: true,
      code: result.code,
      message: result.message,
      codes: vip.list(),
      stats: vip.stats(),
    });
  });

  // ---- 公告管理（站长后台）----
  // 审计只记长度与结果，**不记正文**：公告可能含内部信息。
  app.post('/api/admin/announcement', requireAdmin, (req, res) => {
    const body = req.body || {};
    const result = announcement.set(body.content);
    audit('admin_update_announcement', {
      ip: httpIp(req),
      length: typeof body.content === 'string' ? Array.from(body.content).length : 0,
      ok: result.ok,
    });
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.json({ ok: true, content: result.content, updatedAt: result.updatedAt });
  });

  // ---- 留言管理（站长后台）----

  app.get('/api/admin/messages', requireAdmin, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, messages: messages.list(), stats: messages.stats() });
  });

  app.post('/api/admin/messages/handle', requireAdmin, (req, res) => {
    const body = req.body || {};
    const result = messages.markHandled(body.id, body.handled !== false);
    audit('admin_message_handle', { ip: httpIp(req), id: String(body.id || ''), ok: result.ok });
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.json({ ok: true, message: result.message, record: result.record, stats: messages.stats() });
  });

  app.post('/api/admin/messages/delete', requireAdmin, (req, res) => {
    const body = req.body || {};
    const result = messages.remove(body.id);
    audit('admin_message_delete', { ip: httpIp(req), id: String(body.id || ''), ok: result.ok });
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.json({ ok: true, message: result.message, stats: messages.stats() });
  });

  // 站长回复：写入后该条留言自动变「已处理」，额度随之释放。
  // 400 = 内容问题（空 / 超长），404 = 留言不存在。审计只记 id 与长度，不记回复正文。
  app.post('/api/admin/messages/reply', requireAdmin, (req, res) => {
    const body = req.body || {};
    const result = messages.reply(body.id, body.reply);
    audit('admin_message_reply', {
      ip: httpIp(req),
      id: String(body.id || ''),
      length: typeof body.reply === 'string' ? Array.from(body.reply).length : 0,
      ok: result.ok,
      reason: result.code || null,
    });
    if (!result.ok) {
      res.status(result.code === 'NOT_FOUND' ? 404 : 400).json(result);
      return;
    }
    res.json({ ok: true, message: result.message, record: result.record, stats: messages.stats() });
  });

  // 单词发音音频：按单词命名、内容不变，给一年强缓存 + immutable，
  // 手机下过一次后不再回源（服务器带宽只有 4M，这一层很关键）。
  app.use(
    '/audio',
    express.static(path.join(publicDir, 'audio'), {
      index: false,
      maxAge: '365d',
      immutable: true,
      etag: true,
      setHeaders: (res) => {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      },
    })
  );

  app.use(
    express.static(publicDir, {
      index: false,
      maxAge: '7d',
      etag: true,
    })
  );
  app.use((req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.status(404).sendFile(indexFile);
  });

  function publicPlayers(room) {
    return room.players.map((player) => ({
      id: player.id,
      nickname: player.nickname,
      ready: player.ready,
      score: player.score,
      connected: player.connected,
      isHost: player.id === room.hostId,
    }));
  }

  function questionView(room) {
    const game = room.game;
    const question = game && game.question;
    if (!question) return null;
    return {
      index: game.index + 1,
      total: game.questions.length,
      type: question.type,
      prompt: question.prompt,
      promptLabel: question.promptLabel,
      word: question.word,
      level: question.level,
      options: question.options,
      deadline: question.deadline,
      serverNow: Date.now(),
      answers: Object.entries(question.answers).map(([playerId, answer]) => ({
        playerId,
        selectedIndex: answer.selectedIndex,
        correct: answer.correct,
      })),
    };
  }

  function roomView(room) {
    const view = {
      code: room.code,
      hostId: room.hostId,
      level: room.level,
      mode: room.mode,
      status: room.status,
      maxPlayers: 2,
      createdAt: room.createdAt,
      players: publicPlayers(room),
      game: null,
    };

    if (room.game) {
      if (room.game.mode === 'race') {
        view.game = {
          mode: 'race',
          total: room.game.questions.length,
          startedAt: room.game.startedAt,
          progress: raceProgress(room),
          final: room.game.final,
        };
      } else {
        view.game = {
          mode: 'quiz',
          index: Math.max(1, room.game.index + 1),
          total: room.game.questions.length,
          question: questionView(room),
          result: room.game.lastResult,
          final: room.game.final,
        };
      }
    }
    return view;
  }

  function broadcastRoom(room) {
    io.to(room.code).emit('room:state', roomView(room));
  }

  function findContext(socket) {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return null;
    const player = room.players.find(
      (candidate) => candidate.id === socket.data.playerId && candidate.socketId === socket.id
    );
    if (!player) return null;
    return { room, player };
  }

  function cleanNickname(value) {
    if (typeof value !== 'string') return null;
    const nickname = value.trim().replace(/\s+/g, ' ');
    if (!nickname || nickname.length > config.maxNicknameLength) return null;
    if (/[\u0000-\u001f\u007f]/.test(nickname)) return null;
    return nickname;
  }

  function cleanRoomCode(value) {
    if (typeof value !== 'string') return null;
    const code = value.trim();
    return /^\d{6}$/.test(code) ? code : null;
  }

  function cleanLevel(value) {
    return value === 'CET4' || value === 'CET6' ? value : null;
  }

  function cleanMode(value) {
    return value === 'quiz' || value === 'race' ? value : null;
  }

  function newCode() {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const code = String(crypto.randomInt(100000, 1000000));
      if (!rooms.has(code)) return code;
    }
    throw new Error('暂时无法分配房间码，请稍后重试');
  }

  function newPlayer(nickname) {
    return {
      id: crypto.randomUUID(),
      sessionId: crypto.randomBytes(24).toString('hex'),
      nickname,
      socketId: null,
      connected: false,
      ready: false,
      score: 0,
    };
  }

  function bindPlayer(socket, room, player) {
    player.socketId = socket.id;
    player.connected = true;
    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.data.playerId = player.id;
    sessions.set(player.sessionId, { roomCode: room.code, playerId: player.id });
    socketPlayers.set(socket.id, { roomCode: room.code, playerId: player.id });
    room.lastActivityAt = Date.now();
    // 有人回来了，取消「空房间回收」
    cancelEmptyRoomCleanup(room);
    audit('player_bind', {
      ip: clientIp(socket),
      nickname: player.nickname,
      room: room.code,
      playerId: player.id,
      mode: room.mode,
      status: room.status,
    });
  }

  function clearGameTimers(room) {
    if (room.startTimer) {
      clearTimeout(room.startTimer);
      room.startTimer = null;
    }
    if (!room.game) return;
    if (room.game.timer) clearTimeout(room.game.timer);
    if (room.game.nextTimer) clearTimeout(room.game.nextTimer);
    room.game.timer = null;
    room.game.nextTimer = null;

    if (room.game.states) {
      for (const state of Object.values(room.game.states)) {
        if (state.unlockTimer) clearTimeout(state.unlockTimer);
        if (state.nextQuestionTimer) clearTimeout(state.nextQuestionTimer);
        state.unlockTimer = null;
        state.nextQuestionTimer = null;
      }
    }
  }

  function deleteRoom(room) {
    cancelEmptyRoomCleanup(room);
    clearGameTimers(room);
    for (const player of room.players) {
      sessions.delete(player.sessionId);
    }

    // 彻底清理，避免留下「幽灵连接」：
    // 1) 先通知在线客户端；2) 清掉 socketPlayers / socket.data 映射；3) 把 socket 移出房间。
    io.to(room.code).emit('room:closed', { reason: '房间已关闭' });

    for (const [socketId, reference] of socketPlayers) {
      if (reference.roomCode === room.code) {
        socketPlayers.delete(socketId);
        const socket = io.sockets.sockets.get(socketId);
        if (socket && socket.data.roomCode === room.code) socket.data.roomCode = null;
      }
    }
    io.socketsLeave(room.code);

    rooms.delete(room.code);
    audit('room_closed', {
      room: room.code,
      status: room.status,
      players: room.players.map((player) => player.nickname),
    });
  }

  // ---------------------------------------------------------------
  // 房间生命周期：双方都离线后尽快回收，不再死等 30 分钟。
  // 对局已结束 → 立即回收；对局进行中 → 留 emptyRoomGraceMs 给「刷新重连」。
  // ---------------------------------------------------------------
  function hasConnectedPlayer(room) {
    return room.players.some((player) => player.connected);
  }

  function cancelEmptyRoomCleanup(room) {
    if (!room.emptyTimer) return;
    clearTimeout(room.emptyTimer);
    room.emptyTimer = null;
  }

  function scheduleEmptyRoomCleanup(room) {
    if (!rooms.has(room.code)) return;
    if (hasConnectedPlayer(room)) {
      cancelEmptyRoomCleanup(room);
      return;
    }
    if (room.emptyTimer) return;

    const delay = room.status === 'finished' ? 0 : config.emptyRoomGraceMs;
    room.emptyTimer = setTimeout(() => {
      room.emptyTimer = null;
      if (!rooms.has(room.code)) return;
      if (hasConnectedPlayer(room)) return;
      deleteRoom(room);
    }, delay);
    if (typeof room.emptyTimer.unref === 'function') room.emptyTimer.unref();
  }

  // ---------------------------------------------------------------
  // 审计日志：连接 / 绑定玩家 / 断开 / 房间关闭，含 IP、昵称、房间码。
  // 输出到 stdout，由 PM2 收集（pm2-logrotate 负责切分）。
  // ---------------------------------------------------------------
  function clientIp(socket) {
    const forwarded = socket.handshake?.headers?.['x-forwarded-for'];
    const raw = (Array.isArray(forwarded) ? forwarded[0] : forwarded) || socket.handshake?.address || '';
    return String(raw).split(',')[0].trim().replace(/^::ffff:/, '');
  }

  function audit(event, fields = {}) {
    try {
      console.log('[audit] ' + JSON.stringify({ ts: new Date().toISOString(), event, ...fields }));
    } catch (error) {
      // 日志本身不能影响业务
    }
  }

  function startQuestion(room, questionIndex) {
    if (room.status !== 'playing' || !room.game || room.game.mode !== 'quiz') return;
    if (questionIndex >= room.game.questions.length) {
      finishQuizGame(room);
      return;
    }

    room.game.nextTimer = null;
    room.game.index = questionIndex;
    const question = room.game.questions[questionIndex];
    const startedAt = Date.now();
    room.game.question = {
      type: question.type,
      prompt: question.prompt,
      promptLabel: question.promptLabel,
      word: question.word,
      level: question.level,
      meanings: question.meanings,
      primary: question.primary,
      correctText: question.correctText,
      options: question.options,
      correctIndex: question.correctIndex,
      meaning: question.meaning,
      deadline: startedAt + config.questionMs,
      answers: {},
      ended: false,
    };
    room.lastActivityAt = startedAt;

    io.to(room.code).emit('question:start', {
      mode: 'quiz',
      index: questionIndex + 1,
      total: room.game.questions.length,
      type: question.type,
      prompt: question.prompt,
      promptLabel: question.promptLabel,
      word: question.word,
      level: question.level,
      options: question.options,
      deadline: room.game.question.deadline,
      serverNow: startedAt,
      players: publicPlayers(room),
    });

    room.game.timer = setTimeout(() => {
      if (rooms.get(room.code) !== room) return;
      endQuestion(room, 'timeout');
    }, config.questionMs + 25);
  }

  function answerList(room, question) {
    return room.players.map((player) => {
      const answer = question.answers[player.id];
      return {
        playerId: player.id,
        nickname: player.nickname,
        selectedIndex: answer ? answer.selectedIndex : null,
        correct: Boolean(answer && answer.correct),
      };
    });
  }

  function scoreList(room) {
    return room.players.map((player) => ({
      id: player.id,
      nickname: player.nickname,
      score: player.score,
    }));
  }

  function reviewEntry(question, index, statuses, mistakes = {}) {
    return {
      index: index + 1,
      word: question.word,
      level: question.level,
      meanings: question.meanings,
      primary: question.primary,
      correctOption: question.correctText,
      statuses,
      mistakes,
    };
  }

  function buildQuizReview(room) {
    return (room.game?.history || []).map((result) => {
      const statuses = {};
      for (const player of room.players) {
        const answer = result.answers.find((entry) => entry.playerId === player.id);
        statuses[player.id] =
          !answer || answer.selectedIndex === null
            ? 'unanswered'
            : answer.correct
              ? 'correct'
              : 'wrong';
      }
      return reviewEntry(
        {
          word: result.word,
          level: result.level,
          meanings: result.meanings,
          primary: result.primary,
          correctText: result.correctOption,
        },
        result.questionIndex - 1,
        statuses
      );
    });
  }

  function buildRaceReview(room) {
    const game = room.game;
    return game.questions.map((question, index) => {
      const statuses = {};
      const mistakes = {};
      for (const player of room.players) {
        const state = game.states[player.id];
        const answer = state && state.answers[index];
        statuses[player.id] = answer ? answer.status : 'unanswered';
        mistakes[player.id] = Boolean(answer && answer.hasMistake);
      }
      return reviewEntry(question, index, statuses, mistakes);
    });
  }

  function endQuestion(room, reason, winnerId = null) {
    const game = room.game;
    const question = game && game.question;
    if (!question || question.ended) return;

    question.ended = true;
    if (game.timer) clearTimeout(game.timer);
    game.timer = null;

    const winner = winnerId
      ? room.players.find((player) => player.id === winnerId)
      : null;

    const result = {
      questionIndex: game.index + 1,
      total: game.questions.length,
      type: question.type,
      prompt: question.prompt,
      promptLabel: question.promptLabel,
      word: question.word,
      level: question.level,
      meanings: question.meanings,
      primary: question.primary,
      correctIndex: question.correctIndex,
      correctOption: question.correctText,
      correctMeaning: question.correctText,
      reason,
      winnerId: winner ? winner.id : null,
      winnerName: winner ? winner.nickname : null,
      answers: answerList(room, question),
      players: scoreList(room),
    };

    game.lastResult = result;
    game.history.push(result);
    game.question = null;

    io.to(room.code).emit('question:end', result);

    const isLast = game.index + 1 >= game.questions.length;
    game.nextTimer = setTimeout(() => {
      if (rooms.get(room.code) !== room || room.status !== 'playing') return;
      if (isLast) {
        finishQuizGame(room);
      } else {
        startQuestion(room, game.index + 1);
      }
    }, config.revealMs);
  }

  function finishQuizGame(room) {
    if (room.status !== 'playing' || !room.game || room.game.mode !== 'quiz') return;
    clearGameTimers(room);

    const scores = scoreList(room);
    const highest = Math.max(...scores.map((entry) => entry.score));
    const leaders = room.players.filter((player) => player.score === highest);
    const tie = leaders.length !== 1;
    const winner = tie ? null : leaders[0];

    room.status = 'finished';
    room.players.forEach((player) => {
      player.ready = false;
    });
    room.lastActivityAt = Date.now();

    const final = {
      mode: 'quiz',
      level: room.level,
      tie,
      winnerId: winner ? winner.id : null,
      winnerName: winner ? winner.nickname : null,
      scores,
      players: publicPlayers(room),
      review: buildQuizReview(room),
    };
    room.game.final = final;
    room.game.question = null;

    io.to(room.code).emit('game:over', final);
    broadcastRoom(room);
    // 若此刻双方都已离线，结束后立即回收房间。
    scheduleEmptyRoomCleanup(room);
  }

  function raceProgress(room) {
    if (!room.game || !room.game.states) return [];
    return room.players.map((player) => {
      const state = room.game.states[player.id];
      return {
        id: player.id,
        nickname: player.nickname,
        progress: state ? Math.min(state.index, room.game.questions.length) : 0,
        errors: state ? state.errors : 0,
        finished: Boolean(state && state.finishedAt),
      };
    });
  }

  function raceQuestionPayload(room, state) {
    if (!state || state.index >= room.game.questions.length) return null;
    const question = room.game.questions[state.index];
    return {
      mode: 'race',
      index: state.index + 1,
      total: room.game.questions.length,
      type: question.type,
      prompt: question.prompt,
      promptLabel: question.promptLabel,
      word: question.word,
      level: question.level,
      options: question.options,
      startedAt: room.game.startedAt,
    };
  }

  function sendRaceSync(room, player) {
    if (!room.game || room.game.mode !== 'race') return;
    const state = room.game.states[player.id];
    if (!state) return;
    const socket = player.socketId ? io.sockets.sockets.get(player.socketId) : null;
    if (!socket) return;

    socket.emit('race:sync', {
      mode: 'race',
      total: room.game.questions.length,
      startedAt: room.game.startedAt,
      serverNow: Date.now(),
      progress: raceProgress(room),
      question: state.finishedAt ? null : raceQuestionPayload(room, state),
      you: {
        playerId: player.id,
        progress: Math.min(state.index, room.game.questions.length),
        errors: state.errors,
        lockedUntil: state.lockedUntil,
        finishedAt: state.finishedAt,
      },
    });
  }

  function sendRaceQuestion(room, player) {
    if (!room.game || room.game.mode !== 'race') return;
    const state = room.game.states[player.id];
    if (!state || state.finishedAt) return;
    const question = raceQuestionPayload(room, state);
    if (!question) return;
    const socket = player.socketId ? io.sockets.sockets.get(player.socketId) : null;
    if (!socket) return;
    socket.emit('race:question', {
      ...question,
      progress: Math.min(state.index, room.game.questions.length),
      errors: state.errors,
      serverNow: Date.now(),
    });
  }

  function emitRaceProgress(room) {
    if (!room.game || room.game.mode !== 'race') return;
    io.to(room.code).emit('race:progress', {
      mode: 'race',
      total: room.game.questions.length,
      startedAt: room.game.startedAt,
      serverNow: Date.now(),
      progress: raceProgress(room),
    });
  }

  function startRace(room) {
    if (room.status !== 'playing' || !room.game || room.game.mode !== 'race') return;
    const now = Date.now();
    room.game.startedAt = now;
    room.game.states = {};
    for (const player of room.players) {
      room.game.states[player.id] = {
        index: 0,
        errors: 0,
        answers: {},
        finishedAt: null,
        lockedUntil: 0,
        unlockTimer: null,
        nextQuestionTimer: null,
      };
    }
    room.lastActivityAt = now;
    emitRaceProgress(room);
    for (const player of room.players) {
      sendRaceSync(room, player);
    }
  }

  /**
   * 单个玩家完成 25 题后只标记其个人完成状态，不结束整局。
   * 未完成的玩家继续答题；只有双方都完成后才调用 finishRace 统一结算。
   */
  function finishRacePlayer(room, player) {
    if (room.status !== 'playing' || !room.game || room.game.mode !== 'race') return;
    const state = room.game.states[player.id];
    if (!state || state.finishedAt) return;

    state.finishedAt = Date.now();
    state.index = room.game.questions.length;
    state.lockedUntil = 0;
    if (state.unlockTimer) clearTimeout(state.unlockTimer);
    if (state.nextQuestionTimer) clearTimeout(state.nextQuestionTimer);
    state.unlockTimer = null;
    state.nextQuestionTimer = null;
    room.lastActivityAt = state.finishedAt;

    emitRaceProgress(room);

    const allFinished = room.players.every((candidate) => {
      const candidateState = room.game.states[candidate.id];
      return Boolean(candidateState && candidateState.finishedAt);
    });
    if (allFinished) {
      finishRace(room, player);
      return;
    }

    // 让先完成的玩家立即进入等待页；重连时 sendRaceSync 也会恢复该状态。
    sendRaceSync(room, player);
  }

  function finishRace(room, triggerPlayer) {
    if (room.status !== 'playing' || !room.game || room.game.mode !== 'race') return;
    clearGameTimers(room);

    const now = Date.now();
    const total = room.game.questions.length;
    const stats = room.players.map((player) => {
      const state = room.game.states[player.id];
      const finishedAt = state.finishedAt || null;
      return {
        id: player.id,
        nickname: player.nickname,
        progress: state ? Math.min(state.index, total) : 0,
        errors: state ? state.errors : 0,
        finished: Boolean(finishedAt),
        totalMs: Math.max(0, (finishedAt || now) - room.game.startedAt),
      };
    });

    const allFinished = stats.every((entry) => entry.finished);
    let winnerStats;
    if (allFinished) {
      // 双方都完成时：总用时优先，错误数作为次级判定。
      winnerStats = [...stats].sort(
        (a, b) => a.totalMs - b.totalMs || a.errors - b.errors
      )[0];
    } else {
      winnerStats =
        stats.find((entry) => entry.finished) ||
        stats.find((entry) => entry.id === triggerPlayer.id) ||
        stats[0];
    }
    const winner = room.players.find((player) => player.id === winnerStats.id);

    room.status = 'finished';
    room.players.forEach((player) => {
      player.ready = false;
    });
    room.lastActivityAt = now;

    const final = {
      mode: 'race',
      level: room.level,
      total,
      tie: false,
      winnerId: winner ? winner.id : null,
      winnerName: winner ? winner.nickname : null,
      durationMs: Math.max(0, now - room.game.startedAt),
      scores: stats.map((entry) => ({
        id: entry.id,
        nickname: entry.nickname,
        score: entry.progress,
      })),
      players: publicPlayers(room),
      stats,
      review: buildRaceReview(room),
    };
    room.game.final = final;
    room.game.finishedAt = now;

    io.to(room.code).emit('game:over', final);
    broadcastRoom(room);
    scheduleEmptyRoomCleanup(room);
  }

  function scheduleStart(room) {
    room.startTimer = setTimeout(() => {
      room.startTimer = null;
      if (rooms.get(room.code) !== room || room.status !== 'playing') return;
      startQuestion(room, 0);
    }, config.startDelayMs);
  }

  function registerSocket(socket) {
    const on = (event, handler) => {
      socket.on(event, (payload, ack) => {
        const reply = typeof ack === 'function' ? ack : () => {};
        try {
          handler(payload && typeof payload === 'object' ? payload : {}, reply);
        } catch (error) {
          console.error(`[socket:${event}]`, error);
          reply({ ok: false, error: '服务器处理请求时出错，请重试' });
        }
      });
    };

    socket.on('latency:ping', (payload, ack) => {
      if (typeof ack !== 'function') return;
      ack({
        ok: true,
        t: payload && payload.t != null ? payload.t : null,
        serverNow: Date.now(),
      });
    });

    // ---------------------------------------------------------------
    // 单人错词挑战：错词本存在浏览器 localStorage，服务端只按客户端
    // 给定的词条 id 出题并判分，不保存任何学习进度。
    // ---------------------------------------------------------------
    const MAX_SOLO_WORDS = 300;

    // 客户端错词本以「单词」为唯一键（结算复盘里没有 id 字段），
    // 同时保留按 id 查词的能力，兼容旧调用。
    function soloEntriesFrom(payload) {
      const keys = Array.isArray(payload.words)
        ? payload.words
        : Array.isArray(payload.wordIds)
          ? payload.wordIds
          : [];
      const seen = new Set();
      const entries = [];
      for (const key of keys) {
        if (typeof key !== 'string') continue;
        const normalized = key.trim().toLowerCase();
        if (!normalized || seen.has(normalized)) continue;
        const entry = wordByName.get(normalized) || wordById.get(key);
        if (!entry) continue;
        seen.add(normalized);
        entries.push(entry);
        if (entries.length >= MAX_SOLO_WORDS) break;
      }
      return entries;
    }

    // 与双人对战的 50% / 30% / 20% 题型配比保持一致。
    function randomSoloType() {
      const roll = crypto.randomInt(100);
      if (roll < 50) return 'en2zh';
      if (roll < 80) return 'zh2en';
      return 'listen';
    }

    on('solo:start', (payload, ack) => {
      // 错词挑战为 VIP 专属：免费用户走「限时闯关」（trial:*）。
      if (config.vipRequired && socket.data.vip !== true) {
        ack({
          ok: false,
          error: '错词挑战是 VIP 专属功能，激活后可解锁',
          code: 'VIP_REQUIRED',
        });
        return;
      }
      const entries = soloEntriesFrom(payload);
      if (!entries.length) {
        ack({ ok: false, error: '错词本为空，先去打一局吧' });
        return;
      }
      socket.data.solo = { entries, lastWordId: null, pending: null };
      ack({ ok: true, total: entries.length });
    });

    on('solo:next', (payload, ack) => {
      const solo = socket.data.solo;
      if (!solo) {
        ack({ ok: false, error: '请先开始错词挑战' });
        return;
      }
      // 客户端每轮传回仍未被掌握的单词，已掌握的词自然退出抽题池。
      const keepSource = Array.isArray(payload.words)
        ? payload.words
        : payload.wordIds;
      if (Array.isArray(keepSource)) {
        const keep = new Set(
          keepSource
            .filter((word) => typeof word === 'string')
            .map((word) => word.trim().toLowerCase())
        );
        const filtered = solo.entries.filter((entry) =>
          keep.has(entry.word.toLowerCase())
        );
        if (filtered.length) solo.entries = filtered;
      }
      if (!solo.entries.length) {
        ack({ ok: false, error: '错词本已清空' });
        return;
      }

      let candidates = solo.entries;
      if (candidates.length > 1 && solo.lastWordId) {
        const rest = candidates.filter((entry) => entry.id !== solo.lastWordId);
        if (rest.length) candidates = rest;
      }
      const entry = candidates[crypto.randomInt(candidates.length)];
      const question = buildQuestion(entry, words, randomSoloType());
      solo.pending = question;
      solo.lastWordId = entry.id;

      ack({
        ok: true,
        question: {
          id: question.id,
          word: question.word,
          level: question.level,
          type: question.type,
          prompt: question.prompt,
          promptLabel: question.promptLabel,
          options: question.options,
        },
      });
    });

    on('solo:answer', (payload, ack) => {
      const solo = socket.data.solo;
      const question = solo && solo.pending;
      if (!question) {
        ack({ ok: false, error: '没有待作答的题目' });
        return;
      }
      const index = Number(payload.index);
      if (!Number.isInteger(index) || index < 0 || index >= question.options.length) {
        ack({ ok: false, error: '选项无效' });
        return;
      }
      solo.pending = null;
      ack({
        ok: true,
        correct: index === question.correctIndex,
        id: question.id,
        word: question.word,
        type: question.type,
        correctIndex: question.correctIndex,
        correctText: question.correctText,
        primary: question.primary,
        meanings: question.meanings,
      });
    });

    on('solo:quit', (payload, ack) => {
      socket.data.solo = null;
      ack({ ok: true });
    });

    // ===== 单人限时闯关（免费体验）=====
    // 与「错词挑战」分开：题目由服务端按关卡词池生成，客户端只能提交选项。
    // 超时判定以服务端 deadline 为准，前端倒计时只负责展示与到点自动提交。

    function trialTimeLimit(levelIndex, levelId) {
      const custom = config.trialTimeLimitsMs;
      if (
        Array.isArray(custom) &&
        Number.isInteger(levelIndex) &&
        custom[levelIndex] > 0
      ) {
        return custom[levelIndex];
      }
      return levels.timeLimitFor(levelId);
    }

    function trialQuestionPayload(trial) {
      const question = trial.current;
      return {
        index: trial.index + 1,
        total: trial.questions.length,
        id: question.id,
        word: question.word,
        level: question.level,
        type: question.type,
        prompt: question.prompt,
        promptLabel: question.promptLabel,
        options: question.options,
        timeLimitMs: trial.timeLimitMs,
        deadline: trial.deadline,
        serverNow: Date.now(),
      };
    }

    function armTrialQuestion(trial) {
      trial.current = trial.questions[trial.index];
      trial.deadline = Date.now() + trial.timeLimitMs;
      trial.answered = false;
    }

    on('trial:levels', (payload, ack) => {
      ack({ ok: true, levels: levels.listLevels() });
    });

    on('trial:start', (payload, ack) => {
      const requested = payload && payload.chapter;
      let target;
      let levelIndex;
      try {
        target = levels.findLevel(requested);
        levelIndex = levels.listLevels().findIndex((item) => item.id === target.id);
      } catch (error) {
        ack({ ok: false, error: error.message });
        return;
      }
      // 目前三关全部 free；将来若出现付费关，这里就是权限闸门。
      if (!target.free && socket.data.vip !== true) {
        ack({ ok: false, error: '该关卡为 VIP 专属', code: 'VIP_REQUIRED' });
        return;
      }

      const pool = levels.trialPoolFor(target.id);
      const count = Math.min(config.trialQuestionCount, pool.length);
      let questions;
      try {
        questions = buildQuestions(pool, count, 'CET4');
      } catch (error) {
        console.error('[trial:start]', error);
        ack({ ok: false, error: `第 ${target.id} 关词库不足或损坏` });
        return;
      }

      const trial = {
        levelId: target.id,
        title: target.title,
        questions,
        index: 0,
        correct: 0,
        timeLimitMs: trialTimeLimit(levelIndex, target.id),
        deadline: 0,
        current: null,
        answered: false,
      };
      armTrialQuestion(trial);
      socket.data.trial = trial;

      audit('trial_start', {
        level: target.id,
        total: questions.length,
        timeLimitMs: trial.timeLimitMs,
      });
      ack({
        ok: true,
        chapter: { id: target.id, title: target.title },
        total: questions.length,
        timeLimitMs: trial.timeLimitMs,
        question: trialQuestionPayload(trial),
      });
    });

    on('trial:answer', (payload, ack) => {
      const trial = socket.data.trial;
      if (!trial || !trial.current) {
        ack({ ok: false, error: '请先开始闯关' });
        return;
      }
      if (trial.answered) {
        ack({ ok: false, error: '本题已作答' });
        return;
      }

      const index = payload && Number.isInteger(payload.index) ? payload.index : null;
      // 客户端到点会自动提交 index=null；服务端仍以 deadline 复核，
      // 迟到的答案一律按超时处理，避免前端改时钟作弊。
      const late = Date.now() > trial.deadline + config.trialGraceMs;
      const timedOut = index === null || late;

      let correct = false;
      if (!timedOut) {
        if (index < 0 || index >= trial.current.options.length) {
          ack({ ok: false, error: '选项无效' });
          return;
        }
        correct = index === trial.current.correctIndex;
      }

      trial.answered = true;
      if (correct) trial.correct += 1;

      ack({
        ok: true,
        correct,
        timedOut,
        correctIndex: trial.current.correctIndex,
        correctText: trial.current.correctText,
        word: trial.current.word,
        type: trial.current.type,
        meanings: trial.current.meanings,
      });
    });

    on('trial:next', (payload, ack) => {
      const trial = socket.data.trial;
      if (!trial) {
        ack({ ok: false, error: '请先开始闯关' });
        return;
      }
      // 未作答就请求下一题：记为错误（跳过），不给分。
      if (trial.current && !trial.answered) {
        trial.answered = true;
      }

      trial.index += 1;
      if (trial.index >= trial.questions.length) {
        const summary = {
          chapter: trial.levelId,
          title: trial.title,
          total: trial.questions.length,
          correct: trial.correct,
          wrong: trial.questions.length - trial.correct,
        };
        socket.data.trial = null;
        ack({ ok: true, done: true, summary });
        return;
      }

      armTrialQuestion(trial);
      ack({ ok: true, done: false, question: trialQuestionPayload(trial) });
    });

    on('trial:quit', (payload, ack) => {
      socket.data.trial = null;
      ack({ ok: true });
    });

    on('vip:verify', (payload, ack) => {
      const ip = clientIp(socket);
      const deviceToken = payload && payload.deviceToken;
      const normalizedDevice = normalizeDeviceToken(deviceToken);
      // 不管验证成功还是失败都记录设备指纹：验证失败的设备（已封禁）同样需要能被踢线。
      if (normalizedDevice) socket.data.deviceToken = normalizedDevice;
      // silent=true 是前端「刷新/重连自动重验」，服务端在该模式下不允许首次绑定，
      // 避免解绑后本地残留的码被静默绑回原设备。
      const silent = Boolean(payload && payload.silent);
      const result = vip.verify(payload.code, ip, deviceToken, { silent });
      audit('vip_verify', {
        ip,
        code: maskCode(payload && payload.code),
        // 只记录设备 Token 前 8 位，便于排查「疑似共享」又不落完整凭据。
        device: deviceToken ? String(deviceToken).slice(0, 8) : null,
        ok: result.ok,
        tier: result.tier || null,
        silent,
        reason: result.code || null,
      });

      if (!result.ok) {
        ack({ ok: false, error: result.message, code: result.code });
        return;
      }
      socket.data.vip = true;
      socket.data.vipCode = String(payload.code || '').trim().toUpperCase();
      ack({ ok: true, kind: result.kind, message: result.message });
    });

    // 按设备查授权：前端 init 时的权威判定（不依赖本地缓存）。
    on('vip:status', (payload, ack) => {
      const normalizedDevice = normalizeDeviceToken(payload && payload.deviceToken);
      if (normalizedDevice) socket.data.deviceToken = normalizedDevice;
      const status = vip.statusByDevice(
        payload && payload.deviceToken,
        payload && payload.code
      );
      ack({ ok: true, vip: Boolean(status.vip), kind: status.kind || null });
    });

    // 联系站长：公开留言入口（按 device_token 限流，不需要激活码）
    on('message:create', (payload, ack) => {
      const ip = clientIp(socket);
      const content = payload && payload.content;
      const deviceToken = payload && payload.deviceToken;
      const result = messages.add({ content, deviceToken, ip });

      audit('message_create', {
        ip,
        device: deviceToken ? String(deviceToken).slice(0, 8) : null,
        length: typeof content === 'string' ? Array.from(content).length : 0,
        ok: result.ok,
        reason: result.code || null,
      });

      ack(result);
    });

    // 用户端「我的留言」：按设备 Token 的哈希反查自己的留言与站长回复。
    // 只返回白名单字段，且只返回该设备自己的记录——deviceHash 由服务端计算，
    // 客户端无法指定别人设备，也无法拿到他人留言。
    on('message:mine', (payload, ack) => {
      const deviceToken = normalizeDeviceToken(payload && payload.deviceToken);
      if (!deviceToken) {
        ack({ ok: false, error: '设备标识缺失，请刷新页面后重试', code: 'DEVICE_REQUIRED' });
        return;
      }
      const deviceHash = crypto.createHash('sha256').update(deviceToken).digest('hex');
      const mine = messages.listByDevice(deviceHash).map((item) => ({
        id: item.id,
        content: item.content,
        reply: item.reply == null ? null : item.reply,
        repliedAt: item.repliedAt == null ? null : item.repliedAt,
        createdAt: item.createdAt,
        status: item.status,
      }));
      ack({ ok: true, messages: mine });
    });

    on('room:create', (payload, ack) => {
      if (config.vipRequired && socket.data.vip !== true) {
        ack({ ok: false, error: '创建房间需要激活码', code: 'VIP_REQUIRED' });
        return;
      }
      if (socket.data.roomCode) {
        ack({ ok: false, error: '你已经在一个房间中' });
        return;
      }
      const nickname = cleanNickname(payload.nickname);
      if (!nickname) {
        ack({ ok: false, error: `昵称需为 1-${config.maxNicknameLength} 个字符` });
        return;
      }
      const level = payload.level === undefined ? 'CET4' : cleanLevel(payload.level);
      if (!level || level === 'CET6') {
        ack({ ok: false, error: '六级词库正在建设中，请先体验四级' });
        return;
      }

      const code = newCode();
      const room = {
        code,
        level: 'CET4',
        mode: 'quiz',
        hostId: null,
        status: 'waiting',
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
        players: [],
        game: null,
        startTimer: null,
        emptyTimer: null,
      };
      const player = newPlayer(nickname);
      room.hostId = player.id;
      room.players.push(player);
      rooms.set(code, room);
      bindPlayer(socket, room, player);

      ack({ ok: true, playerId: player.id, sessionId: player.sessionId, room: roomView(room) });
      broadcastRoom(room);
      audit('room_created', {
        room: room.code,
        nickname,
        ip: clientIp(socket),
        mode: room.mode,
        level: room.level,
      });
    });

    on('room:join', (payload, ack) => {
      if (config.vipRequired && socket.data.vip !== true) {
        ack({ ok: false, error: '加入房间需要激活码', code: 'VIP_REQUIRED' });
        return;
      }
      if (socket.data.roomCode) {
        ack({ ok: false, error: '你已经在一个房间中' });
        return;
      }
      const nickname = cleanNickname(payload.nickname);
      const code = cleanRoomCode(payload.code);
      if (!nickname) {
        ack({ ok: false, error: `昵称需为 1-${config.maxNicknameLength} 个字符` });
        return;
      }
      if (!code) {
        ack({ ok: false, error: '请输入 6 位数字房间码' });
        return;
      }
      const room = rooms.get(code);
      if (!room) {
        ack({ ok: false, error: '房间不存在，请检查房间码' });
        return;
      }
      if (room.players.length >= 2) {
        ack({ ok: false, error: '房间已满（最多 2 人）' });
        return;
      }
      if (room.status !== 'waiting') {
        ack({ ok: false, error: '该房间已经开局，无法加入' });
        return;
      }

      const player = newPlayer(nickname);
      room.players.push(player);
      bindPlayer(socket, room, player);

      ack({ ok: true, playerId: player.id, sessionId: player.sessionId, room: roomView(room) });
      broadcastRoom(room);
    });

    on('room:resume', (payload, ack) => {
      const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : '';
      if (!sessionId) {
        ack({ ok: false, fatal: true, error: '没有可恢复的会话' });
        return;
      }
      if (socket.data.roomCode) {
        ack({ ok: false, fatal: true, error: '当前连接已经在房间中' });
        return;
      }
      const reference = sessions.get(sessionId);
      const room = reference ? rooms.get(reference.roomCode) : null;
      const player = room
        ? room.players.find((candidate) => candidate.id === reference.playerId)
        : null;

      if (!room || !player) {
        sessions.delete(sessionId);
        ack({ ok: false, fatal: true, error: '原房间已关闭或会话已失效' });
        return;
      }

      if (player.socketId && player.socketId !== socket.id) {
        const previous = io.sockets.sockets.get(player.socketId);
        socketPlayers.delete(player.socketId);
        if (previous) {
          previous.leave(room.code);
          previous.data.roomCode = null;
          previous.data.playerId = null;
          previous.disconnect(true);
        }
      }

      bindPlayer(socket, room, player);
      ack({
        ok: true,
        playerId: player.id,
        sessionId: player.sessionId,
        room: roomView(room),
      });
      broadcastRoom(room);
      if (room.status === 'playing' && room.game && room.game.mode === 'race') {
        sendRaceSync(room, player);
      }
    });

    on('player:ready', (payload, ack) => {
      const context = findContext(socket);
      if (!context) {
        ack({ ok: false, error: '你不在房间中' });
        return;
      }
      const { room, player } = context;
      if (room.status !== 'waiting') {
        ack({ ok: false, error: '当前不能修改准备状态' });
        return;
      }
      player.ready = Boolean(payload.ready);
      room.lastActivityAt = Date.now();
      ack({ ok: true, room: roomView(room) });
      broadcastRoom(room);
    });

    on('room:mode', (payload, ack) => {
      const context = findContext(socket);
      if (!context) {
        ack({ ok: false, error: '你不在房间中' });
        return;
      }
      const { room, player } = context;
      if (room.hostId !== player.id) {
        ack({ ok: false, error: '只有房主可以切换模式' });
        return;
      }
      if (room.status !== 'waiting') {
        ack({ ok: false, error: '对局开始后不能切换模式' });
        return;
      }
      const mode = cleanMode(payload.mode);
      if (!mode) {
        ack({ ok: false, error: '无效的对战模式' });
        return;
      }
      room.mode = mode;
      room.lastActivityAt = Date.now();
      ack({ ok: true, room: roomView(room) });
      broadcastRoom(room);
    });

    on('room:level', (payload, ack) => {
      const context = findContext(socket);
      if (!context) {
        ack({ ok: false, error: '你不在房间中' });
        return;
      }
      const { room, player } = context;
      if (room.hostId !== player.id) {
        ack({ ok: false, error: '只有房主可以选择词库范围' });
        return;
      }
      if (room.status !== 'waiting') {
        ack({ ok: false, error: '对局开始后不能切换词库范围' });
        return;
      }
      const level = cleanLevel(payload.level);
      if (!level) {
        ack({ ok: false, error: '无效的词库范围' });
        return;
      }
      if (level === 'CET6') {
        ack({ ok: false, error: '六级词库正在建设中，请先体验四级' });
        return;
      }
      room.level = level;
      room.lastActivityAt = Date.now();
      ack({ ok: true, room: roomView(room) });
      broadcastRoom(room);
    });

    on('game:start', (payload, ack) => {
      const context = findContext(socket);
      if (!context) {
        ack({ ok: false, error: '你不在房间中' });
        return;
      }
      const { room, player } = context;
      if (room.hostId !== player.id) {
        ack({ ok: false, error: '只有房主可以开始对战' });
        return;
      }
      if (room.status !== 'waiting') {
        ack({ ok: false, error: '当前状态不能开始对战' });
        return;
      }
      if (room.players.length !== 2) {
        ack({ ok: false, error: '需要两位玩家才能开始' });
        return;
      }
      if (room.players.some((candidate) => !candidate.connected)) {
        ack({ ok: false, error: '对手已掉线，请等待其重连' });
        return;
      }
      if (room.players.some((candidate) => !candidate.ready)) {
        ack({ ok: false, error: '双方都准备好后才能开始' });
        return;
      }

      const mode = room.mode || 'quiz';
      const questionCount = mode === 'race' ? 25 : 10;
      let questions;
      try {
        questions = buildQuestions(words, questionCount, room.level);
      } catch (error) {
        console.error('[start]', error);
        ack({
          ok: false,
          error:
            `${room.level === 'CET4' ? '四级' : '六级'}词库不足或损坏，` +
            `当前模式需要 ${questionCount} 个词条`,
        });
        return;
      }

      room.players.forEach((candidate) => {
        candidate.score = 0;
        candidate.ready = false;
      });
      room.status = 'playing';
      if (mode === 'race') {
        room.game = {
          mode: 'race',
          questions,
          startedAt: null,
          finishedAt: null,
          states: null,
          final: null,
        };
      } else {
        room.game = {
          mode: 'quiz',
          questions,
          index: -1,
          question: null,
          lastResult: null,
          history: [],
          final: null,
          timer: null,
          nextTimer: null,
        };
      }
      room.lastActivityAt = Date.now();

      ack({ ok: true, room: roomView(room) });
      broadcastRoom(room);
      if (mode === 'race') {
        startRace(room);
      } else {
        scheduleStart(room);
      }
    });

    on('game:answer', (payload, ack) => {
      const context = findContext(socket);
      if (!context) {
        ack({ ok: false, error: '你不在房间中' });
        return;
      }
      const { room, player } = context;
      if (room.status !== 'playing' || !room.game || !room.game.question) {
        ack({ ok: false, error: '当前没有可作答的题目' });
        return;
      }
      const question = room.game.question;
      if (question.ended) {
        ack({ ok: false, error: '本题已经结束' });
        return;
      }
      if (Date.now() >= question.deadline) {
        endQuestion(room, 'timeout');
        ack({ ok: false, error: '本题已超时' });
        return;
      }
      if (question.answers[player.id]) {
        ack({ ok: false, error: '本题你已经作答过了' });
        return;
      }
      const optionIndex = payload.optionIndex;
      if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= question.options.length) {
        ack({ ok: false, error: '无效的选项' });
        return;
      }

      const correct = optionIndex === question.correctIndex;
      question.answers[player.id] = {
        selectedIndex: optionIndex,
        correct,
        answeredAt: Date.now(),
      };
      room.lastActivityAt = Date.now();

      // 听音选词答完后立刻展示中文释义，方便当场复盘。
      const reveal =
        question.type === 'listen'
          ? {
              word: question.word,
              meanings: question.meanings,
              primary: question.primary,
            }
          : null;

      if (correct) {
        player.score += 10;
        ack({
          ok: true,
          correct: true,
          selectedIndex: optionIndex,
          score: player.score,
          locked: true,
          correctIndex: question.correctIndex,
          reveal,
        });
        endQuestion(room, 'correct', player.id);
        return;
      }

      player.score -= 5;
      ack({
        ok: true,
        correct: false,
        selectedIndex: optionIndex,
        score: player.score,
        locked: true,
        correctIndex: question.correctIndex,
        reveal,
      });
      socket.to(room.code).emit('answer:update', {
        playerId: player.id,
        nickname: player.nickname,
        correct: false,
        score: player.score,
        selectedIndex: optionIndex,
      });

      const everyoneAnswered = room.players.every(
        (candidate) => question.answers[candidate.id]
      );
      if (everyoneAnswered) {
        endQuestion(room, 'all_wrong');
      }
    });

    on('race:answer', (payload, ack) => {
      const context = findContext(socket);
      if (!context) {
        ack({ ok: false, error: '你不在房间中' });
        return;
      }
      const { room, player } = context;
      if (
        room.status !== 'playing' ||
        room.mode !== 'race' ||
        !room.game ||
        room.game.mode !== 'race'
      ) {
        ack({ ok: false, error: '当前不在竞速对局中' });
        return;
      }
      const game = room.game;
      const state = game.states[player.id];
      if (!state) {
        ack({ ok: false, error: '找不到你的竞速状态' });
        return;
      }
      if (state.finishedAt) {
        ack({ ok: false, error: '你已经完成全部题目' });
        return;
      }

      const now = Date.now();
      if (state.lockedUntil > now) {
        ack({
          ok: false,
          code: 'LOCKED',
          error: '答错惩罚中，请等待倒计时结束',
          lockedUntil: state.lockedUntil,
          serverNow: now,
          remainingMs: state.lockedUntil - now,
        });
        return;
      }

      const question = game.questions[state.index];
      if (!question) {
        ack({ ok: false, error: '当前没有可作答的题目' });
        return;
      }
      const optionIndex = payload.optionIndex;
      if (
        !Number.isInteger(optionIndex) ||
        optionIndex < 0 ||
        optionIndex >= question.options.length
      ) {
        ack({ ok: false, error: '无效的选项' });
        return;
      }

      const previous = state.answers[state.index];
      const attempts = (previous ? previous.attempts : 0) + 1;
      const correct = optionIndex === question.correctIndex;
      // 只要本题选错过一次，后续即使纠正也保留“曾答错”标记，供复盘使用。
      const hasMistake = Boolean(previous && previous.hasMistake) || !correct;
      room.lastActivityAt = now;

      if (correct) {
        state.answers[state.index] = {
          status: 'correct',
          correct: true,
          selectedIndex: optionIndex,
          attempts,
          hasMistake,
          answeredAt: now,
        };
        state.index += 1;
        state.lockedUntil = 0;
        if (state.unlockTimer) clearTimeout(state.unlockTimer);
        if (state.nextQuestionTimer) clearTimeout(state.nextQuestionTimer);
        state.unlockTimer = null;
        state.nextQuestionTimer = null;

        const finished = state.index >= game.questions.length;
        ack({
          ok: true,
          correct: true,
          selectedIndex: optionIndex,
          progress: state.index,
          total: game.questions.length,
          errors: state.errors,
          finished,
        });        emitRaceProgress(room);

        if (finished) {
          finishRacePlayer(room, player);
          return;
        }

        state.nextQuestionTimer = setTimeout(() => {
          state.nextQuestionTimer = null;
          if (rooms.get(room.code) !== room || room.status !== 'playing') return;
          if (!game.states[player.id] || game.states[player.id].finishedAt) return;
          sendRaceQuestion(room, player);
        }, config.raceAdvanceDelayMs);
        return;
      }

      state.answers[state.index] = {
        status: 'wrong',
        correct: false,
        selectedIndex: optionIndex,
        attempts,
        hasMistake,
        answeredAt: now,
      };
      state.errors += 1;
      state.lockedUntil = now + config.racePenaltyMs;
      if (state.unlockTimer) clearTimeout(state.unlockTimer);

      ack({
        ok: true,
        correct: false,
        selectedIndex: optionIndex,
        progress: state.index,
        total: game.questions.length,
        errors: state.errors,
        lockedUntil: state.lockedUntil,
        penaltyMs: config.racePenaltyMs,
        serverNow: now,
        correctIndex: question.correctIndex,
        // 竞速答错会停留 1 秒冷却期，正好用来展示听音题的中文含义。
        reveal:
          question.type === 'listen'
            ? { word: question.word, meanings: question.meanings, primary: question.primary }
            : null,
      });
      socket.emit('race:locked', {
        selectedIndex: optionIndex,
        lockedUntil: state.lockedUntil,
        serverNow: now,
        penaltyMs: config.racePenaltyMs,
        errors: state.errors,
      });
      emitRaceProgress(room);

      state.unlockTimer = setTimeout(() => {
        state.unlockTimer = null;
        if (rooms.get(room.code) !== room || room.status !== 'playing') return;
        if (state.finishedAt) return;
        if (state.lockedUntil > Date.now()) return;
        state.lockedUntil = 0;
        const currentPlayer = room.players.find((entry) => entry.id === player.id);
        if (!currentPlayer) return;
        const currentSocket = currentPlayer.socketId
          ? io.sockets.sockets.get(currentPlayer.socketId)
          : null;
        if (currentSocket) {
          currentSocket.emit('race:unlocked', {
            index: state.index + 1,
            errors: state.errors,
            serverNow: Date.now(),
          });
        }
      }, config.racePenaltyMs + 25);
    });

    on('game:rematch', (payload, ack) => {
      const context = findContext(socket);
      if (!context) {
        ack({ ok: false, error: '你不在房间中' });
        return;
      }
      const { room } = context;
      if (room.status !== 'finished') {
        ack({ ok: false, error: '当前不能再来一局' });
        return;
      }
      clearGameTimers(room);
      room.status = 'waiting';
      room.game = null;
      room.players.forEach((player) => {
        player.score = 0;
        player.ready = false;
      });
      room.lastActivityAt = Date.now();
      ack({ ok: true, room: roomView(room) });
      broadcastRoom(room);
    });

    on('room:leave', (payload, ack) => {
      const context = findContext(socket);
      if (!context) {
        ack({ ok: false, error: '你不在房间中' });
        return;
      }
      const { room, player } = context;
      if (room.status === 'playing') {
        ack({ ok: false, error: '对局进行中，暂不能退出房间' });
        return;
      }

      sessions.delete(player.sessionId);
      socketPlayers.delete(socket.id);
      room.players = room.players.filter((candidate) => candidate.id !== player.id);
      socket.leave(room.code);
      socket.data.roomCode = null;
      socket.data.playerId = null;

      if (room.players.length === 0) {
        deleteRoom(room);
      } else {
        if (room.hostId === player.id) {
          room.hostId = room.players[0].id;
        }
        if (room.status === 'finished') {
          room.status = 'waiting';
          room.game = null;
          room.players.forEach((candidate) => {
            candidate.ready = false;
            candidate.score = 0;
          });
        }
        room.lastActivityAt = Date.now();
        broadcastRoom(room);
        // 剩下的人若恰好已离线，也要能触发回收。
        scheduleEmptyRoomCleanup(room);
      }
      ack({ ok: true });
    });

    socket.on('disconnect', (reason) => {
      const reference = socketPlayers.get(socket.id);
      const durationMs = socket.data.connectedAt
        ? Date.now() - socket.data.connectedAt
        : null;

      if (!reference) {
        audit('socket_disconnect', {
          ip: clientIp(socket),
          sid: socket.id,
          reason,
          durationMs,
          room: null,
        });
        return;
      }

      socketPlayers.delete(socket.id);
      const room = rooms.get(reference.roomCode);
      if (!room) {
        audit('socket_disconnect', {
          ip: clientIp(socket),
          sid: socket.id,
          reason,
          durationMs,
          room: reference.roomCode,
          playerId: reference.playerId,
        });
        return;
      }
      const player = room.players.find((candidate) => candidate.id === reference.playerId);
      if (!player || player.socketId !== socket.id) return;

      player.connected = false;
      player.socketId = null;
      room.lastActivityAt = Date.now();
      broadcastRoom(room);

      const connectedPlayers = room.players.filter((candidate) => candidate.connected).length;
      audit('socket_disconnect', {
        ip: clientIp(socket),
        sid: socket.id,
        reason,
        durationMs,
        room: room.code,
        playerId: player.id,
        nickname: player.nickname,
        status: room.status,
        connectedPlayers,
      });

      // 最后一个人也走了：结束后立即回收，进行中给一个短暂宽限期。
      scheduleEmptyRoomCleanup(room);
    });
  }

  io.on('connection', (socket) => {
    socket.data.connectedAt = Date.now();
    audit('socket_connect', {
      ip: clientIp(socket),
      sid: socket.id,
      ua: String(socket.handshake?.headers?.['user-agent'] || '').slice(0, 80),
    });
    registerSocket(socket);
  });

  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const room of [...rooms.values()]) {
      const hasConnectedPlayer = room.players.some((player) => player.connected);
      if (!hasConnectedPlayer && now - room.lastActivityAt > config.roomTtlMs) {
        deleteRoom(room);
      }
    }
  }, config.cleanupIntervalMs);
  cleanupTimer.unref();

  function close() {
    clearInterval(cleanupTimer);
    for (const room of [...rooms.values()]) {
      cancelEmptyRoomCleanup(room);
      clearGameTimers(room);
    }
    rooms.clear();
    sessions.clear();
    socketPlayers.clear();
    return new Promise((resolve) => {
      io.close(() => httpServer.close(() => resolve()));
    });
  }

  return { app, httpServer, io, rooms, sessions, config, adminAuth, vip, messages, close };
}

module.exports = { createArenaServer, DEFAULT_CONFIG, SESSION_MISSING };
