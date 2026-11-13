'use strict';

/*
 * 德州扑克共享核心：牌、牌力评估、蒙特卡洛胜率与本地 GTO 风格建议。
 * 服务端用于发牌和摊牌，浏览器用于牌面展示与 GTO 面板。
 */
(function attachPokerCore(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PokerCore = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createPokerCore() {
  const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
  const SUITS = ['s', 'h', 'd', 'c'];
  const SUIT_SYMBOLS = { s: '♠', h: '♥', d: '♦', c: '♣' };
  const SUIT_NAMES = { s: '黑桃', h: '红桃', d: '方块', c: '梅花' };
  const CATEGORY_NAMES = [
    '高牌',
    '一对',
    '两对',
    '三条',
    '顺子',
    '同花',
    '葫芦',
    '四条',
    '同花顺',
  ];
  const BB_CHIPS = 100;
  const SB_CHIPS = 50;

  function createDeck() {
    const deck = [];
    for (const rank of RANKS) {
      for (const suit of SUITS) deck.push(rank + suit);
    }
    return deck;
  }

  function shuffle(deck, random = Math.random) {
    const result = deck.slice();
    for (let index = result.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(random() * (index + 1));
      [result[index], result[swap]] = [result[swap], result[index]];
    }
    return result;
  }

  function rankChar(card) {
    return String(card)[0];
  }

  function suitOf(card) {
    return String(card)[1];
  }

  function rankValue(card) {
    return RANKS.indexOf(rankChar(card)) + 2;
  }

  function rankLabel(card) {
    const rank = rankChar(card);
    return rank === 'T' ? '10' : rank;
  }

  function suitSymbol(card) {
    return SUIT_SYMBOLS[suitOf(card)] || '';
  }

  function suitName(card) {
    return SUIT_NAMES[suitOf(card)] || '';
  }

  function isRed(card) {
    const suit = suitOf(card);
    return suit === 'h' || suit === 'd';
  }

  function cardText(card) {
    return `${rankLabel(card)}${suitSymbol(card)}`;
  }

  function evaluateFive(cards) {
    if (!Array.isArray(cards) || cards.length !== 5) {
      throw new Error('evaluateFive requires five cards');
    }
    const ranks = cards.map(rankValue).sort((a, b) => b - a);
    const counts = new Map();
    for (const rank of ranks) counts.set(rank, (counts.get(rank) || 0) + 1);
    const groups = [...counts.entries()].sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return b[0] - a[0];
    });
    const flush = cards.every((card) => suitOf(card) === suitOf(cards[0]));
    const uniqueRanks = [...new Set(ranks)];
    let straightHigh = 0;
    if (uniqueRanks.length === 5) {
      if (uniqueRanks[0] - uniqueRanks[4] === 4) straightHigh = uniqueRanks[0];
      else if (
        uniqueRanks[0] === 14 &&
        uniqueRanks[1] === 5 &&
        uniqueRanks[2] === 4 &&
        uniqueRanks[3] === 3 &&
        uniqueRanks[4] === 2
      ) {
        straightHigh = 5;
      }
    }

    const kickers = (excluded) => ranks.filter((rank) => !excluded.includes(rank));

    if (flush && straightHigh) {
      return {
        category: 8,
        score: [8, straightHigh],
        name: straightHigh === 14 ? '皇家同花顺' : '同花顺',
      };
    }
    if (groups[0][1] === 4) {
      return {
        category: 7,
        score: [7, groups[0][0], groups[1][0]],
        name: '四条',
      };
    }
    if (groups[0][1] === 3 && groups[1] && groups[1][1] === 2) {
      return {
        category: 6,
        score: [6, groups[0][0], groups[1][0]],
        name: '葫芦',
      };
    }
    if (flush) {
      return {
        category: 5,
        score: [5, ...ranks],
        name: '同花',
      };
    }
    if (straightHigh) {
      return {
        category: 4,
        score: [4, straightHigh],
        name: '顺子',
      };
    }
    if (groups[0][1] === 3) {
      return {
        category: 3,
        score: [3, groups[0][0], ...kickers([groups[0][0]])],
        name: '三条',
      };
    }
    if (groups[0][1] === 2 && groups[1] && groups[1][1] === 2) {
      return {
        category: 2,
        score: [2, groups[0][0], groups[1][0], groups[2][0]],
        name: '两对',
      };
    }
    if (groups[0][1] === 2) {
      return {
        category: 1,
        score: [1, groups[0][0], ...kickers([groups[0][0]])],
        name: '一对',
      };
    }
    return {
      category: 0,
      score: [0, ...ranks],
      name: '高牌',
    };
  }

  function compareScores(first, second) {
    const length = Math.max(first.length, second.length);
    for (let index = 0; index < length; index += 1) {
      const a = first[index] || 0;
      const b = second[index] || 0;
      if (a > b) return 1;
      if (a < b) return -1;
    }
    return 0;
  }

  function combinations(cards, choose = 5) {
    const result = [];
    const walk = (start, picked) => {
      if (picked.length === choose) {
        result.push(picked.slice());
        return;
      }
      for (let index = start; index < cards.length; index += 1) {
        picked.push(cards[index]);
        walk(index + 1, picked);
        picked.pop();
      }
    };
    walk(0, []);
    return result;
  }

  function bestHand(cards) {
    if (!Array.isArray(cards) || cards.length < 5 || cards.length > 7) {
      throw new Error('bestHand requires 5 to 7 cards');
    }
    let best = null;
    for (const five of combinations(cards, 5)) {
      const evaluated = evaluateFive(five);
      if (!best || compareScores(evaluated.score, best.score) > 0) {
        best = {
          ...evaluated,
          cards: five.slice(),
        };
      }
    }
    return best;
  }

  function compareHands(first, second) {
    return compareScores(bestHand(first).score, bestHand(second).score);
  }

  function remainingDeck(knownCards) {
    const known = new Set(knownCards);
    return createDeck().filter((card) => !known.has(card));
  }

  function drawFrom(pool, count, random = Math.random) {
    const picked = [];
    const copy = pool.slice();
    for (let index = 0; index < count; index += 1) {
      const swap = index + Math.floor(random() * (copy.length - index));
      [copy[index], copy[swap]] = [copy[swap], copy[index]];
      picked.push(copy[index]);
    }
    return picked;
  }

  /**
   * 对随机对手手牌做蒙特卡洛模拟。返回 0..1 的胜率（平局算半胜）。
   */
  function monteCarloEquity(heroCards, boardCards = [], iterations = 600, random = Math.random) {
    if (!Array.isArray(heroCards) || heroCards.length !== 2) return 0.5;
    const board = boardCards.slice(0, 5);
    const known = [...heroCards, ...board];
    if (new Set(known).size !== known.length) return 0.5;
    const pool = remainingDeck(known);
    const missingBoard = 5 - board.length;
    if (pool.length < 2 + missingBoard) return 0.5;

    let equity = 0;
    const rounds = Math.max(50, Math.min(2000, Number(iterations) || 600));
    for (let iteration = 0; iteration < rounds; iteration += 1) {
      const drawn = drawFrom(pool, 2 + missingBoard, random);
      const opponent = drawn.slice(0, 2);
      const fullBoard = board.concat(drawn.slice(2));
      const heroBest = bestHand(heroCards.concat(fullBoard));
      const opponentBest = bestHand(opponent.concat(fullBoard));
      const comparison = compareScores(heroBest.score, opponentBest.score);
      if (comparison > 0) equity += 1;
      else if (comparison === 0) equity += 0.5;
    }
    return equity / rounds;
  }

  /**
   * 简化的起手牌强度 0..1，用于翻前建议。
   */
  function preflopStrength(holeCards) {
    if (!Array.isArray(holeCards) || holeCards.length !== 2) return 0;
    const [first, second] = holeCards;
    const high = Math.max(rankValue(first), rankValue(second));
    const low = Math.min(rankValue(first), rankValue(second));
    const suited = suitOf(first) === suitOf(second);
    const pair = high === low;
    const gap = high - low;

    if (pair) {
      return Math.min(1, 0.55 + ((high - 2) / 12) * 0.42);
    }

    let score = ((high - 2) / 12) * 0.42 + ((low - 2) / 12) * 0.22;
    if (suited) score += 0.075;
    if (gap === 1) score += 0.065;
    else if (gap === 2) score += 0.035;
    if (high === 14) score += 0.035;
    if (high >= 10 && low >= 10) score += 0.04;
    if (high === 14 && low >= 10) score += 0.045;
    if (suited && gap <= 2 && high >= 8) score += 0.035;
    return Math.max(0.04, Math.min(0.99, score));
  }

  function strengthLabel(value) {
    if (value >= 0.8) return '极强';
    if (value >= 0.66) return '强';
    if (value >= 0.52) return '中等偏强';
    if (value >= 0.4) return '中等';
    if (value >= 0.28) return '偏弱';
    return '弱';
  }

  function percent(value) {
    return `${Math.round(value * 100)}%`;
  }

  function clampRaiseTo(amount, available) {
    const max = available.maxRaiseTo;
    const min = available.minRaiseTo;
    if (!max || !min || max < min) return null;
    return Math.max(min, Math.min(max, Math.round(amount)));
  }

  function makeAdvice(action, amountTo, headline, reason, extra = {}) {
    return {
      action,
      amountTo: Number.isFinite(amountTo) ? amountTo : null,
      headline,
      reason,
      ...extra,
      source: 'local-gto',
    };
  }

  /**
   * 本地 GTO 风格建议。不是商业级 solver，而是基于位置、牌力、赔率的近似策略。
   */
  function adviseGto(input) {
    const {
      holeCards = [],
      board = [],
      stage = 'preflop',
      pot = 0,
      toCall = 0,
      stack = 0,
      currentBet = 0,
      bigBlind = BB_CHIPS,
      position = 'BB',
      available = {},
      iterations = 500,
    } = input || {};

    if (!Array.isArray(holeCards) || holeCards.length !== 2) {
      return makeAdvice('wait', null, '等待发牌', '牌局还没有开始。', {
        note: '本地 GTO 近似',
      });
    }

    const active = ['preflop', 'flop', 'turn', 'river'].includes(stage);
    if (!active) {
      return makeAdvice('wait', null, '等待下一手', '本手已经结束。', {
        note: '本地 GTO 近似',
      });
    }

    const requiredEquity = toCall > 0 ? toCall / (pot + toCall) : 0;
    const stackBb = stack / bigBlind;
    const potBb = pot / bigBlind;
    const isButton = position === 'BTN';
    const canRaise = Boolean(available.canRaise && available.maxRaiseTo > available.minRaiseTo);
    const canBet = Boolean(available.canBet);
    const canCall = Boolean(available.canCall);
    const canCheck = Boolean(available.canCheck);

    if (stage === 'preflop') {
      const strength = preflopStrength(holeCards);
      const label = strengthLabel(strength);
      const base = {
        equity: strength,
        requiredEquity,
        frequency: 0.5,
        handStrength: strength,
        handLabel: label,
        note: '翻前手牌强度 · 本地 GTO 近似',
      };

      if (stackBb <= 18) {
        if (strength >= 0.56 && available.canAllIn) {
          return makeAdvice('allin', stack, 'All-in', `短码 ${stackBb.toFixed(1)} BB，${label}起手牌适合直接全下。`, {
            ...base,
            frequency: 0.78,
          });
        }
        if (toCall > 0 && canCall && strength >= 0.38) {
          return makeAdvice('call', toCall, `跟注 ${(Math.min(toCall, stack) / bigBlind).toFixed(1)} BB`, `短码且底池赔率合适，${label}手牌可以跟注。`, {
            ...base,
            frequency: 0.62,
          });
        }
        return makeAdvice('fold', 0, '弃牌', `短码下 ${label}手牌不足以继续。`, {
          ...base,
          frequency: 0.82,
        });
      }

      if (!isButton) {
        if (toCall === 0) {
          if (strength >= 0.68 && canRaise) {
            const target = clampRaiseTo(bigBlind * 3, available);
            if (target) {
              return makeAdvice('raise', target, `加注到 ${(target / bigBlind).toFixed(1)} BB`, `大盲位拿到${label}起手牌，可以主动加注夺取主动权。`, {
                ...base,
                frequency: 0.58,
              });
            }
          }
          return makeAdvice('check', 0, '过牌', `大盲位免费看翻牌，${label}手牌无需冒险。`, {
            ...base,
            frequency: 0.7,
          });
        }

        if (strength >= 0.78 && canRaise) {
          const target = clampRaiseTo(currentBet * 3, available);
          if (target) {
            return makeAdvice('raise', target, `再加注到 ${(target / bigBlind).toFixed(1)} BB`, `面对加注，${label}起手牌值得 3-bet。`, {
              ...base,
              frequency: 0.46,
            });
          }
        }
        if (canCall && strength >= Math.max(0.3, requiredEquity + 0.04)) {
          return makeAdvice('call', Math.min(toCall, stack), `跟注 ${(Math.min(toCall, stack) / bigBlind).toFixed(1)} BB`, `底池赔率 ${percent(requiredEquity)}，${label}手牌有继续价值。`, {
            ...base,
            frequency: 0.64,
          });
        }
        return makeAdvice('fold', 0, '弃牌', `${label}手牌面对加注不够强。`, {
          ...base,
          frequency: 0.8,
        });
      }

      // 按钮/小盲位
      if (toCall <= bigBlind * 0.5 + 1) {
        if (strength >= 0.78 && available.canAllIn && stackBb <= 35) {
          return makeAdvice('allin', stack, 'All-in', `${label}起手牌，按钮位可以直接全下施压。`, {
            ...base,
            frequency: 0.44,
          });
        }
        if (strength >= 0.44 && canRaise) {
          const target = clampRaiseTo(bigBlind * 2.5, available);
          if (target) {
            return makeAdvice('raise', target, `加注到 ${(target / bigBlind).toFixed(1)} BB`, `按钮位用${label}起手牌开池，保持主动权。`, {
              ...base,
              frequency: strength >= 0.65 ? 0.72 : 0.55,
            });
          }
        }
        return makeAdvice('fold', 0, '弃牌', `${label}起手牌不适合按钮位开池。`, {
          ...base,
          frequency: 0.74,
        });
      }

      if (strength >= 0.82 && canRaise) {
        const target = clampRaiseTo(currentBet * 3, available);
        if (target) {
          return makeAdvice('raise', target, `再加注到 ${(target / bigBlind).toFixed(1)} BB`, `按钮位拿到${label}手牌，面对 3-bet 可以继续施压。`, {
            ...base,
            frequency: 0.42,
          });
        }
      }
      if (canCall && strength >= Math.max(0.36, requiredEquity + 0.03)) {
        return makeAdvice('call', Math.min(toCall, stack), `跟注 ${(Math.min(toCall, stack) / bigBlind).toFixed(1)} BB`, `有位置优势，${label}手牌可以按赔率跟注。`, {
          ...base,
          frequency: 0.58,
        });
      }
      return makeAdvice('fold', 0, '弃牌', `${label}手牌面对较大压力，放弃。`, {
        ...base,
        frequency: 0.76,
      });
    }

    // 翻后：用随机对手范围做蒙特卡洛模拟。
    const equity = monteCarloEquity(holeCards, board, iterations);
    const label = strengthLabel(equity);
    const base = {
      equity,
      requiredEquity,
      frequency: 0.5,
      handStrength: equity,
      handLabel: label,
      note: '蒙特卡洛胜率 · 本地 GTO 近似',
    };
    const potOddsText = toCall > 0 ? `底池赔率 ${percent(requiredEquity)}` : '无需跟注';
    const equityText = `模拟胜率 ${percent(equity)}`;

    if (toCall === 0) {
      if (canBet) {
        if (equity >= 0.72) {
          const target = clampRaiseTo(pot * 0.75, available);
          if (target) {
            return makeAdvice('bet', target, `下注 ${(target / bigBlind).toFixed(1)} BB`, `${equityText}，${label}牌力，下注约 3/4 池获取价值。`, {
              ...base,
              frequency: 0.76,
            });
          }
        }
        if (equity >= 0.57) {
          const target = clampRaiseTo(pot * 0.5, available);
          if (target) {
            return makeAdvice('bet', target, `下注 ${(target / bigBlind).toFixed(1)} BB`, `${equityText}，${label}牌力，半池下注兼顾价值与保护。`, {
              ...base,
              frequency: 0.64,
            });
          }
        }
        if (equity >= 0.47) {
          const target = clampRaiseTo(pot * 0.33, available);
          if (target) {
            return makeAdvice('bet', target, `下注 ${(target / bigBlind).toFixed(1)} BB`, `${equityText}，小注试探并控制底池。`, {
              ...base,
              frequency: 0.48,
            });
          }
        }
      }
      return makeAdvice('check', 0, '过牌', `${equityText}，没有足够的价值或诈唬理由，过牌控制底池。`, {
        ...base,
        frequency: 0.68,
      });
    }

    if (canRaise && equity >= Math.max(0.64, requiredEquity + 0.24)) {
      const target = clampRaiseTo(Math.max(currentBet * 2.5, pot * 0.8), available);
      if (target) {
        return makeAdvice('raise', target, `加注到 ${(target / bigBlind).toFixed(1)} BB`, `${equityText} 远高于${potOddsText}，${label}牌力可以加注施压。`, {
          ...base,
          frequency: 0.55,
        });
      }
    }
    if (canCall && equity >= requiredEquity + 0.03) {
      return makeAdvice('call', Math.min(toCall, stack), `跟注 ${(Math.min(toCall, stack) / bigBlind).toFixed(1)} BB`, `${equityText}，高于${potOddsText}，跟注有利可图。`, {
        ...base,
        frequency: 0.66,
      });
    }
    if (canCheck) {
      return makeAdvice('check', 0, '过牌', `${equityText}，先过牌看看对手行动。`, {
        ...base,
        frequency: 0.6,
      });
    }
    return makeAdvice('fold', 0, '弃牌', `${equityText} 低于${potOddsText}，弃牌更合理。`, {
      ...base,
      frequency: 0.74,
    });
  }

  function amountToBb(chips, bigBlind = BB_CHIPS) {
    return Math.round((chips / bigBlind) * 10) / 10;
  }

  return {
    RANKS,
    SUITS,
    SUIT_SYMBOLS,
    SUIT_NAMES,
    CATEGORY_NAMES,
    BB_CHIPS,
    SB_CHIPS,
    createDeck,
    shuffle,
    rankValue,
    rankLabel,
    suitOf,
    suitSymbol,
    suitName,
    isRed,
    cardText,
    evaluateFive,
    compareScores,
    bestHand,
    compareHands,
    monteCarloEquity,
    preflopStrength,
    strengthLabel,
    adviseGto,
    amountToBb,
  };
});
