'use strict';

/**
 * 连珠 · LAN Board Games
 * 零依赖 Node.js 服务端：静态页面 + 房间管理 + 原生 WebSocket。
 * 支持五子棋与中国跳棋。
 */

const Checkers = require('./public/checkers-core.js');
const Poker = require('./public/poker-core.js');
const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { URL } = require('node:url');
const { spawn } = require('node:child_process');

const PUBLIC_DIR = path.join(__dirname, 'public');
const BOARD_SIZE = 15;
const BOARD_CELLS = BOARD_SIZE * BOARD_SIZE;
const CHECKERS_LAYOUT = Checkers.createLayout();
const CHECKERS_CELLS = CHECKERS_LAYOUT.holeCount;
const GAME_TYPES = new Set(['gomoku', 'checkers', 'poker']);
const POKER_STACK_OPTIONS = new Set([20, 50, 100, 200]);
const POKER_DEFAULT_STACK_BB = 100;
const POKER_BB_CHIPS = Poker.BB_CHIPS;
const POKER_SB_CHIPS = Poker.SB_CHIPS;
const POKER_NEXT_HAND_DELAY_MS = 5600;
const DISCONNECT_GRACE_MS = 90 * 1000;
const ROOM_MAX_IDLE_MS = 12 * 60 * 60 * 1000;
const MAX_MESSAGE_BYTES = 64 * 1024;
const MAX_ROOMS = 1000;
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const rooms = new Map();
const wsConnections = new Set();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

// ---------------------------------------------------------------------------
// Minimal RFC 6455 WebSocket server
// ---------------------------------------------------------------------------

class WebSocketConnection extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.closed = false;
    this.closeSent = false;
    this.isAlive = true;
    this.fragmentOpcode = null;
    this.fragments = [];
    this.fragmentBytes = 0;

    socket.setNoDelay(true);
    socket.on('data', (chunk) => this._receive(chunk));
    socket.on('error', () => this.terminate());
    socket.on('close', () => this._handleSocketClose());

    this.heartbeat = setInterval(() => {
      if (this.closed) return;
      if (!this.isAlive) {
        this.terminate();
        return;
      }
      this.isAlive = false;
      this._sendFrame(0x9, Buffer.alloc(0));
    }, 30_000);
    this.heartbeat.unref?.();
  }

  _receive(chunk) {
    if (this.closed) return;
    this.isAlive = true;
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.buffer.length > MAX_MESSAGE_BYTES + 1024) {
      this.close(1009, 'Message too large');
      return;
    }
    this._parseFrames();
  }

  _parseFrames() {
    while (!this.closed) {
      const buf = this.buffer;
      if (buf.length < 2) return;

      const first = buf[0];
      const second = buf[1];
      const fin = (first & 0x80) !== 0;
      const rsv = first & 0x70;
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let length = second & 0x7f;
      let offset = 2;

      if (rsv !== 0) {
        this.close(1002, 'Invalid RSV bits');
        return;
      }

      if (length === 126) {
        if (buf.length < 4) return;
        length = buf.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (buf.length < 10) return;
        const bigLength = buf.readBigUInt64BE(2);
        if (bigLength > BigInt(MAX_MESSAGE_BYTES)) {
          this.close(1009, 'Message too large');
          return;
        }
        length = Number(bigLength);
        offset = 10;
      }

      if (!masked) {
        this.close(1002, 'Client frames must be masked');
        return;
      }
      if (length > MAX_MESSAGE_BYTES) {
        this.close(1009, 'Message too large');
        return;
      }
      if (buf.length < offset + 4 + length) return;

      const mask = buf.subarray(offset, offset + 4);
      offset += 4;
      const payload = Buffer.from(buf.subarray(offset, offset + length));
      for (let i = 0; i < payload.length; i += 1) {
        payload[i] ^= mask[i & 3];
      }
      this.buffer = buf.subarray(offset + length);

      if (opcode >= 0x8) {
        if (!fin || length > 125) {
          this.close(1002, 'Invalid control frame');
          return;
        }
      }

      if (opcode === 0x8) {
        this._handleCloseFrame(payload);
        return;
      }
      if (opcode === 0x9) {
        this._sendFrame(0xA, payload);
        continue;
      }
      if (opcode === 0xA) {
        this.isAlive = true;
        continue;
      }
      if (opcode === 0x1) {
        if (this.fragmentOpcode !== null) {
          this.close(1002, 'Unexpected data frame');
          return;
        }
        if (fin) {
          this._handleText(payload);
        } else {
          this.fragmentOpcode = opcode;
          this.fragments = [payload];
          this.fragmentBytes = payload.length;
        }
        continue;
      }
      if (opcode === 0x0) {
        if (this.fragmentOpcode === null) {
          this.close(1002, 'Unexpected continuation frame');
          return;
        }
        this.fragments.push(payload);
        this.fragmentBytes += payload.length;
        if (this.fragmentBytes > MAX_MESSAGE_BYTES) {
          this.close(1009, 'Message too large');
          return;
        }
        if (fin) {
          const complete = Buffer.concat(this.fragments, this.fragmentBytes);
          this.fragmentOpcode = null;
          this.fragments = [];
          this.fragmentBytes = 0;
          this._handleText(complete);
        }
        continue;
      }

      this.close(1003, 'Unsupported frame type');
      return;
    }
  }

  _handleText(payload) {
    let text;
    try {
      text = payload.toString('utf8');
    } catch {
      this.close(1007, 'Invalid UTF-8');
      return;
    }
    this.emit('message', text);
  }

  _handleCloseFrame(payload) {
    let code = 1000;
    let reason = '';
    if (payload.length >= 2) {
      code = payload.readUInt16BE(0);
      reason = payload.subarray(2).toString('utf8');
    }
    if (!this.closeSent) {
      this._sendCloseFrame(code, reason);
    }
    this.closed = true;
    this.socket.end();
  }

  _handleSocketClose() {
    if (this._closeEmitted) return;
    this._closeEmitted = true;
    this.closed = true;
    clearInterval(this.heartbeat);
    wsConnections.delete(this);
    this.emit('close');
  }

  _sendFrame(opcode, payload) {
    if (this.closed || !this.socket.writable) return false;
    const length = payload.length;
    let header;
    if (length < 126) {
      header = Buffer.alloc(2);
      header[1] = length;
    } else if (length < 65536) {
      header = Buffer.alloc(4);
      header[1] = 126;
      header.writeUInt16BE(length, 2);
    } else {
      header = Buffer.alloc(10);
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(length), 2);
    }
    header[0] = 0x80 | opcode;
    try {
      this.socket.write(Buffer.concat([header, payload]));
      return true;
    } catch {
      this.terminate();
      return false;
    }
  }

  _sendCloseFrame(code = 1000, reason = '') {
    if (this.closeSent || this.closed) return;
    this.closeSent = true;
    const reasonBytes = Buffer.from(String(reason), 'utf8').subarray(0, 123);
    const payload = Buffer.alloc(2 + reasonBytes.length);
    payload.writeUInt16BE(code, 0);
    reasonBytes.copy(payload, 2);
    this._sendFrame(0x8, payload);
  }

  sendJSON(value) {
    return this.sendText(JSON.stringify(value));
  }

  sendText(text) {
    return this._sendFrame(0x1, Buffer.from(text, 'utf8'));
  }

  ping() {
    this._sendFrame(0x9, Buffer.alloc(0));
  }

  close(code = 1000, reason = '') {
    if (this.closed) return;
    this._sendCloseFrame(code, reason);
    this.closed = true;
    try {
      this.socket.end();
    } catch {
      this.terminate();
    }
  }

  terminate() {
    if (this.closed && this._closeEmitted) return;
    this.closed = true;
    try {
      this.socket.destroy();
    } catch {
      // Ignore sockets already destroyed.
    }
  }
}

