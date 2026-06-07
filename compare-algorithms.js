// 新旧匹配算法对比脚本
// 使用模拟真实 Steam 场景的数据

const TOP_N = 5;

// ==================== 旧算法 ====================
function oldComputeScore(myTop5, theirGames, sharedCount, myTotal, theirTotal) {
  if (!myTop5 || !myTop5.length || !theirGames) return 0;
  const gMap = {}; (theirGames || []).forEach(g => { gMap[g.appid] = g; });
  let weightedSum = 0, maxWeight = 0, matched = 0;
  for (let i = 0; i < myTop5.length; i++) {
    const pg = myTop5[i];
    const w = TOP_N - i;
    maxWeight += w;
    const tg = gMap[pg.appid];
    if (!tg) continue;
    matched++;
    const pT = pg.playtime_forever || 0;
    const tT = tg.playtime_forever || 0;
    const logA = Math.log(pT + 1);
    const logB = Math.log(tT + 1);
    const sim = logA + logB > 0 ? 1 - Math.abs(logA - logB) / (logA + logB) : 1;
    weightedSum += w * sim;
  }
  const norm = weightedSum / maxWeight;
  const matchBonus = matched / TOP_N;
  let sharedRatio = matchBonus;
  if (sharedCount !== undefined) {
    if (myTotal !== undefined && theirTotal !== undefined) {
      const denom = myTotal + theirTotal - sharedCount;
      sharedRatio = denom > 0 ? sharedCount / denom : 0;
    } else {
      sharedRatio = Math.min(sharedCount / 20, 1.0);
    }
  }
  return Math.min((norm * 0.35 + matchBonus * 0.35 + sharedRatio * 0.30) * 1.3, 1.0);
}

// ==================== 新算法 ====================
let gameWeights = {};
let playerGames = [];

function getGameWeight(appid) {
  if (gameWeights[appid] !== undefined) return gameWeights[appid];
  const top5 = getTopGames(playerGames, TOP_N);
  const rank = top5.findIndex(g => g.appid === appid);
  return rank >= 0 ? Math.max(TOP_N - rank, 1) : 1;
}

function getTopGames(games, n) {
  return [...games].filter(g => (g.playtime_forever || 0) > 0)
    .sort((a, b) => (b.playtime_forever || 0) - (a.playtime_forever || 0))
    .slice(0, n);
}

function getExcludedSet() { return new Set(); }

function computeUnifiedScore(myGames, theirGames, activeCount = 5, noLibrary = false) {
  if (!myGames || !theirGames || !myGames.length) return 0;
  const excluded = getExcludedSet();
  const toHrs = pt => (pt || 0) / 60;
  const toLog = h => Math.log(h + 1);

  const theirMap = {};
  for (const g of theirGames) theirMap[g.appid] = toHrs(g.playtime_forever);

  let weightedSimSum = 0, matchedWeight = 0, overlapCount = 0;
  for (let i = 0; i < myGames.length; i++) {
    const g = myGames[i];
    if (excluded.has(g.appid)) continue;
    const w = getGameWeight(g.appid);
    const myH = toHrs(g.playtime_forever);
    if (myH <= 0) continue;
    const theirH = theirMap[g.appid];
    if (theirH !== undefined && theirH > 0) {
      const myL = toLog(myH), theirL = toLog(theirH);
      const sim = 1 - Math.abs(myL - theirL) / (myL + theirL);
      weightedSimSum += w * sim;
      matchedWeight += w;
      overlapCount++;
    }
  }

  const weightedSim = matchedWeight > 0 ? weightedSimSum / matchedWeight : 0;
  const top5Overlap = overlapCount / activeCount;

  let jaccard = 0;
  if (!noLibrary && theirGames.length > 0) {
    const theirSet = new Set(theirGames.map(g => g.appid));
    let shared = 0, myFilteredTotal = 0;
    for (const g of playerGames) {
      if (excluded.has(g.appid)) continue;
      myFilteredTotal++;
      if (theirSet.has(g.appid)) shared++;
    }
    const denom = myFilteredTotal + theirGames.length - shared;
    if (denom > 0) jaccard = shared / denom;
  }

  return Math.min(weightedSim * top5Overlap + jaccard, 1.0);
}

function newComputeMatchScore(friendGames) {
  return computeUnifiedScore(getTopGames(playerGames, TOP_N), friendGames, TOP_N, false);
}

function newComputeStrangerScore(strangerTop5) {
  return computeUnifiedScore(getTopGames(playerGames, TOP_N), strangerTop5, TOP_N, true);
}

