'use strict';

/* --------------------------------------------------------------------------
 * 连珠 · LAN Gomoku — client
 * 无框架、无外部依赖。
 * ------------------------------------------------------------------------ */

const BOARD_SIZE = 15;
const CELL_COUNT = BOARD_SIZE * BOARD_SIZE;
const STORAGE_NAME = 'gomoku.name';
const STORAGE_SOUND = 'gomoku.sound';
const TOKEN_PREFIX = 'gomoku.token.';

const CPU = { BLACK: 1, WHITE: 2 };
const COLOR_NAMES = { 1: '黑方', 2: '白方' };
const COLOR_SHORT = { 1: '黑', 2: '白' };
const GAME_INFO = {
  gomoku: {
    id: 'gomoku',
    label: '五子棋',
    kicker: 'GOMOKU RULES',
    title: '五子棋规则',
    footer: '15 × 15 · 自由规则',
  },
  checkers: {
    id: 'checkers',
    label: '中国跳棋',
    kicker: 'CHINESE CHECKERS',
    title: '中国跳棋规则',
    footer: '六角星 · 运送十子',
  },
  poker: {
    id: 'poker',
    label: '德州扑克',
    kicker: 'HEADS-UP HOLD’EM',
    title: '德州扑克规则',
    footer: '单挑 · 无限注',
  },
};
const Checkers = globalThis.CheckersCore;
const Poker = globalThis.PokerCore;
const ERROR_MESSAGES = {
  ROOM_NOT_FOUND: '房间不存在，请核对房间号',
  REJOIN_FAILED: '无法恢复此房间的座位',
  ROOM_FULL: '房间已满，无法加入',
  NOT_IN_ROOM: '你还没有加入房间',
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const storage = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Private browsing / storage disabled: the game still works.
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Ignore.
    }
  },
};

// Seats are scoped to the tab, not the whole browser. This keeps reloads
// seamless while avoiding a new tab silently taking over the host's seat.
const seatStorage = {
  get(key) {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      sessionStorage.setItem(key, value);
    } catch {
      // Ignore.
    }
  },
  remove(key) {
    try {
      sessionStorage.removeItem(key);
    } catch {
      // Ignore.
    }
  },
};

const els = {
  body: document.body,
  homeScreen: $('#homeScreen'),
  gameScreen: $('#gameScreen'),
  brandHome: $('#brandHome'),
  serverPill: $('#serverPill'),
  serverPillText: $('#serverPillText'),
  soundToggle: $('#soundToggle'),
  soundToggleGame: $('#gameSoundToggle'),
  tabs: $('.tabs'),
  tabButtons: $$('.tab'),
  createPanel: $('#createPanel'),
  joinPanel: $('#joinPanel'),
  nameInput: $('#nameInput'),
  joinNameInput: $('#joinNameInput'),
  nameCount: $('#nameCount'),
  createButton: $('#createButton'),
  joinButton: $('#joinButton'),
  gameChoices: $$('.game-choice'),
  stackOptions: $$('.stack-option'),
  pokerStackPicker: $('#pokerStackPicker'),
  createFinePrint: $('#createFinePrint'),
  heroArt: $('#heroArt'),
  gomokuPreview: $('#gomokuPreview'),
  checkersPreview: $('#checkersPreview'),
  pokerPreview: $('#pokerPreview'),
  miniStar: $('#miniStar'),
  roomInput: $('#roomInput'),
  inviteCallout: $('#inviteCallout'),
  inviteCalloutCode: $('#inviteCalloutCode'),
  serverState: $('#serverState'),
  refreshInfoButton: $('#refreshInfoButton'),
  footerAddress: $('#footerAddress'),
  footerRuleLabel: $('#footerRuleLabel'),

  roomCodeLabel: $('#roomCodeLabel'),
  copyCodeButton: $('#copyCodeButton'),
  roundLabel: $('#roundLabel'),
  connectionLabel: $('#connectionLabel'),
  connectionText: $('#connectionText'),
  boardShell: $('#boardShell'),
  board: $('#board'),
  boardLines: $('#boardLines'),
  stonesLayer: $('#stonesLayer'),
  cellsLayer: $('#cellsLayer'),
  boardLock: $('#boardLock'),
  boardLockTitle: $('#boardLockTitle'),
  boardLockText: $('#boardLockText'),
  resultRibbon: $('#resultRibbon'),
  resultRibbonText: $('#resultRibbonText'),
  checkersShell: $('#checkersShell'),
  checkersBoard: $('#checkersBoard'),
  checkersSvg: $('#checkersSvg'),
  checkersLock: $('#checkersLock'),
  checkersLockTitle: $('#checkersLockTitle'),
  checkersLockText: $('#checkersLockText'),
  checkersRibbon: $('#checkersRibbon'),
  checkersRibbonText: $('#checkersRibbonText'),
  pokerShell: $('#pokerShell'),
  pokerTable: $('#pokerTable'),
  pokerOpponentSeat: $('#pokerOpponentSeat'),
  pokerHeroSeat: $('#pokerHeroSeat'),
  pokerOpponentName: $('#pokerOpponentName'),
  pokerOpponentStack: $('#pokerOpponentStack'),
  pokerOpponentPosition: $('#pokerOpponentPosition'),
  pokerOpponentCards: $('#pokerOpponentCards'),
  pokerOpponentBet: $('#pokerOpponentBet'),
  pokerHeroName: $('#pokerHeroName'),
  pokerHeroStack: $('#pokerHeroStack'),
  pokerHeroPosition: $('#pokerHeroPosition'),
  pokerHeroCards: $('#pokerHeroCards'),
  pokerHeroBet: $('#pokerHeroBet'),
  pokerCommunity: $('#pokerCommunity'),
  pokerPot: $('#pokerPot'),
  pokerStageLabel: $('#pokerStageLabel'),
  pokerLastAction: $('#pokerLastAction'),
  pokerDealerButton: $('#pokerDealerButton'),
  pokerResultPanel: $('#pokerResultPanel'),
  pokerResultKicker: $('#pokerResultKicker'),
  pokerResultTitle: $('#pokerResultTitle'),
  pokerResultDetail: $('#pokerResultDetail'),
  pokerResultHands: $('#pokerResultHands'),
  pokerResultCountdown: $('#pokerResultCountdown'),
  pokerLock: $('#pokerLock'),
  pokerLockTitle: $('#pokerLockTitle'),
  pokerLockText: $('#pokerLockText'),
  chainBar: $('#chainBar'),
  chainCount: $('#chainCount'),
  endChainButton: $('#endChainButton'),
  lastMoveLabel: $('#lastMoveLabel'),
  boardSizeLabel: $('#boardSizeLabel'),
  firstMoveLabel: $('#firstMoveLabel'),
  rulesButton: $('#rulesButton'),

  gtoPanel: $('#gtoPanel'),
  gtoToggle: $('#gtoToggle'),
  gtoToggleLabel: $('#gtoToggleLabel'),
  gtoBody: $('#gtoBody'),
  gtoAction: $('#gtoAction'),
  gtoReason: $('#gtoReason'),
  gtoEquity: $('#gtoEquity'),
  gtoEquityLabel: $('#gtoEquityLabel'),
  gtoOdds: $('#gtoOdds'),
  gtoFrequency: $('#gtoFrequency'),
  pokerControls: $('#pokerControls'),
  pokerCallInfo: $('#pokerCallInfo'),
  pokerFoldButton: $('#pokerFoldButton'),
  pokerCheckButton: $('#pokerCheckButton'),
  pokerCallButton: $('#pokerCallButton'),
  pokerCallAmount: $('#pokerCallAmount'),
  pokerRaiseToggle: $('#pokerRaiseToggle'),
  pokerRaiseBox: $('#pokerRaiseBox'),
  pokerRaiseAmount: $('#pokerRaiseAmount'),
  pokerRaiseSlider: $('#pokerRaiseSlider'),
  pokerRaiseConfirm: $('#pokerRaiseConfirm'),
  pokerActionHint: $('#pokerActionHint'),
  pokerRaisePresets: $$('.poker-raise-presets button'),

  sidePanel: $('#sidePanel'),
  statusCard: $('#statusCard'),
  turnStone: $('#turnStone'),
  statusKicker: $('#statusKicker'),
  statusTitle: $('#statusTitle'),
  statusSub: $('#statusSub'),
  waitingDots: $('#waitingDots'),
  blackPlayerCard: $('#blackPlayerCard'),
  whitePlayerCard: $('#whitePlayerCard'),
  blackName: $('#blackName'),
  whiteName: $('#whiteName'),
  blackSub: $('#blackSub'),
  whiteSub: $('#whiteSub'),
  blackYou: $('#blackYou'),
  whiteYou: $('#whiteYou'),
  blackState: $('#blackState'),
  whiteState: $('#whiteState'),
  moveCountLabel: $('#moveCountLabel'),
  moveCountCaption: $('#moveCountCaption'),
  roundCaption: $('#roundCaption'),
  roundCountLabel: $('#roundCountLabel'),
  phaseCaption: $('#phaseCaption'),
  phaseLabel: $('#phaseLabel'),
  historyPanel: $('#historyPanel'),
  historyTitle: $('#historyTitle'),
  historyList: $('#historyList'),
  historyCount: $('#historyCount'),
  historyEmpty: $('#historyEmpty'),
  gameNote: $('#gameNote'),
  gameNoteMark: $('#gameNoteMark'),
  gameNoteTitle: $('#gameNoteTitle'),
  gameNoteText: $('#gameNoteText'),

  invitePanel: $('#invitePanel'),
  inviteLinkInput: $('#inviteLinkInput'),
  inviteHint: $('#inviteHint'),
  copyLinkButton: $('#copyLinkButton'),
  shareButton: $('#shareButton'),
  primaryAction: $('#primaryAction'),
  secondaryAction: $('#secondaryAction'),
  leaveLink: $('#leaveLink'),

  toastHost: $('#toastHost'),
  reconnectOverlay: $('#reconnectOverlay'),
  reconnectText: $('#reconnectText'),
  reconnectHomeButton: $('#reconnectHomeButton'),
  confirmDialog: $('#confirmDialog'),
  dialogTitle: $('#dialogTitle'),
  dialogBody: $('#dialogBody'),
  dialogConfirmButton: $('#dialogConfirmButton'),
  rulesDialog: $('#rulesDialog'),
  rulesKicker: $('#rulesKicker'),
  rulesTitle: $('#rulesTitle'),
  gomokuRules: $('#gomokuRules'),
  checkersRules: $('#checkersRules'),
  pokerRules: $('#pokerRules'),
};

const state = {
  screen: 'home',
  ws: null,
  socketPromise: null,
  heartbeatTimer: null,
  pingSentAt: 0,
  latency: null,
  lastServerMessage: 0,
  inRoom: false,
  room: null,
  roomCode: null,
  token: null,
  info: null,
  pendingAction: null,
  requestTimer: null,
  leaveTimer: null,
  reconnecting: false,
  reconnectAttempt: 0,
  reconnectTimer: null,
  rejoinTimer: null,
  awaitingRejoin: false,
  movePending: false,
  moveTimer: null,
  rendered: { code: null, round: 0, moveCount: -1, lastMoveNumber: null },
  lastResultKey: null,
  focus: { row: 7, col: 7 },
  autoResume: false,
  selectedGame: ['checkers', 'poker'].includes(storage.get('gomoku.game'))
    ? storage.get('gomoku.game')
    : 'gomoku',
  selectedPokerStackBb: [20, 50, 100, 200].includes(Number(storage.get('gomoku.pokerStack')))
    ? Number(storage.get('gomoku.pokerStack'))
    : 100,
  checkers: {
    layout: null,
    built: false,
    selected: null,
    pending: null,
    moves: { steps: [], jumps: [] },
    lastMoveKey: null,
  },
  poker: {
    gtoEnabled: storage.get('gomoku.gto') === '1',
    adviceKey: null,
    advice: null,
    raiseOpen: false,
    raiseTarget: null,
    actionPending: false,
    actionTimer: null,
    countdownTimer: null,
    nextHandAt: null,
    serverNow: null,
    resultKey: null,
  },
};

const cells = [];
let winLineElement = null;
let checkersElements = null;

const audio = {
  enabled: storage.get(STORAGE_SOUND) !== '0',
  ctx: null,
};

/* --------------------------------------------------------------------------
 * Small utilities
 * ------------------------------------------------------------------------ */

function clampName(value) {
  const text = String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(text).slice(0, 12).join('');
}

function tokenKey(code) {
  return `${TOKEN_PREFIX}${code}`;
}

function colorName(color) {
  return COLOR_NAMES[color] || '';
}

function otherColor(color) {
  return color === CPU.BLACK ? CPU.WHITE : CPU.BLACK;
}

function roomGame(room = state.room) {
  if (room && (room.game === 'checkers' || room.game === 'poker')) return room.game;
  return 'gomoku';
}

function gameInfo(game = roomGame()) {
  return GAME_INFO[game] || GAME_INFO.gomoku;
}

function isCheckers(room = state.room) {
  return roomGame(room) === 'checkers';
}

function isPoker(room = state.room) {
  return roomGame(room) === 'poker';
}

function pokerBb(chips) {
  const value = Number(chips) / 100;
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '');
}

function pokerChips(bb) {
  return Math.round(Number(bb) * 100);
}

function pokerPosition(room, color) {
  if (!room || !room.poker || !color) return '';
  return room.poker.buttonColor === color ? 'BTN · SB' : 'BB';
}

function pokerStageName(stage) {
  return (
    {
      waiting: '等待开始',
      preflop: '翻牌前',
      flop: '翻牌',
      turn: '转牌',
      river: '河牌',
      handComplete: '本手结束',
      matchOver: '牌局结束',
    }[stage] || '等待开始'
  );
}

function playerAt(room, color) {
  if (!room) return null;
  return room.players.find((player) => player && player.color === color) || null;
}

function opponentOf(room) {
  if (!room) return null;
  return playerAt(room, otherColor(room.yourColor));
}

function bothSeated(room) {
  return Boolean(room && room.players[0] && room.players[1]);
}

function allConnected(room) {
  return Boolean(
    bothSeated(room) && room.players.every((player) => player && player.connected)
  );
}

function myPlayer(room) {
  return playerAt(room, room.yourColor);
}

function coordinateLabel(row, col) {
  return `${String.fromCharCode(65 + col)}${row + 1}`;
}

function isLocalHostname() {
  return (
    location.hostname === 'localhost' ||
    location.hostname === '127.0.0.1' ||
    location.hostname === '::1' ||
    location.hostname === '[::1]'
  );
}

function getInviteBase() {
  if (!isLocalHostname()) return location.origin;
  const first = state.info && Array.isArray(state.info.urls) ? state.info.urls[0] : null;
  return first ? first.url : location.origin;
}

function inviteUrlFor(code) {
  const base = getInviteBase().replace(/\/+$/, '');
  return `${base}/?room=${encodeURIComponent(code)}`;
}