function acceptUpgrade(req, socket, head) {
  const key = req.headers['sec-websocket-key'];
  const upgrade = String(req.headers.upgrade || '').toLowerCase();
  if (!key || upgrade !== 'websocket') {
    socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return null;
  }

  const accept = crypto
    .createHash('sha1')
    .update(key + WS_GUID)
    .digest('base64');

  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );

  const ws = new WebSocketConnection(socket);
  wsConnections.add(ws);
  return ws;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function now() {
  return Date.now();
}

function cleanName(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const stripped = value
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = Array.from(stripped).slice(0, 12);
  return chars.join('') || fallback;
}

function generateRoomCode() {
  let candidate = crypto.randomInt(1000, 10000);
  for (let attempt = 0; attempt < 9000; attempt += 1) {
    const code = String(candidate);
    if (!rooms.has(code)) return code;
    candidate = candidate >= 9999 ? 1000 : candidate + 1;
  }
  throw new Error('没有可用的 4 位房间号');
}

function createToken() {
  return crypto.randomBytes(24).toString('base64url');
}

function normalizeGameType(value) {
  return GAME_TYPES.has(value) ? value : 'gomoku';
}

function createGameBoard(game) {
  if (game === 'checkers') return new Uint8Array(CHECKERS_LAYOUT.initialBoard);
  if (game === 'poker') return [];
  return new Uint8Array(BOARD_CELLS);
}

function normalizePokerStack(value) {
  const numeric = Number(value);
  return POKER_STACK_OPTIONS.has(numeric) ? numeric : POKER_DEFAULT_STACK_BB;
}

function colorForSeat(room, seat) {
  return room.round % 2 === 1
    ? seat === 0
      ? 1
      : 2
    : seat === 0
      ? 2
      : 1;
}

function otherColor(color) {
  return color === 1 ? 2 : 1;
}

function makePlayer(name, seat) {
  return {
    token: createToken(),
    name,
    seat,
    ws: null,
    connected: false,
    wantsRematch: false,
    joinedAt: now(),
  };
}

function createPokerState(startingStackBb) {
  const chips = startingStackBb * POKER_BB_CHIPS;
  return {
    startingStackBb,
    startingChips: chips,
    smallBlind: POKER_SB_CHIPS,
    bigBlind: POKER_BB_CHIPS,
    stacks: { 1: chips, 2: chips },
    handNumber: 0,
    stage: 'waiting',
    buttonColor: 1,
    board: [],
    deck: [],
    holeCards: { 1: [], 2: [] },
    pot: 0,
    bets: { 1: 0, 2: 0 },
    committed: { 1: 0, 2: 0 },
    currentBet: 0,
    minRaise: POKER_BB_CHIPS,
    actionsThisRound: 0,
    actor: 0,
    lastAction: null,
    log: [],
    result: null,
    nextHandAt: null,
    nextHandTimer: null,
  };
}

function clearPokerTimer(room) {
  const timer = room && room.poker && room.poker.nextHandTimer;
  if (timer) {
    clearTimeout(timer);
    room.poker.nextHandTimer = null;
  }
  if (room && room.poker) room.poker.nextHandAt = null;
}

function pokerConnectedPlayers(room) {
  return Boolean(
    room.players[0] &&
      room.players[1] &&
      room.players[0].connected &&
      room.players[1].connected
  );
}

function pokerAvailableActions(room, color) {
  const p = room.poker;
  const active =
    room.status === 'playing' &&
    ['preflop', 'flop', 'turn', 'river'].includes(p.stage) &&
    p.actor === color;
  const toCall = Math.max(0, p.currentBet - p.bets[color]);
  const stack = p.stacks[color] || 0;
  const maxTotal = p.bets[color] + stack;
  const minRaiseTo = Math.min(
    Math.max(p.currentBet + p.minRaise, p.bigBlind),
    maxTotal
  );
  return {
    active,
    isTurn: active,
    canFold: active,
    canCheck: active && toCall === 0,
    canCall: active && toCall > 0 && stack > 0,
    callAmount: Math.min(toCall, stack),
    canBet: active && p.currentBet === 0 && stack > 0,
    canRaise: active && p.currentBet > 0 && maxTotal > p.currentBet && stack > toCall,
    minRaiseTo: minRaiseTo > p.currentBet ? minRaiseTo : maxTotal,
    maxRaiseTo: maxTotal,
    canAllIn: active && stack > 0,
    allInTo: maxTotal,
    toCall,
    stack,
    pot: p.pot,
    currentBet: p.currentBet,
    bigBlind: p.bigBlind,
  };
}

function pokerHandPublic(hand) {
  if (!hand) return null;
  return {
    cards: hand.cards.slice(),
    holeCards: hand.holeCards ? hand.holeCards.slice() : [],
    name: hand.name,
    bestFive: hand.bestFive ? hand.bestFive.slice() : [],
  };
}

function publicPokerResult(result, viewerColor) {
  if (!result) return null;
  return {
    handNumber: result.handNumber,
    winnerColor: result.winnerColor,
    pot: result.pot,
    reason: result.reason,
    reveal: Boolean(result.reveal),
    split: Boolean(result.split),
    board: result.board ? result.board.slice() : [],
    hands:
      result.reveal && result.hands
        ? {
            1: pokerHandPublic(result.hands[1]),
            2: pokerHandPublic(result.hands[2]),
          }
        : null,
    yourHand:
      result.reveal && result.hands && viewerColor
        ? pokerHandPublic(result.hands[viewerColor])
        : null,
  };
}