// ==================== 模拟数据 ====================

// 玩家自己的游戏库: 200款游戏，前5款是常玩的
function generateMyLibrary() {
  const games = [];
  // Top5 核心游戏
  const coreGames = [
    { appid: 730, name: 'Counter-Strike 2', hours: 6000 },
    { appid: 570, name: 'Dota 2', hours: 3000 },
    { appid: 578080, name: 'PUBG', hours: 1500 },
    { appid: 252490, name: 'Rust', hours: 800 },
    { appid: 1245620, name: 'Elden Ring', hours: 400 },
  ];
  coreGames.forEach(g => games.push({ appid: g.appid, name: g.name, playtime_forever: g.hours * 60 }));

  // 长尾 195 款游戏 (逐渐递减)
  for (let i = 0; i < 195; i++) {
    const hours = Math.max(300 - i * 1.5, 1);
    games.push({ appid: 100000 + i, name: `Game ${i + 6}`, playtime_forever: Math.round(hours * 60) });
  }
  return games;
}

// 好友类型工厂
function makeFriend(name, coreGames, extraCount, timeMultiplier) {
  const games = [];
  const appidBase = 200000 + Math.floor(Math.random() * 10000);

  // 添加核心重合游戏
  coreGames.forEach(g => {
    games.push({
      appid: g.appid,
      name: g.name,
      playtime_forever: Math.round(g.playtime_forever * (timeMultiplier + (Math.random() - 0.5) * 0.2)),
    });
  });

  // 添加额外游戏 (包括一些与玩家重合的长尾)
  for (let i = 0; i < extraCount; i++) {
    const hours = Math.max(500 - i * 2, 1);
    // 50% 概率从玩家的长尾中取
    const fromMyTail = Math.random() > 0.5;
    const appid = fromMyTail ? 100000 + Math.floor(Math.random() * 195) : appidBase + i;
    games.push({ appid, name: `Friend Game ${i}`, playtime_forever: Math.round(hours * 60) });
  }

  return { name, games };
}

// ==================== 测试场景 ====================

console.log('='.repeat(80));
console.log('    新旧匹配算法对比 - 基于模拟真实 Steam 数据');
console.log('='.repeat(80));

// 设置玩家数据
playerGames = generateMyLibrary();
const myTop5 = getTopGames(playerGames, TOP_N);
const myTotal = playerGames.length;
const myHours = playerGames.reduce((s, g) => s + g.playtime_forever, 0);

console.log(`\n玩家游戏库: ${myTotal} 款游戏, 总时长 ${Math.round(myHours/60)}h`);
console.log(`Top5: ${myTop5.map(g => `${g.name}(${Math.round(g.playtime_forever/60)}h)`).join(', ')}`);
console.log();

// 生成 8 个不同类型的好友
const friends = [
  makeFriend('张三-真死党', myTop5.slice(0, 5), 150, 0.95),
  makeFriend('李四-专职CS2', [myTop5[0]], 200, 1.2),
  makeFriend('王五-口味相反', myTop5.slice(0, 5).reverse(), 120, 0.9),
  makeFriend('赵六-冷门同好', [], 80, 1.0), // 只玩长尾重合
  makeFriend('钱七-轻度玩家', myTop5.slice(0, 2), 20, 0.5),
  makeFriend('孙八-游戏收藏家', myTop5.slice(0, 5), 500, 0.1),
  makeFriend('周九-只玩热门', myTop5.slice(0, 1), 100, 1.5),
  makeFriend('吴十-新人入门', myTop5.slice(0, 3), 5, 0.3),
];

// 修正赵六的数据: 让他玩玩家的长尾游戏
const tailGames = playerGames.slice(5, 25).map(g => ({
  ...g,
  playtime_forever: Math.round(g.playtime_forever * (0.3 + Math.random() * 0.5)),
}));
friends[3].games = tailGames;
friends[3].name = '赵六-冷门同好';

// 计算新旧得分
const results = friends.map(f => {
  const fg = f.games;

  // 旧算法
  const shared = playerGames.filter(pg => fg.some(fg2 => fg2.appid === pg.appid)).length;
  const oldScore = oldComputeScore(myTop5, fg, shared, myTotal, fg.length);

  // 新算法
  const newScore = newComputeMatchScore(fg);

  // 陌生人模拟 (只用Top5)
  const fTop5 = getTopGames(fg, TOP_N);
  const strangerOld = oldComputeScore(myTop5, fTop5, undefined, undefined, undefined);
  // 注意: 旧陌生人用了不同的参数签名，这模拟了computeStrangerBreakdown内的computeScore(myTop5, strangerTop5)
  const strangerNew = newComputeStrangerScore(fTop5);

  return {
    name: f.name,
    gameCount: fg.length,
    sharedCount: shared,
    oldScore: oldScore,
    newScore: newScore,
    strangerOld: strangerOld,
    strangerNew: strangerNew,
  };
});