function displayHost() {
  return getInviteBase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

function saveName() {
  const name = clampName(els.nameInput.value);
  if (name) storage.set(STORAGE_NAME, name);
  return name;
}

function updateNameCount() {
  const length = Array.from(els.nameInput.value).length;
  els.nameCount.textContent = `${Math.min(length, 12)}/12`;
}

function getCheckersLayout() {
  if (!Checkers) return null;
  if (!state.checkers.layout) state.checkers.layout = Checkers.createLayout();
  return state.checkers.layout;
}

function selectGame(game, { persist = true } = {}) {
  const next = ['checkers', 'poker'].includes(game) ? game : 'gomoku';
  state.selectedGame = next;
  for (const button of els.gameChoices) {
    const active = button.dataset.game === next;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-checked', String(active));
  }
  if (els.gomokuPreview) els.gomokuPreview.hidden = next !== 'gomoku';
  if (els.checkersPreview) els.checkersPreview.hidden = next !== 'checkers';
  if (els.pokerPreview) els.pokerPreview.hidden = next !== 'poker';
  if (els.pokerStackPicker) els.pokerStackPicker.hidden = next !== 'poker';
  if (els.heroArt) els.heroArt.dataset.game = next;
  if (els.createFinePrint) {
    els.createFinePrint.textContent =
      next === 'checkers'
        ? '黑方先行 · 六角星棋盘 121 洞'
        : next === 'poker'
          ? `单挑无限注 · 起始 ${state.selectedPokerStackBb} BB`
          : '黑方先行 · 标准 15 × 15 棋盘';
  }
  if (persist) storage.set('gomoku.game', next);
  if (state.screen === 'home') {
    els.footerRuleLabel.textContent = gameInfo(next).footer;
  }
}

function selectPokerStack(stack, { persist = true } = {}) {
  const next = [20, 50, 100, 200].includes(Number(stack)) ? Number(stack) : 100;
  state.selectedPokerStackBb = next;
  for (const button of els.stackOptions) {
    const active = Number(button.dataset.stack) === next;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-checked', String(active));
  }
  if (state.selectedGame === 'poker' && els.createFinePrint) {
    els.createFinePrint.textContent = `单挑无限注 · 起始 ${next} BB`;
  }
  if (persist) storage.set('gomoku.pokerStack', String(next));
}

function initGamePicker() {
  for (const button of els.gameChoices) {
    button.addEventListener('click', () => {
      ensureAudio();
      selectGame(button.dataset.game);
    });
  }
  for (const button of els.stackOptions) {
    button.addEventListener('click', () => {
      ensureAudio();
      selectPokerStack(button.dataset.stack);
    });
  }
  selectGame(state.selectedGame, { persist: false });
  selectPokerStack(state.selectedPokerStackBb, { persist: false });
  buildMiniStarPreview();
}

function buildMiniStarPreview() {
  if (!els.miniStar || !Checkers) return;
  const layout = getCheckersLayout();
  if (!layout) return;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 1000 1000');
  svg.setAttribute('aria-hidden', 'true');

  const defs = document.createElementNS(NS, 'defs');
  const gradient = document.createElementNS(NS, 'radialGradient');
  gradient.setAttribute('id', 'miniStarWood');
  gradient.setAttribute('cx', '35%');
  gradient.setAttribute('cy', '20%');
  gradient.setAttribute('r', '88%');
  for (const [offset, color] of [
    ['0', '#efd09d'],
    ['0.55', '#d3a360'],
    ['1', '#ad7534'],
  ]) {
    const stop = document.createElementNS(NS, 'stop');
    stop.setAttribute('offset', offset);
    stop.setAttribute('stop-color', color);
    gradient.append(stop);
  }
  defs.append(gradient);
  svg.append(defs);

  const star = document.createElementNS(NS, 'polygon');
  star.setAttribute('points', layout.starPoints);
  star.setAttribute('fill', 'url(#miniStarWood)');
  star.setAttribute('stroke', '#7b4e22');
  star.setAttribute('stroke-width', '8');
  star.setAttribute('stroke-linejoin', 'round');
  svg.append(star);

  const holes = document.createElementNS(NS, 'g');
  for (const hole of layout.holes) {
    const circle = document.createElementNS(NS, 'circle');
    circle.setAttribute('cx', String(hole.sx));
    circle.setAttribute('cy', String(hole.sy));
    circle.setAttribute('r', '8');
    circle.setAttribute('fill', 'rgba(53,31,12,.82)');
    holes.append(circle);
  }
  svg.append(holes);

  const pieces = document.createElementNS(NS, 'g');
  layout.holes.forEach((hole) => {
    const color = layout.initialBoard[hole.index];
    if (!color) return;
    const circle = document.createElementNS(NS, 'circle');
    circle.setAttribute('cx', String(hole.sx));
    circle.setAttribute('cy', String(hole.sy));
    circle.setAttribute('r', '18');
    circle.setAttribute('fill', color === 1 ? '#161b18' : '#f3ecdf');
    circle.setAttribute('stroke', color === 1 ? 'rgba(255,255,255,.16)' : 'rgba(128,108,76,.5)');
    circle.setAttribute('stroke-width', '2');
    pieces.append(circle);
  });
  svg.append(pieces);
  els.miniStar.replaceChildren(svg);
}

function setScreen(screen) {
  state.screen = screen;
  els.homeScreen.hidden = screen !== 'home';
  els.gameScreen.hidden = screen !== 'room';
  if (screen === 'home') {
    window.scrollTo(0, 0);
  }
  updateDocumentTitle();
}

function updateDocumentTitle() {
  if (state.screen === 'room' && state.room) {
    const room = state.room;
    if (room.status === 'waiting') {
      document.title = '等待棋友 · 连珠';
    } else if (room.status === 'ended') {
      document.title = '对局结束 · 连珠';
    } else if (isPoker(room)) {
      if (room.poker.stage === 'handComplete') {
        document.title = '本手结束 · 连珠';
      } else if (room.poker.actor === room.yourColor && allConnected(room)) {
        document.title = '轮到你行动 · 连珠';
      } else {
        document.title = '牌局中 · 连珠';
      }
    } else if (room.turn === room.yourColor && allConnected(room)) {
      document.title = `${isCheckers(room) ? '轮到你走棋' : '轮到你落子'} · 连珠`;
    } else {
      document.title = '对局中 · 连珠';
    }
  } else {
    document.title = '连珠 · 局域网棋桌';
  }
}

function setRoomQuery(code) {
  try {
    const url = new URL(location.href);
    url.searchParams.set('room', code);
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  } catch {
    // History API can be unavailable in embedded webviews.
  }
}

function clearRoomQuery() {
  try {
    const url = new URL(location.href);
    url.searchParams.delete('room');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  } catch {
    // Ignore.
  }
}

/* --------------------------------------------------------------------------
 * Toasts, dialogs, clipboard, sound
 * ------------------------------------------------------------------------ */

function toast(message, type = 'info', duration = 3200) {
  const node = document.createElement('div');
  node.className = `toast${type === 'error' ? ' is-error' : ''}`;
  node.textContent = message;
  els.toastHost.append(node);
  while (els.toastHost.children.length > 3) {
    els.toastHost.firstElementChild?.remove();
  }
  window.setTimeout(() => {
    node.classList.add('is-leaving');
    window.setTimeout(() => node.remove(), 280);
  }, duration);
}

function askConfirm({ title, body, confirmText = '确认', danger = false }) {
  return new Promise((resolve) => {
    if (els.confirmDialog.open) {
      resolve(false);
      return;
    }
    els.dialogTitle.textContent = title;
    els.dialogBody.textContent = body;
    els.dialogConfirmButton.textContent = confirmText;
    els.dialogConfirmButton.className = danger ? 'btn btn-danger' : 'btn btn-primary';
    els.confirmDialog.returnValue = 'cancel';

    const onClose = () => {
      els.confirmDialog.removeEventListener('close', onClose);
      resolve(els.confirmDialog.returnValue === 'confirm');
    };
    els.confirmDialog.addEventListener('close', onClose);
    els.confirmDialog.showModal();
  });
}

function fallbackCopy(text) {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.top = '-1000px';
  area.style.opacity = '0';
  document.body.append(area);
  area.select();
  area.setSelectionRange(0, area.value.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

async function copyText(text, successMessage) {
  let copied = false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      copied = true;
    }
  } catch {
    copied = false;
  }
  if (!copied) copied = fallbackCopy(text);
  if (copied) {
    toast(successMessage || '已复制');
  } else {
    toast('复制失败，请手动选择文字', 'error');
  }
  return copied;
}

function ensureAudio() {
  if (!audio.enabled) return null;
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) return null;
  if (!audio.ctx) {
    try {
      audio.ctx = new AudioCtor();
    } catch {
      return null;
    }
  }
  if (audio.ctx.state === 'suspended') {
    audio.ctx.resume().catch(() => {});
  }
  return audio.ctx;
}

function tone(freq, duration, options = {}) {
  const ctx = ensureAudio();
  if (!ctx) return;
  const {
    type = 'sine',
    volume = 0.05,
    delay = 0,
    endFreq = null,
    attack = 0.008,
  } = options;
  const start = ctx.currentTime + delay;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(Math.max(30, freq), start);
  if (endFreq) {
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(30, endFreq), start + duration);
  }
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), start + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.03);
}

function playStone() {
  if (!audio.enabled) return;
  tone(280, 0.075, { type: 'triangle', volume: 0.09, endFreq: 110 });
  tone(720, 0.035, { type: 'sine', volume: 0.025, delay: 0.005, endFreq: 420 });
}

function playJoin() {
  if (!audio.enabled) return;
  tone(392, 0.18, { type: 'sine', volume: 0.035 });
  tone(587.33, 0.24, { type: 'sine', volume: 0.035, delay: 0.11 });
}

function playWin() {
  if (!audio.enabled) return;
  [523.25, 659.25, 783.99, 1046.5].forEach((freq, index) => {
    tone(freq, 0.36, {
      type: 'sine',
      volume: 0.045,
      delay: index * 0.11,
    });
  });
}

function playLose() {
  if (!audio.enabled) return;
  tone(392, 0.3, { type: 'sine', volume: 0.035 });
  tone(329.63, 0.42, { type: 'sine', volume: 0.035, delay: 0.16 });
}

function playDraw() {
  if (!audio.enabled) return;
  tone(440, 0.28, { type: 'sine', volume: 0.03 });
  tone(440, 0.3, { type: 'sine', volume: 0.025, delay: 0.18 });
}

function playError() {
  if (!audio.enabled) return;
  tone(145, 0.12, { type: 'triangle', volume: 0.035, endFreq: 110 });
}

function updateSoundUI() {
  els.body.classList.toggle('is-muted', !audio.enabled);
  els.soundToggle.setAttribute('aria-pressed', String(audio.enabled));
  els.soundToggle.setAttribute('title', audio.enabled ? '关闭音效' : '开启音效');
  els.soundToggleGame.setAttribute('aria-pressed', String(audio.enabled));
  els.soundToggleGame.textContent = `音效：${audio.enabled ? '开' : '关'}`;
}

function toggleSound() {
  audio.enabled = !audio.enabled;
  storage.set(STORAGE_SOUND, audio.enabled ? '1' : '0');
  updateSoundUI();
  if (audio.enabled) {
    ensureAudio();
    playJoin();
    toast('音效已开启');
  } else {
    toast('音效已关闭');
  }
}

/* --------------------------------------------------------------------------
 * Board construction and rendering
 * ------------------------------------------------------------------------ */

const SVG_NS = 'http://www.w3.org/2000/svg';

function buildBoard() {
  const fragment = document.createDocumentFragment();
  const firstCenter = (0.5 / BOARD_SIZE) * 100;
  const lastCenter = 100 - firstCenter;

  for (let index = 0; index < BOARD_SIZE; index += 1) {
    const position = ((index + 0.5) / BOARD_SIZE) * 100;
    const isOuter = index === 0 || index === BOARD_SIZE - 1;

    const vertical = document.createElementNS(SVG_NS, 'line');
    vertical.setAttribute('x1', String(position));
    vertical.setAttribute('y1', String(firstCenter));
    vertical.setAttribute('x2', String(position));
    vertical.setAttribute('y2', String(lastCenter));
    vertical.setAttribute('class', `grid-line${isOuter ? ' outer' : ''}`);
    fragment.append(vertical);

    const horizontal = document.createElementNS(SVG_NS, 'line');
    horizontal.setAttribute('x1', String(firstCenter));
    horizontal.setAttribute('y1', String(position));
    horizontal.setAttribute('x2', String(lastCenter));
    horizontal.setAttribute('y2', String(position));
    horizontal.setAttribute('class', `grid-line${isOuter ? ' outer' : ''}`);
    fragment.append(horizontal);
  }

  for (const [row, col] of [
    [3, 3],
    [3, 11],
    [11, 3],
    [11, 11],
    [7, 7],
  ]) {
    const star = document.createElementNS(SVG_NS, 'circle');
    star.setAttribute('cx', String(((col + 0.5) / BOARD_SIZE) * 100));
    star.setAttribute('cy', String(((row + 0.5) / BOARD_SIZE) * 100));
    star.setAttribute('r', '0.58');
    star.setAttribute('class', 'star-point');
    fragment.append(star);
  }

  winLineElement = document.getElementById('winLine');
  winLineElement.style.display = 'none';
  els.boardLines.append(fragment);

  const cellFragment = document.createDocumentFragment();
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'cell empty';
      cell.dataset.row = String(row);
      cell.dataset.col = String(col);
      cell.tabIndex = row === 7 && col === 7 ? 0 : -1;
      cell.setAttribute('aria-label', `第 ${row + 1} 行，第 ${col + 1} 列，空`);
      cells.push(cell);
      cellFragment.append(cell);
    }
  }
  els.cellsLayer.append(cellFragment);
}

function cellAt(index) {
  return cells[index];
}

function focusBoardCell(row, col) {
  const clampedRow = Math.max(0, Math.min(BOARD_SIZE - 1, row));
  const clampedCol = Math.max(0, Math.min(BOARD_SIZE - 1, col));
  state.focus = { row: clampedRow, col: clampedCol };
  for (const cell of cells) cell.tabIndex = -1;
  const target = cells[clampedRow * BOARD_SIZE + clampedCol];
  target.tabIndex = 0;
  target.focus({ preventScroll: false });
}

function handleCellKeydown(event) {
  const cell = event.target.closest('.cell');
  if (!cell) return;
  const row = Number(cell.dataset.row);
  const col = Number(cell.dataset.col);
  let next = null;
  switch (event.key) {
    case 'ArrowUp':
    case 'w':
    case 'W':
      next = [row - 1, col];
      break;
    case 'ArrowDown':
    case 's':
    case 'S':
      next = [row + 1, col];
      break;
    case 'ArrowLeft':
    case 'a':
    case 'A':
      next = [row, col - 1];
      break;
    case 'ArrowRight':
    case 'd':
    case 'D':
      next = [row, col + 1];
      break;
    case 'Home':
      next = [row, 0];
      break;
    case 'End':
      next = [row, BOARD_SIZE - 1];
      break;
    default:
      return;
  }
  event.preventDefault();
  focusBoardCell(next[0], next[1]);
}

function handleCellClick(event) {
  const cell = event.target.closest('.cell');
  if (!cell) return;
  ensureAudio();
  const row = Number(cell.dataset.row);
  const col = Number(cell.dataset.col);
  state.focus = { row, col };
  for (const item of cells) item.tabIndex = -1;
  cell.tabIndex = 0;
  requestMove(row, col);
}