function publicPoker(room, viewer) {
  const p = room.poker;
  const viewerColor = viewer ? colorForSeat(room, viewer.seat) : 0;
  const opponentColor = viewerColor ? otherColor(viewerColor) : 0;
  const reveal = Boolean(p.result && p.result.reveal);
  return {
    startingStackBb: p.startingStackBb,
    startingChips: p.startingChips,
    smallBlind: p.smallBlind,
    bigBlind: p.bigBlind,
    handNumber: p.handNumber,
    stage: p.stage,
    board: p.board.slice(),
    pot: p.pot,
    stacks: { ...p.stacks },
    bets: { ...p.bets },
    committed: { ...p.committed },
    buttonColor: p.buttonColor,
    actor: p.actor,
    currentBet: p.currentBet,
    minRaise: p.minRaise,
    holeCards: viewerColor ? p.holeCards[viewerColor].slice() : [],
    opponentHoleCards:
      reveal && opponentColor ? p.holeCards[opponentColor].slice() : [],
    opponentCardCount: opponentColor ? p.holeCards[opponentColor].length : 0,
    availableActions: viewerColor ? pokerAvailableActions(room, viewerColor) : null,
    toCall: viewerColor ? Math.max(0, p.currentBet - p.bets[viewerColor]) : 0,
    result: publicPokerResult(p.result, viewerColor),
    nextHandAt: p.nextHandAt,
    serverNow: now(),
    lastAction: p.lastAction,
    log: p.log.slice(-10),
    yourColor: viewerColor,
  };
}

function postPokerBlind(p, color, amount) {
  const payment = Math.min(amount, p.stacks[color]);
  p.stacks[color] -= payment;
  p.bets[color] += payment;
  p.committed[color] += payment;
  p.pot += payment;
  return payment;
}

function dealPokerBoard(p, count) {
  if (p.deck.length > 0) p.deck.pop(); // burn
  for (let index = 0; index < count; index += 1) {
    if (p.deck.length > 0) p.board.push(p.deck.pop());
  }
}

function endPokerMatch(room, winnerColor, reason = 'busted') {
  const p = room.poker;
  clearPokerTimer(room);
  room.status = 'ended';
  room.winner = winnerColor;
  room.endReason = reason;
  room.turn = 0;
  p.actor = 0;
  p.nextHandAt = null;
  p.stage = 'matchOver';
  room.updatedAt = now();
}

function startPokerHand(room) {
  const p = room.poker;
  if (!p) return;
  clearPokerTimer(room);
  if (!room.players[0] || !room.players[1]) {
    p.stage = 'waiting';
    return;
  }
  if (p.stacks[1] <= 0 || p.stacks[2] <= 0) {
    endPokerMatch(room, p.stacks[1] <= 0 ? (p.stacks[2] <= 0 ? 0 : 2) : 1);
    return;
  }

  p.handNumber += 1;
  p.buttonColor = p.handNumber % 2 === 1 ? 1 : 2;
  p.stage = 'preflop';
  p.board = [];
  p.deck = Poker.shuffle(Poker.createDeck());
  p.holeCards = {
    1: [p.deck.pop(), p.deck.pop()],
    2: [p.deck.pop(), p.deck.pop()],
  };
  p.pot = 0;
  p.bets = { 1: 0, 2: 0 };
  p.committed = { 1: 0, 2: 0 };
  p.currentBet = 0;
  p.minRaise = p.bigBlind;
  p.actionsThisRound = 0;
  p.actor = 0;
  p.lastAction = null;
  p.log = [];
  p.result = null;
  p.nextHandAt = null;

  const smallBlindColor = p.buttonColor;
  const bigBlindColor = otherColor(smallBlindColor);
  const sbPaid = postPokerBlind(p, smallBlindColor, p.smallBlind);
  const bbPaid = postPokerBlind(p, bigBlindColor, p.bigBlind);
  p.currentBet = Math.max(p.bets[1], p.bets[2]);
  p.actor = smallBlindColor;
  p.log.push({
    street: 'preflop',
    color: smallBlindColor,
    action: 'small_blind',
    amount: sbPaid,
  });
  p.log.push({
    street: 'preflop',
    color: bigBlindColor,
    action: 'big_blind',
    amount: bbPaid,
  });

  room.status = 'playing';
  room.winner = 0;
  room.endReason = null;
  room.turn = p.actor;
  room.moveCount = p.handNumber;
  room.lastMove = null;
  room.updatedAt = now();

  if (p.stacks[1] === 0 || p.stacks[2] === 0) {
    resolvePokerShowdown(room);
  }
}

function scheduleNextPokerHand(room, delay = POKER_NEXT_HAND_DELAY_MS) {
  const p = room.poker;
  clearPokerTimer(room);
  if (
    !p ||
    room.status !== 'playing' ||
    p.stage !== 'handComplete' ||
    !pokerConnectedPlayers(room)
  ) {
    if (p) p.nextHandAt = null;
    return;
  }
  p.nextHandAt = now() + delay;
  p.nextHandTimer = setTimeout(() => {
    if (!rooms.has(room.code)) return;
    p.nextHandTimer = null;
    p.nextHandAt = null;
    if (room.status !== 'playing' || p.stage !== 'handComplete') return;
    if (!pokerConnectedPlayers(room)) {
      broadcastRoom(room);
      return;
    }
    startPokerHand(room);
    broadcastRoom(room);
  }, delay);
  p.nextHandTimer.unref?.();
}

function refundUncalledPoker(room) {
  const p = room.poker;
  const matched = Math.min(p.committed[1], p.committed[2]);
  for (const color of [1, 2]) {
    const refund = p.committed[color] - matched;
    if (refund > 0) {
      p.stacks[color] += refund;
      p.pot -= refund;
      p.committed[color] = matched;
    }
  }
  if (p.pot < 0) p.pot = 0;
}

function finishPokerHand(room, result) {
  const p = room.poker;
  p.result = result;
  p.stage = 'handComplete';
  p.actor = 0;
  p.currentBet = 0;
  p.actionsThisRound = 0;
  p.bets = { 1: 0, 2: 0 };
  p.committed = { 1: 0, 2: 0 };
  p.pot = result.pot;
  p.nextHandAt = null;
  room.turn = 0;
  room.moveCount = p.handNumber;
  room.updatedAt = now();
  room.history.push({
    handNumber: p.handNumber,
    winnerColor: result.winnerColor,
    pot: result.pot,
    reason: result.reason,
    split: result.split,
    at: now(),
  });
  if (room.history.length > 40) room.history.splice(0, room.history.length - 40);

  const bustedOne = p.stacks[1] <= 0;
  const bustedTwo = p.stacks[2] <= 0;
  if (bustedOne || bustedTwo) {
    clearPokerTimer(room);
    p.stage = 'matchOver';
    room.status = 'ended';
    room.winner = bustedOne && bustedTwo ? 0 : bustedOne ? 2 : 1;
    room.endReason = bustedOne && bustedTwo ? 'draw' : 'busted';
    room.updatedAt = now();
    return;
  }

  room.status = 'playing';
  scheduleNextPokerHand(room);
}

function foldPokerHand(room, folderColor) {
  const p = room.poker;
  const winnerColor = otherColor(folderColor);
  const pot = p.pot;
  p.stacks[winnerColor] += pot;
  p.pot = 0;
  finishPokerHand(room, {
    handNumber: p.handNumber,
    winnerColor,
    pot,
    reason: 'fold',
    reveal: false,
    split: false,
    board: p.board.slice(),
    hands: null,
  });
}

