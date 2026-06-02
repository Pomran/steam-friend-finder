const TOP_N = 5;

const state = {
  playerGames: [],
  rawPlayerGames: [],
  playerTopGames: [],
  friendsData: [],
  mySteamId: null,
  myApiKey: null,
  myProfile: null,
  strangersData: null,
  strangersError: null,
  gameWeights: {},
};

let excludedSet = new Set();

function getExcludedSet() { return excludedSet; }
function getGameWeight(appid) {
  if (state.gameWeights[appid] !== undefined) return state.gameWeights[appid];
  const rank = state.playerTopGames.findIndex(g => g.appid === appid);
  return rank >= 0 ? Math.max(TOP_N - rank, 1) : 1;
}
function setGameWeight(appid, weight) { state.gameWeights[appid] = weight; }
function weightLabel(w) { return ['', '无感', '次要', '一般', '重要', '核心'][w] || w; }

function getTopGames(games, n = TOP_N) {
  const excluded = getExcludedSet();
  return [...games].filter(g => (g.playtime_forever || 0) > 0 && !excluded.has(g.appid))
    .sort((a, b) => (b.playtime_forever || 0) - (a.playtime_forever || 0))
    .slice(0, n);
}

function buildMyVector() {
  const vec = {};
  const excluded = getExcludedSet();
  for (const g of state.playerGames) {
    if (excluded.has(g.appid)) continue;
    const pt = g.playtime_forever || 0;
    if (pt <= 0) continue;
    vec[g.appid] = getGameWeight(g.appid) * Math.sqrt(pt);
  }
  return vec;
}

function buildVector(games) {
  const vec = {};
  for (const g of games) {
    const pt = g.playtime_forever || 0;
    if (pt <= 0) continue;
    vec[g.appid] = Math.sqrt(pt);
  }
  return vec;
}

function computeSimilarity(myVec, otherVec) {
  let dot = 0, normAInter = 0, normBInter = 0;
  let intersectionCount = 0;
  let normATotal = 0;

  for (const k in myVec) {
    normATotal += myVec[k] * myVec[k];
    if (otherVec[k]) {
      dot += myVec[k] * otherVec[k];
      normAInter += myVec[k] * myVec[k];
      normBInter += otherVec[k] * otherVec[k];
      intersectionCount++;
    }
  }

  if (intersectionCount === 0 || normAInter === 0 || normBInter === 0) return 0;

  const alignment = dot / (Math.sqrt(normAInter) * Math.sqrt(normBInter));
  const coverage = Math.sqrt(normAInter / normATotal);

  return alignment * coverage;
}

function computeMatchScore(friendGames) {
  return computeSimilarity(buildMyVector(), buildVector(friendGames));
}

function computeStrangerMatchScore(strangerTopGames) {
  return computeSimilarity(buildMyVector(), buildVector(strangerTopGames));
}

function resetState() {
  state.playerGames = [];
  state.rawPlayerGames = [];
  state.playerTopGames = [];
  state.gameWeights = {};
  excludedSet = new Set();
}

function setupMyGames(games, weights) {
  state.playerGames = games;
  state.rawPlayerGames = games;
  state.playerTopGames = getTopGames(games, TOP_N);
  state.gameWeights = weights || {};
}

function makeGame(appid, playtimeMin) {
  return { appid, name: `Game ${appid}`, playtime_forever: playtimeMin, img_icon_url: '' };
}

function assertClose(actual, expected, tolerance = 0.01) {
  return Math.abs(actual - expected) <= tolerance;
}

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

function expect(actual, expected, label, tolerance = 0.01) {
  if (!assertClose(actual, expected, tolerance)) {
    throw new Error(`${label || ''} 期望 ${expected.toFixed(4)} 实际 ${actual.toFixed(4)} (容差 ${tolerance})`);
  }
}

// ============================================================
test('T01: 完全无重叠 → score = 0', () => {
  setupMyGames([makeGame(1, 6000), makeGame(2, 3000), makeGame(3, 1500)]);
  const friendGames = [makeGame(100, 6000), makeGame(200, 3000), makeGame(300, 1500)];
  const score = computeMatchScore(friendGames);
  expect(score, 0, 'score');
});