function renderGomokuBoard(room) {
  const previous = state.rendered;
  const isNewMove =
    room.lastMove &&
    (previous.code !== room.code ||
      previous.round !== room.round ||
      previous.moveCount !== room.moveCount);

  const active =
    room.status === 'playing' &&
    room.turn === room.yourColor &&
    allConnected(room) &&
    !state.reconnecting;

  els.board.classList.toggle('is-active', active);
  els.board.classList.toggle('turn-black', room.turn === CPU.BLACK);
  els.board.classList.toggle('turn-white', room.turn === CPU.WHITE);
  els.board.setAttribute(
    'aria-label',
    `15 乘 15 五子棋棋盘，${room.moveCount} 手，${
      room.status === 'ended' ? '对局结束' : `轮到${colorName(room.turn)}`
    }`
  );

  const winningSet = new Set(
    (room.winningLine || []).map((point) => point.row * BOARD_SIZE + point.col)
  );
  const lastIndex = room.lastMove
    ? room.lastMove.row * BOARD_SIZE + room.lastMove.col
    : -1;

  const fragment = document.createDocumentFragment();
  for (let index = 0; index < CELL_COUNT; index += 1) {
    const value = room.board[index];
    if (!value) continue;
    const row = Math.floor(index / BOARD_SIZE);
    const col = index % BOARD_SIZE;
    const stone = document.createElement('span');
    stone.className = `stone ${value === CPU.BLACK ? 'black' : 'white'}`;
    stone.style.left = `${((col + 0.5) / BOARD_SIZE) * 100}%`;
    stone.style.top = `${((row + 0.5) / BOARD_SIZE) * 100}%`;
    if (index === lastIndex) {
      stone.classList.add('last');
      if (isNewMove) stone.classList.add('just-placed');
    }
    if (winningSet.has(index)) stone.classList.add('win');
    fragment.append(stone);
  }
  els.stonesLayer.replaceChildren(fragment);

  for (let index = 0; index < CELL_COUNT; index += 1) {
    const cell = cellAt(index);
    const value = room.board[index];
    const row = Math.floor(index / BOARD_SIZE);
    const col = index % BOARD_SIZE;
    cell.classList.toggle('empty', value === 0);
    cell.classList.toggle('occupied', value !== 0);
    cell.setAttribute('aria-disabled', value === 0 ? 'false' : 'true');
    cell.setAttribute(
      'aria-label',
      `第 ${row + 1} 行，第 ${col + 1} 列，${
        value === 0 ? '空' : value === CPU.BLACK ? '黑子' : '白子'
      }`
    );
  }

  if (room.winningLine && room.winningLine.length >= 2) {
    const first = room.winningLine[0];
    const last = room.winningLine[room.winningLine.length - 1];
    const unit = 100 / BOARD_SIZE;
    const x1 = (first.col + 0.5) * unit;
    const y1 = (first.row + 0.5) * unit;
    const dx = (last.col - first.col) * unit;
    const dy = (last.row - first.row) * unit;
    const length = Math.hypot(dx, dy);
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;

    winLineElement.style.left = `${x1}%`;
    winLineElement.style.top = `calc(${y1}% - 2px)`;
    winLineElement.style.width = `${length}%`;
    winLineElement.style.transform = `rotate(${angle}deg)`;
    winLineElement.style.display = 'block';

    const resultKey = `${room.code}:${room.round}:${first.row}:${first.col}:${last.row}:${last.col}`;
    if (state.lastResultKey !== resultKey) {
      state.lastResultKey = resultKey;
      winLineElement.style.animation = 'none';
      void winLineElement.getBoundingClientRect();
      winLineElement.style.animation = '';
    }
  } else {
    winLineElement.style.display = 'none';
  }

  if (room.status === 'waiting') {
    els.boardLock.hidden = false;
    els.boardLockTitle.textContent = '等待棋友入座';
    els.boardLockText.textContent = '邀请链接已准备好，对方加入后会立即开局';
  } else if (room.status === 'playing' && !allConnected(room)) {
    els.boardLock.hidden = false;
    els.boardLockTitle.textContent = '对手暂时离线';
    els.boardLockText.textContent = '棋局已暂停，等待对方重新连接…';
  } else {
    els.boardLock.hidden = true;
  }

  if (room.status === 'ended') {
    els.resultRibbon.hidden = false;
    els.resultRibbonText.textContent = resultSummary(room);
  } else {
    els.resultRibbon.hidden = true;
  }

  if (room.lastMove) {
    els.lastMoveLabel.textContent = `上一手 ${coordinateLabel(
      room.lastMove.row,
      room.lastMove.col
    )} · ${COLOR_SHORT[room.lastMove.color]}`;
  } else {
    els.lastMoveLabel.textContent = '上一手 —';
  }

  state.rendered = {
    code: room.code,
    round: room.round,
    moveCount: room.moveCount,
    lastMoveNumber: room.lastMove ? room.lastMove.moveNumber : null,
  };
}

function renderBoard(room) {
  const checkers = isCheckers(room);
  const poker = isPoker(room);
  els.boardShell.hidden = checkers || poker;
  els.checkersShell.hidden = !checkers;
  els.pokerShell.hidden = !poker;
  els.boardSizeLabel.textContent = checkers
    ? '六角星 · 121 洞'
    : poker
      ? '单挑 · 无限注'
      : '15 × 15';
  els.firstMoveLabel.textContent = checkers
    ? '黑方先走'
    : poker
      ? '盲注 0.5 / 1 BB'
      : '黑方先行';
  els.footerRuleLabel.textContent = gameInfo(roomGame(room)).footer;
  if (!poker) {
    els.gtoPanel.hidden = true;
    els.pokerControls.hidden = true;
    stopPokerCountdown();
  }

  if (checkers) {
    renderCheckersBoard(room);
  } else if (poker) {
    hideChainBar();
    renderPokerTable(room);
  } else {
    hideChainBar();
    renderGomokuBoard(room);
  }
}

function resultSummary(room) {
  if (room.status !== 'ended') return '';
  if (isCheckers(room)) {
    if (room.endReason === 'resign') return `${colorName(room.winner)}胜 · 对手认输`;
    return `${colorName(room.winner)}送达`;
  }
  if (!room.winner) return '和棋 · 棋盘已满';
  if (room.endReason === 'resign') return `${colorName(room.winner)}胜 · 对手认输`;
  return `${colorName(room.winner)}五连`;
}

function checkersResultSummary(room) {
  if (room.status !== 'ended') return '';
  if (room.endReason === 'resign') return `${colorName(room.winner)}胜 · 对手认输`;
  return `${colorName(room.winner)} · 十子抵达`;
}

/* --------------------------------------------------------------------------
 * Chinese checkers board and interaction
 * ------------------------------------------------------------------------ */

function svgElement(tag, attributes = {}) {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, String(value));
  }
  return element;
}

function addSvgGradient(defs, id, stops, attributes = {}) {
  const gradient = svgElement('radialGradient', { id, ...attributes });
  for (const [offset, color] of stops) {
    gradient.append(svgElement('stop', { offset, 'stop-color': color }));
  }
  defs.append(gradient);
}

function convexHull(points) {
  const sorted = [...points].sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]));
  if (sorted.length <= 2) return sorted;
  const cross = (o, a, b) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
      lower.pop();
    }
    lower.push(point);
  }
  const upper = [];
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
      upper.pop();
    }
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function zonePolygonPoints(layout, indices, expansion = 1.12) {
  const points = indices.map((index) => {
    const hole = layout.holes[index];
    return [hole.sx, hole.sy];
  });
  const hull = convexHull(points);
  const center = hull.reduce(
    (acc, [x, y]) => [acc[0] + x / hull.length, acc[1] + y / hull.length],
    [0, 0]
  );
  return hull
    .map(([x, y]) => {
      const px = center[0] + (x - center[0]) * expansion;
      const py = center[1] + (y - center[1]) * expansion;
      return `${px.toFixed(1)},${py.toFixed(1)}`;
    })
    .join(' ');
}

function buildCheckersBoard() {
  if (state.checkers.built || !Checkers) return;
  const layout = getCheckersLayout();
  if (!layout) return;

  const svg = els.checkersSvg;
  svg.replaceChildren();
  svg.setAttribute('viewBox', `0 0 ${layout.viewBox} ${layout.viewBox}`);

  const defs = svgElement('defs');
  addSvgGradient(
    defs,
    'checkersWood',
    [
      ['0', '#efd09d'],
      ['0.42', '#ddb679'],
      ['0.76', '#c79553'],
      ['1', '#a96f31'],
    ],
    { cx: '34%', cy: '20%', r: '92%' }
  );
  addSvgGradient(
    defs,
    'checkersHole',
    [
      ['0', '#3d2510'],
      ['0.6', '#251509'],
      ['1', '#120a04'],
    ],
    { cx: '50%', cy: '35%', r: '78%' }
  );
  addSvgGradient(
    defs,
    'checkersBlackMarble',
    [
      ['0', '#7d857f'],
      ['0.22', '#3b423d'],
      ['0.58', '#171c18'],
      ['1', '#030504'],
    ],
    { cx: '33%', cy: '24%', r: '78%' }
  );
  addSvgGradient(
    defs,
    'checkersWhiteMarble',
    [
      ['0', '#ffffff'],
      ['0.38', '#f7f1e6'],
      ['0.74', '#ddd4c3'],
      ['1', '#bcb19d'],
    ],
    { cx: '33%', cy: '24%', r: '78%' }
  );

  const pieceShadow = svgElement('filter', {
    id: 'checkersPieceShadow',
    x: '-80%',
    y: '-80%',
    width: '260%',
    height: '260%',
  });
  pieceShadow.append(
    svgElement('feDropShadow', {
      dx: '0',
      dy: '7',
      stdDeviation: '5',
      'flood-color': '#000000',
      'flood-opacity': '0.48',
    })
  );
  defs.append(pieceShadow);

  const starShadow = svgElement('filter', {
    id: 'checkersStarShadow',
    x: '-30%',
    y: '-30%',
    width: '160%',
    height: '160%',
  });
  starShadow.append(
    svgElement('feDropShadow', {
      dx: '0',
      dy: '16',
      stdDeviation: '13',
      'flood-color': '#000000',
      'flood-opacity': '0.5',
    })
  );
  defs.append(starShadow);
  svg.append(defs);

  const star = svgElement('polygon', {
    points: layout.starPoints,
    fill: 'url(#checkersWood)',
    class: 'checkers-star',
    filter: 'url(#checkersStarShadow)',
    'stroke-linejoin': 'round',
  });
  svg.append(star);

  const starInner = svgElement('polygon', {
    points: layout.starPoints,
    class: 'checkers-star-inner',
    transform: 'translate(500 500) scale(0.985) translate(-500 -500)',
  });
  const starRim = svgElement('polygon', {
    points: layout.starPoints,
    class: 'checkers-star-rim',
    transform: 'translate(500 500) scale(0.973) translate(-500 -500)',
  });
  svg.append(starRim, starInner);

  const zonesLayer = svgElement('g', { class: 'checkers-zones' });
  const zones = {};
  for (const color of [1, 2]) {
    const polygon = svgElement('polygon', {
      points: zonePolygonPoints(layout, layout.homeIndices[color]),
      class: 'checkers-home-zone',
      'data-color': color,
      fill: color === 1 ? 'rgba(8, 14, 10, 0.18)' : 'rgba(250, 242, 226, 0.07)',
      stroke: 'rgba(255, 239, 209, 0.13)',
    });
    zones[color] = polygon;
    zonesLayer.append(polygon);
  }
  svg.append(zonesLayer);

  const holesLayer = svgElement('g', { class: 'checkers-holes' });
  const holeElements = [];
  for (const hole of layout.holes) {
    const group = svgElement('g', {
      class: 'checkers-hole',
      'data-index': hole.index,
    });
    group.append(
      svgElement('circle', {
        cx: hole.sx,
        cy: hole.sy,
        r: 11.5,
        class: 'checkers-hole-floor',
      })
    );
    group.append(
      svgElement('circle', {
        cx: hole.sx,
        cy: hole.sy,
        r: 22,
        class: 'checkers-hole-hit',
      })
    );
    holeElements[hole.index] = group;
    holesLayer.append(group);
  }
  svg.append(holesLayer);

  const markersLayer = svgElement('g', { class: 'checkers-markers' });
  const piecesLayer = svgElement('g', { class: 'checkers-pieces' });
  svg.append(markersLayer, piecesLayer);

  checkersElements = {
    layout,
    holes: holeElements,
    zones,
    markers: markersLayer,
    pieces: piecesLayer,
  };
  state.checkers.built = true;
}

function resetCheckersSelection() {
  state.checkers.selected = null;
  state.checkers.pending = null;
  state.checkers.moves = { steps: [], jumps: [] };
  hideChainBar();
}

function hideChainBar() {
  if (!els.chainBar) return;
  els.chainBar.hidden = true;
  els.body.classList.remove('is-chaining');
}

function showChainBar(count) {
  els.chainCount.textContent = String(count);
  els.chainBar.hidden = false;
  els.body.classList.add('is-chaining');
}

function getCheckersLegalMoves(board, index) {
  if (!Checkers || !checkersElements) return { steps: [], jumps: [] };
  return Checkers.getLegalMoves(checkersElements.layout, board, index);
}

function updateCheckersHint() {
  const room = state.room;
  if (!room || !isCheckers(room) || room.status !== 'playing' || !allConnected(room)) return;
  if (room.turn !== room.yourColor) {
    const opponent = opponentOf(room);
    els.statusSub.textContent = `${opponent ? opponent.name : '对手'}正在思考…`;
    return;
  }
  const pending = state.checkers.pending;
  if (pending && pending.submitted) {
    els.statusSub.textContent = '正在提交走子…';
  } else if (pending) {
    els.statusSub.textContent = `连跳中 · 已跳 ${pending.path.length} 步，可继续或结束回合`;
  } else if (state.checkers.selected != null) {
    els.statusSub.textContent = '选择落点 · 实心点为单步，圆圈为跳跃';
  } else {
    els.statusSub.textContent = `你执${colorName(room.yourColor)} · 送子到对面阵营`;
  }
}

function makeCheckersPiece(hole, color, isJustMoved) {
  const circle = svgElement('circle', {
    cx: hole.sx,
    cy: hole.sy,
    r: 20.5,
    class: `checkers-piece ${color === CPU.BLACK ? 'black' : 'white'}${
      isJustMoved ? ' is-just-moved' : ''
    }`,
  });
  return circle;
}