// ==================== 输出结果 ====================

console.log('┌──────────────────────┬─────────┬────────┬──────────┬──────────┬───────────┬──────────┐');
console.log('│ 好友                  │ 游戏数  │ 重合数 │ 旧得分   │ 新得分   │ 陌生人旧  │ 陌生人新  │');
console.log('├──────────────────────┼─────────┼────────┼──────────┼──────────┼───────────┼──────────┤');
results.forEach(r => {
  const name = r.name.padEnd(20);
  const gc = String(r.gameCount).padStart(7);
  const sc = String(r.sharedCount).padStart(6);
  const oldS = (r.oldScore * 100).toFixed(1).padStart(6);
  const newS = (r.newScore * 100).toFixed(1).padStart(6);
  const so = (r.strangerOld * 100).toFixed(1).padStart(7);
  const sn = (r.strangerNew * 100).toFixed(1).padStart(7);
  console.log(`│ ${name} │ ${gc} │ ${sc} │ ${oldS}% │ ${newS}% │ ${so}% │ ${sn}% │`);
});
console.log('└──────────────────────┴─────────┴────────┴──────────┴──────────┴───────────┴──────────┘');

// ==================== 排序对比 ====================

const sortedByOld = [...results].sort((a, b) => b.oldScore - a.oldScore);
const sortedByNew = [...results].sort((a, b) => b.newScore - a.newScore);

console.log('\n\n📊 旧算法排序:');
sortedByOld.forEach((r, i) => {
  console.log(`  #${i + 1} ${r.name.padEnd(20)} ${(r.oldScore * 100).toFixed(1)}%`);
});

console.log('\n📊 新算法排序:');
sortedByNew.forEach((r, i) => {
  console.log(`  #${i + 1} ${r.name.padEnd(20)} ${(r.newScore * 100).toFixed(1)}%`);
});

// ==================== 排名变化 ====================

console.log('\n\n📈 排位变化:');
const oldRankMap = {};
sortedByOld.forEach((r, i) => { oldRankMap[r.name] = i + 1; });

sortedByNew.forEach((r, i) => {
  const oldRank = oldRankMap[r.name];
  const diff = oldRank - (i + 1);
  const arrow = diff > 0 ? '↑' : diff < 0 ? '↓' : '→';
  const diffStr = diff !== 0 ? ` (${Math.abs(diff)}位)` : '';
  console.log(`  #${i + 1} ${r.name.padEnd(20)} ${(r.newScore * 100).toFixed(1)}%  旧排名 #${oldRank}  ${arrow}${diffStr}`);
});

// ==================== 权重影响测试 ====================

console.log('\n\n⚡ 权重影响测试:');
console.log('将 #1 CS2 权重设为 1 (无关)，#5 Elden Ring 权重设为 5 (核心)，观察排序变化');

// 保存原始权重
const savedWeights = { ...gameWeights };
gameWeights = { 730: 1, 1245620: 5 };

const weightedResults = friends.map(f => {
  const fg = f.games;
  const score = newComputeMatchScore(fg);
  return { name: f.name, score };
}).sort((a, b) => b.score - a.score);

console.log('\n权重调整后新排序:');
weightedResults.forEach((r, i) => {
  console.log(`  #${i + 1} ${r.name.padEnd(20)} ${(r.score * 100).toFixed(1)}%`);
});

// 恢复
gameWeights = savedWeights;

// ==================== 分数分布统计 ====================

console.log('\n\n📊 新旧算法分数分布:');
const oldScores = results.map(r => r.oldScore);
const newScores = results.map(r => r.newScore);

function distribution(scores) {
  const ranges = ['0-20%', '20-40%', '40-60%', '60-80%', '80-100%'];
  const bins = [0, 0, 0, 0, 0];
  scores.forEach(s => {
    const idx = Math.min(Math.floor(s / 0.2), 4);
    bins[idx]++;
  });
  return ranges.map((r, i) => `    ${r}: ${'█'.repeat(bins[i])}${'░'.repeat(Math.max(0, 8 - bins[i]))} (${bins[i]})`).join('\n');
}

console.log('旧算法:');
console.log(distribution(oldScores));
console.log('新算法:');
console.log(distribution(newScores));
