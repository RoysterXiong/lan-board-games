'use strict';

const assert = require('node:assert/strict');
const Checkers = require('../public/checkers-core');
const Poker = require('../public/poker-core');
const { startServer } = require('../server');

class TestClient {
  constructor(url, label) {
    this.label = label;
    this.queue = [];
    this.waiters = [];
    this.closed = false;
    this.ws = new WebSocket(url);
    this.ws.addEventListener('message', (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      const waiterIndex = this.waiters.findIndex((waiter) => waiter.predicate(message));
      if (waiterIndex >= 0) {
        const [waiter] = this.waiters.splice(waiterIndex, 1);
        clearTimeout(waiter.timer);
        waiter.resolve(message);
      } else {
        this.queue.push(message);
      }
    });
    this.ws.addEventListener('close', () => {
      this.closed = true;
      for (const waiter of this.waiters.splice(0)) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error(`${label} closed while waiting for ${waiter.description}`));
      }
    });
  }

  open() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${this.label} open timeout`)), 3000);
      this.ws.addEventListener(
        'open',
        () => {
          clearTimeout(timer);
          resolve(this);
        },
        { once: true }
      );
      this.ws.addEventListener(
        'error',
        () => {
          clearTimeout(timer);
          reject(new Error(`${this.label} connection error`));
        },
        { once: true }
      );
    });
  }

  send(message) {
    this.ws.send(JSON.stringify(message));
  }

  waitFor(predicate, description = 'message', timeout = 3000) {
    const queuedIndex = this.queue.findIndex(predicate);
    if (queuedIndex >= 0) {
      return Promise.resolve(this.queue.splice(queuedIndex, 1)[0]);
    }
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, reject, description, timer: null };
      waiter.timer = setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new Error(`${this.label} timed out waiting for ${description}`));
      }, timeout);
      this.waiters.push(waiter);
    });
  }

  waitForRoom(description, predicate = () => true, timeout = 3000) {
    return this.waitFor(
      (message) => message.type === 'room' && predicate(message.room),
      description,
      timeout
    );
  }

  close() {
    try {
      this.ws.close();
    } catch {
      // Ignore.
    }
  }
}

async function main() {
  const globalGuard = setTimeout(() => {
    console.error('\n测试全局超时，强制退出。');
    process.exit(2);
  }, 30_000);
  globalGuard.unref();

  const { server, port, localUrl } = await startServer({ port: 0, host: '127.0.0.1' });
  const wsUrl = localUrl.replace('http://', 'ws://') + '/ws';
  const clients = [];
  const results = [];
  const record = (name, detail = '') => {
    results.push(name);
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
  };

  try {
    const royal = Poker.evaluateFive(['As', 'Ks', 'Qs', 'Js', 'Ts']);
    assert.equal(royal.name, '皇家同花顺');
    assert.equal(Poker.evaluateFive(['5h', '4d', '3c', '2s', 'Ad']).name, '顺子');
    const bestSeven = Poker.bestHand(['As', 'Ks', 'Qs', 'Js', 'Ts', '2d', '3c']);
    assert.equal(bestSeven.name, '皇家同花顺');
    const preflopAdvice = Poker.adviseGto({
      holeCards: ['As', 'Ah'],
      stage: 'preflop',
      pot: 150,
      toCall: 50,
      stack: 10_000,
      currentBet: 100,
      position: 'BTN',
      available: { canRaise: true, minRaiseTo: 200, maxRaiseTo: 10_000, canAllIn: true },
    });
    assert.ok(preflopAdvice.action === 'raise' || preflopAdvice.action === 'allin');
    assert.ok(Poker.monteCarloEquity(['As', 'Ah'], [], 80) > 0.6);
    record('德州扑克牌力评估与本地 GTO 建议');

    const layout = Checkers.createLayout();
    assert.equal(layout.holes.length, 121);
    assert.equal(layout.homeIndices[1].length, 10);
    assert.equal(layout.homeIndices[2].length, 10);
    assert.equal(layout.outlinePoints.length, 12);
    assert.equal(layout.initialBoard.filter((value) => value === 1).length, 10);
    assert.equal(layout.initialBoard.filter((value) => value === 2).length, 10);
    const initialMoves = [];
    for (let index = 0; index < layout.holeCount; index += 1) {
      if (layout.initialBoard[index] !== 1) continue;
      const moves = Checkers.getLegalMoves(layout, layout.initialBoard, index);
      for (const to of moves.steps) initialMoves.push({ from: index, to, type: 'step' });
      for (const jump of moves.jumps) {
        initialMoves.push({ from: index, to: jump.to, type: 'jump' });
      }
    }
    assert.ok(initialMoves.length > 0);
    const stepMove = initialMoves.find((move) => move.type === 'step');
    const stepResult = Checkers.applyMove(
      layout,
      layout.initialBoard,
      layout.initialBoard[stepMove.from],
      stepMove.from,
      [stepMove.to]
    );
    assert.equal(stepResult.ok, true);
    assert.equal(stepResult.type, 'step');
    assert.equal(stepResult.board[stepMove.from], 0);
    assert.equal(stepResult.board[stepMove.to], 1);
    const jumpSetup = new Int8Array(layout.holeCount);
    const jumpFrom = 30;
    const jump = layout.jumps[jumpFrom][0];
    jumpSetup[jumpFrom] = 1;
    jumpSetup[jump.over] = 2;
    const jumpResult = Checkers.applyMove(layout, jumpSetup, 1, jumpFrom, [jump.to]);
    assert.equal(jumpResult.ok, true);
    assert.equal(jumpResult.type, 'jump');
    assert.equal(jumpResult.board[jump.over], 2);
    const repeatedJump = Checkers.validateMove(layout, jumpSetup, 1, jumpFrom, [
      jump.to,
      jump.to,
    ]);
    assert.equal(repeatedJump.ok, false);

    let chainBoard = Uint8Array.from(layout.initialBoard);
    let chainStep = Checkers.applyMove(layout, chainBoard, 1, 61, [34]);
    assert.equal(chainStep.ok, true);
    chainBoard = Uint8Array.from(chainStep.board);
    chainStep = Checkers.applyMove(layout, chainBoard, 2, 91, [26]);
    assert.equal(chainStep.ok, true);
    chainBoard = Uint8Array.from(chainStep.board);
    const chainResult = Checkers.applyMove(layout, chainBoard, 1, 63, [61, 25]);
    assert.equal(chainResult.ok, true);
    assert.equal(chainResult.type, 'jump');
    assert.equal(chainResult.jumps, 2);

    const winningBoard = new Int8Array(layout.holeCount);
    for (const index of layout.targetIndices[1]) winningBoard[index] = 1;
    assert.equal(Checkers.hasWon(layout, winningBoard, 1), true);
    assert.equal(Checkers.hasWon(layout, winningBoard, 2), false);
    record('中国跳棋棋盘、连跳与胜负规则');

    const healthResponse = await fetch(`${localUrl}/health`);
    assert.equal(healthResponse.status, 200);
    const health = await healthResponse.json();
    assert.equal(health.ok, true);
    record('HTTP 健康检查');

    const indexResponse = await fetch(`${localUrl}/`);
    assert.equal(indexResponse.status, 200);
    assert.match(indexResponse.headers.get('content-type'), /text\/html/);
    assert.match(await indexResponse.text(), /连珠/);
    record('静态首页');

    const traversalResponse = await fetch(`${localUrl}/..%2Fserver.js`);
    assert.equal(traversalResponse.status, 403);
    record('静态路径穿越防护');

    const host = await new TestClient(wsUrl, 'host').open();
    clients.push(host);
    host.send({ type: 'create', name: '房主' });
    const hostJoined = await host.waitFor((m) => m.type === 'joined', 'host joined');
    assert.match(hostJoined.room.code, /^\d{4}$/);
    assert.equal(hostJoined.room.status, 'waiting');
    assert.equal(hostJoined.room.yourColor, 1);
    assert.equal(hostJoined.room.players[1], null);
    record('创建房间');

    let guest = await new TestClient(wsUrl, 'guest').open();
    clients.push(guest);
    guest.send({ type: 'join', room: hostJoined.room.code, name: '棋友' });
    const guestJoined = await guest.waitFor((m) => m.type === 'joined', 'guest joined');
    assert.equal(guestJoined.room.status, 'playing');
    assert.equal(guestJoined.room.yourColor, 2);
    assert.equal(guestJoined.room.players[0].name, '房主');
    assert.equal(guestJoined.room.players[1].name, '棋友');
    const hostSawGuest = await host.waitForRoom('host sees guest', (room) => room.status === 'playing');
    assert.equal(hostSawGuest.room.players[1].connected, true);
    record('第二位玩家加入');

    guest.close();
    const offline = await host.waitForRoom(
      'host sees guest offline',
      (room) => room.players[1] && room.players[1].connected === false
    );
    assert.equal(offline.room.status, 'playing');
    const guestRejoined = await new TestClient(wsUrl, 'guest-rejoin').open();
    clients.push(guestRejoined);
    guestRejoined.send({
      type: 'rejoin',
      room: hostJoined.room.code,
      token: guestJoined.token,
    });
    const rejoinJoined = await guestRejoined.waitFor(
      (m) => m.type === 'joined',
      'guest rejoin joined'
    );
    assert.equal(rejoinJoined.room.yourColor, 2);
    await host.waitForRoom(
      'host sees guest reconnect',
      (room) => room.players[1] && room.players[1].connected === true
    );
    guest = guestRejoined;
    record('断线重连恢复座位');

    const moves = [
      [host, 7, 7],
      [guest, 8, 7],
      [host, 7, 8],
      [guest, 8, 8],
      [host, 7, 9],
      [guest, 8, 9],
      [host, 7, 10],
      [guest, 8, 10],
      [host, 7, 11],
    ];
    let lastHostRoom = null;
    for (const [client, row, col] of moves) {
      client.send({ type: 'move', row, col });
      lastHostRoom = await host.waitForRoom(
        `move ${row},${col}`,
        (room) => room.board[row * 15 + col] !== 0
      );
    }
    const finished = lastHostRoom;
    assert.equal(finished.room.status, 'ended');
    assert.equal(finished.room.winner, 1);
    assert.equal(finished.room.endReason, 'five');
    assert.equal(finished.room.winningLine.length, 5);
    assert.equal(finished.room.moveCount, 9);
    assert.equal(finished.room.history.length, 9);
    assert.deepEqual(finished.room.history[8], {
      row: 7,
      col: 11,
      color: 1,
      moveNumber: 9,
    });
    record('落子同步、棋谱与五连判胜');

    const guestFinished = await guest.waitForRoom('guest sees finished game', (room) => room.status === 'ended');
    assert.equal(guestFinished.room.winner, 1);
    assert.equal(guestFinished.room.yourColor, 2);
    record('双方胜负状态同步');

    host.send({ type: 'move', row: 1, col: 1 });
    const postGameError = await host.waitFor((m) => m.type === 'error', 'post-game error');
    assert.equal(postGameError.code, 'GAME_NOT_PLAYING');
    record('禁止终局后继续落子');

    host.send({ type: 'rematch' });
    await guest.waitForRoom('guest sees rematch vote', (room) => room.players[0].wantsRematch === true);
    guest.send({ type: 'rematch' });
    const nextRoundHost = await host.waitForRoom('round 2 host', (room) => room.round === 2);
    const nextRoundGuest = await guest.waitForRoom('round 2 guest', (room) => room.round === 2);
    assert.equal(nextRoundHost.room.status, 'playing');
    assert.equal(nextRoundHost.room.yourColor, 2);
    assert.equal(nextRoundGuest.room.yourColor, 1);
    assert.equal(nextRoundHost.room.moveCount, 0);
    assert.equal(nextRoundHost.room.winningLine.length, 0);
    record('再来一局与黑白互换');

    host.send({ type: 'move', row: 5, col: 5 });
    const wrongTurn = await host.waitFor((m) => m.type === 'error', 'wrong turn error');
    assert.equal(wrongTurn.code, 'NOT_YOUR_TURN');
    record('拒绝未轮到的一方落子');

    guest.send({ type: 'move', row: 5, col: 5 });
    await host.waitForRoom(
      'guest move round 2',
      (room) => room.round === 2 && room.board[5 * 15 + 5] === 1
    );
    host.send({ type: 'move', row: 6, col: 6 });
    await host.waitForRoom(
      'host move round 2',
      (room) => room.round === 2 && room.board[6 * 15 + 6] === 2
    );
    guest.send({ type: 'resign' });
    const resigned = await host.waitForRoom(
      'resign result',
      (room) => room.round === 2 && room.status === 'ended'
    );
    assert.equal(resigned.room.winner, 2);
    assert.equal(resigned.room.endReason, 'resign');
    const guestSawResign = await guest.waitForRoom(
      'guest sees resign result',
      (room) => room.round === 2 && room.status === 'ended'
    );
    assert.equal(guestSawResign.room.winner, 2);
    record('认输判负');

    guest.send({ type: 'leave' });
    await guest.waitFor((m) => m.type === 'left', 'guest left');
    const closed = await host.waitFor((m) => m.type === 'room_closed', 'host room closed');
    assert.equal(closed.reason, 'opponent_left');
    record('离开房间与房间关闭通知');

    const unknownRoom = await new TestClient(wsUrl, 'unknown').open();
    clients.push(unknownRoom);
    unknownRoom.send({ type: 'join', room: '0000', name: '路人' });
    const notFound = await unknownRoom.waitFor((m) => m.type === 'error', 'room not found');
    assert.equal(notFound.code, 'ROOM_NOT_FOUND');
    record('不存在的房间提示');

    const checkersHost = await new TestClient(wsUrl, 'checkers-host').open();
    clients.push(checkersHost);
    checkersHost.send({ type: 'create', name: '跳棋房主', game: 'checkers' });
    const checkersHostJoined = await checkersHost.waitFor(
      (m) => m.type === 'joined',
      'checkers host joined'
    );
    assert.equal(checkersHostJoined.room.game, 'checkers');
    assert.equal(checkersHostJoined.room.board.length, 121);
    assert.equal(checkersHostJoined.room.board.filter((value) => value === 1).length, 10);
    assert.equal(checkersHostJoined.room.board.filter((value) => value === 2).length, 10);

    const checkersGuest = await new TestClient(wsUrl, 'checkers-guest').open();
    clients.push(checkersGuest);
    checkersGuest.send({ type: 'join', room: checkersHostJoined.room.code, name: '跳棋棋友' });
    const checkersGuestJoined = await checkersGuest.waitFor(
      (m) => m.type === 'joined',
      'checkers guest joined'
    );
    assert.equal(checkersGuestJoined.room.game, 'checkers');
    assert.equal(checkersGuestJoined.room.yourColor, 2);
    await checkersHost.waitForRoom(
      'checkers host sees guest',
      (room) => room.status === 'playing' && room.players[1]
    );

    const blackStep = initialMoves.find((move) => move.type === 'step');
    checkersHost.send({
      type: 'move',
      from: blackStep.from,
      path: [blackStep.to],
    });
    const afterBlack = await checkersHost.waitForRoom(
      'checkers black move',
      (room) => room.moveCount === 1
    );
    assert.equal(afterBlack.room.turn, 2);
    assert.equal(afterBlack.room.board[blackStep.from], 0);
    assert.equal(afterBlack.room.board[blackStep.to], 1);
    assert.equal(afterBlack.room.lastMove.type, 'step');
    assert.equal(afterBlack.room.history.length, 1);

    const guestBoard = Int8Array.from(
      (await checkersGuest.waitForRoom('checkers guest board', (room) => room.moveCount === 1))
        .room.board
    );
    const whiteMove = [];
    for (let index = 0; index < layout.holeCount; index += 1) {
      if (guestBoard[index] !== 2) continue;
      const moves = Checkers.getLegalMoves(layout, guestBoard, index);
      for (const to of moves.steps) whiteMove.push({ from: index, to });
      if (whiteMove.length > 0) break;
    }
    assert.ok(whiteMove.length > 0);

    checkersGuest.send({
      type: 'move',
      from: layout.homeIndices[2][0],
      path: [layout.homeIndices[1][0]],
    });
    const checkersError = await checkersGuest.waitFor(
      (m) => m.type === 'error',
      'checkers illegal move'
    );
    assert.equal(checkersError.code, 'ILLEGAL_CHECKERS_MOVE');

    checkersGuest.send({ type: 'move', from: whiteMove[0].from, path: [whiteMove[0].to] });
    const afterWhite = await checkersHost.waitForRoom(
      'checkers white move',
      (room) => room.moveCount === 2
    );
    assert.equal(afterWhite.room.turn, 1);
    assert.equal(afterWhite.room.board[whiteMove[0].from], 0);
    assert.equal(afterWhite.room.board[whiteMove[0].to], 2);
    record('中国跳棋房间与走子同步');

    checkersHost.send({ type: 'resign' });
    const checkersResigned = await checkersHost.waitForRoom(
      'checkers resign',
      (room) => room.status === 'ended'
    );
    assert.equal(checkersResigned.room.winner, 2);
    assert.equal(checkersResigned.room.endReason, 'resign');
    checkersHost.send({ type: 'rematch' });
    await checkersGuest.waitForRoom(
      'checkers rematch vote',
      (room) => room.players[0].wantsRematch === true
    );
    checkersGuest.send({ type: 'rematch' });
    const checkersRound2 = await checkersHost.waitForRoom(
      'checkers round 2',
      (room) => room.round === 2
    );
    assert.equal(checkersRound2.room.game, 'checkers');
    assert.equal(checkersRound2.room.yourColor, 2);
    assert.equal(checkersRound2.room.moveCount, 0);
    assert.equal(checkersRound2.room.history.length, 0);
    assert.equal(checkersRound2.room.board.filter((value) => value === 1).length, 10);
    assert.equal(checkersRound2.room.board.filter((value) => value === 2).length, 10);
    record('中国跳棋再来一局与黑白互换');

    const pokerHost = await new TestClient(wsUrl, 'poker-host').open();
    clients.push(pokerHost);
    pokerHost.send({
      type: 'create',
      name: '扑克房主',
      game: 'poker',
      startingStackBb: 20,
    });
    const pokerHostJoined = await pokerHost.waitFor(
      (m) => m.type === 'joined',
      'poker host joined'
    );
    assert.equal(pokerHostJoined.room.game, 'poker');
    assert.equal(pokerHostJoined.room.board.length, 0);
    assert.equal(pokerHostJoined.room.poker.startingStackBb, 20);
    assert.equal(pokerHostJoined.room.poker.stage, 'waiting');
    assert.deepEqual(pokerHostJoined.room.poker.stacks, { 1: 2000, 2: 2000 });

    const pokerGuest = await new TestClient(wsUrl, 'poker-guest').open();
    clients.push(pokerGuest);
    pokerGuest.send({
      type: 'join',
      room: pokerHostJoined.room.code,
      name: '扑克棋友',
    });
    const pokerGuestJoined = await pokerGuest.waitFor(
      (m) => m.type === 'joined',
      'poker guest joined'
    );
    assert.equal(pokerGuestJoined.room.poker.stage, 'preflop');
    assert.equal(pokerGuestJoined.room.poker.handNumber, 1);
    assert.equal(pokerGuestJoined.room.poker.pot, 150);
    assert.deepEqual(pokerGuestJoined.room.poker.stacks, { 1: 1950, 2: 1900 });
    assert.equal(pokerGuestJoined.room.poker.holeCards.length, 2);
    assert.equal(pokerGuestJoined.room.poker.opponentHoleCards.length, 0);
    const pokerHostDealt = await pokerHost.waitForRoom(
      'poker host dealt',
      (room) => room.poker.stage === 'preflop'
    );
    assert.equal(pokerHostDealt.room.poker.holeCards.length, 2);
    assert.equal(pokerHostDealt.room.poker.opponentHoleCards.length, 0);
    assert.equal(pokerHostDealt.room.poker.availableActions.isTurn, true);
    record('单挑德州扑克发牌、盲注与底牌隐私');

    pokerHost.send({ type: 'pokerAction', action: 'allin' });
    await pokerGuest.waitForRoom(
      'poker guest facing allin',
      (room) => room.poker.lastAction && room.poker.lastAction.action === 'allin'
    );
    pokerGuest.send({ type: 'pokerAction', action: 'call' });
    const pokerMatchEnd = await pokerHost.waitForRoom(
      'poker allin showdown',
      (room) => room.status === 'ended' && room.poker.stage === 'matchOver',
      5000
    );
    assert.equal(pokerMatchEnd.room.endReason, 'busted');
    assert.equal(pokerMatchEnd.room.poker.board.length, 5);
    assert.equal(pokerMatchEnd.room.poker.result.reveal, true);
    assert.equal(pokerMatchEnd.room.poker.opponentHoleCards.length, 2);
    assert.equal(
      pokerMatchEnd.room.poker.stacks[1] + pokerMatchEnd.room.poker.stacks[2],
      4000
    );
    assert.equal(Math.min(pokerMatchEnd.room.poker.stacks[1], pokerMatchEnd.room.poker.stacks[2]), 0);
    record('全下摊牌、公共牌与筹码清零');

    pokerHost.send({ type: 'rematch' });
    await pokerGuest.waitForRoom(
      'poker rematch vote',
      (room) => room.players[0].wantsRematch === true
    );
    pokerGuest.send({ type: 'rematch' });
    const pokerRound2 = await pokerHost.waitForRoom(
      'poker round 2',
      (room) => room.round === 2 && room.poker.stage === 'preflop'
    );
    assert.equal(pokerRound2.room.poker.handNumber, 1);
    assert.equal(pokerRound2.room.poker.stacks[1] + pokerRound2.room.poker.stacks[2], 3850);
    assert.equal(pokerRound2.room.yourColor, 2);
    assert.equal(pokerRound2.room.poker.actor, 1);

    pokerGuest.send({ type: 'pokerAction', action: 'fold' });
    const pokerFolded = await pokerHost.waitForRoom(
      'poker fold hand complete',
      (room) => room.poker.stage === 'handComplete'
    );
    assert.equal(pokerFolded.room.status, 'playing');
    assert.equal(pokerFolded.room.poker.result.reason, 'fold');
    assert.equal(pokerFolded.room.poker.result.reveal, false);
    assert.equal(pokerFolded.room.poker.opponentHoleCards.length, 0);
    assert.ok(pokerFolded.room.poker.nextHandAt > Date.now());
    record('弃牌结算、隐藏底牌与自动下一手');

    const pokerBadStack = await new TestClient(wsUrl, 'poker-stack').open();
    clients.push(pokerBadStack);
    pokerBadStack.send({
      type: 'create',
      name: '筹码测试',
      game: 'poker',
      startingStackBb: 37,
    });
    const pokerFallback = await pokerBadStack.waitFor(
      (m) => m.type === 'joined',
      'poker fallback joined'
    );
    assert.equal(pokerFallback.room.poker.startingStackBb, 100);
    pokerBadStack.send({ type: 'leave' });
    record('德州扑克起始筹码选项校验');

    pokerHost.send({ type: 'leave' });
    await pokerHost.waitFor((m) => m.type === 'left', 'poker host left');
    await pokerGuest.waitFor((m) => m.type === 'room_closed', 'poker room closed');

    console.log(`\n  通过 ${results.length} 项测试。\n`);
    clearTimeout(globalGuard);
  } finally {
    for (const client of clients) client.close();
    await new Promise((resolve) => {
      server.close(resolve);
      setTimeout(() => {
        server.closeAllConnections?.();
        resolve();
      }, 500).unref();
    });
  }
}

main().catch((error) => {
  console.error('\n测试失败：', error);
  process.exitCode = 1;
});