function renderCheckersBoard(room) {
  if (!Checkers) {
    toast('中国跳棋模块加载失败，请刷新页面', 'error');
    return;
  }
  buildCheckersBoard();
  if (!checkersElements) return;
  const layout = checkersElements.layout;
  const pending = state.checkers.pending;
  const board = pending ? pending.board : room.board;
  const active =
    room.status === 'playing' &&
    room.turn === room.yourColor &&
    allConnected(room) &&
    !state.reconnecting &&
    !(pending && pending.submitted);
  const selected =
    active && !pending
      ? state.checkers.selected
      : active && pending
        ? pending.current
        : null;

  els.checkersBoard.classList.toggle('is-active', active);
  els.checkersBoard.setAttribute(
    'aria-label',
    `中国跳棋六角星棋盘，${layout.holeCount} 个棋位，${room.moveCount} 回合，${
      room.status === 'ended' ? '对局结束' : `轮到${colorName(room.turn)}`
    }`
  );

  const targetZoneColor = room.yourColor ? otherColor(room.yourColor) : 0;
  for (const color of [1, 2]) {
    const zone = checkersElements.zones[color];
    if (!zone) continue;
    zone.classList.toggle('is-target', active && color === targetZoneColor);
  }

  const targetSet = new Set(layout.targetIndices[room.yourColor] || []);
  const actionSet = new Set();
  if (selected != null) {
    const legal = pending
      ? { steps: [], jumps: pending.jumps }
      : state.checkers.moves;
    for (const target of legal.steps || []) actionSet.add(target);
    for (const jump of legal.jumps || []) actionSet.add(jump.to ?? jump);
  }

  for (let index = 0; index < layout.holeCount; index += 1) {
    const hole = checkersElements.holes[index];
    hole.classList.toggle('is-own', board[index] === room.yourColor);
    hole.classList.toggle('is-target', targetSet.has(index));
    hole.classList.toggle('is-actionable', actionSet.has(index));
  }

  const moveKey = `${room.code}:${room.round}:${room.moveCount}:${
    room.lastMove && room.lastMove.to != null ? room.lastMove.to : 'none'
  }`;
  const isNewMove = state.checkers.lastMoveKey !== moveKey;
  state.checkers.lastMoveKey = moveKey;

  const pieceFragment = document.createDocumentFragment();
  const lastTo =
    !pending && room.lastMove && Number.isInteger(room.lastMove.to)
      ? room.lastMove.to
      : null;
  for (let index = 0; index < layout.holeCount; index += 1) {
    const color = board[index];
    if (!color) continue;
    const isJustMoved =
      (pending && index === pending.current) ||
      (!pending && isNewMove && index === lastTo);
    pieceFragment.append(makeCheckersPiece(layout.holes[index], color, isJustMoved));
  }
  checkersElements.pieces.replaceChildren(pieceFragment);

  const markerFragment = document.createDocumentFragment();
  if (lastTo != null) {
    markerFragment.append(
      svgElement('circle', {
        cx: layout.holes[lastTo].sx,
        cy: layout.holes[lastTo].sy,
        r: 25,
        class: 'checkers-last-ring',
      })
    );
  }
  if (selected != null) {
    markerFragment.append(
      svgElement('circle', {
        cx: layout.holes[selected].sx,
        cy: layout.holes[selected].sy,
        r: 27,
        class: 'checkers-selection',
      })
    );
    if (pending) {
      for (const jump of pending.jumps) {
        markerFragment.append(
          svgElement('circle', {
            cx: layout.holes[jump.to].sx,
            cy: layout.holes[jump.to].sy,
            r: 14,
            class: 'checkers-marker-jump',
          })
        );
      }
    } else {
      for (const target of state.checkers.moves.steps) {
        markerFragment.append(
          svgElement('circle', {
            cx: layout.holes[target].sx,
            cy: layout.holes[target].sy,
            r: 9,
            class: 'checkers-marker-step',
          })
        );
      }
      for (const jump of state.checkers.moves.jumps) {
        markerFragment.append(
          svgElement('circle', {
            cx: layout.holes[jump.to].sx,
            cy: layout.holes[jump.to].sy,
            r: 14,
            class: 'checkers-marker-jump',
          })
        );
      }
    }
  }
  checkersElements.markers.replaceChildren(markerFragment);

  els.checkersRibbon.hidden = room.status !== 'ended';
  if (room.status === 'ended') {
    els.checkersRibbonText.textContent = checkersResultSummary(room);
  }

  if (room.status === 'waiting') {
    els.checkersLock.hidden = false;
    els.checkersLockTitle.textContent = '等待棋友入座';
    els.checkersLockText.textContent = '邀请链接已准备好，对方加入后会立即开局';
  } else if (room.status === 'playing' && !allConnected(room)) {
    els.checkersLock.hidden = false;
    els.checkersLockTitle.textContent = '对手暂时离线';
    els.checkersLockText.textContent = '棋局已暂停，等待对方重新连接…';
  } else {
    els.checkersLock.hidden = true;
  }

  if (pending && !pending.submitted) {
    showChainBar(pending.path.length);
    els.lastMoveLabel.textContent = `连跳中 · 已跳 ${pending.path.length} 步`;
  } else {
    hideChainBar();
    if (room.lastMove) {
      const desc =
        room.lastMove.type === 'jump'
          ? room.lastMove.jumps > 1
            ? `连跳 ${room.lastMove.jumps} 步`
            : '跳跃'
          : '移动';
      els.lastMoveLabel.textContent = `上一手 ${COLOR_SHORT[room.lastMove.color]}方 · ${desc}`;
    } else {
      els.lastMoveLabel.textContent = '上一手 —';
    }
  }

  updateCheckersHint();
}

function checkersCanAct() {
  const room = state.room;
  return Boolean(
    room &&
      isCheckers(room) &&
      room.status === 'playing' &&
      room.turn === room.yourColor &&
      allConnected(room) &&
      !state.reconnecting &&
      !state.movePending
  );
}

function handleCheckersHoleClick(event) {
  const hit = event.target.closest('.checkers-hole-hit');
  if (!hit) return;
  const group = hit.closest('.checkers-hole');
  if (!group) return;
  const index = Number(group.dataset.index);
  const room = state.room;
  if (!checkersCanAct()) return;

  const pending = state.checkers.pending;
  if (pending) {
    if (pending.submitted) return;
    const jump = pending.jumps.find((entry) => entry.to === index);
    if (!jump) return;
    advanceCheckersJump(jump);
    return;
  }

  if (room.board[index] === room.yourColor) {
    const moves = getCheckersLegalMoves(room.board, index);
    state.checkers.selected = index;
    state.checkers.moves = moves;
    if (!moves.steps.length && !moves.jumps.length) {
      toast('这枚棋子暂时无法移动');
    }
    renderCheckersBoard(room);
    return;
  }

  if (state.checkers.selected == null) return;
  const selected = state.checkers.selected;
  const isStep = state.checkers.moves.steps.includes(index);
  const jump = state.checkers.moves.jumps.find((entry) => entry.to === index);

  if (isStep) {
    submitCheckersMove(selected, [index], room);
    return;
  }
  if (jump) {
    startCheckersJump(selected, jump, room);
    return;
  }
  if (room.board[index] === 0) {
    state.checkers.selected = null;
    state.checkers.moves = { steps: [], jumps: [] };
    renderCheckersBoard(room);
  }
}

function startCheckersJump(from, jump, room) {
  const layout = checkersElements.layout;
  const board = new Uint8Array(room.board);
  board[from] = 0;
  board[jump.to] = room.yourColor;
  const visited = new Set([from, jump.to]);
  const nextJumps = layout.jumps[jump.to].filter(
    (candidate) =>
      board[candidate.over] !== 0 &&
      board[candidate.to] === 0 &&
      !visited.has(candidate.to)
  );
  state.checkers.pending = {
    from,
    current: jump.to,
    path: [jump.to],
    board,
    visited,
    jumps: nextJumps,
    submitted: false,
    color: room.yourColor,
  };
  state.checkers.selected = jump.to;
  state.checkers.moves = { steps: [], jumps: nextJumps };
  if (nextJumps.length === 0) {
    submitCheckersMove(from, [jump.to], room);
    return;
  }
  renderCheckersBoard(room);
}

function advanceCheckersJump(jump) {
  const room = state.room;
  const pending = state.checkers.pending;
  if (!room || !pending || pending.submitted) return;
  if (pending.board[jump.over] === 0 || pending.board[jump.to] !== 0) return;

  pending.board[pending.current] = 0;
  pending.board[jump.to] = pending.color;
  pending.current = jump.to;
  pending.path.push(jump.to);
  pending.visited.add(jump.to);

  const nextJumps = checkersElements.layout.jumps[jump.to].filter(
    (candidate) =>
      pending.board[candidate.over] !== 0 &&
      pending.board[candidate.to] === 0 &&
      !pending.visited.has(candidate.to)
  );
  pending.jumps = nextJumps;
  state.checkers.selected = jump.to;
  state.checkers.moves = { steps: [], jumps: nextJumps };

  if (nextJumps.length === 0) {
    submitCheckersMove(pending.from, pending.path.slice(), room);
    return;
  }
  renderCheckersBoard(room);
}

function submitCheckersMove(from, path, room) {
  if (state.movePending || !Array.isArray(path) || path.length === 0) return;
  const pending = state.checkers.pending;
  if (pending) pending.submitted = true;
  state.movePending = true;
  window.clearTimeout(state.moveTimer);
  state.moveTimer = window.setTimeout(() => {
    state.movePending = false;
  }, 1800);

  if (!sendMessage({ type: 'move', from, path })) {
    state.movePending = false;
    resetCheckersSelection();
    if (room) renderCheckersBoard(room);
    toast('连接断开，正在重连…', 'error');
    return;
  }
  hideChainBar();
  if (room) renderCheckersBoard(room);
}

function endCheckersChain() {
  const pending = state.checkers.pending;
  const room = state.room;
  if (!pending || pending.submitted || !room) return;
  submitCheckersMove(pending.from, pending.path.slice(), room);
}

/* --------------------------------------------------------------------------
 * Heads-up Texas Hold'em
 * ------------------------------------------------------------------------ */

function pokerCardElement(card, options = {}) {
  const element = document.createElement('div');
  element.className = 'playing-card';
  if (options.empty) {
    element.classList.add('is-empty');
    return element;
  }
  if (options.hidden) {
    element.classList.add('is-back');
    return element;
  }
  if (!card || !Poker) {
    element.classList.add('is-empty');
    return element;
  }
  if (Poker.isRed(card)) element.classList.add('is-red');
  if (options.winning) element.classList.add('is-winning');
  const rank = document.createElement('span');
  rank.className = 'card-rank';
  rank.textContent = Poker.rankLabel(card);
  const suit = document.createElement('span');
  suit.className = 'card-suit';
  suit.textContent = Poker.suitSymbol(card);
  element.append(rank, suit);
  return element;
}

function renderPokerCardRow(container, cards, options = {}) {
  const slots = options.slots ?? cards.length;
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < slots; index += 1) {
    const card = cards[index];
    if (card) {
      fragment.append(
        pokerCardElement(card, {
          winning: options.winningSet && options.winningSet.has(card),
        })
      );
    } else if (options.faceDown) {
      fragment.append(pokerCardElement(null, { hidden: true }));
    } else {
      fragment.append(pokerCardElement(null, { empty: true }));
    }
  }
  container.replaceChildren(fragment);
}

function pokerActionLabel(action) {
  if (!action) return '';
  const name = `${COLOR_SHORT[action.color]}方`;
  const bb = pokerBb(action.amount || action.pay || 0);
  switch (action.action) {
    case 'small_blind':
      return `${name} 小盲 ${bb} BB`;
    case 'big_blind':
      return `${name} 大盲 ${bb} BB`;
    case 'fold':
      return `${name} 弃牌`;
    case 'check':
      return `${name} 过牌`;
    case 'call':
      return `${name} 跟注 ${bb} BB`;
    case 'bet':
      return `${name} 下注 ${bb} BB`;
    case 'raise':
      return `${name} 加注到 ${bb} BB`;
    case 'allin':
      return `${name} All-in ${bb} BB`;
    case 'allin_call':
      return `${name} All-in 跟注 ${bb} BB`;
    default:
      return name;
  }
}

function pokerHandLabel(room, color) {
  if (!room.poker || !room.poker.result) return '';
  const hand = room.poker.result.hands && room.poker.result.hands[color];
  return hand ? hand.name : '';
}

function updatePokerCountdown() {
  if (!els.pokerResultCountdown) return;
  const { nextHandAt, serverNow, receivedAt } = state.poker;
  if (!nextHandAt || !serverNow) {
    els.pokerResultCountdown.textContent = '';
    return;
  }
  const estimatedServerNow = serverNow + (Date.now() - receivedAt);
  const remaining = Math.max(0, Math.ceil((nextHandAt - estimatedServerNow) / 1000));
  els.pokerResultCountdown.textContent =
    remaining > 0 ? `下一手将在 ${remaining} 秒后开始` : '下一手即将开始…';
}

function stopPokerCountdown() {
  if (state.poker.countdownTimer) {
    window.clearInterval(state.poker.countdownTimer);
    state.poker.countdownTimer = null;
  }
}

function startPokerCountdown(room) {
  stopPokerCountdown();
  const p = room.poker;
  if (!p || !p.nextHandAt) {
    state.poker.nextHandAt = null;
    els.pokerResultCountdown.textContent =
      room.status === 'ended'
        ? '点击「再来一局」重新开始'
        : p.stage === 'handComplete' && !allConnected(room)
          ? '等待对手重连后开始下一手'
          : '';
    return;
  }
  state.poker.nextHandAt = p.nextHandAt;
  state.poker.serverNow = p.serverNow;
  state.poker.receivedAt = Date.now();
  updatePokerCountdown();
  state.poker.countdownTimer = window.setInterval(updatePokerCountdown, 500);
}

function renderPokerResult(room) {
  const p = room.poker;
  const result = p.result;
  const ended = room.status === 'ended';
  const show = ended || p.stage === 'handComplete' || p.stage === 'matchOver';
  els.pokerResultPanel.hidden = !show;
  if (!show) {
    stopPokerCountdown();
    return;
  }

  const viewerColor = room.yourColor;
  const opponentColor = otherColor(viewerColor);
  let kicker = ended ? 'MATCH OVER' : 'HAND COMPLETE';
  let title = ended ? '牌局结束' : '本手结束';
  let detail = '';

  if (ended) {
    if (room.winner === viewerColor) {
      title = '你赢得整局';
      detail = `对手筹码归零 · 你剩下 ${pokerBb(p.stacks[viewerColor])} BB`;
    } else if (room.winner === 0) {
      title = '牌局结束';
      detail = '双方筹码归零';
    } else {
      title = '筹码清零';
      detail = `对手赢得整局 · 你剩下 ${pokerBb(p.stacks[viewerColor])} BB`;
    }
  } else if (p.stage === 'matchOver') {
    kicker = 'MATCH OVER';
    title = '牌局结束';
    detail = '筹码已经清零';
  } else if (result) {
    const potText = `底池 ${pokerBb(result.pot)} BB`;
    if (result.reason === 'split') {
      title = '平分底池';
      detail = `${potText} · 双方牌力相同`;
    } else if (result.winnerColor === viewerColor) {
      title = result.reason === 'fold' ? '对手弃牌' : '本手胜出';
      detail = `${potText} · 你赢得这手牌`;
    } else {
      title = result.reason === 'fold' ? '你弃牌' : '本手落败';
      detail = `${potText} · 对手赢得这手牌`;
    }
    if (result.reason !== 'fold' && result.hands) {
      detail += ` · 你：${result.hands[viewerColor]?.name || '—'} / 对手：${
        result.hands[opponentColor]?.name || '—'
      }`;
    }
  }

  els.pokerResultKicker.textContent = kicker;
  els.pokerResultTitle.textContent = title;
  els.pokerResultDetail.textContent = detail;

  const handFragment = document.createDocumentFragment();
  if (result && result.reveal && result.hands) {
    for (const color of [viewerColor, opponentColor]) {
      if (!result.hands[color]) continue;
      const row = document.createElement('span');
      const label = document.createElement('b');
      label.textContent = color === viewerColor ? '你' : '对手';
      const value = document.createElement('strong');
      value.textContent = result.hands[color].name;
      row.append(label, value);
      handFragment.append(row);
    }
  }
  els.pokerResultHands.replaceChildren(handFragment);
  startPokerCountdown(room);
}