test('T02: 完全重叠+相同时长+相同权重 → score = 1', () => {
  setupMyGames([makeGame(1, 6000), makeGame(2, 3000), makeGame(3, 1500)], { 1: 1, 2: 1, 3: 1 });
  const friendGames = [makeGame(1, 6000), makeGame(2, 3000), makeGame(3, 1500)];
  const score = computeMatchScore(friendGames);
  expect(score, 1.0, 'score');
});

test('T03: 完全重叠+不同时长 → score < 1', () => {
  setupMyGames([makeGame(1, 6000), makeGame(2, 3000)]);
  const friendGames = [makeGame(1, 12000), makeGame(2, 60)];
  const score = computeMatchScore(friendGames);
  if (score >= 1.0) throw new Error(`score 应 < 1.0，实际 ${score.toFixed(4)}`);
  if (score <= 0) throw new Error(`score 应 > 0，实际 ${score.toFixed(4)}`);
});

test('T04: 部分重叠 → 0 < score < 1', () => {
  setupMyGames([makeGame(1, 6000), makeGame(2, 3000), makeGame(3, 1500)]);
  const friendGames = [makeGame(1, 6000), makeGame(2, 3000), makeGame(999, 5000)];
  const score = computeMatchScore(friendGames);
  if (score <= 0 || score >= 1) throw new Error(`score 应在 (0,1)，实际 ${score.toFixed(4)}`);
});

test('T05: 陌生人Top5全是核心游戏 → 高分', () => {
  const myGames = [];
  for (let i = 1; i <= 200; i++) myGames.push(makeGame(i, Math.max(6000 - i * 25, 60)));
  setupMyGames(myGames);
  const strangerTop5 = [makeGame(1, 6000), makeGame(2, 5800), makeGame(3, 5600), makeGame(4, 5400), makeGame(5, 5200)];
  const score = computeStrangerMatchScore(strangerTop5);
  if (score < 0.3) throw new Error(`陌生人匹配核心游戏应得较高分，实际 ${score.toFixed(4)}`);
});

test('T06: 陌生人Top5全是边缘游戏 → 低分', () => {
  const myGames = [];
  for (let i = 1; i <= 200; i++) myGames.push(makeGame(i, Math.max(6000 - i * 25, 60)));
  setupMyGames(myGames);
  const strangerTop5 = [makeGame(190, 200), makeGame(191, 180), makeGame(192, 160), makeGame(193, 140), makeGame(194, 120)];
  const score = computeStrangerMatchScore(strangerTop5);
  if (score > 0.15) throw new Error(`陌生人匹配边缘游戏应得低分，实际 ${score.toFixed(4)}`);
});

test('T07: 高权重游戏匹配 → 分数高于低权重游戏匹配', () => {
  setupMyGames([makeGame(1, 6000), makeGame(2, 3000), makeGame(3, 1500), makeGame(4, 800), makeGame(5, 400)]);
  state.gameWeights = { 1: 5, 2: 1, 3: 1, 4: 1, 5: 1 };
  const friendMatchCore = computeMatchScore([makeGame(1, 6000)]);
  state.gameWeights = { 1: 1, 2: 5, 3: 1, 4: 1, 5: 1 };
  const friendMatchSecondary = computeMatchScore([makeGame(2, 3000)]);
  if (friendMatchCore <= friendMatchSecondary) {
    throw new Error(`核心权重匹配 (${friendMatchCore.toFixed(4)}) 应 > 次要权重匹配 (${friendMatchSecondary.toFixed(4)})`);
  }
});

test('T08: 权重=1(无感)游戏匹配 → 分数低于权重=5(核心)', () => {
  setupMyGames([makeGame(1, 6000), makeGame(2, 3000), makeGame(3, 1500), makeGame(4, 800), makeGame(5, 400)]);
  state.gameWeights = { 1: 1, 2: 1, 3: 1, 4: 1, 5: 5 };
  const scoreMatchLow = computeMatchScore([makeGame(1, 6000)]);
  const scoreMatchHigh = computeMatchScore([makeGame(5, 400)]);
  if (scoreMatchHigh <= scoreMatchLow) {
    throw new Error(`核心权重5 (${scoreMatchHigh.toFixed(4)}) 应 > 无感权重1 (${scoreMatchLow.toFixed(4)})`);
  }
});