function resolvePokerShowdown(room) {
  const p = room.poker;
  if (p.stage === 'handComplete' || p.stage === 'matchOver') return;
  while (p.board.length < 5) {
    dealPokerBoard(p, p.board.length === 0 ? 3 : 1);
  }
  refundUncalledPoker(room);

  const bestOne = Poker.bestHand(p.holeCards[1].concat(p.board));
  const bestTwo = Poker.bestHand(p.holeCards[2].concat(p.board));
  const comparison = Poker.compareScores(bestOne.score, bestTwo.score);
  const pot = p.pot;
  const hands = {
    1: {
      cards: p.holeCards[1].concat(p.board),
      holeCards: p.holeCards[1].slice(),
      name: bestOne.name,
      bestFive: bestOne.cards,
    },
    2: {
      cards: p.holeCards[2].concat(p.board),
      holeCards: p.holeCards[2].slice(),
      name: bestTwo.name,
      bestFive: bestTwo.cards,
    },
  };

  let winnerColor = 0;
  let split = false;
  if (comparison > 0) {
    winnerColor = 1;
    p.stacks[1] += pot;
  } else if (comparison < 0) {
    winnerColor = 2;
    p.stacks[2] += pot;
  } else {
    split = true;
    const share = Math.floor(pot / 2);
    const odd = pot - share * 2;
    p.stacks[1] += share;
    p.stacks[2] += share;
    if (odd > 0) p.stacks[p.buttonColor] += odd;
  }
  p.pot = 0;

  finishPokerHand(room, {
    handNumber: p.handNumber,
    winnerColor,
    pot,
    reason: split ? 'split' : 'showdown',
    reveal: true,
    split,
    board: p.board.slice(),
    hands,
  });
}

function completePokerStreet(room) {
  const p = room.poker;
  if (p.stage === 'handComplete' || p.stage === 'matchOver') return;
  if (p.stacks[1] === 0 || p.stacks[2] === 0) {
    resolvePokerShowdown(room);
    return;
  }

  if (p.stage === 'river') {
    resolvePokerShowdown(room);
    return;
  }

  if (p.stage === 'preflop') {
    dealPokerBoard(p, 3);
    p.stage = 'flop';
  } else if (p.stage === 'flop') {
    dealPokerBoard(p, 1);
    p.stage = 'turn';
  } else if (p.stage === 'turn') {
    dealPokerBoard(p, 1);
    p.stage = 'river';
  }

  p.bets = { 1: 0, 2: 0 };
  p.currentBet = 0;
  p.minRaise = p.bigBlind;
  p.actionsThisRound = 0;
  p.actor = otherColor(p.buttonColor);
  room.turn = p.actor;
  room.updatedAt = now();

  if (p.stacks[p.actor] === 0) resolvePokerShowdown(room);
}

function recordPokerAction(room, color, action, amount, pay = 0) {
  const p = room.poker;
  const entry = {
    street: p.stage,
    color,
    action,
    amount,
    pay,
    handNumber: p.handNumber,
  };
  p.lastAction = entry;
  p.log.push(entry);
  if (p.log.length > 30) p.log.splice(0, p.log.length - 30);
  room.updatedAt = now();
}

function applyPokerAction(room, color, rawAction, rawAmount) {
  const p = room.poker;
  if (!['preflop', 'flop', 'turn', 'river'].includes(p.stage)) {
    return { ok: false, message: '当前不在行动阶段' };
  }
  if (room.turn !== color || p.actor !== color) {
    return { ok: false, message: '还没轮到你行动' };
  }
  const action = String(rawAction || '');
  const available = pokerAvailableActions(room, color);
  if (!available.active) return { ok: false, message: '当前无法行动' };

  const toCall = Math.max(0, p.currentBet - p.bets[color]);
  const stack = p.stacks[color];
  const maxTotal = p.bets[color] + stack;

  if (action === 'fold') {
    recordPokerAction(room, color, 'fold', 0, 0);
    foldPokerHand(room, color);
    return { ok: true };
  }

  if (action === 'check') {
    if (toCall !== 0) return { ok: false, message: '面对下注时不能过牌' };
    recordPokerAction(room, color, 'check', 0, 0);
    p.actionsThisRound += 1;
    if (p.actionsThisRound >= 2) {
      completePokerStreet(room);
    } else {
      p.actor = otherColor(color);
      room.turn = p.actor;
    }
    return { ok: true };
  }

  if (action === 'call') {
    if (toCall <= 0) return { ok: false, message: '没有需要跟注的金额' };
    const pay = Math.min(toCall, stack);
    p.stacks[color] -= pay;
    p.bets[color] += pay;
    p.committed[color] += pay;
    p.pot += pay;
    p.actionsThisRound += 1;
    recordPokerAction(room, color, p.stacks[color] === 0 ? 'allin_call' : 'call', p.bets[color], pay);
    if (p.stacks[color] === 0) {
      resolvePokerShowdown(room);
    } else if (p.actionsThisRound >= 2 && p.bets[1] === p.bets[2]) {
      completePokerStreet(room);
    } else {
      p.actor = otherColor(color);
      room.turn = p.actor;
    }
    return { ok: true };
  }

  if (!['bet', 'raise', 'allin'].includes(action)) {
    return { ok: false, message: '未知的行动' };
  }

  if (action === 'allin') {
    if (stack <= 0) return { ok: false, message: '没有筹码可以全下' };
    const target = maxTotal;
    if (target <= p.currentBet) {
      // 全下金额不足以加注，等同于全下跟注。
      const pay = stack;
      p.stacks[color] = 0;
      p.bets[color] += pay;
      p.committed[color] += pay;
      p.pot += pay;
      p.actionsThisRound += 1;
      recordPokerAction(room, color, 'allin_call', p.bets[color], pay);
      resolvePokerShowdown(room);
      return { ok: true };
    }
    return applyPokerAggression(room, color, 'allin', target);
  }

  const amount = Number(rawAmount);
  if (!Number.isInteger(amount) || amount <= 0) {
    return { ok: false, message: '下注金额无效' };
  }
  if (action === 'bet') {
    if (p.currentBet !== 0) return { ok: false, message: '当前应选择加注' };
    if (amount <= p.bets[color]) return { ok: false, message: '下注金额过低' };
    if (amount > maxTotal) return { ok: false, message: '下注金额超过筹码' };
    const isAllIn = amount === maxTotal;
    if (!isAllIn && amount < p.bets[color] + p.bigBlind) {
      return { ok: false, message: `最小下注为 ${p.bigBlind / POKER_BB_CHIPS} BB` };
    }
    return applyPokerAggression(room, color, 'bet', amount);
  }

  if (p.currentBet <= 0) return { ok: false, message: '当前应选择下注' };
  if (amount <= p.currentBet) return { ok: false, message: '加注金额必须高于当前下注' };
  if (amount > maxTotal) return { ok: false, message: '加注金额超过筹码' };
  const isAllIn = amount === maxTotal;
  if (!isAllIn && amount < p.currentBet + p.minRaise) {
    return {
      ok: false,
      message: `最小加注到 ${(p.currentBet + p.minRaise) / POKER_BB_CHIPS} BB`,
    };
  }
  return applyPokerAggression(room, color, 'raise', amount);
}