function renderPokerControls(room) {
  const p = room.poker;
  const activeStage = ['preflop', 'flop', 'turn', 'river'].includes(p.stage);
  const show = room.status === 'playing' && activeStage && allConnected(room);
  els.pokerControls.hidden = !show;
  els.gtoPanel.hidden = false;
  if (!show) {
    state.poker.raiseOpen = false;
    els.pokerRaiseBox.hidden = true;
    return;
  }

  const available = p.availableActions || {};
  const myTurn =
    available.isTurn &&
    p.actor === room.yourColor &&
    !state.poker.actionPending &&
    !state.reconnecting;
  const toCall = available.toCall || 0;
  const bb = p.bigBlind || 100;
  const canRaiseAction = Boolean(myTurn && (available.canBet || available.canRaise));

  els.pokerFoldButton.disabled = !myTurn;
  els.pokerCheckButton.disabled = !myTurn || !available.canCheck;
  els.pokerCallButton.disabled = !myTurn || !available.canCall;
  els.pokerCallAmount.textContent =
    available.canCall && available.callAmount > 0
      ? `${pokerBb(available.callAmount)} BB`
      : '—';
  els.pokerRaiseToggle.disabled = !canRaiseAction;
  els.pokerRaiseToggle.textContent = available.canBet ? '下注' : '加注';
  els.pokerRaiseToggle.classList.toggle('is-open', state.poker.raiseOpen);

  els.pokerCallInfo.textContent = myTurn
    ? toCall > 0
      ? `底池 ${pokerBb(p.pot)} BB · 需跟注 ${pokerBb(toCall)} BB`
      : `底池 ${pokerBb(p.pot)} BB · 可以过牌`
    : `底池 ${pokerBb(p.pot)} BB · 等待对手`;

  const hint = state.poker.actionPending
    ? '正在提交行动…'
    : myTurn
      ? '轮到你行动 · 选择弃牌、过牌/跟注或下注'
      : '等待对手行动';
  els.pokerActionHint.textContent = hint;

  if (!canRaiseAction) state.poker.raiseOpen = false;
  els.pokerRaiseBox.hidden = !state.poker.raiseOpen || !canRaiseAction;
  if (els.pokerRaiseBox.hidden) return;

  const minChips = Math.max(bb, available.minRaiseTo || bb);
  const maxChips = Math.max(minChips, available.maxRaiseTo || minChips);
  const defaultTarget = available.canBet
    ? Math.min(maxChips, Math.max(minChips, Math.round(p.pot * 0.66)))
    : Math.min(
        maxChips,
        Math.max(minChips, p.currentBet + Math.round(p.pot * 0.7))
      );
  const target = Math.max(
    minChips,
    Math.min(maxChips, state.poker.raiseTarget || defaultTarget)
  );
  state.poker.raiseTarget = target;
  els.pokerRaiseSlider.min = String(minChips / 100);
  els.pokerRaiseSlider.max = String(maxChips / 100);
  els.pokerRaiseSlider.step = '0.5';
  els.pokerRaiseSlider.value = String(target / 100);
  els.pokerRaiseAmount.textContent = `${pokerBb(target)} BB`;
  els.pokerRaiseConfirm.textContent = `${
    available.canBet ? '下注' : '加注到'
  } ${pokerBb(target)} BB`;
}

function setPokerRaiseTarget(target) {
  const room = state.room;
  if (!room || !room.poker) return;
  const p = room.poker;
  const available = p.availableActions || {};
  if (!available.maxRaiseTo) return;
  const min = Math.max(p.bigBlind, available.minRaiseTo || p.bigBlind);
  const max = Math.max(min, available.maxRaiseTo);
  const clamped = Math.max(min, Math.min(max, Math.round(target)));
  state.poker.raiseTarget = clamped;
  els.pokerRaiseSlider.value = String(clamped / 100);
  els.pokerRaiseAmount.textContent = `${pokerBb(clamped)} BB`;
  els.pokerRaiseConfirm.textContent = `${
    available.canBet ? '下注' : '加注到'
  } ${pokerBb(clamped)} BB`;
}

function pokerPotFractionTarget(room, fraction) {
  const p = room.poker;
  const available = p.availableActions || {};
  if (fraction === 'allin') return available.maxRaiseTo;
  const min = Math.max(p.bigBlind, available.minRaiseTo || p.bigBlind);
  const max = Math.max(min, available.maxRaiseTo || min);
  const target = available.canBet
    ? Math.round(p.pot * Number(fraction))
    : p.currentBet + Math.round((p.pot + (available.toCall || 0)) * Number(fraction));
  return Math.max(min, Math.min(max, target));
}

function updateGtoPanel(room) {
  const p = room.poker;
  const enabled = state.poker.gtoEnabled;
  els.gtoPanel.hidden = false;
  els.gtoToggle.setAttribute('aria-pressed', String(enabled));
  els.gtoToggleLabel.textContent = enabled ? '开' : '关';
  els.gtoBody.hidden = !enabled;
  if (!enabled || !Poker) return;

  const viewerColor = room.yourColor;
  const hole = p.holeCards || [];
  const activeStage = ['preflop', 'flop', 'turn', 'river'].includes(p.stage);
  const available = p.availableActions || {};
  const key = JSON.stringify({
    stage: p.stage,
    hole,
    board: p.board,
    actor: p.actor,
    pot: p.pot,
    toCall: available.toCall,
    stack: p.stacks[viewerColor],
    currentBet: p.currentBet,
    min: available.minRaiseTo,
    max: available.maxRaiseTo,
    result: p.result ? [p.result.winnerColor, p.result.reason, p.result.handNumber] : null,
  });
  if (key === state.poker.adviceKey && state.poker.advice) {
    renderGtoAdvice(state.poker.advice, p);
    return;
  }

  let advice;
  const labelContext = {
    note: '本地 GTO 近似 · 仅供娱乐',
  };
  if (!hole.length) {
    advice = {
      action: 'wait',
      headline: '等待发牌',
      reason: '牌局还没有开始。',
      equity: null,
      requiredEquity: 0,
      frequency: null,
      ...labelContext,
    };
  } else if (room.status === 'ended' || p.stage === 'matchOver') {
    advice = {
      action: 'wait',
      headline: '牌局结束',
      reason:
        room.winner === room.yourColor
          ? '你赢下了全部筹码。'
          : '筹码已经清零，可以点击「再来一局」。',
      equity: null,
      requiredEquity: 0,
      frequency: null,
      ...labelContext,
    };
  } else if (p.stage === 'handComplete') {
    const handName = p.result?.yourHand?.name;
    advice = {
      action: 'wait',
      headline: '本手结束',
      reason: handName ? `你的最终牌型：${handName}。等待下一手。` : '等待下一手。',
      equity: null,
      requiredEquity: 0,
      frequency: null,
      ...labelContext,
    };
  } else if (activeStage && available.isTurn) {
    advice = Poker.adviseGto({
      holeCards: hole,
      board: p.board,
      stage: p.stage,
      pot: p.pot,
      toCall: available.toCall || 0,
      stack: p.stacks[viewerColor],
      currentBet: p.currentBet,
      bigBlind: p.bigBlind,
      position: p.buttonColor === viewerColor ? 'BTN' : 'BB',
      available,
      iterations: 520,
    });
  } else if (activeStage) {
    const strength =
      p.stage === 'preflop'
        ? Poker.preflopStrength(hole)
        : Poker.monteCarloEquity(hole, p.board, 420);
    const toCall = Math.max(0, p.currentBet - p.bets[viewerColor]);
    const requiredEquity = toCall > 0 ? toCall / (p.pot + toCall) : 0;
    advice = {
      action: 'wait',
      headline: '等待对手行动',
      reason:
        p.stage === 'preflop'
          ? `你当前${Poker.strengthLabel(strength)}起手牌，等待对手行动。`
          : `当前模拟胜率 ${Math.round(strength * 100)}%，等待对手行动。`,
      equity: strength,
      requiredEquity,
      frequency: null,
      handLabel: Poker.strengthLabel(strength),
      ...labelContext,
    };
  } else {
    advice = {
      action: 'wait',
      headline: '等待下一手',
      reason: '牌局即将继续。',
      equity: null,
      requiredEquity: 0,
      frequency: null,
      ...labelContext,
    };
  }
  state.poker.adviceKey = key;
  state.poker.advice = advice;
  renderGtoAdvice(advice, p);
}

function renderGtoAdvice(advice, p) {
  els.gtoAction.textContent = advice.headline || '—';
  els.gtoReason.textContent = advice.reason || '';
  const preflop = p.stage === 'preflop';
  els.gtoEquityLabel.textContent = preflop ? '强度' : '胜率';
  els.gtoEquity.textContent =
    advice.equity == null ? '—' : `${Math.round(advice.equity * 100)}%`;
  els.gtoOdds.textContent =
    advice.requiredEquity > 0
      ? `${Math.round(advice.requiredEquity * 100)}%`
      : '—';
  els.gtoFrequency.textContent =
    advice.frequency == null ? '—' : `${Math.round(advice.frequency * 100)}%`;
}

function renderPokerTable(room) {
  const p = room.poker;
  const viewerColor = room.yourColor;
  const opponentColor = otherColor(viewerColor);
  const hero = playerAt(room, viewerColor);
  const opponent = playerAt(room, opponentColor);
  const activeStage = ['preflop', 'flop', 'turn', 'river'].includes(p.stage);
  const reveal = Boolean(p.result && p.result.reveal);
  const resultHands = p.result && p.result.hands;
  const winningSet = new Set();
  if (resultHands && reveal) {
    for (const hand of Object.values(resultHands)) {
      for (const card of hand.bestFive || []) winningSet.add(card);
    }
  }

  els.pokerHeroName.textContent = hero ? hero.name : '你';
  els.pokerOpponentName.textContent = opponent ? opponent.name : '等待加入';
  els.pokerHeroStack.textContent = `${pokerBb(p.stacks[viewerColor])} BB`;
  els.pokerOpponentStack.textContent = opponent
    ? `${pokerBb(p.stacks[opponentColor])} BB`
    : '—';
  els.pokerHeroPosition.textContent =
    p.handNumber > 0 ? pokerPosition(room, viewerColor) : '—';
  els.pokerOpponentPosition.textContent =
    opponent && p.handNumber > 0 ? pokerPosition(room, opponentColor) : '—';

  renderPokerCardRow(els.pokerHeroCards, p.holeCards || [], {
    slots: 2,
    winningSet,
  });
  const opponentCards =
    reveal && Array.isArray(p.opponentHoleCards) ? p.opponentHoleCards : [];
  renderPokerCardRow(els.pokerOpponentCards, opponentCards, {
    slots: 2,
    faceDown: !reveal && p.opponentCardCount > 0,
    winningSet,
  });

  const board = p.board || [];
  renderPokerCardRow(els.pokerCommunity, board, {
    slots: 5,
    winningSet,
  });

  els.pokerPot.innerHTML = `底池 <strong>${pokerBb(p.pot)} BB</strong>`;
  els.pokerStageLabel.textContent = pokerStageName(p.stage);
  els.pokerLastAction.textContent = p.lastAction
    ? pokerActionLabel(p.lastAction)
    : p.stage === 'waiting'
      ? '对手加入后自动发牌'
      : '';

  const hasHand = p.handNumber > 0 && p.stage !== 'waiting';
  els.pokerDealerButton.hidden = !hasHand;
  els.pokerDealerButton.classList.toggle(
    'is-hero',
    hasHand && p.buttonColor === viewerColor
  );
  els.pokerDealerButton.classList.toggle(
    'is-opponent',
    hasHand && p.buttonColor !== viewerColor
  );

  const foldResult = p.result && p.result.reason === 'fold' ? p.result : null;
  const heroActive =
    activeStage &&
    p.actor === viewerColor &&
    allConnected(room) &&
    !p.result;
  const opponentActive =
    activeStage &&
    p.actor === opponentColor &&
    allConnected(room) &&
    !p.result;
  els.pokerHeroSeat.classList.toggle('is-active', heroActive);
  els.pokerOpponentSeat.classList.toggle('is-active', opponentActive);
  els.pokerHeroSeat.classList.toggle(
    'is-folded',
    Boolean(foldResult && foldResult.winnerColor !== viewerColor)
  );
  els.pokerOpponentSeat.classList.toggle(
    'is-folded',
    Boolean(foldResult && foldResult.winnerColor !== opponentColor)
  );

  const heroBet = p.bets[viewerColor] || 0;
  const opponentBet = p.bets[opponentColor] || 0;
  els.pokerHeroBet.hidden = heroBet <= 0;
  els.pokerHeroBet.textContent = heroBet > 0 ? `${pokerBb(heroBet)} BB` : '';
  els.pokerOpponentBet.hidden = opponentBet <= 0;
  els.pokerOpponentBet.textContent =
    opponentBet > 0 ? `${pokerBb(opponentBet)} BB` : '';

  renderPokerResult(room);

  els.pokerLock.hidden = !(room.status === 'waiting' || p.stage === 'waiting');
  if (!els.pokerLock.hidden) {
    els.pokerLockTitle.textContent = '等待对手入座';
    els.pokerLockText.textContent = `对手加入后自动发牌 · 双方 ${p.startingStackBb} BB`;
  }

  els.lastMoveLabel.textContent = p.lastAction
    ? `上一手 ${pokerActionLabel(p.lastAction)}`
    : hasHand
      ? `${p.handNumber} 手 · ${pokerStageName(p.stage)}`
      : '等待发牌';

  renderPokerControls(room);
  updateGtoPanel(room);
}

function sendPokerAction(action, amount = null) {
  if (state.poker.actionPending) return;
  if (!isPoker(state.room) || state.room.status !== 'playing') return;
  const payload = { type: 'pokerAction', action };
  if (Number.isFinite(amount)) payload.amount = Math.round(amount);
  state.poker.actionPending = true;
  window.clearTimeout(state.poker.actionTimer);
  state.poker.actionTimer = window.setTimeout(() => {
    state.poker.actionPending = false;
    if (state.room && isPoker(state.room)) renderPokerControls(state.room);
  }, 2200);
  if (!sendMessage(payload)) {
    state.poker.actionPending = false;
    toast('连接断开，正在重连…', 'error');
    return;
  }
  renderPokerControls(state.room);
}

/* --------------------------------------------------------------------------
 * Room UI rendering
 * ------------------------------------------------------------------------ */

function renderRoom(room) {
  if (!room) return;
  const checkers = isCheckers(room);
  const poker = isPoker(room);
  const p = room.poker;
  els.sidePanel.classList.toggle('is-poker', poker);
  els.roomCodeLabel.textContent = room.code;
  if (poker) {
    els.roundLabel.textContent =
      room.status === 'waiting'
        ? `第 ${room.round} 局 · 单挑`
        : room.status === 'ended'
          ? '牌局结束'
          : `第 ${p.handNumber} 手 · ${pokerStageName(p.stage)}`;
    els.moveCountLabel.textContent = String(p.handNumber);
    els.moveCountCaption.textContent = '手牌';
    els.roundCountLabel.textContent = '0.5 / 1';
    els.roundCaption.textContent = '盲注';
    els.phaseLabel.textContent = pokerStageName(p.stage);
    els.phaseCaption.textContent = '阶段';
    els.gameNote.hidden = true;
  } else {
    els.roundLabel.textContent =
      room.status === 'waiting'
        ? `第 ${room.round} 局 · 黑先`
        : room.status === 'ended'
          ? `第 ${room.round} 局 · 对局结束`
          : `第 ${room.round} 局 · ${colorName(room.turn)}行棋`;
    els.moveCountLabel.textContent = String(room.moveCount);
    els.moveCountCaption.textContent = checkers ? '回合' : '手数';
    els.roundCountLabel.textContent = String(room.round);
    els.roundCaption.textContent = '局数';
    els.phaseLabel.textContent =
      room.status === 'waiting' ? '等待中' : room.status === 'ended' ? '已结束' : '对局中';
    els.phaseCaption.textContent = '状态';
    els.gameNote.hidden = false;
    els.gameNoteMark.textContent = checkers ? '跳' : '五';
    els.gameNoteTitle.textContent = checkers ? '连跳无影' : '落子无悔';
    els.gameNoteText.textContent = checkers
      ? '走一步或连跳，先送完十子'
      : '横 · 竖 · 斜，先连五子者胜';
  }

  renderStatus(room);
  renderPlayers(room);
  renderActions(room);
  renderHistory(room);
  renderInvitePanel(room);
  renderBoard(room);
  updateConnectionLabel();
  updateDocumentTitle();
  updateFooter();
}