test('T09: 排除游戏后 → 该游戏不影响匹配', () => {
  setupMyGames([makeGame(1, 6000), makeGame(2, 3000), makeGame(3, 1500)]);
  excludedSet = new Set([1]);
  const score = computeMatchScore([makeGame(1, 6000), makeGame(2, 3000), makeGame(3, 1500)]);
  if (score >= 1.0) throw new Error(`排除核心游戏后 score 应 < 1.0，实际 ${score.toFixed(4)}`);
});

test('T10: 空游戏库 → score = 0', () => {
  setupMyGames([]);
  const score = computeMatchScore([makeGame(1, 6000)]);
  expect(score, 0, 'score');
});

test('T11: 对方空游戏库 → score = 0', () => {
  setupMyGames([makeGame(1, 6000), makeGame(2, 3000)]);
  const score = computeMatchScore([]);
  expect(score, 0, 'score');
});

test('T12: 单款游戏重叠 → 0 < score < 1', () => {
  setupMyGames([makeGame(1, 6000), makeGame(2, 3000), makeGame(3, 1500)]);
  const score = computeMatchScore([makeGame(1, 6000), makeGame(99, 5000), makeGame(98, 4000)]);
  if (score <= 0 || score >= 1) throw new Error(`score 应在 (0,1)，实际 ${score.toFixed(4)}`);
});

test('T13: computeSimilarity非对称 — coverage是"我的"覆盖度', () => {
  setupMyGames([makeGame(1, 6000), makeGame(2, 3000), makeGame(3, 1500)]);
  const friendGames = [makeGame(1, 6000)];
  const scoreA = computeMatchScore(friendGames);

  resetState();
  setupMyGames([makeGame(1, 6000)]);
  const friendGamesB = [makeGame(1, 6000), makeGame(2, 3000), makeGame(3, 1500)];
  const scoreB = computeMatchScore(friendGamesB);

  if (scoreA === scoreB) throw new Error(`非对称算法中两个方向分数应不同: A=${scoreA.toFixed(4)} B=${scoreB.toFixed(4)}`);
});

test('T14: playtime=0的游戏不参与计算', () => {
  setupMyGames([makeGame(1, 6000), makeGame(2, 0), makeGame(3, 0)]);
  const score = computeMatchScore([makeGame(1, 6000)]);
  expect(score, 1.0, 'score');
});

test('T15: 多款游戏时长比例越接近 → alignment越高', () => {
  setupMyGames([makeGame(1, 6000), makeGame(2, 3000)], { 1: 1, 2: 1 });
  const scoreClose = computeMatchScore([makeGame(1, 6000), makeGame(2, 3000)]);
  const scoreFar = computeMatchScore([makeGame(1, 3000), makeGame(2, 6000)]);
  if (scoreClose <= scoreFar) {
    throw new Error(`时长比例一致 (${scoreClose.toFixed(4)}) 应 > 时长比例反转 (${scoreFar.toFixed(4)})`);
  }
});

test('T16: coverage精确值 — 3款游戏重叠2款', () => {
  setupMyGames([makeGame(1, 6000), makeGame(2, 3000), makeGame(3, 1500)]);
  const friendGames = [makeGame(1, 6000), makeGame(2, 3000), makeGame(99, 9999)];

  const myVec = buildMyVector();
  const friendVec = buildVector(friendGames);
  const score = computeSimilarity(myVec, friendVec);

  const w1 = getGameWeight(1), w2 = getGameWeight(2), w3 = getGameWeight(3);
  const normATotal = (w1*w1*6000) + (w2*w2*3000) + (w3*w3*1500);
  const normAInter = (w1*w1*6000) + (w2*w2*3000);
  const expectedCoverage = Math.sqrt(normAInter / normATotal);

  const normBInter = 6000 + 3000;
  const dot = w1 * Math.sqrt(6000) * Math.sqrt(6000) + w2 * Math.sqrt(3000) * Math.sqrt(3000);
  const expectedAlignment = dot / (Math.sqrt(normAInter) * Math.sqrt(normBInter));
  const expectedScore = expectedAlignment * expectedCoverage;

  expect(score, expectedScore, 'score', 0.001);
});