function applyPokerAggression(room, color, action, target) {
  const p = room.poker;
  const previousCurrentBet = p.currentBet;
  const pay = target - p.bets[color];
  if (pay <= 0 || pay > p.stacks[color]) {
    return { ok: false, message: '下注金额无效' };
  }
  p.stacks[color] -= pay;
  p.bets[color] += pay;
  p.committed[color] += pay;
  p.pot += pay;
  p.currentBet = Math.max(p.currentBet, target);
  const raiseSize = target - previousCurrentBet;
  if (raiseSize >= p.minRaise) p.minRaise = raiseSize;
  p.actionsThisRound += 1;
  p.actor = otherColor(color);
  room.turn = p.actor;
  recordPokerAction(room, color, action, target, pay);

  if (p.stacks[p.actor] === 0) {
    resolvePokerShowdown(room);
  }
  return { ok: true };
}

function publicPlayer(room, player) {
  if (!player) return null;
  return {
    name: player.name,
    color: colorForSeat(room, player.seat),
    connected: Boolean(player.ws && player.connected),
    wantsRematch: Boolean(player.wantsRematch),
  };
}

function publicRoom(room, viewer) {
  return {
    code: room.code,
    game: room.game,
    board: Array.from(room.board),
    turn: room.turn,
    status: room.status,
    winner: room.winner,
    winningLine: room.winningLine,
    endReason: room.endReason,
    lastMove: room.lastMove,
    moveCount: room.moveCount,
    round: room.round,
    history: room.history,
    createdAt: room.createdAt,
    poker: room.game === 'poker' ? publicPoker(room, viewer) : null,
    players: room.players.map((player) => publicPlayer(room, player)),
    yourColor: viewer ? colorForSeat(room, viewer.seat) : 0,
    youAreHost: viewer ? viewer.seat === 0 : false,
  };
}

function send(ws, message) {
  if (ws && !ws.closed) ws.sendJSON(message);
}

function broadcastRoom(room) {
  room.updatedAt = now();
  for (const player of room.players) {
    if (!player || !player.ws) continue;
    send(player.ws, { type: 'room', room: publicRoom(room, player) });
  }
}

function detachPlayer(player) {
  if (!player) return;
  const ws = player.ws;
  if (ws && ws.session && ws.session.player === player) {
    ws.session.player = null;
    ws.session.room = null;
  }
  player.ws = null;
  player.connected = false;
}

function clearRoomTimer(room) {
  if (room.closeTimer) {
    clearTimeout(room.closeTimer);
    room.closeTimer = null;
  }
}

function scheduleRoomCloseIfNeeded(room) {
  clearRoomTimer(room);
  const players = room.players.filter(Boolean);
  if (players.length === 0) return;
  const everyoneConnected = players.every((player) => player.ws && player.connected);
  if (everyoneConnected) return;

  room.closeTimer = setTimeout(() => {
    const stillHere = rooms.get(room.code);
    if (!stillHere) return;
    const stillDisconnected = stillHere.players
      .filter(Boolean)
      .some((player) => !player.connected);
    if (stillDisconnected) {
      closeRoom(stillHere, 'opponent_timeout', '对手长时间未连接，房间已关闭');
    }
  }, DISCONNECT_GRACE_MS);
  room.closeTimer.unref?.();
}

function closeRoom(room, reason, message) {
  if (!rooms.has(room.code)) return;
  rooms.delete(room.code);
  clearRoomTimer(room);
  clearPokerTimer(room);
  for (const player of room.players) {
    if (!player) continue;
    const ws = player.ws;
    if (ws) {
      send(ws, {
        type: 'room_closed',
        reason,
        message: message || '房间已关闭',
      });
    }
    detachPlayer(player);
  }
}

function startNextRound(room) {
  room.round += 1;
  clearPokerTimer(room);
  room.board = createGameBoard(room.game);
  room.turn = room.game === 'poker' ? 0 : 1;
  room.status = 'playing';
  room.winner = 0;
  room.winningLine = [];
  room.endReason = null;
  room.lastMove = null;
  room.moveCount = 0;
  room.history = [];
  for (const player of room.players) {
    if (player) player.wantsRematch = false;
  }
  if (room.game === 'poker') {
    const startingStackBb = room.poker ? room.poker.startingStackBb : POKER_DEFAULT_STACK_BB;
    room.poker = createPokerState(startingStackBb);
  }
  room.updatedAt = now();
  if (room.game === 'poker') startPokerHand(room);
}

function findWinningLine(board, row, col, color) {
  const directions = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ];

  for (const [dr, dc] of directions) {
    const line = [{ row, col }];

    for (const sign of [-1, 1]) {
      let r = row + dr * sign;
      let c = col + dc * sign;
      while (
        r >= 0 &&
        r < BOARD_SIZE &&
        c >= 0 &&
        c < BOARD_SIZE &&
        board[r * BOARD_SIZE + c] === color
      ) {
        if (sign === -1) line.unshift({ row: r, col: c });
        else line.push({ row: r, col: c });
        r += dr * sign;
        c += dc * sign;
      }
    }

    if (line.length >= 5) return line;
  }
  return null;
}

function normalizeRoomCode(value) {
  return String(value || '').trim();
}

// ---------------------------------------------------------------------------
// Session handlers
// ---------------------------------------------------------------------------

function handleCreate(ws, msg) {
  if (ws.session.room) {
    send(ws, { type: 'error', code: 'ALREADY_IN_ROOM', message: '你已经在房间中' });
    return;
  }
  if (rooms.size >= MAX_ROOMS) {
    send(ws, { type: 'error', code: 'SERVER_FULL', message: '服务器房间已满，请稍后再试' });
    return;
  }

  const name = cleanName(msg.name, '房主');
  const game = normalizeGameType(msg.game);
  const startingStackBb = normalizePokerStack(msg.startingStackBb);
  const room = {
    code: generateRoomCode(),
    game,
    startingStackBb,
    createdAt: now(),
    updatedAt: now(),
    round: 1,
    players: [makePlayer(name, 0), null],
    board: createGameBoard(game),
    turn: game === 'poker' ? 0 : 1,
    status: 'waiting',
    winner: 0,
    winningLine: [],
    endReason: null,
    lastMove: null,
    moveCount: 0,
    history: [],
    poker: game === 'poker' ? createPokerState(startingStackBb) : null,
    closeTimer: null,
  };
  const host = room.players[0];
  host.ws = ws;
  host.connected = true;
  rooms.set(room.code, room);
  ws.session.room = room;
  ws.session.player = host;

  send(ws, {
    type: 'joined',
    token: host.token,
    room: publicRoom(room, host),
  });
}