function renderPokerStatus(room) {
  const me = myPlayer(room);
  const opponent = opponentOf(room);
  const p = room.poker;
  const connected = allConnected(room);
  let kicker = 'WAITING FOR PLAYER';
  let title = '等待棋友入座';
  let subtitle = '对手加入后自动发牌';
  let stoneClass = 'waiting';
  let showWaiting = false;

  if (room.status === 'waiting' || p.stage === 'waiting') {
    showWaiting = true;
  } else if (room.status === 'ended') {
    kicker = 'MATCH OVER';
    title = room.winner === room.yourColor ? '你赢得整局' : '筹码清零';
    subtitle =
      room.winner === room.yourColor
        ? `对手筹码归零 · 你剩 ${pokerBb(p.stacks[room.yourColor])} BB`
        : `你剩 ${pokerBb(p.stacks[room.yourColor])} BB · 对手赢得本局`;
    stoneClass = room.winner === 1 ? 'black' : 'white';
    if (room.endReason === 'draw' || !room.winner) {
      title = '牌局结束';
      subtitle = '双方筹码归零';
      stoneClass = 'waiting';
    }
  } else if (p.stage === 'handComplete') {
    kicker = 'HAND COMPLETE';
    const result = p.result;
    if (!result) {
      title = '本手结束';
    } else if (result.reason === 'split') {
      title = '平分底池';
      subtitle = `底池 ${pokerBb(result.pot)} BB · 双方各取一半`;
    } else if (result.winnerColor === room.yourColor) {
      title = result.reason === 'fold' ? '对手弃牌' : '本手获胜';
      subtitle = `你赢得 ${pokerBb(result.pot)} BB 底池`;
    } else {
      title = result.reason === 'fold' ? '你弃牌' : '本手落败';
      subtitle = `对手赢得 ${pokerBb(result.pot)} BB 底池`;
    }
    stoneClass = result && result.winnerColor === 1 ? 'black' : 'white';
  } else if (!connected) {
    kicker = 'GAME PAUSED';
    title = '对手暂时离线';
    subtitle = '牌局已暂停，等待对方重新连接';
    stoneClass = 'waiting';
  } else if (p.actor === room.yourColor) {
    kicker = 'YOUR ACTION';
    title = '轮到你行动';
    const toCall = Math.max(0, p.currentBet - p.bets[room.yourColor]);
    subtitle =
      toCall > 0
        ? `底池 ${pokerBb(p.pot)} BB · 需跟注 ${pokerBb(toCall)} BB`
        : `底池 ${pokerBb(p.pot)} BB · 可以过牌或下注`;
    stoneClass = room.yourColor === 1 ? 'black' : 'white';
  } else {
    kicker = "OPPONENT'S ACTION";
    title = '等待对手行动';
    subtitle = `底池 ${pokerBb(p.pot)} BB · ${opponent ? opponent.name : '对手'}正在思考…`;
    stoneClass = p.actor === 1 ? 'black' : 'white';
  }

  if (me && me.connected === false) {
    kicker = 'RECONNECTING';
    title = '正在恢复连接';
    subtitle = '请稍候，牌局不会丢失';
  }

  els.statusKicker.textContent = kicker;
  els.statusTitle.textContent = title;
  els.statusSub.textContent = subtitle;
  els.turnStone.className = `turn-stone ${stoneClass}`;
  els.waitingDots.hidden = !showWaiting;
  els.statusCard.classList.toggle(
    'is-your-turn',
    room.status === 'playing' &&
      p.actor === room.yourColor &&
      connected &&
      p.stage !== 'handComplete'
  );
}

function renderStatus(room) {
  if (isPoker(room)) {
    renderPokerStatus(room);
    return;
  }
  const me = myPlayer(room);
  const opponent = opponentOf(room);
  const seated = bothSeated(room);
  const connected = allConnected(room);
  const checkers = isCheckers(room);
  let kicker = 'WAITING';
  let title = '房间已创建';
  let subtitle = `房间号 ${room.code} · 邀请链接已准备好`;
  let stoneClass = 'waiting';
  let showWaiting = false;

  if (room.status === 'waiting') {
    kicker = 'WAITING FOR PLAYER';
    title = '等待棋友入座';
    subtitle = '把邀请链接发给朋友，对方加入后自动开局';
    stoneClass = 'waiting';
    showWaiting = true;
  } else if (room.status === 'playing') {
    if (!seated || !connected) {
      kicker = 'GAME PAUSED';
      title = '对手暂时离线';
      subtitle = '棋局已暂停，等待对方重新连接';
      stoneClass = 'waiting';
    } else if (room.turn === room.yourColor) {
      kicker = 'YOUR TURN';
      title = checkers ? '轮到你走棋' : '轮到你落子';
      subtitle = checkers
        ? `你执${colorName(room.yourColor)} · 选择一枚棋子`
        : `你执${colorName(room.yourColor)} · 第 ${room.round} 局`;
      stoneClass = room.turn === CPU.BLACK ? 'black' : 'white';
    } else {
      kicker = "OPPONENT'S TURN";
      title = checkers ? '等待对手走棋' : '等待对手落子';
      subtitle = `${opponent ? opponent.name : '对手'}正在思考…`;
      stoneClass = room.turn === CPU.BLACK ? 'black' : 'white';
    }
  } else {
    kicker = 'GAME OVER';
    if (!room.winner) {
      title = '和棋';
      subtitle = '棋盘已满，双方平分秋色';
      stoneClass = 'waiting';
    } else if (room.winner === room.yourColor) {
      title = '你赢了';
      subtitle =
        room.endReason === 'resign'
          ? `对手认输 · 第 ${room.round} 局`
          : checkers
            ? `十子全部抵达对面 · 第 ${room.round} 局`
            : `${colorName(room.winner)}五连 · 第 ${room.round} 局`;
      stoneClass = room.winner === CPU.BLACK ? 'black' : 'white';
    } else {
      title = '你输了';
      subtitle =
        room.endReason === 'resign'
          ? `你已认输 · 第 ${room.round} 局`
          : checkers
            ? `对手十子抵达对面 · 第 ${room.round} 局`
            : `${colorName(room.winner)}五连 · 第 ${room.round} 局`;
      stoneClass = room.winner === CPU.BLACK ? 'black' : 'white';
    }
    const opponentWants = opponent && opponent.wantsRematch;
    if (opponentWants) subtitle += ' · 对手想再来一局';
  }

  if (me && me.connected === false) {
    kicker = 'RECONNECTING';
    title = '正在恢复连接';
    subtitle = '请稍候，棋局不会丢失';
  }

  els.statusKicker.textContent = kicker;
  els.statusTitle.textContent = title;
  els.statusSub.textContent = subtitle;
  els.turnStone.className = `turn-stone ${stoneClass}`;
  els.waitingDots.hidden = !showWaiting;
  els.statusCard.classList.toggle(
    'is-your-turn',
    room.status === 'playing' && room.turn === room.yourColor && connected
  );
}

function renderPlayerCard(room, color, card, nameEl, subtitleEl, youEl, stateEl) {
  const player = playerAt(room, color);
  const isMe = player && color === room.yourColor;
  const poker = isPoker(room);
  const p = poker ? room.poker : null;
  nameEl.textContent = player ? player.name : '等待加入';
  youEl.hidden = !isMe;

  let subtitle =
    color === CPU.BLACK ? '黑方 · 先手' : '白方 · 后手';
  if (poker) {
    subtitle = player
      ? `${pokerBb(p.stacks[color])} BB · ${pokerPosition(room, color)}`
      : '等待加入';
  }
  subtitleEl.textContent = subtitle;

  let stateText = '空位';
  let stateClass = '';
  if (player) {
    if (!player.connected) {
      stateText = '重连中';
      stateClass = 'is-offline';
    } else if (room.status === 'ended') {
      if (player.wantsRematch) {
        stateText = '想再来一局';
        stateClass = 'is-thinking';
      } else if (room.winner === color) {
        stateText = '胜者';
        stateClass = 'is-online';
      } else if (room.winner === 0) {
        stateText = poker ? '结束' : '和棋';
      } else {
        stateText = '已结束';
      }
    } else if (poker) {
      if (p.stage === 'waiting') {
        stateText = '在线';
        stateClass = 'is-online';
      } else if (p.stage === 'handComplete' && p.result) {
        if (p.result.split) {
          stateText = '平分';
          stateClass = 'is-online';
        } else if (p.result.winnerColor === color) {
          stateText = '本手胜';
          stateClass = 'is-online';
        } else {
          stateText = '本手负';
        }
      } else if (p.stage === 'matchOver') {
        stateText = '结束';
      } else if (p.actor === color) {
        stateText = isMe ? '请行动' : '行动中';
        stateClass = 'is-thinking';
      } else {
        stateText = '等待';
        stateClass = 'is-online';
      }
    } else if (room.status === 'playing') {
      if (room.turn === color) {
        stateText = isMe ? (isCheckers(room) ? '请走棋' : '请落子') : '思考中';
        stateClass = 'is-thinking';
      } else {
        stateText = '在线';
        stateClass = 'is-online';
      }
    } else {
      stateText = '在线';
      stateClass = 'is-online';
    }
  }

  stateEl.textContent = stateText;
  stateEl.className = `player-state${stateClass ? ` ${stateClass}` : ''}`;
  const isActive = poker
    ? (p.stage !== 'handComplete' && p.stage !== 'matchOver' && p.actor === color) ||
      (room.status === 'ended' && room.winner === color)
    : (room.status === 'playing' && room.turn === color && player) ||
      (room.status === 'ended' && room.winner === color);
  card.classList.toggle('is-active', Boolean(isActive));
}

function renderPlayers(room) {
  renderPlayerCard(
    room,
    CPU.BLACK,
    els.blackPlayerCard,
    els.blackName,
    els.blackSub,
    els.blackYou,
    els.blackState
  );
  renderPlayerCard(
    room,
    CPU.WHITE,
    els.whitePlayerCard,
    els.whiteName,
    els.whiteSub,
    els.whiteYou,
    els.whiteState
  );
}

function configureAction(button, { hidden, label, variant = 'btn-ghost', disabled }) {
  button.hidden = Boolean(hidden);
  if (hidden) return;
  button.textContent = label;
  button.className = `btn ${variant}`;
  button.disabled = Boolean(disabled);
}

function renderActions(room) {
  const connected = allConnected(room);
  const me = myPlayer(room);
  const opponent = opponentOf(room);

  if (room.status === 'waiting') {
    configureAction(els.primaryAction, {
      hidden: false,
      label: '复制邀请链接',
      variant: 'btn-primary',
    });
    configureAction(els.secondaryAction, {
      hidden: false,
      label: '关闭房间',
      variant: 'btn-ghost',
    });
    els.leaveLink.hidden = true;
    return;
  }

  if (room.status === 'playing' && isPoker(room)) {
    configureAction(els.primaryAction, { hidden: true });
    configureAction(els.secondaryAction, { hidden: true });
    els.leaveLink.hidden = false;
    return;
  }

  if (room.status === 'playing') {
    configureAction(els.primaryAction, { hidden: true });
    if (!connected) {
      configureAction(els.secondaryAction, {
        hidden: false,
        label: '离开房间',
        variant: 'btn-ghost',
      });
      els.leaveLink.hidden = true;
    } else {
      configureAction(els.secondaryAction, {
        hidden: false,
        label: '认输',
        variant: 'btn-danger',
      });
      els.leaveLink.hidden = false;
    }
    return;
  }

  const myVote = Boolean(me && me.wantsRematch);
  const theirVote = Boolean(opponent && opponent.wantsRematch);
  let label = '再来一局';
  if (!connected) label = '等待对手重连';
  else if (myVote) label = '已申请 · 等待对手';
  else if (theirVote) label = '接受再来一局';
  configureAction(els.primaryAction, {
    hidden: false,
    label,
    variant: 'btn-primary',
    disabled: myVote || !connected,
  });
  configureAction(els.secondaryAction, {
    hidden: false,
    label: '离开房间',
    variant: 'btn-ghost',
  });
  els.leaveLink.hidden = true;
}

function renderHistory(room) {
  if (isPoker(room)) {
    els.historyPanel.hidden = true;
    return;
  }
  const checkers = isCheckers(room);
  const history = Array.isArray(room.history) ? room.history : [];
  const show = bothSeated(room);
  const previousLength = Number(els.historyList.dataset.length || 0);
  els.historyPanel.hidden = !show;
  els.historyTitle.textContent = checkers ? '走棋记录' : '落子记录';
  els.historyCount.textContent = `${history.length} ${checkers ? '回合' : '手'}`;
  els.historyEmpty.textContent = checkers ? '还没有走棋' : '第一手，等你落下';
  els.historyEmpty.hidden = history.length > 0;
  els.historyList.hidden = history.length === 0;
  els.historyList.dataset.length = String(history.length);

  if (!show) {
    if (history.length === 0) els.historyList.replaceChildren();
    return;
  }

  if (history.length === 0) {
    els.historyList.replaceChildren();
    return;
  }

  const fragment = document.createDocumentFragment();
  history.forEach((move, index) => {
    const item = document.createElement('li');
    item.className = `history-item${index === history.length - 1 ? ' is-latest' : ''}`;
    const number = document.createElement('span');
    number.className = 'history-index';
    number.textContent = String(move.moveNumber || index + 1).padStart(2, '0');
    const stone = document.createElement('span');
    stone.className = `history-stone ${move.color === CPU.BLACK ? 'black' : 'white'}`;
    const coord = document.createElement('span');
    coord.className = 'history-coord';
    coord.textContent = checkers
      ? move.type === 'jump'
        ? move.jumps > 1
          ? `连跳 ${move.jumps} 步`
          : '跳跃'
        : '移动一步'
      : coordinateLabel(move.row, move.col);
    const owner = document.createElement('span');
    owner.className = 'history-owner';
    owner.textContent = `${COLOR_SHORT[move.color]}方`;
    item.append(number, stone, coord, owner);
    fragment.append(item);
  });
  els.historyList.replaceChildren(fragment);
  if (history.length !== previousLength) {
    requestAnimationFrame(() => {
      els.historyList.scrollTop = els.historyList.scrollHeight;
    });
  }
}

function renderInvitePanel(room) {
  const hasOpponent = Boolean(room.players[1]);
  els.invitePanel.hidden = hasOpponent;
  const link = inviteUrlFor(room.code);
  els.inviteLinkInput.value = link;
  if (room.status === 'waiting') {
    els.inviteHint.textContent = isLocalHostname() && !(state.info && state.info.urls?.length)
      ? '未检测到局域网地址，可让朋友使用本机地址'
      : '同一 Wi‑Fi 下打开链接即可加入';
  }
  updateFooter();
}

function updateConnectionLabel() {
  const open = Boolean(state.ws && state.ws.readyState === WebSocket.OPEN);
  const offline = !open || state.reconnecting;
  els.connectionLabel.classList.toggle('is-offline', offline);
  if (offline) {
    els.connectionText.textContent = state.reconnecting ? '重连中' : '已断开';
  } else if (state.latency != null) {
    els.connectionText.textContent = `已连接 · ${state.latency}ms`;
  } else {
    els.connectionText.textContent = '已连接';
  }
}

function updateFooter() {
  if (state.screen === 'room' && state.roomCode) {
    els.footerAddress.textContent = `邀请地址 ${displayHost()}`;
  } else {
    const first = state.info && Array.isArray(state.info.urls) ? state.info.urls[0] : null;
    els.footerAddress.textContent = first ? `LAN · ${first.address}` : 'LAN BOARD GAMES';
  }
}

/* --------------------------------------------------------------------------
 * Room transitions
 * ------------------------------------------------------------------------ */