test('T17: 默认权重按排名分配', () => {
  setupMyGames([makeGame(1, 6000), makeGame(2, 3000), makeGame(3, 1500), makeGame(4, 800), makeGame(5, 400)]);
  expect(getGameWeight(1), 5, 'rank 1 weight');
  expect(getGameWeight(2), 4, 'rank 2 weight');
  expect(getGameWeight(3), 3, 'rank 3 weight');
  expect(getGameWeight(4), 2, 'rank 4 weight');
  expect(getGameWeight(5), 1, 'rank 5 weight');
});

test('T18: 自定义权重覆盖默认值', () => {
  setupMyGames([makeGame(1, 6000), makeGame(2, 3000)], { 1: 1, 2: 5 });
  expect(getGameWeight(1), 1, 'custom weight for appid 1');
  expect(getGameWeight(2), 5, 'custom weight for appid 2');
});

test('T19: weightLabel正确映射', () => {
  if (weightLabel(1) !== '无感') throw new Error(`weightLabel(1) 应为 '无感'，实际 '${weightLabel(1)}'`);
  if (weightLabel(2) !== '次要') throw new Error(`weightLabel(2) 应为 '次要'，实际 '${weightLabel(2)}'`);
  if (weightLabel(3) !== '一般') throw new Error(`weightLabel(3) 应为 '一般'，实际 '${weightLabel(3)}'`);
  if (weightLabel(4) !== '重要') throw new Error(`weightLabel(4) 应为 '重要'，实际 '${weightLabel(4)}'`);
  if (weightLabel(5) !== '核心') throw new Error(`weightLabel(5) 应为 '核心'，实际 '${weightLabel(5)}'`);
});

test('T20: 200款游戏场景 — 核心5款匹配 vs 边缘5款匹配', () => {
  const myGames = [];
  for (let i = 1; i <= 200; i++) myGames.push(makeGame(i, Math.max(6000 - i * 25, 60)));
  setupMyGames(myGames);

  const coreStranger = [makeGame(1, 6000), makeGame(2, 5800), makeGame(3, 5600), makeGame(4, 5400), makeGame(5, 5200)];
  const edgeStranger = [makeGame(196, 100), makeGame(197, 90), makeGame(198, 80), makeGame(199, 70), makeGame(200, 60)];

  const coreScore = computeStrangerMatchScore(coreStranger);
  const edgeScore = computeStrangerMatchScore(edgeStranger);

  if (coreScore <= edgeScore) {
    throw new Error(`核心匹配 (${coreScore.toFixed(4)}) 应 > 边缘匹配 (${edgeScore.toFixed(4)})`);
  }
  if (coreScore < 0.2) {
    throw new Error(`核心匹配分数不应太低: ${coreScore.toFixed(4)}`);
  }
});

test('T21: √playtime压缩极端时长差异', () => {
  setupMyGames([makeGame(1, 120000), makeGame(2, 120)]);
  const vec = buildMyVector();
  const ratio = vec[1] / vec[2];
  const rawRatio = 120000 / 120;
  if (ratio >= rawRatio) {
    throw new Error(`√playtime 应压缩比值: 压缩后 ${ratio.toFixed(2)} 应 < 原始 ${rawRatio.toFixed(2)}`);
  }
});

test('T22: 好友完整库 vs 陌生人Top5 — 好友覆盖度更高', () => {
  const myGames = [];
  for (let i = 1; i <= 50; i++) myGames.push(makeGame(i, 6000 - i * 80));
  setupMyGames(myGames);

  const friendFull = myGames.map(g => ({ ...g, playtime_forever: g.playtime_forever * 0.8 }));
  const strangerTop5 = friendFull.slice(0, 5);

  const friendScore = computeMatchScore(friendFull);
  const strangerScore = computeStrangerMatchScore(strangerTop5);

  if (friendScore <= strangerScore) {
    throw new Error(`好友完整库 (${friendScore.toFixed(4)}) 应 > 陌生人Top5 (${strangerScore.toFixed(4)})`);
  }
});

// ============================================================
// Run
// ============================================================
console.log('\n=== Steam 玩伴探测 · 算法单元测试 ===\n');

for (const t of tests) {
  resetState();
  try {
    t.fn();
    passed++;
    console.log(`  ✓ ${t.name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${t.name}`);
    console.log(`    ${e.message}\n`);
  }
}

console.log(`\n=== 结果: ${passed}/${tests.length} 通过, ${failed} 失败 ===\n`);
process.exit(failed > 0 ? 1 : 0);