function handleJoin(ws, msg) {
  if (ws.session.room) {
    send(ws, { type: 'error', code: 'ALREADY_IN_ROOM', message: '你已经在房间中' });
    return;
  }

  const code = normalizeRoomCode(msg.room);
  if (!/^\d{4}$/.test(code)) {
    send(ws, { type: 'error', code: 'BAD_ROOM_CODE', message: '请输入 4 位数字房间号' });
    return;
  }

  const room = rooms.get(code);
  if (!room) {
    send(ws, { type: 'error', code: 'ROOM_NOT_FOUND', message: '房间不存在，请核对房间号' });
    return;
  }
  if (room.players[1]) {
    send(ws, { type: 'error', code: 'ROOM_FULL', message: '房间已满，无法加入' });
    return;
  }
  if (!room.players[0] || !room.players[0].connected) {
    send(ws, {
      type: 'error',
      code: 'HOST_OFFLINE',
      message: '房主暂时离线，请稍后再试',
    });
    return;
  }

  const guest = makePlayer(cleanName(msg.name, '棋友'), 1);
  guest.ws = ws;
  guest.connected = true;
  room.players[1] = guest;
  room.status = 'playing';
  room.turn = 1;
  room.updatedAt = now();
  room.players.forEach((player) => {
    if (player) player.wantsRematch = false;
  });
  clearRoomTimer(room);
  ws.session.room = room;
  ws.session.player = guest;
  if (room.game === 'poker') startPokerHand(room);

  send(ws, {
    type: 'joined',
    token: guest.token,
    room: publicRoom(room, guest),
  });
  broadcastRoom(room);
  scheduleRoomCloseIfNeeded(room);
}

function handleRejoin(ws, msg) {
  if (ws.session.room) {
    send(ws, { type: 'error', code: 'ALREADY_IN_ROOM', message: '你已经在房间中' });
    return;
  }
  const code = normalizeRoomCode(msg.room);
  const token = String(msg.token || '');
  const room = rooms.get(code);
  if (!room) {
    send(ws, { type: 'error', code: 'ROOM_NOT_FOUND', message: '房间已关闭或不存在' });
    return;
  }

  const player = room.players.find((entry) => entry && entry.token === token);
  if (!player) {
    send(ws, { type: 'error', code: 'REJOIN_FAILED', message: '无法恢复此房间的座位' });
    return;
  }

  const oldSocket = player.ws;
  if (oldSocket && oldSocket !== ws) {
    if (oldSocket.session && oldSocket.session.player === player) {
      oldSocket.session.player = null;
      oldSocket.session.room = null;
    }
    oldSocket.close(4001, 'Session resumed elsewhere');
  }

  player.ws = ws;
  player.connected = true;
  ws.session.room = room;
  ws.session.player = player;
  if (room.players[0] && room.players[1] && room.status === 'waiting') {
    room.status = 'playing';
    room.turn = 1;
  }
  clearRoomTimer(room);
  scheduleRoomCloseIfNeeded(room);

  if (room.game === 'poker') {
    if (room.players[0] && room.players[1]) {
      if (room.poker.stage === 'waiting') {
        startPokerHand(room);
      } else if (room.poker.stage === 'handComplete' && pokerConnectedPlayers(room)) {
        scheduleNextPokerHand(room, 2600);
      }
    }
  }

  send(ws, {
    type: 'joined',
    token: player.token,
    room: publicRoom(room, player),
  });
  broadcastRoom(room);
}

const CHECKERS_ERROR_MESSAGES = {
  BAD_FROM: '请选择一枚棋子',
  NO_PIECE: '这里没有可以移动的棋子',
  WRONG_PIECE: '请选择自己的棋子',
  BAD_PATH: '走子路径无效',
  REPEATED: '连跳不能重复经过同一位置',
  NOT_REACHABLE: '这一步走不到',
  MIXED_PATH: '连跳不能混入普通走步',
  NO_PIECE_TO_JUMP: '跳跃路径被挡住了',
  OCCUPIED: '目标位置已经有棋子',
};

function finishGame(room, winner, endReason) {
  room.status = 'ended';
  room.winner = winner;
  room.turn = 0;
  room.endReason = endReason;
  if (winner === 0) room.winningLine = [];
  for (const entry of room.players) {
    if (entry) entry.wantsRematch = false;
  }
  broadcastRoom(room);
}

function handleGomokuMove(ws, msg, room, color) {
  const row = msg.row;
  const col = msg.col;
  if (
    !Number.isInteger(row) ||
    !Number.isInteger(col) ||
    row < 0 ||
    row >= BOARD_SIZE ||
    col < 0 ||
    col >= BOARD_SIZE
  ) {
    send(ws, { type: 'error', code: 'BAD_MOVE', message: '落子位置无效' });
    return;
  }

  const index = row * BOARD_SIZE + col;
  if (room.board[index] !== 0) {
    send(ws, { type: 'error', code: 'OCCUPIED', message: '这里已经有棋子了' });
    return;
  }

  room.board[index] = color;
  room.moveCount += 1;
  room.lastMove = { row, col, color, moveNumber: room.moveCount };
  room.history.push({ row, col, color, moveNumber: room.moveCount });
  room.updatedAt = now();

  const winningLine = findWinningLine(room.board, row, col, color);
  if (winningLine) {
    room.winningLine = winningLine;
    finishGame(room, color, 'five');
    return;
  }

  if (room.moveCount >= BOARD_CELLS) {
    finishGame(room, 0, 'draw');
    return;
  }

  room.turn = otherColor(color);
  broadcastRoom(room);
}

function handleCheckersMove(ws, msg, room, color) {
  const from = msg.from;
  const path = msg.path;
  const result = Checkers.applyMove(CHECKERS_LAYOUT, room.board, color, from, path);
  if (!result.ok) {
    send(ws, {
      type: 'error',
      code: 'ILLEGAL_CHECKERS_MOVE',
      message: CHECKERS_ERROR_MESSAGES[result.reason] || '这一步不合规则',
    });
    return;
  }

  room.board = new Uint8Array(result.board);
  room.moveCount += 1;
  room.lastMove = {
    from,
    to: result.to,
    path: result.path,
    type: result.type,
    jumps: result.jumps,
    color,
    moveNumber: room.moveCount,
  };
  room.history.push({
    from,
    to: result.to,
    path: result.path,
    type: result.type,
    jumps: result.jumps,
    color,
    moveNumber: room.moveCount,
  });
  room.updatedAt = now();

  if (result.won) {
    room.winningLine = [];
    finishGame(room, color, 'home');
    return;
  }

  room.turn = otherColor(color);
  broadcastRoom(room);
}