function applyRoom(room, options = {}) {
  const previous = state.room;
  state.movePending = false;
  window.clearTimeout(state.moveTimer);
  state.moveTimer = null;

  if (isPoker(room)) {
    state.poker.actionPending = false;
    window.clearTimeout(state.poker.actionTimer);
    state.poker.actionTimer = null;
    state.poker.raiseOpen = false;
  }

  if (isCheckers(room)) {
    const changed =
      !previous ||
      previous.code !== room.code ||
      previous.moveCount !== room.moveCount ||
      previous.turn !== room.turn ||
      previous.round !== room.round ||
      previous.status !== room.status ||
      !allConnected(room);
    if (changed) resetCheckersSelection();
  }

  state.room = room;
  renderRoom(room);

  if (!previous || previous.code !== room.code) return;

  const previousOpponent = opponentOf(previous);
  const nextOpponent = opponentOf(room);

  if (!previousOpponent && nextOpponent && !options.silent) {
    toast('对手已加入，对局开始');
    playJoin();
  } else if (
    previousOpponent &&
    previousOpponent.connected &&
    nextOpponent &&
    !nextOpponent.connected
  ) {
    toast('对手暂时离线，棋局已暂停', 'error');
  } else if (
    previousOpponent &&
    !previousOpponent.connected &&
    nextOpponent &&
    nextOpponent.connected
  ) {
    toast('对手已重新连接');
    playJoin();
  }

  if (
    room.lastMove &&
    (!previous.lastMove || previous.lastMove.moveNumber !== room.lastMove.moveNumber)
  ) {
    playStone();
  }

  if (isPoker(room) && previous.poker && previous.poker.stage !== 'handComplete') {
    if (room.poker.stage === 'handComplete' && room.poker.result) {
      const result = room.poker.result;
      if (result.reason === 'split') playDraw();
      else if (result.winnerColor === room.yourColor) playWin();
      else playLose();
      if (result.reason === 'fold') {
        toast(result.winnerColor === room.yourColor ? '对手弃牌，你赢得底池' : '你已弃牌');
      }
    }
  }

  if (previous.status === 'playing' && room.status === 'ended') {
    if (room.winner === room.yourColor) playWin();
    else if (room.winner === 0) playDraw();
    else playLose();
    if (room.endReason === 'resign' && room.winner === room.yourColor) {
      toast('对手认输了');
    } else if (isPoker(room) && room.winner === room.yourColor) {
      toast('对手筹码清零，你赢得整局');
    }
  }

  if (room.round > previous.round) {
    toast(`新一局开始 · 你执${colorName(room.yourColor)}`);
    playJoin();
  }
}

/* --------------------------------------------------------------------------
 * Networking
 * ------------------------------------------------------------------------ */

