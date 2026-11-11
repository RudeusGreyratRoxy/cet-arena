(() => {
  'use strict';

  const STORAGE = {
    session: 'cetArena.sessionId',
    room: 'cetArena.roomCode',
    nickname: 'cetArena.nickname',
    vip: 'cetArena.vip.v1',
  };
  const APP_VERSION = '20261111-vip3';

  const VIEW_IDS = ['loading', 'home', 'room', 'game', 'result', 'solo'];
  const LETTERS = ['A', 'B', 'C', 'D'];

  const el = {
    connection: document.getElementById('connection'),
    connectionText: document.getElementById('connectionText'),
    pingDisplay: document.getElementById('pingDisplay'),
    pingValue: document.getElementById('pingValue'),
    reconnectBanner: document.getElementById('reconnectBanner'),
    nickname: document.getElementById('nickname'),
    roomCode: document.getElementById('roomCode'),
    createBtn: document.getElementById('createBtn'),
    joinBtn: document.getElementById('joinBtn'),
    homeError: document.getElementById('homeError'),
    wrongChallengeBtn: document.getElementById('wrongChallengeBtn'),
    wrongBookCount: document.getElementById('wrongBookCount'),
    wrongBookHint: document.getElementById('wrongBookHint'),
    soloExitBtn: document.getElementById('soloExitBtn'),
    soloPlay: document.getElementById('soloPlay'),
    soloSummary: document.getElementById('soloSummary'),
    soloSummaryTitle: document.getElementById('soloSummaryTitle'),
    soloSummaryCopy: document.getElementById('soloSummaryCopy'),
    soloAgainBtn: document.getElementById('soloAgainBtn'),
    soloHomeBtn: document.getElementById('soloHomeBtn'),
    soloRemaining: document.getElementById('soloRemaining'),
    soloMastered: document.getElementById('soloMastered'),
    soloAnswered: document.getElementById('soloAnswered'),
    soloPrompt: document.getElementById('soloPrompt'),
    soloQuestionWord: document.getElementById('soloQuestionWord'),
    soloWordText: document.getElementById('soloWordText'),
    soloSpeakBtn: document.getElementById('soloSpeakBtn'),
    soloOptions: document.getElementById('soloOptions'),
    soloReveal: document.getElementById('soloReveal'),
    answerReveal: document.getElementById('answerReveal'),
    soloFeedback: document.getElementById('soloFeedback'),
    soloDots: document.getElementById('soloDots'),
    soloStreakValue: document.getElementById('soloStreakValue'),
    lobbyCode: document.getElementById('lobbyCode'),
    roomLevelBadge: document.getElementById('roomLevelBadge'),
    shareCode: document.getElementById('shareCode'),
    shareLevel: document.getElementById('shareLevel'),
    copyLinkBtn: document.getElementById('copyLinkBtn'),
    lobbyPlayers: document.getElementById('lobbyPlayers'),
    lobbyStatus: document.getElementById('lobbyStatus'),
    modeQuizBtn: document.getElementById('modeQuizBtn'),
    modeRaceBtn: document.getElementById('modeRaceBtn'),
    modeHint: document.getElementById('modeHint'),
    levelSelect: document.getElementById('levelSelect'),
    levelHint: document.getElementById('levelHint'),
    readyBtn: document.getElementById('readyBtn'),
    startBtn: document.getElementById('startBtn'),
    leaveBtn: document.getElementById('leaveBtn'),
    questionIndex: document.getElementById('questionIndex'),
    questionTotal: document.getElementById('questionTotal'),
    questionLevel: document.getElementById('questionLevel'),
    raceClock: document.getElementById('raceClock'),
    scoreStrip: document.getElementById('scoreStrip'),
    timerRow: document.getElementById('timerRow'),
    timerNumber: document.getElementById('timerNumber'),
    timerBar: document.getElementById('timerBar'),
    questionWord: document.getElementById('questionWord'),
    questionWordText: document.getElementById('questionWordText'),
    speakBtn: document.getElementById('speakBtn'),
    questionPrompt: document.getElementById('questionPrompt'),
    options: document.getElementById('options'),
    cooldownHint: document.getElementById('cooldownHint'),
    gameFeedback: document.getElementById('gameFeedback'),
    opponentStatus: document.getElementById('opponentStatus'),
    resultTitle: document.getElementById('resultTitle'),
    resultSubtitle: document.getElementById('resultSubtitle'),
    finalScores: document.getElementById('finalScores'),
    rematchBtn: document.getElementById('rematchBtn'),
    resultLeaveBtn: document.getElementById('resultLeaveBtn'),
    rematchHint: document.getElementById('rematchHint'),
    reviewPanel: document.getElementById('reviewPanel'),
    reviewList: document.getElementById('reviewList'),
    reviewSummary: document.getElementById('reviewSummary'),
    vipOverlay: document.getElementById('vipOverlay'),
    vipStepHost: document.getElementById('vipStepHost'),
    vipStepPlayer: document.getElementById('vipStepPlayer'),
    vipStepPay: document.getElementById('vipStepPay'),
    vipHostInput: document.getElementById('vipHostInput'),
    vipHostError: document.getElementById('vipHostError'),
    vipHostVerifyBtn: document.getElementById('vipHostVerifyBtn'),
    vipHostPayBtn: document.getElementById('vipHostPayBtn'),
    vipHostCloseBtn: document.getElementById('vipHostCloseBtn'),
    vipPlayerInput: document.getElementById('vipPlayerInput'),
    vipPlayerError: document.getElementById('vipPlayerError'),
    vipPlayerVerifyBtn: document.getElementById('vipPlayerVerifyBtn'),
    vipPlayerPayBtn: document.getElementById('vipPlayerPayBtn'),
    vipPlayerCloseBtn: document.getElementById('vipPlayerCloseBtn'),
    vipPayCloseBtn: document.getElementById('vipPayCloseBtn'),
    vipNotice: document.getElementById('vipNotice'),
    vipBackBtn: document.getElementById('vipBackBtn'),
    vipClearBtn: document.getElementById('vipClearBtn'),
    toast: document.getElementById('toast'),
  };

  const state = {
    socket: null,
    sessionId: storageGet(STORAGE.session),
    playerId: null,
    room: null,
    currentQuestion: null,
    questionResult: null,
    selectedIndex: null,
    answerLocked: false,
    answeredCorrect: null,
    currentView: 'loading',
    resumeInFlight: false,
    speechWord: '',
    speechUtterance: null,
    lastSpeechTriggerAt: 0,
    speechNoticeShown: false,
    ping: {
      timer: null,
      inFlight: false,
    },
    countdown: {
      interval: null,
      deadline: 0,
      serverOffset: 0,
      total: 15000,
      expired: false,
    },
    race: {
      active: false,
      total: 25,
      progress: [],
      startedAt: 0,
      serverOffset: 0,
      question: null,
      lockedUntil: 0,
      errors: 0,
      clockTimer: null,
      cooldownTimer: null,
    },
    toastTimer: null,
    connectErrorShown: false,
    solo: {
      active: false,
      total: 0,
      answered: 0,
      correct: 0,
      mastered: 0,
      current: null,
      busy: false,
      lastWordId: null,
    },
    vip: {
      verified: false,
      code: '',
      tier: null,
      pending: null,
    },
  };

  init();

  function init() {
    el.nickname.value = storageGet(STORAGE.nickname) || '';

    const queryRoom = new URLSearchParams(window.location.search).get('room');
    if (queryRoom && /^\d{6}$/.test(queryRoom)) {
      el.roomCode.value = queryRoom;
    }

    // 预览参数：?vip=1 直接展示激活码弹窗，?vip=pay 展示会员支付页（便于验收/截图）。
    const vipPreview = new URLSearchParams(window.location.search).get('vip');
    if (vipPreview) {
      window.setTimeout(() => {
        openVipModal(vipPreview === 'join' ? 'join' : 'create');
        if (vipPreview === 'pay') showVipStep('pay');
      }, 0);
    }

    bindUiEvents();
    refreshWrongBookUi();
    const storedVip = readStoredVip();
    if (storedVip) {
      state.vip.code = storedVip.code;
      state.vip.tier = storedVip.tier || null;
    }
    updateVipUi();
    if (state.sessionId) {
      setView('loading');
    } else {
      setView('home');
    }
    connectSocket();
  }

  function bindUiEvents() {
    el.createBtn.addEventListener('click', createRoom);
    el.joinBtn.addEventListener('click', joinRoom);
    el.roomCode.addEventListener('input', () => {
      el.roomCode.value = el.roomCode.value.replace(/\D/g, '').slice(0, 6);
    });
    el.roomCode.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') joinRoom();
    });
    el.nickname.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && el.roomCode.value.length === 0) createRoom();
    });
    el.readyBtn.addEventListener('click', toggleReady);
    el.startBtn.addEventListener('click', startGame);
    el.leaveBtn.addEventListener('click', leaveRoom);
    el.copyLinkBtn.addEventListener('click', copyInviteLink);
    el.rematchBtn.addEventListener('click', requestRematch);
    el.resultLeaveBtn.addEventListener('click', leaveRoom);
    el.modeQuizBtn.addEventListener('click', () => setRoomMode('quiz'));
    el.modeRaceBtn.addEventListener('click', () => setRoomMode('race'));
    el.levelSelect.addEventListener('change', () => setRoomLevel(el.levelSelect.value));
    el.speakBtn.addEventListener('click', handleSpeakTrigger);
    el.speakBtn.addEventListener('touchend', handleSpeakTrigger);
    el.wrongChallengeBtn.addEventListener('click', startWrongChallenge);
    el.soloExitBtn.addEventListener('click', exitSolo);
    el.soloAgainBtn.addEventListener('click', startWrongChallenge);
    el.soloHomeBtn.addEventListener('click', () => setView('home'));
    el.soloSpeakBtn.addEventListener('click', handleSpeakTrigger);
    el.soloSpeakBtn.addEventListener('touchend', handleSpeakTrigger);

    // VIP 遮罩（房主通道 / 单人通道 / 价格）
    el.vipHostVerifyBtn.addEventListener('click', () => submitVip('host'));
    el.vipPlayerVerifyBtn.addEventListener('click', () => submitVip('player'));
    for (const [input, step] of [
      [el.vipHostInput, 'host'],
      [el.vipPlayerInput, 'player'],
    ]) {
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') submitVip(step);
        if (event.key === 'Escape') closeVipModal();
      });
    }
    el.vipHostPayBtn.addEventListener('click', () => showVipStep('pay'));
    el.vipPlayerPayBtn.addEventListener('click', () => showVipStep('pay'));
    el.vipBackBtn.addEventListener('click', () => {
      showVipStep(state.vip.pending === 'join' ? 'player' : 'host');
    });
    for (const button of document.querySelectorAll('[data-pay]')) {
      button.addEventListener('click', showPayMaintenanceNotice);
    }
    el.vipHostCloseBtn.addEventListener('click', closeVipModal);
    el.vipPlayerCloseBtn.addEventListener('click', closeVipModal);
    el.vipPayCloseBtn.addEventListener('click', closeVipModal);
    el.vipClearBtn.addEventListener('click', clearVipAndReload);

    // 首次交互时唤醒语音引擎（Chrome 在页面未交互时会挂起语音队列）。
    window.addEventListener('pointerdown', ensureSpeechReady, {
      once: true,
      passive: true,
    });
  }

  function connectSocket() {
    const socket = io({
      autoConnect: false,
      auth: { clientVersion: APP_VERSION },
      reconnection: true,
      reconnectionAttempts: 50,
      reconnectionDelay: 500,
      reconnectionDelayMax: 4000,
      randomizationFactor: 0.5,
      timeout: 20000,
      transports: ['websocket', 'polling'],
    });
    state.socket = socket;

    socket.on('connect', () => {
      setConnection('online', '已连接');
      el.reconnectBanner.hidden = true;
      state.connectErrorShown = false;
      startPingLoop();

      if (state.sessionId) {
        tryResume();
      } else if (state.currentView === 'loading') {
        setView('home');
      }

      // 本地存过激活码：连上后静默重验（同一 IP 视为同一设备）。
      if (state.vip.code && !state.vip.verified) {
        verifyVipCode(state.vip.code).then((result) => {
          if (!result.ok) clearVip();
        });
      }
    });

    socket.on('disconnect', (reason) => {
      setConnection('offline', '连接断开');
      stopPingLoop();
      setPing(null);
      setActionsOffline();
      if (state.solo.active) {
        state.solo.active = false;
        showToast('连接断开，错词挑战已暂停，进度已保存', 'error');
        setView('home');
        refreshWrongBookUi();
      }
      if (state.room) {
        el.reconnectBanner.hidden = false;
      }
      if (reason === 'io server disconnect') {
        showToast('服务器关闭了当前连接，请刷新页面重试', 'error');
      }
    });

    socket.on('connect_error', (error) => {
      setConnection('offline', '连接失败');
      setPing(null);
      if (error && error.data && error.data.code === 'CLIENT_OUTDATED') {
        showToast('页面版本已更新，正在刷新…', 'error');
        window.setTimeout(() => window.location.reload(), 600);
        return;
      }
      if (state.room) el.reconnectBanner.hidden = false;
      if (state.currentView === 'loading' && !state.room) setView('home');
      if (!state.room) {
        showHomeError('无法连接服务器，请确认服务已启动。页面会自动重试。');
      }
      if (!state.connectErrorShown) {
        state.connectErrorShown = true;
        showToast('连接服务器失败，正在重试…', 'error');
      }
    });

    socket.io.on('reconnect_attempt', () => {
      setConnection('connecting', '重连中');
      setPing(null);
    });

    socket.io.on('reconnect_failed', () => {
      el.reconnectBanner.hidden = true;
      stopPingLoop();
      setPing(null);
      goHome({ clearSession: true, message: '重连失败，已回到首页。请重新加入房间。' });
    });

    socket.on('room:state', (room) => {
      if (!room || typeof room !== 'object') return;
      state.room = room;
      storageSet(STORAGE.room, room.code);
      applyRoom(room);
    });

    socket.on('room:closed', (payload) => {
      showToast((payload && payload.reason) || '房间已关闭', 'error');
      goHome({ clearSession: true });
    });

    socket.on('question:start', (question) => {
      if (!state.room) {
        state.room = {
          code: '',
          mode: 'quiz',
          status: 'playing',
          players: question.players || [],
          game: { total: question.total, index: question.index, question: null, result: null },
        };
      }
      state.room.status = 'playing';
      state.room.mode = 'quiz';
      if (Array.isArray(question.players)) mergePlayers(question.players);
      resetRaceState();

      state.currentQuestion = question;
      state.questionResult = null;
      state.selectedIndex = null;
      state.answerLocked = false;
      state.answeredCorrect = null;

      renderQuestion(question);
      renderScoreStrip();
      startCountdown(question.deadline, question.serverNow);
      setView('game');
    });

    socket.on('answer:update', (update) => {
      if (!update || !state.room) return;
      updatePlayerScore(update.playerId, update.score);
      if (
        state.currentQuestion &&
        !state.answerLocked &&
        update.playerId !== state.playerId
      ) {
        setFeedback(
          `对手 ${update.nickname} 答错了（−5 分）。你仍可以作答。`,
          'warning'
        );
        el.opponentStatus.textContent = '对手已答错，机会留给你';
      }
    });

    socket.on('question:end', (result) => {
      if (!result) return;
      handleQuestionEnd(result);
    });

    socket.on('race:sync', (payload) => {
      if (!payload) return;
      handleRaceSync(payload);
    });

    socket.on('race:question', (payload) => {
      if (!payload) return;
      handleRaceQuestion(payload);
    });

    socket.on('race:progress', (payload) => {
      if (!payload) return;
      handleRaceProgress(payload);
    });

    socket.on('race:locked', (payload) => {
      if (!payload) return;
      handleRaceLocked(payload);
    });

    socket.on('race:unlocked', (payload) => {
      if (!payload) return;
      handleRaceUnlocked(payload);
    });

    socket.on('game:over', (final) => {
      if (!final) return;
      stopCountdown();
      stopRaceClock();
      clearRaceCooldown();
      if (state.room) {
        state.room.status = 'finished';
        if (Array.isArray(final.players)) mergePlayers(final.players);
        state.room.game = { ...(state.room.game || {}), final };
      }
      state.race.active = false;
      renderResult(final);
      setView('result');
    });

    socket.connect();
  }

  async function tryResume() {
    if (!state.sessionId || state.resumeInFlight) return;
    state.resumeInFlight = true;
    const wasInRoom = Boolean(state.room);
    if (wasInRoom) {
      el.reconnectBanner.textContent = '网络恢复，正在同步房间状态…';
      el.reconnectBanner.hidden = false;
    }

    const result = await request('room:resume', { sessionId: state.sessionId }, 10000);
    state.resumeInFlight = false;

    if (result.ok && result.room) {
      state.sessionId = result.sessionId;
      state.playerId = result.playerId;
      persistSession(result.sessionId, result.playerId, result.room.code);
      applyRoom(result.room);
      el.reconnectBanner.textContent = '网络中断，正在尝试重连…你的房间和比分会被保留';
      el.reconnectBanner.hidden = true;
      if (wasInRoom) showToast('已重新连接，回到房间', 'success');
      return;
    }

    if (result.fatal) {
      clearSession();
      state.room = null;
      state.playerId = null;
      setView('home');
      el.reconnectBanner.hidden = true;
      showHomeError(result.error || '原房间已失效，请重新创建或加入房间');
      showToast(result.error || '原房间已失效', 'error');
      return;
    }

    if (state.currentView === 'loading') {
      setView('home');
    }
    showToast(result.error || '恢复房间失败，请刷新页面重试', 'error');
  }

  // ---------------------------------------------------------------
  // VIP 激活码（拟付费门面）：房主码 host / 单人码 player
  // ---------------------------------------------------------------
  function readStoredVip() {
    const raw = storageGet(STORAGE.vip);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed.code === 'string' && parsed.code ? parsed : null;
    } catch (error) {
      return null;
    }
  }

  function persistVip(code, tier) {
    state.vip.code = code;
    state.vip.tier = tier || null;
    state.vip.verified = Boolean(tier);
    storageSet(
      STORAGE.vip,
      JSON.stringify({ code, tier: tier || null, verifiedAt: new Date().toISOString() })
    );
    updateVipUi();
  }

  function clearVip() {
    state.vip.code = '';
    state.vip.tier = null;
    state.vip.verified = false;
    try {
      window.localStorage.removeItem(STORAGE.vip);
    } catch (error) {
      /* 隐私模式忽略 */
    }
    updateVipUi();
  }

  /** 首页「清除激活状态」按钮只在已激活时出现。 */
  function updateVipUi() {
    if (!el.vipClearBtn) return;
    el.vipClearBtn.hidden = !state.vip.verified;
  }

  function canHost() {
    return state.vip.verified && (state.vip.tier === 'host' || state.vip.tier === 'super_admin');
  }

  function canJoin() {
    return state.vip.verified && Boolean(state.vip.tier);
  }

  function clearVipAndReload() {
    clearVip();
    showToast('已清除激活状态，下次需重新输入激活码', 'success');
    window.setTimeout(() => window.location.reload(), 700);
  }

  async function verifyVipCode(rawCode, options = {}) {
    const code = String(rawCode || '').trim().toUpperCase();
    if (!code) return { ok: false, error: '请输入激活码' };

    const result = await request('vip:verify', { code }, 8000);
    if (!result.ok) {
      return { ok: false, error: result.error || '验证失败，请稍后重试' };
    }

    persistVip(code, result.tier);
    return { ok: true, tier: result.tier };
  }

  /**
   * mode: 'create' 打开房主通道，'join' 打开单人通道。
   */
  function openVipModal(mode) {
    state.vip.pending = mode === 'join' ? 'join' : 'create';
    el.vipOverlay.hidden = false;
    showVipStep(state.vip.pending === 'create' ? 'host' : 'player');
    showVipError('host', '');
    showVipError('player', '');
    el.vipHostInput.value = '';
    el.vipPlayerInput.value = '';
    document.body.classList.add('vip-open');
    const input = state.vip.pending === 'create' ? el.vipHostInput : el.vipPlayerInput;
    window.setTimeout(() => {
      if (!el.vipOverlay.hidden) input.focus();
    }, 60);
  }

  function closeVipModal() {
    el.vipOverlay.hidden = true;
    state.vip.pending = null;
    document.body.classList.remove('vip-open');
  }

  function showVipStep(step) {
    el.vipStepHost.hidden = step !== 'host';
    el.vipStepPlayer.hidden = step !== 'player';
    el.vipStepPay.hidden = step !== 'pay';
    el.vipNotice.hidden = true;
    if (step === 'host') window.setTimeout(() => el.vipHostInput.focus(), 40);
    if (step === 'player') window.setTimeout(() => el.vipPlayerInput.focus(), 40);
  }

  function showVipError(step, message) {
    const node = step === 'host' ? el.vipHostError : el.vipPlayerError;
    node.textContent = message || '';
    node.hidden = !message;
  }

  async function submitVip(step) {
    const isHost = step === 'host';
    const input = isHost ? el.vipHostInput : el.vipPlayerInput;
    const button = isHost ? el.vipHostVerifyBtn : el.vipPlayerVerifyBtn;
    const code = input.value;

    if (!code.trim()) {
      showVipError(step, '请输入激活码');
      input.focus();
      return;
    }

    showVipError(step, '');
    setBusy(button, true, '验证中…');
    const result = await verifyVipCode(code);
    setBusy(button, false);

    if (!result.ok) {
      showVipError(step, result.error || '验证失败，请重试');
      return;
    }

    // 单人码不能建房：提示后保留已激活状态，用户可以直接去「加入房间」。
    if (isHost && !canHost()) {
      showVipError(step, '这是单人码，只能加入房间；创建房间需要房主码。');
      return;
    }

    const pending = state.vip.pending;
    closeVipModal();
    showToast('激活成功，欢迎回来', 'success');
    if (pending === 'create') createRoom();
    else if (pending === 'join') joinRoom();
  }

  function showPayMaintenanceNotice() {
    const message = '支付通道维护中，请联系站长获取专属激活码。';
    el.vipNotice.textContent = message;
    el.vipNotice.hidden = false;
    showToast(message, 'info');
  }

  async function createRoom() {
    clearHomeError();
    const nickname = getNickname();
    if (!validateNickname(nickname)) return;

    // 未激活或只有单人码：房主通道
    if (!canHost()) {
      openVipModal('create');
      return;
    }

    setBusy(el.createBtn, true, '创建中…');
    const result = await request('room:create', { nickname }, 10000);
    setBusy(el.createBtn, false);

    if (!result.ok) {
      if (result.code === 'VIP_REQUIRED' || result.code === 'VIP_TIER') {
        if (result.code === 'VIP_TIER') showToast(result.error, 'error');
        openVipModal('create');
        return;
      }
      showHomeError(result.error || '创建房间失败，请重试');
      return;
    }

    storageSet(STORAGE.nickname, nickname);
    state.sessionId = result.sessionId;
    state.playerId = result.playerId;
    persistSession(result.sessionId, result.playerId, result.room.code);
    applyRoom(result.room);
  }

  async function joinRoom() {
    clearHomeError();
    const nickname = getNickname();
    if (!validateNickname(nickname)) return;
    const code = el.roomCode.value.trim();
    if (!/^\d{6}$/.test(code)) {
      showHomeError('请输入 6 位数字房间码');
      el.roomCode.focus();
      return;
    }

    // 加入房间需要激活码（单人码或房主码都可以）
    if (!canJoin()) {
      openVipModal('join');
      return;
    }

    setBusy(el.joinBtn, true, '加入中…');
    const result = await request('room:join', { nickname, code }, 10000);
    setBusy(el.joinBtn, false);

    if (!result.ok) {
      if (result.code === 'VIP_REQUIRED') {
        openVipModal('join');
        return;
      }
      showHomeError(result.error || '加入房间失败，请重试');
      return;
    }

    storageSet(STORAGE.nickname, nickname);
    state.sessionId = result.sessionId;
    state.playerId = result.playerId;
    persistSession(result.sessionId, result.playerId, result.room.code);
    applyRoom(result.room);
  }

  async function toggleReady() {
    if (!state.room || !state.socket || !state.socket.connected) return;
    const me = findMe();
    if (!me) return;
    el.readyBtn.disabled = true;
    const result = await request('player:ready', { ready: !me.ready }, 8000);
    if (!result.ok) {
      showToast(result.error || '修改准备状态失败', 'error');
      el.readyBtn.disabled = false;
      return;
    }
    if (result.room) applyRoom(result.room);
  }

  async function startGame() {
    setBusy(el.startBtn, true, '开始中…');
    const result = await request('game:start', {}, 10000);
    setBusy(el.startBtn, false);
    if (!result.ok) {
      showToast(result.error || '开始对战失败', 'error');
    }
  }

  async function setRoomMode(mode) {
    if (!state.room || state.room.mode === mode) return;
    const me = findMe();
    if (!me || !me.isHost) {
      showToast('只有房主可以切换模式', 'error');
      return;
    }
    el.modeQuizBtn.disabled = true;
    el.modeRaceBtn.disabled = true;
    const result = await request('room:mode', { mode }, 8000);
    if (!result.ok) {
      showToast(result.error || '切换模式失败', 'error');
      renderLobby(state.room);
      return;
    }
    if (result.room) applyRoom(result.room);
  }

  async function setRoomLevel(level) {
    if (!state.room) return;
    if (level === state.room.level) return;
    const me = findMe();
    if (!me || !me.isHost) {
      showToast('只有房主可以选择词库范围', 'error');
      renderLobby(state.room);
      return;
    }
    if (level === 'CET6') {
      renderLobby(state.room);
      showToast('六级词库正在建设中，请先体验四级');
      return;
    }
    el.levelSelect.disabled = true;
    const result = await request('room:level', { level }, 8000);
    if (!result.ok) {
      showToast(result.error || '切换词库范围失败', 'error');
      renderLobby(state.room);
      return;
    }
    if (result.room) {
      applyRoom(result.room);
      showToast('词库范围已切换为 CET-4 核心', 'success');
    }
  }

  async function requestRematch() {
    setBusy(el.rematchBtn, true, '准备中…');
    const result = await request('game:rematch', {}, 10000);
    setBusy(el.rematchBtn, false);
    if (!result.ok) {
      showToast(result.error || '无法开始新一局', 'error');
      return;
    }
    if (result.room) applyRoom(result.room);
    showToast('已回到准备状态，重新准备后由房主开始', 'success');
  }

  async function leaveRoom() {
    if (!state.socket || !state.socket.connected) {
      showToast('当前未连接服务器，无法退出，请稍后重试', 'error');
      return;
    }
    const result = await request('room:leave', {}, 8000);
    if (!result.ok) {
      showToast(result.error || '退出房间失败', 'error');
      return;
    }
    goHome({ clearSession: true, message: '已退出房间' });
  }

  async function copyInviteLink() {
    if (!state.room) return;
    const url = `${window.location.origin}${window.location.pathname}?room=${state.room.code}`;
    try {
      await copyText(url);
      showToast('邀请链接已复制，发给好友即可', 'success');
      const original = el.copyLinkBtn.textContent;
      el.copyLinkBtn.textContent = '已复制链接';
      window.setTimeout(() => {
        el.copyLinkBtn.textContent = original;
      }, 1800);
    } catch (error) {
      showToast(`复制失败，请手动发送房间码：${state.room.code}`, 'error');
    }
  }

  function applyRoom(room) {
    if (!room) return;
    state.room = room;
    storageSet(STORAGE.room, room.code);

    if (room.status === 'waiting') {
      resetRaceState();
      clearQuestionState();
      renderLobby(room);
      setView('room');
      return;
    }

    if (room.status === 'playing') {
      if (Array.isArray(room.players)) mergePlayers(room.players);

      if (room.mode === 'race') {
        state.race.active = true;
        if (room.game) {
          state.race.total = room.game.total || 25;
          state.race.startedAt = room.game.startedAt || Date.now();
          if (Array.isArray(room.game.progress)) {
            state.race.progress = room.game.progress;
          }
        }
        setRaceUi(true);
        renderScoreStrip();
        if (state.race.startedAt) {
          startRaceClock(state.race.startedAt, Date.now());
        }
        const mine = state.race.progress.find((entry) => entry.id === state.playerId);
        if (mine && mine.finished) {
          renderRaceWaiting();
        } else if (!state.race.question) {
          renderGamePending(room);
        }
        setView('game');
        return;
      }

      setRaceUi(false);
      state.race.active = false;
      renderScoreStrip();
      if (room.game && room.game.question) {
        setView('game');
        syncQuestion(room.game.question);
      } else {
        const resultIndex = room.game && room.game.result ? room.game.result.questionIndex : null;
        const alreadyShowing =
          state.questionResult && state.questionResult.questionIndex === resultIndex;
        if (!alreadyShowing) {
          if (state.currentQuestion) clearQuestionState();
          renderGamePending(room);
        }
        setView('game');
      }
      return;
    }

    if (room.status === 'finished') {
      stopCountdown();
      stopRaceClock();
      clearRaceCooldown();
      state.race.active = false;
      setRaceUi(false);
      if (room.game && Array.isArray(room.game.final?.players)) {
        mergePlayers(room.game.final.players);
      }
      renderResult(room.game ? room.game.final : null);
      setView('result');
    }
  }

  function isRaceRoom() {
    return Boolean(state.room && state.room.mode === 'race');
  }

  function setRaceUi(active) {
    el.timerRow.hidden = active;
    el.raceClock.hidden = !active;
    if (!active) {
      stopRaceClock();
      clearRaceCooldown();
    }
  }

  function startRaceClock(startedAt, serverNow) {
    if (!startedAt) return;
    stopRaceClock();
    state.race.startedAt = startedAt;
    state.race.serverOffset =
      (typeof serverNow === 'number' ? serverNow : Date.now()) - Date.now();
    el.raceClock.hidden = false;
    const tick = () => {
      const elapsed = Math.max(
        0,
        Date.now() + state.race.serverOffset - state.race.startedAt
      );
      el.raceClock.textContent = formatClock(elapsed);
    };
    tick();
    state.race.clockTimer = window.setInterval(tick, 500);
  }

  function stopRaceClock() {
    if (state.race.clockTimer) {
      window.clearInterval(state.race.clockTimer);
      state.race.clockTimer = null;
    }
    if (el.raceClock) el.raceClock.hidden = true;
  }

  function formatClock(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function handleRaceSync(payload) {
    state.race.active = true;
    state.race.total = payload.total || 25;
    state.race.startedAt = payload.startedAt || 0;
    state.race.serverOffset =
      (typeof payload.serverNow === 'number' ? payload.serverNow : Date.now()) - Date.now();
    state.race.progress = Array.isArray(payload.progress) ? payload.progress : [];
    state.race.errors = payload.you ? payload.you.errors || 0 : 0;
    state.race.lockedUntil = payload.you ? payload.you.lockedUntil || 0 : 0;

    if (state.room) {
      state.room.status = 'playing';
      state.room.mode = 'race';
      if (state.room.game) {
        state.room.game.progress = state.race.progress;
        state.room.game.startedAt = state.race.startedAt;
      }
    }
    setRaceUi(true);
    startRaceClock(state.race.startedAt, payload.serverNow);
    renderScoreStrip();

    const mine = state.race.progress.find((entry) => entry.id === state.playerId);
    const finished =
      Boolean(payload.you && payload.you.finishedAt) ||
      Boolean(mine && mine.finished);

    if (payload.question) {
      state.race.question = payload.question;
      state.currentQuestion = payload.question;
      state.questionResult = null;
      state.selectedIndex = null;
      state.answerLocked = false;
      renderRaceQuestion(payload.question);
      if (state.race.lockedUntil > Date.now() + state.race.serverOffset) {
        startRaceCooldown(state.race.lockedUntil, payload.serverNow);
      }
    } else if (isRaceRoom()) {
      state.race.question = null;
      state.currentQuestion = null;
      state.answerLocked = true;
      if (finished) {
        renderRaceWaiting();
      } else {
        renderGamePending(state.room);
      }
    }
    setView('game');
  }

  function handleRaceQuestion(question) {
    if (!isRaceRoom() && state.room) state.room.mode = 'race';
    state.race.active = true;
    state.race.question = question;
    state.race.lockedUntil = 0;
    state.race.errors =
      typeof question.errors === 'number' ? question.errors : state.race.errors;
    state.currentQuestion = question;
    state.questionResult = null;
    state.selectedIndex = null;
    state.answerLocked = false;
    clearRaceCooldown();
    renderRaceQuestion(question);
    setView('game');
  }

  function handleRaceProgress(payload) {
    if (!payload) return;
    state.race.total = payload.total || state.race.total;
    state.race.progress = Array.isArray(payload.progress) ? payload.progress : [];
    if (payload.startedAt) state.race.startedAt = payload.startedAt;
    if (typeof payload.serverNow === 'number') {
      state.race.serverOffset = payload.serverNow - Date.now();
    }
    if (state.room && state.room.game) {
      state.room.game.progress = state.race.progress;
    }
    renderScoreStrip();

    const mine = state.race.progress.find((entry) => entry.id === state.playerId);
    if (
      mine &&
      mine.finished &&
      state.currentView === 'game' &&
      state.race.question
    ) {
      renderRaceWaiting();
    }
  }

  function handleRaceLocked(payload) {
    if (!isRaceRoom()) return;
    state.race.lockedUntil = payload.lockedUntil || 0;
    state.race.errors =
      typeof payload.errors === 'number' ? payload.errors : state.race.errors;
    if (Number.isInteger(payload.selectedIndex)) {
      state.selectedIndex = payload.selectedIndex;
    }
    const selected =
      state.selectedIndex === null
        ? null
        : el.options.querySelector(`[data-index="${state.selectedIndex}"]`);
    if (selected) {
      selected.classList.remove('is-selected');
      selected.classList.add('is-wrong');
    }
    disableOptions();
    startRaceCooldown(payload.lockedUntil, payload.serverNow);
  }

  function handleRaceUnlocked(payload) {
    if (!isRaceRoom() || !state.race.question) return;
    state.race.lockedUntil = 0;
    clearRaceCooldown();
    resetRaceOptions();
    setFeedback('惩罚结束，可以继续作答。', 'info');
    if (payload && typeof payload.errors === 'number') {
      state.race.errors = payload.errors;
      renderScoreStrip();
    }
  }

  function renderRaceQuestion(question) {
    setRaceUi(true);
    clearRaceCooldown();
    hideAnswerReveal(el.answerReveal);
    el.questionIndex.textContent = String(question.index);
    el.questionTotal.textContent = String(question.total);
    el.questionLevel.textContent = `${levelLabel(question.level)} · 竞速`;
    renderQuestionPrompt(question);
    el.options.replaceChildren();

    question.options.forEach((text, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'option';
      button.dataset.index = String(index);

      const key = document.createElement('span');
      key.className = 'option-key';
      key.textContent = LETTERS[index] || String(index + 1);

      const label = document.createElement('span');
      label.className = 'option-text';
      label.textContent = text;

      button.append(key, label);
      button.addEventListener('click', () => submitAnswer(index));
      el.options.append(button);
    });

    setFeedback('答错会短暂冷却 1 秒；答对进入下一题。', 'info');
    el.timerNumber.classList.remove('is-urgent');
    el.timerBar.classList.remove('is-urgent');
    state.answerLocked = false;
    renderScoreStrip();
    updateOpponentStatus();
    if (state.race.startedAt) {
      startRaceClock(state.race.startedAt, Date.now() + state.race.serverOffset);
    }

    // 竞速模式同样有听音题，出现即自动播报。
    if (question.type === 'listen') {
      scheduleAutoSpeak(question.word, () => state.currentQuestion === question);
    }
  }

  function startRaceCooldown(lockedUntil, serverNow) {
    if (!isRaceRoom()) return;
    if (!lockedUntil || lockedUntil <= Date.now() + state.race.serverOffset) {
      return;
    }
    const offset =
      (typeof serverNow === 'number' ? serverNow : Date.now()) - Date.now();
    state.race.lockedUntil = lockedUntil;
    state.answerLocked = true;
    if (state.race.cooldownTimer) {
      window.clearInterval(state.race.cooldownTimer);
      state.race.cooldownTimer = null;
    }

    const selectedIndex = state.selectedIndex;
    for (const button of el.options.querySelectorAll('.option')) {
      button.disabled = true;
      const index = Number(button.dataset.index);
      if (selectedIndex !== null && index === selectedIndex) {
        button.classList.remove('is-dimmed');
        button.classList.add('is-wrong');
      } else {
        button.classList.remove('is-wrong');
        button.classList.add('is-dimmed');
      }
    }

    el.cooldownHint.hidden = false;
    const tick = () => {
      const remaining = Math.max(0, lockedUntil - (Date.now() + offset));
      el.cooldownHint.textContent = `冷却中 ${(remaining / 1000).toFixed(1)}s`;
      if (remaining <= 0) {
        clearRaceCooldown();
        if (isRaceRoom() && state.currentView === 'game') {
          resetRaceOptions();
          setFeedback('冷却结束，可以继续作答。', 'info');
        }
      }
    };
    tick();
    state.race.cooldownTimer = window.setInterval(tick, 100);
  }

  function clearRaceCooldown() {
    if (state.race.cooldownTimer) {
      window.clearInterval(state.race.cooldownTimer);
      state.race.cooldownTimer = null;
    }
    el.cooldownHint.hidden = true;
  }

  function resetRaceOptions() {
    if (!isRaceRoom() || !state.currentQuestion) return;
    for (const button of el.options.querySelectorAll('.option')) {
      button.disabled = false;
      button.classList.remove('is-wrong', 'is-selected', 'is-dimmed', 'is-correct');
    }
    state.selectedIndex = null;
    state.answerLocked = false;
  }

  function resetRaceState() {
    setRaceUi(false);
    state.race.active = false;
    state.race.total = 25;
    state.race.progress = [];
    state.race.startedAt = 0;
    state.race.serverOffset = 0;
    state.race.question = null;
    state.race.lockedUntil = 0;
    state.race.errors = 0;
  }

  function syncQuestion(question) {
    const isNew =
      !state.currentQuestion ||
      state.currentQuestion.index !== question.index ||
      state.currentQuestion.word !== question.word;

    state.currentQuestion = question;

    if (isNew) {
      state.questionResult = null;
      state.answeredCorrect = null;
      const mine = (question.answers || []).find(
        (answer) => answer.playerId === state.playerId
      );
      if (mine) {
        state.selectedIndex = mine.selectedIndex;
        state.answerLocked = true;
        state.answeredCorrect = mine.correct;
      } else {
        state.selectedIndex = null;
        state.answerLocked = false;
      }
      renderQuestion(question);

      const opponentAnswer = (question.answers || []).find(
        (answer) => answer.playerId !== state.playerId
      );
      if (opponentAnswer && !opponentAnswer.correct && !state.answerLocked) {
        setFeedback('对手已答错（−5 分），你仍可以作答。', 'warning');
        el.opponentStatus.textContent = '对手已答错，机会留给你';
      }
    }

    startCountdown(question.deadline, question.serverNow);
  }

  function isSpeechSupported() {
    return Boolean(
      window.speechSynthesis &&
        typeof window.speechSynthesis.speak === 'function' &&
        typeof window.SpeechSynthesisUtterance === 'function'
    );
  }

  function showSpeechUnsupported() {
    if (state.speechNoticeShown) return;
    state.speechNoticeShown = true;
    showToast(
      '当前浏览器不支持发音，请尝试在外部 Safari/Chrome 中打开',
      'error'
    );
  }

  function pickSpeechVoice(voices) {
    if (!Array.isArray(voices)) return null;
    return (
      voices.find((voice) => /^en[-_]US/i.test(voice.lang)) ||
      voices.find((voice) => /^en/i.test(voice.lang)) ||
      null
    );
  }

  function stopSpeech() {
    if (window.speechSynthesis) {
      try {
        window.speechSynthesis.cancel();
      } catch (error) {
        // 忽略部分 WebView 的 cancel 异常。
      }
    }
    state.speechUtterance = null;
  }

  function handleSpeakTrigger() {
    if (!state.speechWord) return;
    const now = Date.now();
    if (now - state.lastSpeechTriggerAt < 500) return;
    state.lastSpeechTriggerAt = now;

    if (!isSpeechSupported()) {
      showSpeechUnsupported();
      return;
    }
    // 直接在 click/touchend 的同步调用链里调用 speak()，手机浏览器才认可用户手势。
    playSpeech(state.speechWord);
  }

  function playSpeech(word, options = {}) {
    const silent = options.silent === true;
    if (!word) return false;
    if (!isSpeechSupported()) {
      if (silent) nudgeSpeakButton();
      else showSpeechUnsupported();
      return false;
    }
    const synth = window.speechSynthesis;
    const Utterance = window.SpeechSynthesisUtterance;

    try {
      // 每次发声前先清空可能卡住的队列。
      synth.cancel();
      const utterance = new Utterance(word);
      utterance.lang = 'en-US';
      utterance.rate = 0.9;
      utterance.pitch = 1;
      utterance.volume = 1;

      const voice = pickSpeechVoice(synth.getVoices());
      if (voice) utterance.voice = voice;

      utterance.onend = () => {
        if (state.speechUtterance === utterance) state.speechUtterance = null;
      };
      utterance.onerror = (event) => {
        if (state.speechUtterance === utterance) state.speechUtterance = null;
        if (
          event &&
          ['not-allowed', 'synthesis-unavailable', 'synthesis-failed', 'language-unavailable'].includes(
            event.error
          )
        ) {
          // 自动播放被浏览器拦截时不要弹错误提示，只提示用户点喇叭。
          if (silent) nudgeSpeakButton();
          else showSpeechUnsupported();
        }
      };

      // 保持引用，避免部分浏览器在语音结束前回收 utterance。
      state.speechUtterance = utterance;
      synth.speak(utterance);
      return true;
    } catch (error) {
      console.warn('语音播放失败', error);
      if (silent) nudgeSpeakButton();
      else showSpeechUnsupported();
      return false;
    }
  }

  /**
   * 自动播放失败时的兜底：让喇叭按钮轻微跳动，引导用户手动点击。
   */
  function nudgeSpeakButton() {
    for (const button of [el.speakBtn, el.soloSpeakBtn]) {
      if (!button || button.hidden) continue;
      button.classList.remove('is-nudge');
      // 读取 offsetWidth 以重启动画（无此属性的环境会得到 undefined，无害）。
      void button.offsetWidth;
      button.classList.add('is-nudge');
      button.title = '点击喇叭播放发音';
    }
  }

  function ensureSpeechReady() {
    try {
      const synth = window.speechSynthesis;
      if (synth && synth.paused) synth.resume();
    } catch (error) {
      /* 某些 WebView 不支持 resume，忽略 */
    }
  }

  /**
   * 尝试自动播报（静默失败）。
   * 语音列表在部分浏览器里是异步加载的，若暂时为空则等 voiceschanged /
   * 700ms 后再试一次，避免第一次进页面听不到声音。
   */
  function tryAutoSpeak(word) {
    if (!word || !isSpeechSupported()) return false;
    ensureSpeechReady();
    const synth = window.speechSynthesis;
    let voices = [];
    try {
      voices = synth.getVoices() || [];
    } catch (error) {
      voices = [];
    }
    if (voices.length > 0) return playSpeech(word, { silent: true });

    let spoke = false;
    const speakOnce = () => {
      if (spoke) return;
      spoke = true;
      playSpeech(word, { silent: true });
    };
    try {
      synth.addEventListener('voiceschanged', speakOnce, { once: true });
    } catch (error) {
      /* 老浏览器不支持 options，忽略 */
    }
    window.setTimeout(speakOnce, 700);
    return true;
  }

  /**
   * 延迟一点点再播，确保题目已经渲染完；
   * isStillCurrent 用于防止用户已切题后还播上一题的单词。
   */
  function scheduleAutoSpeak(word, isStillCurrent) {
    if (!word) return;
    window.setTimeout(() => {
      if (typeof isStillCurrent === 'function' && !isStillCurrent()) return;
      tryAutoSpeak(word);
    }, 260);
  }

  function renderAnswerReveal(node, word, meanings) {
    if (!node) return;
    if (!word || !Array.isArray(meanings) || meanings.length === 0) {
      node.hidden = true;
      node.replaceChildren();
      return;
    }
    node.replaceChildren();

    const label = document.createElement('span');
    label.className = 'answer-reveal-label';
    label.textContent = '中文含义';

    const body = document.createElement('span');
    body.className = 'answer-reveal-body';
    const wordEl = document.createElement('strong');
    wordEl.textContent = word;
    body.append(wordEl, document.createTextNode(' — '));
    body.append(
      document.createTextNode(
        meanings.map((meaning) => `${meaning.pos} ${meaning.meaning}`).join('；')
      )
    );

    node.append(label, body);
    node.hidden = false;
  }

  function hideAnswerReveal(...nodes) {
    for (const node of nodes) {
      if (!node) continue;
      node.hidden = true;
      node.replaceChildren();
    }
  }

  function resetQuestionWord(text) {
    stopSpeech();
    el.questionWordText.textContent = text;
    el.questionWord.classList.remove('is-cn-prompt', 'is-listen');
    el.speakBtn.hidden = true;
    state.speechWord = '';
  }

  function renderQuestionPrompt(question) {
    stopSpeech();
    const zh2en = question.type === 'zh2en';
    const isListen = question.type === 'listen';
    el.questionPrompt.textContent =
      question.promptLabel ||
      (isListen
        ? '点击喇叭听发音，选择正确的英文单词'
        : zh2en
          ? '选择正确的英文单词'
          : '选择正确的中文释义');
    el.questionWord.classList.toggle('is-cn-prompt', zh2en);
    el.questionWord.classList.toggle('is-listen', isListen);
    el.questionWordText.textContent = isListen
      ? ''
      : question.prompt || question.word || '';
    state.speechWord =
      isListen || question.type === 'en2zh' ? question.word || '' : '';
    el.speakBtn.hidden = !state.speechWord;
    el.speakBtn.setAttribute(
      'aria-label',
      isListen ? '播放题目单词发音' : '播放题干单词发音'
    );
    if (state.speechWord && !isSpeechSupported()) {
      showSpeechUnsupported();
    }
  }

  function renderQuestion(question) {
    setRaceUi(false);
    state.race.active = false;
    hideAnswerReveal(el.answerReveal);
    el.questionIndex.textContent = String(question.index);
    el.questionTotal.textContent = String(question.total);
    el.questionLevel.textContent = `${levelLabel(question.level)} · 抢答`;
    renderQuestionPrompt(question);
    el.options.replaceChildren();

    question.options.forEach((text, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'option';
      button.dataset.index = String(index);

      const key = document.createElement('span');
      key.className = 'option-key';
      key.textContent = LETTERS[index] || String(index + 1);

      const label = document.createElement('span');
      label.className = 'option-text';
      label.textContent = text;

      button.append(key, label);
      button.addEventListener('click', () => submitAnswer(index));
      el.options.append(button);
    });

    setFeedback('', '');
    el.timerNumber.textContent = '15';
    el.timerNumber.classList.remove('is-urgent');
    el.timerBar.style.width = '100%';
    el.timerBar.classList.remove('is-urgent');

    if (state.answerLocked) {
      applyLockedOptionStyles();
      if (state.answeredCorrect === true) {
        setFeedback('本题已抢答成功，等待结算…', 'correct');
      } else if (state.answeredCorrect === false) {
        setFeedback('本题你已答错，不能再作答，等待对手…', 'wrong');
      } else {
        setFeedback('本题已锁定', 'warning');
      }
    }

    updateOpponentStatus();

    // 听音选词：题目出现后自动播报一次（失败则保留喇叭按钮兜底）。
    if (question.type === 'listen') {
      scheduleAutoSpeak(question.word, () => state.currentQuestion === question);
    }
  }

  function renderRaceWaiting() {
    if (!isRaceRoom() || !state.room || state.room.status === 'finished') return;
    if (state.currentView === 'result') return;

    const total = state.race.total || 25;
    const mine = state.race.progress.find((entry) => entry.id === state.playerId);
    const opponent = state.race.progress.find((entry) => entry.id !== state.playerId);
    const opponentFinished = Boolean(opponent && opponent.finished);

    state.race.active = true;
    state.race.question = null;
    state.currentQuestion = null;
    state.selectedIndex = null;
    state.answerLocked = true;
    setRaceUi(true);
    hideAnswerReveal(el.answerReveal);
    stopCountdown();
    clearRaceCooldown();

    el.questionIndex.textContent = String(total);
    el.questionTotal.textContent = String(total);
    el.questionLevel.textContent = `${levelLabel(state.room.level)} · 竞速`;
    el.questionPrompt.textContent = '你已完成全部题目';
    resetQuestionWord('等待对手作答…');
    el.options.replaceChildren();
    setFeedback(
      opponentFinished ? '双方均已完成，正在结算…' : '已完成，等待对手作答...',
      'info'
    );
    renderScoreStrip();
    if (!opponentFinished) {
      el.opponentStatus.textContent = `你 ${mine ? mine.progress : total}/${total} 已完成 · 等待对手`;
    }
  }

  function renderGamePending(room) {
    hideAnswerReveal(el.answerReveal);
    const game = room.game || {};
    if (room.mode === 'race') {
      const mine = state.race.progress.find((entry) => entry.id === state.playerId);
      if (mine && mine.finished) {
        renderRaceWaiting();
        return;
      }
      state.race.active = true;
      setRaceUi(true);
      el.questionIndex.textContent = String(
        (state.race.progress.find((entry) => entry.id === state.playerId)?.progress || 0) + 1
      );
      el.questionTotal.textContent = String(game.total || state.race.total || 25);
      el.questionLevel.textContent = `${levelLabel(room.level)} · 竞速`;
      resetQuestionWord('准备开始');
      el.questionPrompt.textContent = '题目准备中';
      el.options.replaceChildren();
      setFeedback('竞速对局即将开始，双方独立作答 25 题。', 'info');
      el.opponentStatus.textContent = '答错会短暂冷却 1 秒，双方都完成后统一结算';
      renderScoreStrip();
      return;
    }

    setRaceUi(false);
    state.race.active = false;
    el.questionIndex.textContent = String(game.index || 1);
    el.questionTotal.textContent = String(game.total || 10);
    el.questionLevel.textContent = `${levelLabel(room.level)} · 抢答`;
    resetQuestionWord('下一题准备中');
    el.questionPrompt.textContent = '题目准备中';
    el.options.replaceChildren();
    el.timerNumber.textContent = '--';
    el.timerNumber.classList.remove('is-urgent');
    el.timerBar.style.width = '0%';
    el.timerBar.classList.remove('is-urgent');

    const result = game.result;
    if (result && result.correctMeaning) {
      setFeedback('正在载入下一题…', 'info', `上一题正确答案：${result.correctMeaning}`);
    } else {
      setFeedback('双方已就位，第一题马上开始…', 'info');
    }
    el.opponentStatus.textContent = '计时将在题目出现后开始';
    renderScoreStrip();
  }

  async function submitAnswer(optionIndex) {
    if (isRaceRoom() && state.race.active) {
      return submitRaceAnswer(optionIndex);
    }
    if (!state.currentQuestion || state.answerLocked) return;
    if (!state.socket || !state.socket.connected) {
      showToast('网络已断开，正在重连，请稍候', 'error');
      return;
    }

    const questionRef = state.currentQuestion;
    state.answerLocked = true;
    state.selectedIndex = optionIndex;

    const selected = el.options.querySelector(`[data-index="${optionIndex}"]`);
    if (selected) selected.classList.add('is-selected');
    disableOptions();
    setFeedback('已提交，等待服务端判定…', 'info');

    const result = await request('game:answer', { optionIndex }, 7000);
    if (state.currentQuestion !== questionRef) return;

    if (!result.ok) {
      setFeedback(result.error || '提交失败，请等待本题结算', 'warning');
      return;
    }

    state.answeredCorrect = Boolean(result.correct);
    updatePlayerScore(state.playerId, result.score);

    // 听音选词答完立即展示中文含义，方便当场复盘。
    if (result.reveal) {
      renderAnswerReveal(el.answerReveal, result.reveal.word, result.reveal.meanings);
    }

    if (result.correct) {
      if (selected) selected.classList.add('is-correct');
      setFeedback('回答正确，+10 分！', 'correct');
      el.opponentStatus.textContent = '你已抢答成功，本题即将结束';
    } else {
      if (selected) {
        selected.classList.remove('is-selected');
        selected.classList.add('is-wrong');
      }
      setFeedback('回答错误，−5 分。本题你不能再答，等待对手作答…', 'wrong');
      el.opponentStatus.textContent = '等待对手作答…';
      applyLockedOptionStyles();
    }
  }

  async function submitRaceAnswer(optionIndex) {
    if (!state.currentQuestion || state.answerLocked) return;
    if (!state.socket || !state.socket.connected) {
      showToast('网络已断开，正在重连，请稍候', 'error');
      return;
    }
    if (state.race.lockedUntil > Date.now() + state.race.serverOffset) {
      startRaceCooldown(state.race.lockedUntil, Date.now() + state.race.serverOffset);
      return;
    }

    const questionRef = state.currentQuestion;
    state.answerLocked = true;
    state.selectedIndex = optionIndex;
    const selected = el.options.querySelector(`[data-index="${optionIndex}"]`);
    if (selected) selected.classList.add('is-selected');
    disableOptions();
    setFeedback('已提交，等待判定…', 'info');

    const result = await request('race:answer', { optionIndex }, 8000);
    if (state.currentQuestion !== questionRef) return;
    if (state.room && state.room.status === 'finished') return;

    if (!result.ok) {
      if (result.code === 'LOCKED' && result.lockedUntil) {
        startRaceCooldown(result.lockedUntil, result.serverNow);
        return;
      }
      setFeedback(result.error || '提交失败，请重试', 'warning');
      state.answerLocked = false;
      resetRaceOptions();
      return;
    }

    state.race.errors =
      typeof result.errors === 'number' ? result.errors : state.race.errors;
    if (typeof result.progress === 'number') {
      state.race.progress = state.race.progress.map((entry) =>
        entry.id === state.playerId
          ? {
              ...entry,
              progress: result.progress,
              errors: state.race.errors,
              finished: Boolean(result.finished) || entry.finished,
            }
          : entry
      );
      renderScoreStrip();
    }

    if (result.correct) {
      if (result.finished) {
        renderRaceWaiting();
        return;
      }
      if (selected) {
        selected.classList.remove('is-selected');
        selected.classList.add('is-correct');
      }
      setFeedback('答对了，正在进入下一题…', 'correct');
      el.opponentStatus.textContent = '答对，继续下一题';
    } else {
      if (selected) {
        selected.classList.remove('is-selected');
        selected.classList.add('is-wrong');
      }
      // 听音题答错时利用冷却的 1 秒展示中文含义，帮助当场记忆。
      if (result.reveal) {
        renderAnswerReveal(el.answerReveal, result.reveal.word, result.reveal.meanings);
      }
      state.race.lockedUntil = result.lockedUntil || 0;
      setFeedback('答错了，冷却 1 秒后才能继续。', 'wrong');
      startRaceCooldown(result.lockedUntil, result.serverNow);
    }
  }

  function handleQuestionEnd(result) {
    state.questionResult = result;
    state.answerLocked = true;
    stopCountdown();
    el.timerNumber.textContent = '0';
    el.timerBar.style.width = '0%';
    el.timerNumber.classList.remove('is-urgent');
    el.timerBar.classList.remove('is-urgent');

    if (Array.isArray(result.players)) {
      mergePlayers(result.players);
      renderScoreStrip();
    }

    const buttons = [...el.options.querySelectorAll('.option')];
    buttons.forEach((button) => {
      button.disabled = true;
      button.classList.remove('is-dimmed', 'is-selected');
      if (Number(button.dataset.index) === result.correctIndex) {
        button.classList.add('is-correct');
      }
    });

    const mine = (result.answers || []).find(
      (answer) => answer.playerId === state.playerId
    );
    if (mine && mine.selectedIndex !== null) {
      const myButton = el.options.querySelector(
        `[data-index="${mine.selectedIndex}"]`
      );
      if (myButton && !mine.correct) myButton.classList.add('is-wrong');
    }

    const iWon = result.winnerId === state.playerId;
    const detailParts = [`正确答案：${result.correctMeaning}`];
    let main = '';
    let kind = 'info';

    // 听音选词：本题结束后同样展示中文含义（没作答的人也能复盘）。
    if (result.type === 'listen') {
      renderAnswerReveal(el.answerReveal, result.word, result.meanings);
    }

    if (iWon) {
      main = '抢答成功，+10 分！';
      kind = 'correct';
    } else if (mine && mine.selectedIndex !== null && !mine.correct) {
      main = '你答错了，−5 分。';
      kind = 'wrong';
      if (result.winnerId) {
        detailParts.push(`对手 ${result.winnerName} 抢答成功，+10 分`);
      } else if (result.reason === 'all_wrong') {
        detailParts.push('双方都答错，本题结束');
      } else {
        detailParts.push('本题无人得分');
      }
    } else if (!mine || mine.selectedIndex === null) {
      if (result.winnerId) {
        main = `对手 ${result.winnerName} 抢答成功，+10 分。`;
        kind = 'warning';
      } else {
        main = result.reason === 'timeout' ? '时间到，本题无人得分。' : '本题无人答对。';
        kind = 'warning';
      }
    } else {
      main = '本题结束。';
    }

    setFeedback(main, kind, detailParts.join(' · '));
    el.opponentStatus.textContent =
      result.questionIndex >= result.total
        ? '10 题已完成，正在统计最终比分…'
        : '下一题即将开始…';
  }

  function renderLobby(room) {
    el.lobbyCode.textContent = room.code;
    el.roomLevelBadge.textContent = levelLabel(room.level);
    el.shareCode.textContent = room.code;
    el.shareLevel.textContent =
      room.level === 'CET6'
        ? '当前词库：CET-6 核心（建设中）'
        : '当前词库：CET-4 核心（200 词）';
    el.lobbyPlayers.replaceChildren();

    const me = findMe();
    const ordered = me
      ? [me, ...room.players.filter((player) => player.id !== me.id)]
      : room.players;

    for (let slot = 0; slot < 2; slot += 1) {
      const player = ordered[slot];
      el.lobbyPlayers.append(buildLobbyPlayerCard(player, room, slot));
    }

    const bothReady =
      room.players.length === 2 && room.players.every((player) => player.ready);
    const bothConnected =
      room.players.length === 2 && room.players.every((player) => player.connected);
    const isHost = Boolean(me && me.isHost);
    const connected = Boolean(state.socket && state.socket.connected);
    const mode = room.mode === 'race' ? 'race' : 'quiz';
    const level = room.level === 'CET6' ? 'CET6' : 'CET4';

    el.levelSelect.value = level;
    el.levelSelect.disabled = !isHost || !connected;
    el.levelHint.textContent =
      level === 'CET6'
        ? '六级词库正在建设中，请先体验四级'
        : isHost
          ? '当前词库：CET-4 核心（200 词）'
          : '当前词库：CET-4 核心（200 词）· 由房主选择';

    el.modeQuizBtn.classList.toggle('is-active', mode === 'quiz');
    el.modeRaceBtn.classList.toggle('is-active', mode === 'race');
    el.modeQuizBtn.setAttribute('aria-pressed', String(mode === 'quiz'));
    el.modeRaceBtn.setAttribute('aria-pressed', String(mode === 'race'));
    el.modeQuizBtn.disabled = !isHost || !connected;
    el.modeRaceBtn.disabled = !isHost || !connected;
    el.modeHint.textContent = isHost
      ? mode === 'race'
        ? '竞速模式：双方独立答 25 题，答错冷却 1 秒，先完成者获胜。'
        : '抢答模式：双方同题抢答，15 秒一题，共 10 题。'
      : `房主选择：${mode === 'race' ? '竞速模式（25 题，答错冷却 1 秒）' : '抢答模式（10 题，15 秒一题）'}`;

    el.lobbyStatus.textContent = lobbyStatusText(room, me, bothReady, bothConnected);

    el.readyBtn.hidden = !me;
    el.readyBtn.disabled = !connected;
    el.readyBtn.textContent = me && me.ready ? '取消准备' : '准备';
    el.readyBtn.classList.toggle('btn-secondary', Boolean(me && me.ready));
    el.readyBtn.classList.toggle('btn-primary', !(me && me.ready));

    el.startBtn.hidden = !isHost;
    el.startBtn.disabled = !connected || !bothReady || !bothConnected;
    el.startBtn.classList.toggle('btn-primary', bothReady && bothConnected);
    el.startBtn.classList.toggle('btn-secondary', !(bothReady && bothConnected));
    el.startBtn.textContent = bothReady
      ? mode === 'race'
        ? '开始竞速'
        : '开始对战'
      : '等待双方准备';

    el.leaveBtn.disabled = !connected;
  }

  function buildLobbyPlayerCard(player, room, slot) {
    const card = document.createElement('article');
    card.className = 'player-card';

    if (!player) {
      card.classList.add('is-empty');
      const avatar = document.createElement('div');
      avatar.className = 'player-avatar';
      avatar.textContent = '+';

      const info = document.createElement('div');
      info.className = 'player-info';
      const title = document.createElement('div');
      title.className = 'empty-copy';
      title.textContent = '等待好友加入';
      const sub = document.createElement('div');
      sub.className = 'empty-sub';
      sub.textContent = slot === 1 ? '把房间码发给 TA' : '房间还有一个空位';
      info.append(title, sub);
      card.append(avatar, info);
      return card;
    }

    const isMe = player.id === state.playerId;
    if (isMe) card.classList.add('is-me');

    const avatar = document.createElement('div');
    avatar.className = 'player-avatar';
    avatar.textContent = initialOf(player.nickname);

    const info = document.createElement('div');
    info.className = 'player-info';

    const nameRow = document.createElement('div');
    nameRow.className = 'player-name-row';
    const name = document.createElement('span');
    name.className = 'player-name';
    name.textContent = player.nickname;
    nameRow.append(name);
    if (isMe) {
      const you = document.createElement('span');
      you.className = 'player-you';
      you.textContent = '你';
      nameRow.append(you);
    }

    const meta = document.createElement('div');
    meta.className = 'player-meta';
    const score = document.createElement('span');
    score.className = 'player-score';
    score.textContent = `${player.score} 分`;
    meta.append(score);

    if (player.isHost) meta.append(tag('房主', 'tag-host'));
    if (!player.connected) {
      meta.append(tag('掉线', 'tag-offline'));
    } else if (room.status === 'waiting' && player.ready) {
      meta.append(tag('已准备', 'tag-ready'));
    } else if (room.status === 'waiting') {
      meta.append(tag('未准备', ''));
    }

    info.append(nameRow, meta);
    card.append(avatar, info);
    return card;
  }

  function lobbyStatusText(room, me, bothReady, bothConnected) {
    if (room.players.length < 2) {
      return '等待好友加入。复制邀请链接，或把 6 位房间码发给 TA。';
    }
    if (!bothConnected) {
      return '有一位玩家暂时掉线，正在等待重连…';
    }
    if (bothReady) {
      if (me && me.isHost) return '双方已准备，你可以开始对战。';
      return '双方已准备，等待房主开始…';
    }
    if (me && me.ready) {
      return '你已准备，等待对手准备…';
    }
    return '双方都准备后，由房主开始对战。';
  }

  function renderScoreStrip() {
    if (isRaceRoom() && state.race.active) {
      renderRaceProgress();
      return;
    }
    const players = state.room && Array.isArray(state.room.players) ? state.room.players : [];
    el.scoreStrip.replaceChildren();
    const me = players.find((player) => player.id === state.playerId);
    const ordered = me
      ? [me, ...players.filter((player) => player.id !== me.id)]
      : players;

    for (const player of ordered) {
      const chip = document.createElement('div');
      chip.className = 'score-chip';
      if (player.id === state.playerId) chip.classList.add('is-me');
      if (!player.connected) chip.classList.add('is-offline');

      const avatar = document.createElement('div');
      avatar.className = 'score-avatar';
      avatar.textContent = initialOf(player.nickname);

      const name = document.createElement('div');
      name.className = 'score-name';
      name.textContent = player.nickname;
      const sub = document.createElement('small');
      sub.textContent =
        player.id === state.playerId
          ? '你'
          : player.connected
            ? '对手'
            : '对手 · 掉线';
      name.append(sub);

      const score = document.createElement('div');
      score.className = 'score-value';
      score.textContent = String(player.score);

      chip.append(avatar, name, score);
      el.scoreStrip.append(chip);
    }
  }

  function renderRaceProgress() {
    const roomPlayers = state.room && Array.isArray(state.room.players) ? state.room.players : [];
    const byId = new Map(state.race.progress.map((entry) => [entry.id, entry]));
    const entries = roomPlayers.map((player) => {
      const progress = byId.get(player.id);
      return {
        id: player.id,
        nickname: player.nickname,
        connected: player.connected,
        progress: progress ? progress.progress : 0,
        errors: progress ? progress.errors : 0,
        finished: progress ? progress.finished : false,
      };
    });
    const me = entries.find((entry) => entry.id === state.playerId);
    const ordered = me
      ? [me, ...entries.filter((entry) => entry.id !== me.id)]
      : entries;

    el.scoreStrip.replaceChildren();
    for (const entry of ordered) {
      const chip = document.createElement('div');
      chip.className = 'score-chip';
      if (entry.id === state.playerId) chip.classList.add('is-me');
      if (!entry.connected) chip.classList.add('is-offline');

      const avatar = document.createElement('div');
      avatar.className = 'score-avatar';
      avatar.textContent = initialOf(entry.nickname);

      const name = document.createElement('div');
      name.className = 'score-name';
      name.textContent = entry.nickname;
      const sub = document.createElement('small');
      const role =
        entry.id === state.playerId ? '你' : entry.connected ? '对手' : '对手 · 掉线';
      sub.textContent = entry.finished
        ? `${role} · 已完成`
        : `${role} · 错误 ${entry.errors}`;
      name.append(sub);

      const value = document.createElement('div');
      value.className = 'score-value';
      value.textContent = `${entry.progress}/${state.race.total}`;

      chip.append(avatar, name, value);
      el.scoreStrip.append(chip);
    }
    updateOpponentStatus();
  }

  function updatePlayerScore(playerId, score) {
    if (!state.room || !Array.isArray(state.room.players)) return;
    const player = state.room.players.find((candidate) => candidate.id === playerId);
    if (!player) return;
    player.score = score;
    renderScoreStrip();
  }

  function mergePlayers(incoming) {
    if (!state.room) return;
    if (!Array.isArray(state.room.players)) state.room.players = [];
    for (const update of incoming) {
      if (!update || !update.id) continue;
      const existing = state.room.players.find((player) => player.id === update.id);
      if (existing) {
        Object.assign(existing, update);
      } else {
        state.room.players.push({ ...update });
      }
    }
  }

  function renderResult(final) {
    stopSpeech();
    if (!final) {
      el.resultTitle.textContent = '对局结束';
      el.resultSubtitle.textContent = '正在同步最终比分…';
      el.finalScores.replaceChildren();
      el.reviewPanel.hidden = true;
      setView('result');
      return;
    }

    const meId = state.playerId;
    const mode = final.mode === 'race' ? 'race' : 'quiz';
    const level = levelLabel(final.level || state.room?.level);
    let tie = false;
    let winnerId = final.winnerId || null;

    if (mode === 'race') {
      tie = false;
      if (winnerId === meId) {
        el.resultTitle.textContent = '你赢了！';
      } else {
        el.resultTitle.textContent = '这一局，对手用时更短。';
      }
      el.resultSubtitle.textContent =
        `竞速模式 · ${level} 词库 · ${final.total || 25} 题 · ` +
        `总用时 ${formatClock(final.durationMs || 0)}`;

      const stats = Array.isArray(final.stats) ? final.stats : [];
      const me = stats.find((entry) => entry.id === meId);
      const ordered = me
        ? [me, ...stats.filter((entry) => entry.id !== meId)]
        : stats;
      el.finalScores.replaceChildren();
      for (const entry of ordered) {
        const card = document.createElement('div');
        card.className = 'final-player';
        if (entry.id === meId) card.classList.add('is-me');
        if (entry.id === winnerId) card.classList.add('is-winner');

        const name = document.createElement('div');
        name.className = 'final-name';
        name.textContent = entry.nickname;

        const value = document.createElement('div');
        value.className = 'final-score is-race';
        value.textContent = `${entry.progress}/${final.total || 25}`;

        const note = document.createElement('div');
        note.className = 'final-note';
        note.textContent = `${entry.finished ? '已完成' : '未完成'} · 用时 ${formatClock(entry.totalMs)} · 错误 ${entry.errors} 次`;

        card.append(name, value, note);
        el.finalScores.append(card);
      }
    } else {
      const sortedScores = [...final.scores].sort((a, b) => b.score - a.score);
      const topScore = sortedScores.length ? sortedScores[0].score : 0;
      const leaders = sortedScores.filter((entry) => entry.score === topScore);
      tie = final.tie || leaders.length !== 1;
      winnerId = tie ? null : leaders[0].id;

      if (tie) {
        el.resultTitle.textContent = '势均力敌，平局。';
      } else if (winnerId === meId) {
        el.resultTitle.textContent = '你赢了！';
      } else {
        el.resultTitle.textContent = '这一局，对手拿下。';
      }

      if (tie) {
        el.resultSubtitle.textContent = `双方最终 ${topScore} 分 · ${level} 词库`;
      } else {
        const winnerName = final.winnerName || leaders[0].nickname;
        el.resultSubtitle.textContent = `${winnerName} 获胜 · ${level} 词库 · 本局共 10 题`;
      }

      el.finalScores.replaceChildren();
      for (const player of final.players || sortedScores) {
        const card = document.createElement('div');
        card.className = 'final-player';
        const scoreEntry = final.scores.find((entry) => entry.id === player.id);
        const score = scoreEntry ? scoreEntry.score : player.score;
        if (player.id === meId) card.classList.add('is-me');
        if (!tie && player.id === winnerId) card.classList.add('is-winner');

        const name = document.createElement('div');
        name.className = 'final-name';
        name.textContent = player.nickname;

        const value = document.createElement('div');
        value.className = 'final-score';
        value.textContent = String(score);

        const note = document.createElement('div');
        note.className = 'final-note';
        if (player.id === meId) {
          note.textContent = '你';
        } else if (!tie && player.id === winnerId) {
          note.textContent = '本局胜者';
        } else {
          note.textContent = '对手';
        }

        card.append(name, value, note);
        el.finalScores.append(card);
      }
    }

    const opponent = (state.room?.players || []).find(
      (player) => player.id !== meId
    );
    if (opponent && !opponent.connected) {
      el.rematchHint.textContent = '对手暂时掉线，重连后即可再来一局。';
    } else {
      el.rematchHint.textContent =
        '再来一局会回到准备状态，双方重新准备后由房主开始。';
    }
    el.rematchBtn.disabled = !(state.socket && state.socket.connected);
    renderReview(final.review);
  }

  function renderReview(review) {
    if (!Array.isArray(review) || review.length === 0) {
      el.reviewPanel.hidden = true;
      el.reviewList.replaceChildren();
      return;
    }

    el.reviewPanel.hidden = false;
    el.reviewSummary.textContent =
      `${review.length} 个单词 · 标记为你的作答结果：✅ 答对 / ❌ 答错（含答错后纠正） / — 未作答`;
    el.reviewList.replaceChildren();

    for (const entry of review) {
      const status = entry.statuses?.[state.playerId] || 'unanswered';
      const hadMistake = Boolean(
        entry.mistakes && entry.mistakes[state.playerId]
      );
      const displayStatus =
        status === 'correct' && hadMistake ? 'wrong' : status;
      const statusLabel =
        displayStatus === 'correct'
          ? '答对'
          : displayStatus === 'wrong'
            ? status === 'correct'
              ? '曾答错，后改正'
              : '答错'
            : '未作答';

      const item = document.createElement('article');
      item.className = `review-item is-${displayStatus}`;
      item.setAttribute('aria-label', `${entry.word}，${statusLabel}`);
      if (hadMistake) item.title = '本题曾答错，后改正';

      const icon = document.createElement('span');
      icon.className = 'review-status';
      icon.textContent =
        displayStatus === 'correct'
          ? '✅'
          : displayStatus === 'wrong'
            ? '❌'
            : '—';

      const content = document.createElement('div');
      content.className = 'review-content';

      const wordRow = document.createElement('div');
      wordRow.className = 'review-word-row';
      const word = document.createElement('span');
      word.className = 'review-word';
      word.textContent = entry.word;
      const level = document.createElement('span');
      level.className = 'level-badge review-level';
      level.textContent = levelLabel(entry.level);
      wordRow.append(word, level);

      const meanings = document.createElement('ul');
      meanings.className = 'review-meanings';
      for (const meaning of entry.meanings || []) {
        const row = document.createElement('li');
        row.className = 'review-meaning';
        const pos = document.createElement('span');
        pos.className = 'review-pos';
        pos.textContent = meaning.pos;
        row.append(pos, document.createTextNode(meaning.meaning));
        if (meaning.frequencyRank === 1) {
          const frequency = document.createElement('span');
          frequency.className = 'frequency-tag';
          frequency.textContent = '高频';
          row.append(frequency);
        }
        meanings.append(row);
      }

      content.append(wordRow, meanings);
      item.append(icon, content);
      el.reviewList.append(item);
    }

    // 答错的单词自动进入错词本（含“答错后改正”的情况）。
    const recorded = recordMistakesToBook(review);
    if (recorded.added > 0) {
      el.reviewSummary.textContent += ` · ${recorded.added} 个新错词已存入错词本`;
    }
    if (recorded.added > 0 || recorded.updated > 0) {
      refreshWrongBookUi();
    }
  }

  // ---------------------------------------------------------------
  // 错词本 + 单人错词挑战
  // ---------------------------------------------------------------
  function wrongBookApi() {
    return typeof window !== 'undefined' ? window.WrongBook || null : null;
  }

  function readWrongBook() {
    const api = wrongBookApi();
    return api ? api.load(window.localStorage) : { version: 1, words: [] };
  }

  function persistWrongBook(book) {
    const api = wrongBookApi();
    if (api) api.save(window.localStorage, book);
    refreshWrongBookUi(book);
    return book;
  }

  function refreshWrongBookUi(book) {
    const api = wrongBookApi();
    const current = book || readWrongBook();
    const total = api ? api.count(current) : 0;
    if (el.wrongBookCount) el.wrongBookCount.textContent = String(total);
    if (el.wrongBookHint) {
      el.wrongBookHint.textContent = total
        ? `错词本里还有 ${total} 个单词`
        : '错词本为空';
    }
    if (el.wrongChallengeBtn) {
      el.wrongChallengeBtn.classList.toggle('is-empty', total === 0);
    }
  }

  /**
   * 结算页里答错的单词写入 localStorage。返回新增/更新数量。
   */
  function recordMistakesToBook(review) {
    const api = wrongBookApi();
    if (!api || !Array.isArray(review) || review.length === 0) {
      return { added: 0, updated: 0 };
    }
    const missed = review
      .filter((entry) => {
        const status = entry.statuses?.[state.playerId] || 'unanswered';
        const hadMistake = Boolean(
          entry.mistakes && entry.mistakes[state.playerId]
        );
        return status === 'wrong' || hadMistake;
      })
      // 复盘条目只有 word（没有 id），错词本以 word 为唯一键。
      .map((entry) => ({
        word: entry.word,
        level: entry.level,
      }));

    if (missed.length === 0) return { added: 0, updated: 0 };
    const result = api.addMistakes(readWrongBook(), missed);
    if (result.added === 0 && result.updated === 0) {
      console.warn('[wrongbook] 检测到答错单词但未能写入错词本', missed);
      return { added: 0, updated: 0 };
    }
    persistWrongBook(result.book);
    return { added: result.added, updated: result.updated };
  }

  async function startWrongChallenge() {
    const api = wrongBookApi();
    const book = readWrongBook();
    const total = api ? api.count(book) : 0;
    if (total === 0) {
      showToast('当前没有错词，快去打一局吧', 'info');
      return;
    }
    if (!state.socket || !state.socket.connected) {
      showToast('尚未连接服务器，请稍候再试', 'error');
      return;
    }

    const words = book.words.map((entry) => entry.word);
    const started = await request('solo:start', { words });
    if (!started.ok) {
      showToast(started.error || '无法开始错词挑战', 'error');
      return;
    }

    state.solo = {
      active: true,
      total: started.total || words.length,
      answered: 0,
      correct: 0,
      mastered: 0,
      current: null,
      busy: false,
      lastWordId: null,
    };
    el.soloSummary.hidden = true;
    el.soloPlay.hidden = false;
    el.soloFeedback.textContent = '';
    setView('solo');
    updateSoloStats();
    await nextSoloQuestion();
  }

  async function nextSoloQuestion() {
    if (!state.solo.active) return;
    const remaining = readWrongBook().words;
    if (remaining.length === 0) {
      finishSolo();
      return;
    }
    updateSoloStats();
    setSoloFeedback('正在抽题…', 'info');

    const response = await request('solo:next', {
      words: remaining.map((entry) => entry.word),
    });
    if (!state.solo.active) return;
    if (!response.ok || !response.question) {
      setSoloFeedback('', '');
      showToast(response.error || '抽题失败，请重试', 'error');
      return;
    }

    state.solo.current = response.question;
    state.solo.lastWordId = response.question.id;
    state.solo.busy = false;
    renderSoloQuestion(response.question);
  }

  function renderSoloQuestion(question) {
    hideAnswerReveal(el.soloReveal);
    const isListen = question.type === 'listen';
    const isZh2en = question.type === 'zh2en';

    el.soloPrompt.textContent =
      question.promptLabel ||
      (isListen ? '点击喇叭听发音，选择正确的英文单词' : '选择正确的中文释义');
    el.soloQuestionWord.classList.toggle('is-cn-prompt', isZh2en);
    el.soloQuestionWord.classList.toggle('is-listen', isListen);
    el.soloWordText.textContent = isListen
      ? ''
      : question.prompt || question.word || '';
    state.speechWord = isListen || question.type === 'en2zh' ? question.word : '';
    el.soloSpeakBtn.hidden = !state.speechWord;
    if (state.speechWord && !isSpeechSupported()) showSpeechUnsupported();

    el.soloOptions.replaceChildren();
    question.options.forEach((text, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'option';
      button.dataset.index = String(index);

      const key = document.createElement('span');
      key.className = 'option-key';
      key.textContent = LETTERS[index] || String(index + 1);

      const label = document.createElement('span');
      label.className = 'option-text';
      label.textContent = text;

      button.append(key, label);
      button.addEventListener('click', () => answerSolo(index));
      el.soloOptions.append(button);
    });

    setSoloFeedback('', '');
    updateSoloStreak(question.word);
    updateSoloStats();

    // 听音题需要主动听，进入题目时自动播一次，失败则保留喇叭按钮兜底。
    if (isListen) {
      scheduleAutoSpeak(question.word, () => state.solo.current === question);
    }
  }

  async function answerSolo(index) {
    const solo = state.solo;
    if (!solo.active || solo.busy || !solo.current) return;
    const question = solo.current;
    solo.busy = true;
    disableSoloOptions();

    const response = await request('solo:answer', { index });
    if (!response.ok) {
      solo.busy = false;
      enableSoloOptions();
      showToast(response.error || '提交失败，请重试', 'error');
      return;
    }

    const api = wrongBookApi();
    solo.answered += 1;

    // 服务端只会在作答后下发 correctIndex；拿不到时用正确答案文本兜底，
    // 避免把正确选项误标成红色。
    const correctIndex = Number.isInteger(response.correctIndex)
      ? response.correctIndex
      : question.options.indexOf(response.correctText);

    [...el.soloOptions.children].forEach((button, optionIndex) => {
      button.classList.add('is-locked');
      if (optionIndex === correctIndex) {
        button.classList.add('is-correct');
      } else if (optionIndex === index) {
        button.classList.add('is-wrong');
      } else {
        button.classList.add('is-dimmed');
      }
    });

    if (question.type === 'listen') {
      renderAnswerReveal(
        el.soloReveal,
        response.word || question.word,
        response.meanings
      );
    }

    let streak = 0;
    let mastered = false;

    if (response.correct) {
      solo.correct += 1;
      const result = api.markCorrect(readWrongBook(), question.word);
      persistWrongBook(result.book);
      streak = result.streak;
      mastered = result.mastered;
      if (mastered) {
        solo.mastered += 1;
        setSoloFeedback(
          `✅ 连续答对 3 次，「${question.word}」已移出错词本`,
          'correct'
        );
      } else {
        setSoloFeedback(`✅ 答对了，连对 ${result.streak}/3`, 'correct');
      }
    } else {
      const result = api.markWrong(readWrongBook(), question.word);
      persistWrongBook(result.book);
      setSoloFeedback(
        `❌ 答错了，正确答案是「${response.correctText}」，连对已清零`,
        'wrong'
      );
    }

    updateSoloStreak(question.word, mastered ? 3 : streak);
    updateSoloStats();

    const delay = mastered ? 1500 : 1000;
    window.setTimeout(() => {
      if (!state.solo.active) return;
      if (readWrongBook().words.length === 0) finishSolo();
      else nextSoloQuestion();
    }, delay);
  }

  function finishSolo() {
    if (!state.solo.active) return;
    state.solo.active = false;
    state.solo.current = null;
    stopSpeech();

    el.soloPlay.hidden = true;
    el.soloSummary.hidden = false;
    el.soloSummaryTitle.textContent =
      state.solo.mastered > 0 ? '本轮错词已全部掌握 🎉' : '挑战结束';
    el.soloSummaryCopy.textContent =
      `本轮作答 ${state.solo.answered} 题，答对 ${state.solo.correct} 题，` +
      `掌握并移出错词本 ${state.solo.mastered} 个单词。`;
    refreshWrongBookUi();
  }

  function exitSolo() {
    if (!state.solo.active && el.soloSummary.hidden) {
      setView('home');
      return;
    }
    state.solo.active = false;
    state.solo.current = null;
    stopSpeech();
    if (state.socket && state.socket.connected) {
      state.socket.emit('solo:quit', {});
    }
    setView('home');
    refreshWrongBookUi();
  }

  function setSoloFeedback(text, kind) {
    el.soloFeedback.textContent = text;
    el.soloFeedback.className = `feedback${kind ? ` is-${kind}` : ''}`;
  }

  function disableSoloOptions() {
    [...el.soloOptions.children].forEach((button) => {
      button.disabled = true;
      button.classList.add('is-locked');
    });
  }

  function enableSoloOptions() {
    [...el.soloOptions.children].forEach((button) => {
      button.disabled = false;
      button.classList.remove('is-locked');
    });
  }

  function updateSoloStats() {
    const remaining = readWrongBook().words.length;
    el.soloRemaining.textContent = String(remaining);
    el.soloMastered.textContent = String(state.solo.mastered);
    el.soloAnswered.textContent = String(state.solo.answered);
  }

  function updateSoloStreak(wordId, overrideStreak) {
    const api = wrongBookApi();
    const entry = api ? api.get(readWrongBook(), wordId) : null;
    const streak =
      typeof overrideStreak === 'number'
        ? overrideStreak
        : entry
          ? entry.streak
          : 0;

    el.soloDots.replaceChildren();
    for (let index = 0; index < 3; index += 1) {
      const dot = document.createElement('span');
      dot.className = `solo-dot${index < streak ? ' is-on' : ''}`;
      el.soloDots.append(dot);
    }
    el.soloStreakValue.textContent = `${streak} / 3`;
    el.soloStreakValue.classList.toggle('is-done', streak >= 3);
  }

  function startCountdown(deadline, serverNow) {
    stopCountdown();
    if (!deadline) return;

    const now = typeof serverNow === 'number' ? serverNow : Date.now();
    const duration = Math.max(1, deadline - now);
    state.countdown.deadline = deadline;
    state.countdown.serverOffset = now - Date.now();
    state.countdown.total = duration;
    state.countdown.expired = false;

    const tick = () => {
      const remaining = Math.max(
        0,
        deadline - (Date.now() + state.countdown.serverOffset)
      );
      const seconds = Math.ceil(remaining / 1000);
      const progress = Math.max(0, Math.min(100, (remaining / duration) * 100));
      const urgent = remaining <= 5000;

      el.timerNumber.textContent = String(seconds);
      el.timerBar.style.width = `${progress}%`;
      el.timerNumber.classList.toggle('is-urgent', urgent);
      el.timerBar.classList.toggle('is-urgent', urgent);

      if (remaining <= 0 && !state.countdown.expired) {
        state.countdown.expired = true;
        stopCountdown();
        if (!state.answerLocked) {
          state.answerLocked = true;
          disableOptions();
          setFeedback('时间到，正在等待服务端结算…', 'warning');
        }
      }
    };

    tick();
    state.countdown.interval = window.setInterval(tick, 100);
  }

  function stopCountdown() {
    if (state.countdown.interval) {
      window.clearInterval(state.countdown.interval);
      state.countdown.interval = null;
    }
  }

  function clearQuestionState() {
    stopCountdown();
    state.currentQuestion = null;
    state.questionResult = null;
    state.selectedIndex = null;
    state.answerLocked = false;
    state.answeredCorrect = null;
  }

  function disableOptions() {
    for (const button of el.options.querySelectorAll('.option')) {
      button.disabled = true;
    }
  }

  function applyLockedOptionStyles() {
    for (const button of el.options.querySelectorAll('.option')) {
      button.disabled = true;
      const index = Number(button.dataset.index);
      if (index !== state.selectedIndex) button.classList.add('is-dimmed');
    }
  }

  function setFeedback(text, kind, detail) {
    el.gameFeedback.className = 'feedback';
    if (kind) el.gameFeedback.classList.add(`is-${kind}`);
    el.gameFeedback.replaceChildren();
    if (text) {
      el.gameFeedback.append(document.createTextNode(text));
    }
    if (detail) {
      const small = document.createElement('small');
      small.textContent = detail;
      el.gameFeedback.append(small);
    }
  }

  function updateOpponentStatus() {
    if (!state.room) return;
    if (isRaceRoom() && state.race.active) {
      const mine = state.race.progress.find((entry) => entry.id === state.playerId);
      const opponent = state.race.progress.find((entry) => entry.id !== state.playerId);
      const myProgress = mine ? mine.progress : 0;
      const opponentProgress = opponent ? opponent.progress : 0;
      if (mine && mine.finished && opponent && opponent.finished) {
        el.opponentStatus.textContent = '双方均已完成，正在结算…';
      } else if (mine && mine.finished) {
        el.opponentStatus.textContent =
          `你 ${myProgress}/${state.race.total} 已完成 · ` +
          `等待对手 ${opponentProgress}/${state.race.total}`;
      } else if (opponent && opponent.finished) {
        el.opponentStatus.textContent =
          `对手已完成 · 你 ${myProgress}/${state.race.total}，继续作答`;
      } else {
        el.opponentStatus.textContent =
          `竞速中 · 你 ${myProgress}/${state.race.total} · ` +
          `对手 ${opponentProgress}/${state.race.total} · 答错冷却 1 秒`;
      }
      return;
    }
    const me = findMe();
    const opponent = state.room.players.find(
      (player) => !me || player.id !== me.id
    );
    if (!opponent) {
      el.opponentStatus.textContent = '';
      return;
    }
    el.opponentStatus.textContent = opponent.connected
      ? `对手 ${opponent.nickname} 已就位`
      : '对手暂时掉线，本题计时仍会继续';
  }

  function findMe() {
    if (!state.room || !Array.isArray(state.room.players)) return null;
    return state.room.players.find((player) => player.id === state.playerId) || null;
  }

  function setActionsOffline() {
    el.readyBtn.disabled = true;
    el.startBtn.disabled = true;
    el.rematchBtn.disabled = true;
    el.modeQuizBtn.disabled = true;
    el.modeRaceBtn.disabled = true;
    el.levelSelect.disabled = true;
  }

  function startPingLoop() {
    stopPingLoop();
    const run = () => {
      if (!state.socket || !state.socket.connected) {
        setPing(null);
        return;
      }
      if (state.ping.inFlight || document.hidden) return;
      state.ping.inFlight = true;
      const startedAt = performance.now();
      state.socket.timeout(2500).emit('latency:ping', { t: Date.now() }, (error) => {
        state.ping.inFlight = false;
        if (error || !state.socket || !state.socket.connected) {
          setPing(null);
          return;
        }
        setPing(Math.max(0, Math.round(performance.now() - startedAt)));
      });
    };
    run();
    state.ping.timer = window.setInterval(run, 1000);
  }

  function stopPingLoop() {
    if (state.ping.timer) {
      window.clearInterval(state.ping.timer);
      state.ping.timer = null;
    }
    state.ping.inFlight = false;
  }

  function setPing(ms) {
    if (!el.pingDisplay || !el.pingValue) return;
    if (typeof ms !== 'number' || !Number.isFinite(ms)) {
      el.pingValue.textContent = '-- ms';
      el.pingDisplay.dataset.quality =
        state.socket && state.socket.connected ? 'unknown' : 'offline';
      return;
    }
    el.pingValue.textContent = `${ms} ms`;
    el.pingDisplay.dataset.quality =
      ms > 500 ? 'bad' : ms > 200 ? 'warn' : 'good';
  }

  function setConnection(mode, text) {
    el.connection.dataset.state = mode;
    el.connectionText.textContent = text;
  }

  function setView(name) {
    if (!VIEW_IDS.includes(name)) return;
    state.currentView = name;
    for (const viewName of VIEW_IDS) {
      const node = document.getElementById(`view-${viewName}`);
      if (node) node.hidden = viewName !== name;
    }
    document.body.dataset.view = name;
    window.scrollTo(0, 0);
  }

  function goHome({ clearSession: shouldClear, message } = {}) {
    clearQuestionState();
    resetRaceState();
    state.room = null;
    state.playerId = null;
    el.reconnectBanner.hidden = true;
    if (shouldClear) clearSession();
    setView('home');
    clearHomeError();
    if (message) showToast(message, 'error');
  }

  async function request(event, payload, timeout = 8000) {
    return new Promise((resolve) => {
      if (!state.socket || !state.socket.connected) {
        resolve({ ok: false, error: '尚未连接服务器，请稍候再试' });
        return;
      }
      state.socket.timeout(timeout).emit(event, payload, (error, response) => {
        if (error) {
          resolve({ ok: false, error: '请求超时，请检查网络后重试' });
          return;
        }
        resolve(
          response && typeof response === 'object'
            ? response
            : { ok: false, error: '服务器没有返回结果' }
        );
      });
    });
  }

  function persistSession(sessionId, playerId, roomCode) {
    state.sessionId = sessionId;
    state.playerId = playerId;
    storageSet(STORAGE.session, sessionId);
    storageSet(STORAGE.room, roomCode);
    if (state.socket) state.socket.auth = { sessionId };
  }

  function clearSession() {
    state.sessionId = null;
    storageRemove(STORAGE.session);
    storageRemove(STORAGE.room);
    if (state.socket) state.socket.auth = {};
  }

  function getNickname() {
    return el.nickname.value.trim().replace(/\s+/g, ' ');
  }

  function levelLabel(level) {
    return level === 'CET6' ? 'CET-6' : 'CET-4';
  }

  function validateNickname(nickname) {
    if (!nickname) {
      showHomeError('请先输入昵称');
      el.nickname.focus();
      return false;
    }
    if (nickname.length > 20) {
      showHomeError('昵称最多 20 个字符');
      el.nickname.focus();
      return false;
    }
    return true;
  }

  function showHomeError(message) {
    el.homeError.textContent = message;
    el.homeError.hidden = false;
  }

  function clearHomeError() {
    el.homeError.textContent = '';
    el.homeError.hidden = true;
  }

  function showToast(message, kind = 'info') {
    if (state.toastTimer) window.clearTimeout(state.toastTimer);
    el.toast.textContent = message;
    el.toast.className = 'toast';
    if (kind === 'error') el.toast.classList.add('is-error');
    if (kind === 'success') el.toast.classList.add('is-success');
    el.toast.hidden = false;
    state.toastTimer = window.setTimeout(() => {
      el.toast.hidden = true;
      state.toastTimer = null;
    }, 3800);
  }

  function setBusy(button, busy, busyText) {
    if (!button) return;
    if (busy) {
      if (!button.dataset.originalHtml) button.dataset.originalHtml = button.innerHTML;
      button.disabled = true;
      button.textContent = busyText;
    } else {
      button.disabled = false;
      if (button.dataset.originalHtml) {
        button.innerHTML = button.dataset.originalHtml;
      }
    }
  }

  function tag(text, className) {
    const node = document.createElement('span');
    node.className = `tag ${className || ''}`.trim();
    node.textContent = text;
    return node;
  }

  function initialOf(nickname) {
    if (!nickname) return '?';
    return Array.from(nickname.trim())[0]?.toUpperCase() || '?';
  }

  async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.append(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    textarea.remove();
    if (!ok) throw new Error('copy failed');
  }

  function storageGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (error) {
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (error) {
      // 隐私模式可能禁用 localStorage；当前页面仍可继续运行。
    }
  }

  function storageRemove(key) {
    try {
      window.localStorage.removeItem(key);
    } catch (error) {
      // 忽略存储异常。
    }
  }
})();