function handlePokerAction(ws, msg) {
  const room = ws.session.room;
  const player = ws.session.player;
  if (!room || !player) {
    send(ws, { type: 'error', code: 'NOT_IN_ROOM', message: '请先加入房间' });
    return;
  }
  if (room.game !== 'poker') {
    send(ws, { type: 'error', code: 'WRONG_GAME', message: '当前房间不是德州扑克' });
    return;
  }
  if (room.status !== 'playing') {
    send(ws, { type: 'error', code: 'GAME_NOT_PLAYING', message: '当前牌局不在行动阶段' });
    return;
  }
  const opponent = room.players.find((entry) => entry && entry !== player);
  if (!opponent || !opponent.ws || !opponent.connected) {
    send(ws, {
      type: 'error',
      code: 'OPPONENT_OFFLINE',
      message: '对手暂时离线，牌局已暂停',
    });
    return;
  }
  const color = colorForSeat(room, player.seat);
  const result = applyPokerAction(room, color, msg.action, msg.amount);
  if (!result.ok) {
    send(ws, { type: 'error', code: 'POKER_ACTION', message: result.message });
    return;
  }
  broadcastRoom(room);
}

function handleMove(ws, msg) {
  const room = ws.session.room;
  const player = ws.session.player;
  if (!room || !player) {
    send(ws, { type: 'error', code: 'NOT_IN_ROOM', message: '请先加入房间' });
    return;
  }
  if (room.game === 'poker') {
    send(ws, { type: 'error', code: 'WRONG_GAME', message: '德州扑克请使用下注操作' });
    return;
  }
  if (room.status !== 'playing') {
    send(ws, {
      type: 'error',
      code: 'GAME_NOT_PLAYING',
      message: room.game === 'checkers' ? '当前无法走棋' : '当前无法落子',
    });
    return;
  }

  const opponent = room.players.find((entry) => entry && entry !== player);
  if (!opponent || !opponent.ws || !opponent.connected) {
    send(ws, {
      type: 'error',
      code: 'OPPONENT_OFFLINE',
      message: '对手暂时离线，棋局已暂停',
    });
    return;
  }

  const color = colorForSeat(room, player.seat);
  if (room.turn !== color) {
    send(ws, { type: 'error', code: 'NOT_YOUR_TURN', message: '还没轮到你' });
    return;
  }

  if (room.game === 'checkers') {
    handleCheckersMove(ws, msg, room, color);
    return;
  }
  handleGomokuMove(ws, msg, room, color);
}

function handleResign(ws) {
  const room = ws.session.room;
  const player = ws.session.player;
  if (!room || !player) {
    send(ws, { type: 'error', code: 'NOT_IN_ROOM', message: '请先加入房间' });
    return;
  }
  if (room.status !== 'playing') {
    send(ws, { type: 'error', code: 'GAME_NOT_PLAYING', message: '当前无法认输' });
    return;
  }
  const color = colorForSeat(room, player.seat);
  if (room.game === 'poker') clearPokerTimer(room);
  room.status = 'ended';
  room.winner = otherColor(color);
  room.winningLine = [];
  room.endReason = 'resign';
  room.turn = 0;
  room.updatedAt = now();
  for (const entry of room.players) {
    if (entry) entry.wantsRematch = false;
  }
  broadcastRoom(room);
}

function handleRematch(ws) {
  const room = ws.session.room;
  const player = ws.session.player;
  if (!room || !player) {
    send(ws, { type: 'error', code: 'NOT_IN_ROOM', message: '请先加入房间' });
    return;
  }
  if (room.status !== 'ended') {
    send(ws, { type: 'error', code: 'GAME_NOT_ENDED', message: '本局还未结束' });
    return;
  }

  const opponent = room.players.find((entry) => entry && entry !== player);
  if (!opponent || !opponent.ws || !opponent.connected) {
    send(ws, {
      type: 'error',
      code: 'OPPONENT_OFFLINE',
      message: '对手不在线，暂时无法开始新一局',
    });
    return;
  }

  player.wantsRematch = true;
  room.updatedAt = now();
  const bothReady = room.players
    .filter(Boolean)
    .every((entry) => entry.wantsRematch && entry.ws && entry.connected);

  if (bothReady) {
    startNextRound(room);
    broadcastRoom(room);
    return;
  }
  broadcastRoom(room);
}

function handleLeave(ws) {
  const room = ws.session.room;
  const player = ws.session.player;
  if (!room || !player) {
    send(ws, { type: 'left' });
    return;
  }

  const opponent = room.players.find((entry) => entry && entry !== player);
  rooms.delete(room.code);
  clearRoomTimer(room);
  clearPokerTimer(room);

  const opponentSocket = opponent && opponent.ws;
  const opponentName = opponent && opponent.name;
  for (const entry of room.players) {
    if (entry) detachPlayer(entry);
  }

  send(ws, { type: 'left' });
  if (opponentSocket && !opponentSocket.closed) {
    send(opponentSocket, {
      type: 'room_closed',
      reason: 'opponent_left',
      message: opponentName
        ? `${player.name} 已离开，房间关闭`
        : '对手已离开，房间关闭',
    });
  }
}

function handleMessage(ws, raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    send(ws, { type: 'error', code: 'BAD_JSON', message: '消息格式错误' });
    return;
  }
  if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') {
    send(ws, { type: 'error', code: 'BAD_MESSAGE', message: '消息格式错误' });
    return;
  }

  switch (msg.type) {
    case 'create':
      handleCreate(ws, msg);
      break;
    case 'join':
      handleJoin(ws, msg);
      break;
    case 'rejoin':
      handleRejoin(ws, msg);
      break;
    case 'move':
      handleMove(ws, msg);
      break;
    case 'pokerAction':
      handlePokerAction(ws, msg);
      break;
    case 'resign':
      handleResign(ws);
      break;
    case 'rematch':
      handleRematch(ws);
      break;
    case 'leave':
      handleLeave(ws);
      break;
    case 'ping':
      send(ws, { type: 'pong', t: msg.t });
      break;
    default:
      send(ws, { type: 'error', code: 'UNKNOWN_TYPE', message: '未知的消息类型' });
  }
}