function socketUrl() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/ws`;
}

function connectSocket() {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    return Promise.resolve(state.ws);
  }
  if (state.socketPromise) return state.socketPromise;

  let settle;
  const promise = new Promise((resolve, reject) => {
    let settled = false;
    const ws = new WebSocket(socketUrl());
    state.ws = ws;

    const finishReject = (error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      if (state.socketPromise === promise) state.socketPromise = null;
      reject(error);
    };

    const timer = window.setTimeout(() => {
      if (settled) return;
      finishReject(new Error('连接服务器超时'));
      try {
        ws.close();
      } catch {
        // Ignore.
      }
    }, 8000);

    ws.addEventListener('open', () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      ws.__hadOpened = true;
      if (state.socketPromise === promise) state.socketPromise = null;
      startHeartbeat();
      state.lastServerMessage = Date.now();
      updateConnectionLabel();
      resolve(ws);
    });

    ws.addEventListener('message', handleSocketMessage);
    ws.addEventListener('close', (event) => {
      window.clearTimeout(timer);
      if (!settled) {
        settled = true;
        if (state.socketPromise === promise) state.socketPromise = null;
        reject(new Error('无法连接服务器'));
      }
      handleSocketClose(ws, event);
    });
    ws.addEventListener('error', () => {
      // The close event carries the actionable state.
    });
  });

  state.socketPromise = promise;
  return promise;
}

function sendMessage(message) {
  const ws = state.ws;
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return false;
  }
  try {
    ws.send(JSON.stringify(message));
    return true;
  } catch {
    return false;
  }
}

function startHeartbeat() {
  stopHeartbeat();
  state.pingSentAt = Date.now();
  sendMessage({ type: 'ping', t: state.pingSentAt });
  state.heartbeatTimer = window.setInterval(() => {
    const ws = state.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (state.pingSentAt && Date.now() - state.pingSentAt > 45_000) {
      try {
        ws.close(4000, 'Ping timeout');
      } catch {
        // Ignore.
      }
      return;
    }
    state.pingSentAt = Date.now();
    sendMessage({ type: 'ping', t: state.pingSentAt });
  }, 15_000);
}

function stopHeartbeat() {
  if (state.heartbeatTimer) {
    window.clearInterval(state.heartbeatTimer);
    state.heartbeatTimer = null;
  }
}

function handleSocketMessage(event) {
  state.lastServerMessage = Date.now();
  let message;
  try {
    message = JSON.parse(event.data);
  } catch {
    return;
  }
  if (!message || typeof message.type !== 'string') return;

  switch (message.type) {
    case 'hello':
      break;
    case 'pong':
      if (state.pingSentAt) {
        state.latency = Math.max(1, Date.now() - state.pingSentAt);
        state.pingSentAt = 0;
        updateConnectionLabel();
      }
      break;
    case 'joined':
      handleJoined(message);
      break;
    case 'room':
      if (!state.inRoom) return;
      if (state.roomCode && message.room.code !== state.roomCode) return;
      applyRoom(message.room);
      break;
    case 'error':
      handleServerError(message);
      break;
    case 'left':
      handleLeft();
      break;
    case 'room_closed':
      handleRoomClosed(message);
      break;
    default:
      break;
  }
}

function handleSocketClose(ws, event) {
  if (state.ws !== ws) return;
  state.ws = null;
  state.socketPromise = null;
  stopHeartbeat();
  state.pingSentAt = 0;
  updateConnectionLabel();

  const wasOpen = Boolean(ws.__hadOpened);
  const cleanClose = event && (event.code === 1000 || event.code === 1001);

  if (state.inRoom && !cleanClose) {
    if (!state.reconnecting) beginReconnect();
    else scheduleReconnect();
    return;
  }

  if (state.inRoom && cleanClose && !state.reconnecting) {
    // Server initiated a clean close (for example, shutdown); try to recover,
    // unless the user is already on the home screen.
    beginReconnect();
    return;
  }

  if (state.pendingAction && wasOpen) {
    failPendingAction('连接已断开，请重试');
  }
}

function handleJoined(message) {
  const wasReconnecting = state.reconnecting || state.autoResume;
  const room = message.room;
  if (!room) return;

  clearPendingAction();
  clearLeaveTimer();
  stopReconnecting({ keepOverlay: false });
  state.autoResume = false;

  state.inRoom = true;
  state.roomCode = room.code;
  state.token = message.token;
  state.latency = state.latency || null;
  seatStorage.set(tokenKey(room.code), message.token);
  saveName();
  setRoomQuery(room.code);
  setScreen('room');
  state.movePending = false;
  applyRoom(room, { silent: wasReconnecting });
  updateConnectionLabel();
  startHeartbeat();
  if (wasReconnecting) {
    toast('已恢复房间连接');
  }
}

function handleServerError(message) {
  const code = message.code;
  const text = message.message || ERROR_MESSAGES[code] || '操作失败';

  if (state.awaitingRejoin || state.reconnecting) {
    if (code === 'ROOM_NOT_FOUND' || code === 'REJOIN_FAILED') {
      const roomCode = state.roomCode;
      state.autoResume = false;
      stopReconnecting({ keepOverlay: true });
      state.awaitingRejoin = false;
      hideReconnectOverlay();
      closeSocketQuietly();
      clearRoomState();
      removeToken(roomCode);
      clearRoomQuery();
      setScreen('home');
      activateTab('join');
      if (roomCode) els.roomInput.value = roomCode;
      toast('房间已关闭，无法恢复对局，请重新创建或加入', 'error', 4200);
      return;
    }
    toast(text, 'error');
    state.awaitingRejoin = false;
    clearRejoinTimer();
    scheduleReconnect();
    return;
  }

  if (state.pendingAction) {
    failPendingAction(text);
    return;
  }

  state.movePending = false;
  window.clearTimeout(state.moveTimer);
  state.moveTimer = null;
  state.poker.actionPending = false;
  state.poker.raiseOpen = false;
  window.clearTimeout(state.poker.actionTimer);
  if (state.room && isCheckers(state.room)) {
    resetCheckersSelection();
    renderCheckersBoard(state.room);
  }
  if (state.room && isPoker(state.room)) {
    renderPokerTable(state.room);
  }
  toast(text, 'error');
  playError();
}

function beginReconnect() {
  if (!state.inRoom || state.reconnecting) return;
  state.reconnecting = true;
  state.reconnectAttempt = 0;
  state.movePending = false;
  state.poker.actionPending = false;
  state.poker.raiseOpen = false;
  window.clearTimeout(state.poker.actionTimer);
  if (state.room && isCheckers(state.room)) resetCheckersSelection();
  updateConnectionLabel();
  showReconnectOverlay('网络连接中断，正在恢复房间…');
  scheduleReconnect(0);
}

function scheduleReconnect(delayOverride) {
  if (!state.reconnecting || !state.inRoom) return;
  window.clearTimeout(state.reconnectTimer);
  const attempt = Math.max(1, state.reconnectAttempt + 1);
  const delay =
    typeof delayOverride === 'number'
      ? delayOverride
      : Math.min(5000, 650 * attempt + 250);
  state.reconnectTimer = window.setTimeout(attemptReconnect, delay);
}

function attemptReconnect() {
  if (!state.reconnecting || !state.inRoom) return;
  state.reconnectAttempt += 1;
  els.reconnectText.textContent = `正在恢复房间连接…（第 ${state.reconnectAttempt} 次）`;
  updateConnectionLabel();

  connectSocket()
    .then(() => {
      if (!state.reconnecting || !state.inRoom || !state.token || !state.roomCode) return;
      state.awaitingRejoin = true;
      sendMessage({ type: 'rejoin', room: state.roomCode, token: state.token });
      clearRejoinTimer();
      state.rejoinTimer = window.setTimeout(() => {
        if (!state.awaitingRejoin || !state.reconnecting) return;
        state.awaitingRejoin = false;
        closeSocketQuietly();
        scheduleReconnect();
      }, 5000);
    })
    .catch(() => {
      scheduleReconnect();
    });
}

function stopReconnecting({ keepOverlay = false } = {}) {
  state.reconnecting = false;
  state.reconnectAttempt = 0;
  state.awaitingRejoin = false;
  window.clearTimeout(state.reconnectTimer);
  state.reconnectTimer = null;
  clearRejoinTimer();
  if (!keepOverlay) hideReconnectOverlay();
  updateConnectionLabel();
}

function clearRejoinTimer() {
  if (state.rejoinTimer) {
    window.clearTimeout(state.rejoinTimer);
    state.rejoinTimer = null;
  }
}

function showReconnectOverlay(text) {
  els.reconnectText.textContent = text;
  els.reconnectOverlay.hidden = false;
}

function hideReconnectOverlay() {
  els.reconnectOverlay.hidden = true;
}

function closeSocketQuietly() {
  const ws = state.ws;
  state.ws = null;
  state.socketPromise = null;
  stopHeartbeat();
  if (ws) {
    try {
      ws.close(1000, 'Leaving');
    } catch {
      // Ignore.
    }
  }
}

/* --------------------------------------------------------------------------
 * Pending actions / buttons
 * ------------------------------------------------------------------------ */

function setButtonBusy(button, busy, label) {
  const span = button.querySelector('span');
  if (!span) return;
  if (busy) {
    if (!button.dataset.idleLabel) button.dataset.idleLabel = span.textContent;
    span.textContent = label;
    button.disabled = true;
  } else {
    if (button.dataset.idleLabel) {
      span.textContent = button.dataset.idleLabel;
      delete button.dataset.idleLabel;
    }
    button.disabled = false;
  }
}

function beginPendingAction(action) {
  state.pendingAction = action;
  if (action === 'create') {
    setButtonBusy(els.createButton, true, '正在创建…');
  } else {
    setButtonBusy(els.joinButton, true, '正在加入…');
  }
  window.clearTimeout(state.requestTimer);
  state.requestTimer = window.setTimeout(() => {
    if (state.pendingAction) {
      failPendingAction('服务器响应超时，请重试');
    }
  }, 12_000);
}

function clearPendingAction() {
  state.pendingAction = null;
  window.clearTimeout(state.requestTimer);
  state.requestTimer = null;
  setButtonBusy(els.createButton, false);
  setButtonBusy(els.joinButton, false);
}

function failPendingAction(message) {
  clearPendingAction();
  toast(message, 'error');
  playError();
}

async function createRoom() {
  if (state.pendingAction) return;
  ensureAudio();
  const name = clampName(els.nameInput.value);
  saveName();
  beginPendingAction('create');
  try {
    await connectSocket();
    if (
      !sendMessage({
        type: 'create',
        name,
        game: state.selectedGame,
        startingStackBb: state.selectedPokerStackBb,
      })
    ) {
      failPendingAction('连接已断开，请重试');
    }
  } catch (error) {
    failPendingAction(error.message || '无法连接服务器，请确认服务已启动');
  }
}

async function joinRoom() {
  if (state.pendingAction) return;
  ensureAudio();
  const code = (els.roomInput.value || '').replace(/\D/g, '').slice(0, 4);
  els.roomInput.value = code;
  if (!/^\d{4}$/.test(code)) {
    toast('请输入 4 位数字房间号', 'error');
    els.roomInput.focus();
    return;
  }
  const name = clampName(els.joinNameInput.value);
  saveName();
  beginPendingAction('join');
  try {
    await connectSocket();
    if (!sendMessage({ type: 'join', room: code, name })) {
      failPendingAction('连接已断开，请重试');
    }
  } catch (error) {
    failPendingAction(error.message || '无法连接服务器，请确认服务已启动');
  }
}

/* --------------------------------------------------------------------------
 * Leaving / room lifecycle
 * ------------------------------------------------------------------------ */

function removeToken(code) {
  if (code) seatStorage.remove(tokenKey(code));
}

function clearLeaveTimer() {
  if (state.leaveTimer) {
    window.clearTimeout(state.leaveTimer);
    state.leaveTimer = null;
  }
}

function clearRoomState() {
  clearLeaveTimer();
  clearPendingAction();
  stopReconnecting({ keepOverlay: true });
  hideReconnectOverlay();
  state.inRoom = false;
  state.room = null;
  state.roomCode = null;
  state.token = null;
  state.movePending = false;
  state.autoResume = false;
  state.rendered = { code: null, round: 0, moveCount: -1, lastMoveNumber: null };
  state.lastResultKey = null;
  resetCheckersSelection();
  hideChainBar();
  els.checkersBoard.classList.remove('is-active');
  stopPokerCountdown();
  state.poker.actionPending = false;
  state.poker.raiseOpen = false;
  state.poker.adviceKey = null;
  state.poker.advice = null;
  window.clearTimeout(state.poker.actionTimer);
  state.poker.actionTimer = null;
  els.gtoPanel.hidden = true;
  els.pokerControls.hidden = true;
  els.pokerResultPanel.hidden = true;
  window.clearTimeout(state.moveTimer);
  state.moveTimer = null;
}

function goHome({ toastMessage, type = 'info' } = {}) {
  const code = state.roomCode;
  clearRoomState();
  removeToken(code);
  clearRoomQuery();
  els.reconnectOverlay.hidden = true;
  els.inviteCallout.hidden = true;
  setScreen('home');
  els.footerRuleLabel.textContent = gameInfo(state.selectedGame).footer;
  updateFooter();
  if (toastMessage) toast(toastMessage, type, 3800);
}

function handleLeft() {
  clearLeaveTimer();
  goHome({ toastMessage: '已离开房间' });
}

function handleRoomClosed(message) {
  const reason = message.reason;
  const text =
    message.message ||
    (reason === 'opponent_left'
      ? '对手已离开，房间关闭'
      : '房间已关闭');
  if (!state.inRoom && state.screen !== 'room') return;
  goHome({
    toastMessage: text,
    type: reason === 'server_shutdown' || reason === 'opponent_timeout' ? 'error' : 'info',
  });
}

function leaveRoom(options = {}) {
  if (!state.inRoom) {
    hideReconnectOverlay();
    setScreen('home');
    return;
  }
  if (state.leaveTimer) return;

  const finish = async () => {
    const room = state.room;
    if (!options.skipConfirm && room && room.status === 'playing') {
      const poker = isPoker(room);
      const confirmed = await askConfirm({
        title: poker ? '离开这张牌桌？' : '离开这局棋？',
        body: poker
          ? '离开后房间会关闭，当前牌局不会保留。对手会收到你离开的提示。'
          : '离开后房间会关闭，当前棋局不会保留。对手会收到你离开的提示。',
        confirmText: '离开房间',
        danger: true,
      });
      if (!confirmed) return;
    }

    if (state.reconnecting) {
      abandonReconnect();
      return;
    }

    if (!sendMessage({ type: 'leave' })) {
      goHome({ toastMessage: '已离开房间' });
      closeSocketQuietly();
      return;
    }

    clearLeaveTimer();
    state.leaveTimer = window.setTimeout(() => {
      goHome({ toastMessage: '已离开房间' });
      closeSocketQuietly();
    }, 2600);
  };

  finish();
}

function abandonReconnect() {
  const code = state.roomCode;
  const ws = state.ws;
  if (ws && ws.readyState === WebSocket.OPEN && state.inRoom) {
    try {
      ws.send(JSON.stringify({ type: 'leave' }));
    } catch {
      // Ignore.
    }
  }
  clearRoomState();
  removeToken(code);
  clearRoomQuery();
  hideReconnectOverlay();
  setScreen('home');
  updateFooter();
  toast('已退出房间');
  closeSocketQuietly();
}

function handleReconnectHomeClick() {
  abandonReconnect();
}

/* --------------------------------------------------------------------------
 * Server info / link UI
 * ------------------------------------------------------------------------ */

async function loadServerInfo({ quiet = false } = {}) {
  const label = els.serverState.querySelector('span');
  els.serverState.classList.remove('is-offline');
  els.serverPill.classList.remove('is-offline');
  if (!quiet) {
    label.textContent = '正在获取局域网地址…';
    els.refreshInfoButton.disabled = true;
  }
  try {
    const response = await fetch('/api/info', { cache: 'no-store' });
    if (!response.ok) throw new Error('bad response');
    state.info = await response.json();
    const first = state.info.urls && state.info.urls[0];
    const shownHost = !isLocalHostname() ? location.host : first ? first.url.replace(/^https?:\/\//, '') : location.host;
    label.textContent = `局域网地址 ${shownHost}`;
    els.serverPillText.textContent = '局域网就绪';
    els.inviteHint.textContent = first
      ? '同一 Wi‑Fi 下打开链接即可加入'
      : '未检测到局域网地址，请检查网络连接';
    updateFooter();
    if (state.room) renderInvitePanel(state.room);
  } catch {
    els.serverState.classList.add('is-offline');
    els.serverPill.classList.add('is-offline');
    els.serverPillText.textContent = '信息不可用';
    label.textContent = '未能读取服务器信息，请刷新重试';
    if (!quiet) toast('无法读取服务器信息', 'error');
  } finally {
    els.refreshInfoButton.disabled = false;
  }
}

function activateTab(tab) {
  const isJoin = tab === 'join';
  els.tabs.dataset.active = isJoin ? 'join' : 'create';
  for (const button of els.tabButtons) {
    const active = button.dataset.tab === tab;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
  }
  els.createPanel.hidden = isJoin;
  els.joinPanel.hidden = !isJoin;
  if (isJoin && !state.inRoom && els.roomInput.value.length < 4) {
    // Do not steal focus on page load; the invitation is already obvious.
  }
}

/* --------------------------------------------------------------------------
 * Moves
 * ------------------------------------------------------------------------ */

function requestMove(row, col) {
  const room = state.room;
  if (!room || !state.inRoom || state.reconnecting) return;
  if (room.status === 'waiting') {
    toast('还在等对手入座');
    return;
  }
  if (room.status === 'ended') {
    toast('本局已经结束，点击「再来一局」继续');
    return;
  }
  if (!allConnected(room)) {
    toast('对手暂时离线，棋局暂停中');
    return;
  }
  if (room.turn !== room.yourColor) {
    toast('还没轮到你落子');
    return;
  }
  if (room.board[row * BOARD_SIZE + col] !== 0) return;
  if (state.movePending) return;

  state.movePending = true;
  window.clearTimeout(state.moveTimer);
  state.moveTimer = window.setTimeout(() => {
    state.movePending = false;
  }, 1800);

  if (!sendMessage({ type: 'move', row, col })) {
    state.movePending = false;
    toast('连接断开，正在重连…', 'error');
  }
}

function sendResign() {
  const room = state.room;
  if (!room || room.status !== 'playing') return;
  askConfirm({
    title: '确定认输？',
    body: '本局将判你负，对手直接获胜。认输后仍可以和对手再来一局。',
    confirmText: '认输',
    danger: true,
  }).then((confirmed) => {
    if (!confirmed) return;
    if (!sendMessage({ type: 'resign' })) {
      toast('连接已断开，请稍后重试', 'error');
    }
  });
}

function sendRematch() {
  if (!state.inRoom) return;
  if (!sendMessage({ type: 'rematch' })) {
    toast('连接已断开，请稍后重试', 'error');
  }
}

/* --------------------------------------------------------------------------
 * Event binding
 * ------------------------------------------------------------------------ */

function bindEvents() {
  els.brandHome.addEventListener('click', () => {
    if (state.screen === 'room') {
      leaveRoom();
      return;
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  els.soundToggle.addEventListener('click', () => {
    ensureAudio();
    toggleSound();
  });
  els.soundToggleGame.addEventListener('click', () => {
    ensureAudio();
    toggleSound();
  });

  els.tabButtons.forEach((button) => {
    button.addEventListener('click', () => activateTab(button.dataset.tab));
    button.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      activateTab(event.key === 'ArrowLeft' ? 'create' : 'join');
      const target = els.tabButtons.find((item) => item.dataset.tab === (event.key === 'ArrowLeft' ? 'create' : 'join'));
      target?.focus();
    });
  });

  els.createPanel.addEventListener('submit', (event) => {
    event.preventDefault();
    createRoom();
  });
  els.joinPanel.addEventListener('submit', (event) => {
    event.preventDefault();
    joinRoom();
  });

  els.nameInput.addEventListener('input', () => {
    const value = els.nameInput.value.slice(0, 12);
    if (els.nameInput.value !== value) els.nameInput.value = value;
    els.joinNameInput.value = value;
    updateNameCount();
  });
  els.nameInput.addEventListener('blur', saveName);
  els.joinNameInput.addEventListener('input', () => {
    const value = els.joinNameInput.value.slice(0, 12);
    if (els.joinNameInput.value !== value) els.joinNameInput.value = value;
    els.nameInput.value = value;
    updateNameCount();
  });
  els.joinNameInput.addEventListener('blur', saveName);

  els.roomInput.addEventListener('input', () => {
    els.roomInput.value = els.roomInput.value.replace(/\D/g, '').slice(0, 4);
    if (els.roomInput.value.length === 4) els.inviteCallout.hidden = true;
  });
  els.roomInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      joinRoom();
    }
  });

  els.cellsLayer.addEventListener('click', handleCellClick);
  els.cellsLayer.addEventListener('keydown', handleCellKeydown);
  els.cellsLayer.addEventListener('focusin', (event) => {
    const cell = event.target.closest('.cell');
    if (!cell) return;
    state.focus = {
      row: Number(cell.dataset.row),
      col: Number(cell.dataset.col),
    };
    for (const item of cells) item.tabIndex = -1;
    cell.tabIndex = 0;
  });

  els.copyCodeButton.addEventListener('click', () => {
    if (state.roomCode) copyText(state.roomCode, '房间号已复制');
  });
  els.copyLinkButton.addEventListener('click', () => {
    if (state.roomCode) copyText(inviteUrlFor(state.roomCode), '邀请链接已复制');
  });
  els.inviteLinkInput.addEventListener('focus', () => els.inviteLinkInput.select());
  els.inviteLinkInput.addEventListener('click', () => els.inviteLinkInput.select());

  els.primaryAction.addEventListener('click', () => {
    const room = state.room;
    if (!room) return;
    if (room.status === 'waiting') {
      copyText(inviteUrlFor(room.code), '邀请链接已复制');
    } else if (room.status === 'ended') {
      sendRematch();
    }
  });

  els.secondaryAction.addEventListener('click', () => {
    const room = state.room;
    if (!room) return;
    if (room.status === 'playing' && allConnected(room)) {
      sendResign();
    } else if (room.status === 'waiting') {
      askConfirm({
        title: '关闭房间？',
        body: '房间关闭后，已复制的邀请链接将失效。',
        confirmText: '关闭房间',
        danger: true,
      }).then((confirmed) => {
        if (confirmed) leaveRoom({ skipConfirm: true });
      });
    } else {
      leaveRoom({ skipConfirm: true });
    }
  });

  els.leaveLink.addEventListener('click', () => leaveRoom());

  els.shareButton.addEventListener('click', async () => {
    if (!state.roomCode) return;
    const url = inviteUrlFor(state.roomCode);
    const game = gameInfo(roomGame());
    const shareData = {
      title: `连珠 · ${game.label}`,
      text: `来和我下一盘${game.label}，房间号 ${state.roomCode}`,
      url,
    };
    if (navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch (error) {
        if (error && error.name === 'AbortError') return;
      }
    }
    copyText(url, '邀请链接已复制');
  });

  els.reconnectHomeButton.addEventListener('click', handleReconnectHomeClick);
  els.refreshInfoButton.addEventListener('click', () => loadServerInfo());

  els.rulesButton.addEventListener('click', () => {
    const info = gameInfo(roomGame());
    els.rulesKicker.textContent = info.kicker;
    els.rulesTitle.textContent = info.title;
    els.gomokuRules.hidden = info.id !== 'gomoku';
    els.checkersRules.hidden = info.id !== 'checkers';
    els.pokerRules.hidden = info.id !== 'poker';
    if (!els.rulesDialog.open) els.rulesDialog.showModal();
  });

  els.checkersSvg.addEventListener('click', handleCheckersHoleClick);
  els.endChainButton.addEventListener('click', endCheckersChain);

  els.gtoToggle.addEventListener('click', () => {
    state.poker.gtoEnabled = !state.poker.gtoEnabled;
    storage.set('gomoku.gto', state.poker.gtoEnabled ? '1' : '0');
    state.poker.adviceKey = null;
    state.poker.advice = null;
    if (state.room && isPoker(state.room)) updateGtoPanel(state.room);
    else els.gtoBody.hidden = !state.poker.gtoEnabled;
  });

  els.pokerFoldButton.addEventListener('click', () => sendPokerAction('fold'));
  els.pokerCheckButton.addEventListener('click', () => sendPokerAction('check'));
  els.pokerCallButton.addEventListener('click', () => sendPokerAction('call'));
  els.pokerRaiseToggle.addEventListener('click', () => {
    if (!state.room || !isPoker(state.room)) return;
    const available = state.room.poker.availableActions || {};
    if (!available.canBet && !available.canRaise) return;
    state.poker.raiseOpen = !state.poker.raiseOpen;
    if (state.poker.raiseOpen) {
      const min = Math.max(state.room.poker.bigBlind, available.minRaiseTo || 0);
      const max = Math.max(min, available.maxRaiseTo || min);
      state.poker.raiseTarget = Math.min(
        max,
        Math.max(min, Math.round(state.room.poker.pot * 0.66))
      );
    }
    renderPokerControls(state.room);
  });
  els.pokerRaiseSlider.addEventListener('input', () => {
    setPokerRaiseTarget(Number(els.pokerRaiseSlider.value) * 100);
  });
  for (const button of els.pokerRaisePresets) {
    button.addEventListener('click', () => {
      if (!state.room || !isPoker(state.room)) return;
      const target = pokerPotFractionTarget(state.room, button.dataset.size);
      if (Number.isFinite(target)) setPokerRaiseTarget(target);
    });
  }
  els.pokerRaiseConfirm.addEventListener('click', () => {
    if (!state.room || !isPoker(state.room)) return;
    const available = state.room.poker.availableActions || {};
    const target = state.poker.raiseTarget;
    if (!target) return;
    state.poker.raiseOpen = false;
    if (target >= (available.maxRaiseTo || target)) {
      sendPokerAction('allin');
    } else {
      sendPokerAction(available.canBet ? 'bet' : 'raise', target);
    }
  });

  els.confirmDialog.addEventListener('click', (event) => {
    if (event.target !== els.confirmDialog) return;
    const rect = els.confirmDialog.getBoundingClientRect();
    const inside =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;
    if (!inside) els.confirmDialog.close('cancel');
  });

  window.addEventListener('online', () => {
    if (state.inRoom && !state.reconnecting) {
      const open = state.ws && state.ws.readyState === WebSocket.OPEN;
      if (!open) beginReconnect();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !state.inRoom) return;
    if (state.reconnecting) {
      scheduleReconnect(0);
      return;
    }
    const open = state.ws && state.ws.readyState === WebSocket.OPEN;
    if (!open) beginReconnect();
  });

  window.addEventListener('pointerdown', ensureAudio, { once: true, capture: true });
}

/* --------------------------------------------------------------------------
 * Boot
 * ------------------------------------------------------------------------ */

function initializeName() {
  const stored = storage.get(STORAGE_NAME);
  const fallback = `棋手${Math.floor(10 + Math.random() * 90)}`;
  const name = clampName(stored || fallback);
  els.nameInput.value = name;
  els.joinNameInput.value = name;
  updateNameCount();
  if (!stored) storage.set(STORAGE_NAME, name);
}

function initializeFromUrl() {
  let code = '';
  try {
    code = (new URL(location.href).searchParams.get('room') || '').trim();
  } catch {
    code = '';
  }
  if (!/^\d{4}$/.test(code)) return;

  els.roomInput.value = code;
  els.inviteCallout.hidden = false;
  els.inviteCalloutCode.textContent = code;
  activateTab('join');

  const token = seatStorage.get(tokenKey(code));
  if (token) {
    state.autoResume = true;
    state.inRoom = true;
    state.roomCode = code;
    state.token = token;
    state.reconnecting = true;
    state.reconnectAttempt = 0;
    showReconnectOverlay('正在恢复上次的对局…');
    updateConnectionLabel();
    scheduleReconnect(0);
  }
}

function init() {
  buildBoard();
  bindEvents();
  initializeName();
  initGamePicker();
  updateSoundUI();
  initializeFromUrl();
  loadServerInfo();
  setScreen('home');
  updateFooter();
  updateConnectionLabel();
}

init();
