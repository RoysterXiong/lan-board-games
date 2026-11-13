'use strict';

/*
 * 中国跳棋共享核心：棋盘拓扑、合法落点、连跳校验与胜负判定。
 * 同时供 Node 服务端和浏览器使用（UMD，无依赖）。
 */
(function attachCheckersCore(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CheckersCore = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createCheckersCore() {
  const DIRECTIONS = [
    [1, -1, 0],
    [1, 0, -1],
    [0, 1, -1],
    [-1, 1, 0],
    [-1, 0, 1],
    [0, -1, 1],
  ];

  const ARM_TIPS = DIRECTIONS;
  const CENTER_RADIUS = 4;
  const ARM_LAYERS = 4;
  const HOLE_COUNT = 121;
  const PIECES_PER_SIDE = 10;
  const VIEW_BOX = 1000;
  const VIEW_PADDING = 58;

  function keyOf(x, y, z) {
    return `${x},${y},${z}`;
  }

  function rotate(x, y, angle) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return [x * cos - y * sin, x * sin + y * cos];
  }

  function createLayout() {
    const cells = [];
    const byKey = new Map();
    const arms = Array.from({ length: 6 }, () => []);

    const addCell = (x, y, z, arm) => {
      if (x + y + z !== 0) throw new Error('Invalid cube coordinate');
      const key = keyOf(x, y, z);
      if (byKey.has(key)) return byKey.get(key);
      const cell = {
        index: cells.length,
        x,
        y,
        z,
        arm,
        rawX: 0,
        rawY: 0,
        sx: 0,
        sy: 0,
      };
      cells.push(cell);
      byKey.set(key, cell);
      if (arm !== null && arm !== undefined) arms[arm].push(cell.index);
      return cell;
    };

    // 中心大六边形：半径 4，共 61 格。
    for (let x = -CENTER_RADIUS; x <= CENTER_RADIUS; x += 1) {
      for (let y = -CENTER_RADIUS; y <= CENTER_RADIUS; y += 1) {
        const z = -x - y;
        if (Math.abs(z) <= CENTER_RADIUS) addCell(x, y, z, null);
      }
    }

    // 六个三角形臂，每个 10 格，共 60 格。
    // 先生成顶部居中的三角形，再每次旋转 60° 得到另外五个臂。
    const topArmCells = [];
    for (let layer = 1; layer <= ARM_LAYERS; layer += 1) {
      for (let x = layer; x <= 4; x += 1) {
        const z = -4 - layer;
        topArmCells.push([x, -x - z, z]);
      }
    }
    let rotatedArm = topArmCells;
    for (let armIndex = 0; armIndex < 6; armIndex += 1) {
      for (const [x, y, z] of rotatedArm) {
        addCell(x, y, z, armIndex);
      }
      rotatedArm = rotatedArm.map(([x, y, z]) => [-z, -x, -y]);
    }

    if (cells.length !== HOLE_COUNT) {
      throw new Error(`Chinese checkers board should have ${HOLE_COUNT} holes, got ${cells.length}`);
    }

    // 等角投影（pointy-top 方向），六个臂端点均匀分布在圆周上。
    for (const cell of cells) {
      cell.rawX = Math.sqrt(3) * (cell.x + cell.z / 2);
      cell.rawY = 1.5 * cell.z;
    }

    // 找到一个臂的端点作为“上方”，旋转整个棋盘，让双方阵营正好在上下。
    const armTips = arms.map((indices) => {
      let best = null;
      let bestDistance = -1;
      for (const index of indices) {
        const cell = cells[index];
        const distance = Math.hypot(cell.rawX, cell.rawY);
        if (distance > bestDistance) {
          bestDistance = distance;
          best = cell;
        }
      }
      return { arm: indices, tip: best, angle: Math.atan2(best.rawY, best.rawX) };
    });

    const topArm = armTips.reduce((best, entry) =>
      entry.tip.rawY < best.tip.rawY ? entry : best
    );
    const rotation = -Math.PI / 2 - topArm.angle;
    const centerX = 500;
    const centerY = 500;

    // 先旋转，再按最大跨度缩放并居中。
    const rotated = cells.map((cell) => {
      const [x, y] = rotate(cell.rawX, cell.rawY, rotation);
      return { cell, x, y };
    });
    const minX = Math.min(...rotated.map((item) => item.x));
    const maxX = Math.max(...rotated.map((item) => item.x));
    const minY = Math.min(...rotated.map((item) => item.y));
    const maxY = Math.max(...rotated.map((item) => item.y));
    const scale = (VIEW_BOX - VIEW_PADDING * 2) / Math.max(maxX - minX, maxY - minY);
    const offsetX = (VIEW_BOX - (minX + maxX) * scale) / 2;
    const offsetY = (VIEW_BOX - (minY + maxY) * scale) / 2;

    const toScreen = (rawX, rawY) => {
      const [x, y] = rotate(rawX, rawY, rotation);
      return {
        x: offsetX + x * scale,
        y: offsetY + y * scale,
      };
    };

    for (const { cell, x, y } of rotated) {
      cell.sx = offsetX + x * scale;
      cell.sy = offsetY + y * scale;
    }

    // 找到上下两个相对的阵营，分别作为黑方与白方的起点。
    const sortedArms = [...armTips].sort((a, b) => a.tip.sy - b.tip.sy);
    const topZone = sortedArms[0].arm;
    const bottomZone = sortedArms[sortedArms.length - 1].arm;

    if (topZone.length !== PIECES_PER_SIDE || bottomZone.length !== PIECES_PER_SIDE) {
      throw new Error('Invalid home zones');
    }

    const stepMap = Array.from({ length: HOLE_COUNT }, () => []);
    const jumpMap = Array.from({ length: HOLE_COUNT }, () => []);
    const neighborMap = Array.from({ length: HOLE_COUNT }, () => []);

    for (const cell of cells) {
      for (const [dx, dy, dz] of DIRECTIONS) {
        const neighbor = byKey.get(keyOf(cell.x + dx, cell.y + dy, cell.z + dz));
        const jumpTarget = byKey.get(keyOf(cell.x + dx * 2, cell.y + dy * 2, cell.z + dz * 2));
        if (neighbor) {
          neighborMap[cell.index].push(neighbor.index);
          stepMap[cell.index].push(neighbor.index);
        }
        if (neighbor && jumpTarget) {
          jumpMap[cell.index].push({
            over: neighbor.index,
            to: jumpTarget.index,
          });
        }
      }
    }

    const homeIndices = {
      1: [...topZone],
      2: [...bottomZone],
    };
    const targetIndices = {
      1: [...bottomZone],
      2: [...topZone],
    };

    // 星形棋盘外轮廓：六个臂尖 + 六个中心六边形角上的凹口。
    const outlinePoints = [];
    for (const arm of armTips) {
      const tipCell = arm.tip;
      const outward = Math.hypot(tipCell.rawX, tipCell.rawY) || 1;
      const extra = 1.28;
      const point = toScreen(
        tipCell.rawX + (tipCell.rawX / outward) * extra,
        tipCell.rawY + (tipCell.rawY / outward) * extra
      );
      outlinePoints.push({ ...point, angle: Math.atan2(point.y - centerY, point.x - centerX) });
    }
    for (const [x, y, z] of [
      [4, -4, 0],
      [4, 0, -4],
      [0, 4, -4],
      [-4, 4, 0],
      [-4, 0, 4],
      [0, -4, 4],
    ]) {
      const cell = byKey.get(keyOf(x, y, z));
      const rawX = cell.rawX;
      const rawY = cell.rawY;
      const distance = Math.hypot(rawX, rawY) || 1;
      const point = toScreen(
        rawX + (rawX / distance) * 1.35,
        rawY + (rawY / distance) * 1.35
      );
      outlinePoints.push({ ...point, angle: Math.atan2(point.y - centerY, point.x - centerX) });
    }
    outlinePoints.sort((a, b) => a.angle - b.angle);
    const starPoints = outlinePoints.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ');

    const zoneSets = {
      1: new Set(homeIndices[1]),
      2: new Set(homeIndices[2]),
    };

    const layout = {
      holes: cells.map((cell) => ({
        index: cell.index,
        x: cell.x,
        y: cell.y,
        z: cell.z,
        arm: cell.arm,
        sx: Number(cell.sx.toFixed(2)),
        sy: Number(cell.sy.toFixed(2)),
      })),
      arms: arms.map((indices) => [...indices]),
      homeIndices,
      targetIndices,
      steps: stepMap,
      jumps: jumpMap,
      neighbors: neighborMap,
      outlinePoints: outlinePoints.map((point) => ({
        x: Number(point.x.toFixed(2)),
        y: Number(point.y.toFixed(2)),
      })),
      starPoints,
      holeCount: cells.length,
      piecesPerSide: PIECES_PER_SIDE,
      viewBox: VIEW_BOX,
      center: { x: centerX, y: centerY },
      scale,
      rotation,
      zoneSets,
    };

    layout.initialBoard = createInitialBoard(layout);
    return layout;
  }

  function createInitialBoard(layout) {
    const board = new Int8Array(layout.holeCount);
    for (const index of layout.homeIndices[1]) board[index] = 1;
    for (const index of layout.homeIndices[2]) board[index] = 2;
    return board;
  }

  function emptyBoard(layout) {
    return new Int8Array(layout.holeCount);
  }

  function pieceOwner(board, index) {
    return board[index] || 0;
  }

  function getStepTargets(layout, board, index) {
    return layout.steps[index].filter((to) => board[to] === 0);
  }

  function getJumpTargets(layout, board, index, visited = null) {
    const result = [];
    for (const jump of layout.jumps[index]) {
      if (board[jump.over] !== 0 && board[jump.to] === 0) {
        if (!visited || !visited.has(jump.to)) result.push(jump);
      }
    }
    return result;
  }

  function getLegalMoves(layout, board, index) {
    const owner = board[index];
    if (!owner) return { steps: [], jumps: [] };
    return {
      steps: getStepTargets(layout, board, index),
      jumps: getJumpTargets(layout, board, index),
    };
  }

  function findStep(layout, from, to) {
    return layout.steps[from].includes(to);
  }

  function findJump(layout, from, to) {
    return layout.jumps[from].find((jump) => jump.to === to) || null;
  }

  /**
   * 校验一个完整回合：单步一步，或一段连跳路径。
   * path 为落点 indices 数组。返回 {ok, reason, type, to, path, board?}
   */
  function validateMove(layout, board, color, from, rawPath) {
    if (!Number.isInteger(from) || from < 0 || from >= layout.holeCount) {
      return { ok: false, reason: 'BAD_FROM' };
    }
    if (board[from] !== color) {
      return { ok: false, reason: board[from] ? 'WRONG_PIECE' : 'NO_PIECE' };
    }
    if (!Array.isArray(rawPath) || rawPath.length === 0 || rawPath.length > 60) {
      return { ok: false, reason: 'BAD_PATH' };
    }
    const path = rawPath.slice();
    for (const target of path) {
      if (!Number.isInteger(target) || target < 0 || target >= layout.holeCount) {
        return { ok: false, reason: 'BAD_PATH' };
      }
    }

    const working = board.slice();
    const visited = new Set([from]);
    let current = from;
    let sawJump = false;

    for (let stepIndex = 0; stepIndex < path.length; stepIndex += 1) {
      const target = path[stepIndex];
      if (visited.has(target)) return { ok: false, reason: 'REPEATED' };
      const isStep = findStep(layout, current, target);
      const jump = findJump(layout, current, target);

      if (!isStep && !jump) {
        return { ok: false, reason: 'NOT_REACHABLE' };
      }
      if (path.length > 1 && !jump) {
        return { ok: false, reason: 'MIXED_PATH' };
      }
      if (jump) {
        if (working[jump.over] === 0) return { ok: false, reason: 'NO_PIECE_TO_JUMP' };
        sawJump = true;
      } else if (stepIndex > 0) {
        return { ok: false, reason: 'MIXED_PATH' };
      }
      if (working[target] !== 0) return { ok: false, reason: 'OCCUPIED' };

      // 在连跳模拟中把棋子搬到落点，再检查下一跳。
      working[current] = 0;
      working[target] = color;
      visited.add(target);
      current = target;
    }

    const type = path.length > 1 || sawJump ? 'jump' : 'step';
    return {
      ok: true,
      from,
      to: current,
      path,
      type,
      jumps: type === 'jump' ? path.length : 0,
    };
  }

  function applyMove(layout, board, color, from, path) {
    const validated = validateMove(layout, board, color, from, path);
    if (!validated.ok) return validated;
    const next = board.slice();
    next[from] = 0;
    next[validated.to] = color;
    return {
      ...validated,
      board: next,
      won: hasWon(layout, next, color),
    };
  }

  function hasWon(layout, board, color) {
    const target = layout.targetIndices[color];
    if (!target) return false;
    let count = 0;
    for (const index of target) {
      if (board[index] === color) count += 1;
    }
    return count === PIECES_PER_SIDE;
  }

  function hasAnyLegalMove(layout, board, color) {
    for (let index = 0; index < layout.holeCount; index += 1) {
      if (board[index] !== color) continue;
      if (layout.steps[index].some((to) => board[to] === 0)) return true;
      if (layout.jumps[index].some((jump) => board[jump.over] !== 0 && board[jump.to] === 0)) {
        return true;
      }
    }
    return false;
  }

  function countInTarget(layout, board, color) {
    let count = 0;
    for (const index of layout.targetIndices[color] || []) {
      if (board[index] === color) count += 1;
    }
    return count;
  }

  return {
    DIRECTIONS,
    ARM_TIPS,
    HOLE_COUNT,
    PIECES_PER_SIDE,
    createLayout,
    createInitialBoard,
    emptyBoard,
    getLegalMoves,
    getStepTargets,
    getJumpTargets,
    validateMove,
    applyMove,
    hasWon,
    hasAnyLegalMove,
    countInTarget,
    findStep,
    findJump,
  };
});