function attachWebSocket(ws) {
  ws.session = { room: null, player: null };

  ws.on('message', (raw) => {
    try {
      handleMessage(ws, raw);
    } catch (error) {
      console.error('[ws] Unhandled message error:', error);
      send(ws, { type: 'error', code: 'SERVER_ERROR', message: '服务器处理请求时出错' });
    }
  });

  ws.on('close', () => {
    const player = ws.session.player;
    const room = ws.session.room;
    if (player && room && player.ws === ws) {
      player.ws = null;
      player.connected = false;
      room.updatedAt = now();
      scheduleRoomCloseIfNeeded(room);
      broadcastRoom(room);
    }
    ws.session.player = null;
    ws.session.room = null;
  });

  send(ws, { type: 'hello', version: 1 });
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

function getNetworkUrls(port) {
  const urls = [];
  const interfaces = os.networkInterfaces();
  for (const [name, addresses] of Object.entries(interfaces)) {
    if (!addresses) continue;
    for (const address of addresses) {
      const isIpv4 = address.family === 'IPv4' || address.family === 4;
      if (isIpv4 && !address.internal) {
        urls.push({ name, address: address.address, url: `http://${address.address}:${port}` });
      }
    }
  }
  const score = (entry) => {
    if (entry.address.startsWith('192.168.')) return 0;
    if (entry.address.startsWith('10.')) return 1;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(entry.address)) return 2;
    return 3;
  };
  urls.sort((a, b) => score(a) - score(b));
  return urls;
}

function writeJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

async function serveStatic(req, res, pathname) {
  let relativePath;
  try {
    relativePath = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad request');
    return;
  }

  if (relativePath === '/' || relativePath === '') relativePath = '/index.html';
  const resolved = path.resolve(PUBLIC_DIR, `.${relativePath}`);
  if (resolved !== PUBLIC_DIR && !resolved.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  let stat;
  try {
    stat = await fsp.stat(resolved);
  } catch {
    res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  if (!stat.isFile()) {
    res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  const ext = path.extname(resolved).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const headers = {
    ...SECURITY_HEADERS,
    'Content-Type': contentType,
    'Content-Length': stat.size,
    'Cache-Control': 'no-cache',
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
      "script-src 'self'; connect-src 'self' ws: wss:; font-src 'self'; " +
      "object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  };

  if (req.method === 'HEAD') {
    res.writeHead(200, headers);
    res.end();
    return;
  }

  res.writeHead(200, headers);
  const stream = fs.createReadStream(resolved);
  stream.pipe(res);
  stream.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(500, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
    }
    res.end('Internal server error');
  });
}

function createServer() {
  const server = http.createServer(async (req, res) => {
    try {
      const parsed = new URL(req.url || '/', 'http://localhost');
      const pathname = parsed.pathname;

      if (pathname === '/health') {
        writeJson(res, 200, { ok: true, rooms: rooms.size, uptime: process.uptime() });
        return;
      }

      if (pathname === '/api/info') {
        const address = server.address();
        const port = address && typeof address === 'object' ? address.port : 3000;
        writeJson(res, 200, {
          name: '连珠 · LAN Board Games',
          boardSize: BOARD_SIZE,
          games: [
            { id: 'gomoku', name: '五子棋', boardSize: BOARD_SIZE },
            { id: 'checkers', name: '中国跳棋', holes: CHECKERS_CELLS },
            {
              id: 'poker',
              name: '德州扑克',
              mode: 'heads-up no-limit holdem',
              stackOptionsBb: [...POKER_STACK_OPTIONS],
            },
          ],
          hostname: os.hostname(),
          port,
          urls: getNetworkUrls(port),
        });
        return;
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, {
          ...SECURITY_HEADERS,
          Allow: 'GET, HEAD',
          'Content-Type': 'text/plain; charset=utf-8',
        });
        res.end('Method not allowed');
        return;
      }

      await serveStatic(req, res, pathname);
    } catch (error) {
      console.error('[http] Request error:', error);
      if (!res.headersSent) {
        res.writeHead(500, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
      }
      res.end('Internal server error');
    }
  });

  server.on('upgrade', (req, socket, head) => {
    let pathname = '/';
    try {
      pathname = new URL(req.url || '/', 'http://localhost').pathname;
    } catch {
      // Fall through to rejection.
    }
    if (pathname !== '/ws') {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    const ws = acceptUpgrade(req, socket, head);
    if (ws) {
      attachWebSocket(ws);
      if (head && head.length > 0) ws._receive(head);
    }
  });

  const idleSweep = setInterval(() => {
    const cutoff = now() - ROOM_MAX_IDLE_MS;
    for (const room of [...rooms.values()]) {
      if (room.updatedAt < cutoff) {
        closeRoom(room, 'room_expired', '房间长时间无活动，已自动关闭');
      }
    }
  }, 30 * 60 * 1000);
  idleSweep.unref?.();

  server.on('close', () => {
    clearInterval(idleSweep);
    for (const ws of wsConnections) ws.terminate();
    wsConnections.clear();
    for (const room of rooms.values()) {
      clearRoomTimer(room);
      clearPokerTimer(room);
    }
    rooms.clear();
  });

  return server;
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

async function startServer(options = {}) {
  const preferredPort = Number.isInteger(options.port)
    ? options.port
    : Number(process.env.PORT) || 3000;
  const host = options.host || process.env.HOST || '0.0.0.0';
  const server = createServer();

  let port = preferredPort;
  if (preferredPort === 0) {
    await listen(server, 0, host);
  } else {
    let lastError;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        await listen(server, preferredPort + attempt, host);
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        if (error.code !== 'EADDRINUSE') throw error;
      }
    }
    if (lastError) {
      throw new Error(
        `端口 ${preferredPort}-${preferredPort + 9} 均被占用，请设置环境变量 PORT 后重试。`
      );
    }
  }

  const address = server.address();
  const actualPort = address && typeof address === 'object' ? address.port : port;
  const urls = getNetworkUrls(actualPort);

  return {
    server,
    port: actualPort,
    urls,
    localUrl: `http://localhost:${actualPort}`,
  };
}

function printBanner(port, urls) {
  const line = '─'.repeat(52);
  console.log('');
  console.log(`  ●●●●●   连珠 · LAN Board Games`);
  console.log(`  ${line}`);
  console.log(`  本机打开      http://localhost:${port}`);
  if (urls.length > 0) {
    for (const entry of urls) {
      console.log(`  局域网打开    ${entry.url}`);
    }
  } else {
    console.log('  未检测到局域网 IPv4 地址，请检查网络连接');
  }
  console.log(`  ${line}`);
  console.log('  房主创建房间后，把邀请链接发给同一 Wi-Fi 下的朋友。');
  console.log('  按 Ctrl+C 停止服务器。');
  console.log('');
}

async function main() {
  const { server, port, urls, localUrl } = await startServer();
  printBanner(port, urls);

  if (process.env.AUTO_OPEN === '1' && process.platform === 'win32') {
    try {
      const child = spawn('cmd', ['/c', 'start', '', localUrl], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.unref();
    } catch {
      // Opening the browser is a convenience only.
    }
  }

  const shutdown = () => {
    console.log('\n正在关闭服务器…');
    for (const ws of wsConnections) {
      send(ws, { type: 'room_closed', reason: 'server_shutdown', message: '服务器已关闭' });
      ws.close(1001, 'Server shutting down');
    }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('\n启动失败：', error.message || error);
    process.exit(1);
  });
}

module.exports = {
  createServer,
  startServer,
  printBanner,
  BOARD_SIZE,
  rooms,
};
