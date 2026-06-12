
const state = {
  playerGames: [],
  rawPlayerGames: [],
  playerTopGames: [],
  myRecentGames: [],
  friendsRecentData: [],
  friendsRecentLoaded: false,
  friendsData: [],
  mySteamId: null, myApiKey: null,
  myProfile: null,
  strangersData: null,
  strangersError: null,
  _recruitMode: 'match',
  recentMatchResults: null,
  gameWeights: {},
  showWeights: false,
  weeklyReport: null,
  friendsWeekly: null,
};

const STRANGER_API_BASE = '';

const TOP_N = 5;

const PROXY_BASE = 'https://steam.i-test.top/proxy';

function proxyUrl(url) {
  return PROXY_BASE ? `${PROXY_BASE}?url=${encodeURIComponent(url)}` : url;
}

function steamApiUrl(endpoint, params) {
  const qs = Object.entries(params).map(([k,v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return proxyUrl(`https://api.steampowered.com${endpoint}?${qs}`);
}

const apiCache = new Map();
const CACHE_TTL = 10 * 60 * 1000;
const strangersCache = { data: null, ts: 0 };
const STRANGERS_CACHE_TTL = 2 * 60 * 1000;
const STRANGERS_PAGE_SIZE = 10;
let strangersDisplayCount = STRANGERS_PAGE_SIZE;
const FRIEND_RACE_PAGE = 10;
let friendRaceDisplayCount = FRIEND_RACE_PAGE;

function getExcludedSet() {
  try { return new Set(JSON.parse(localStorage.getItem('excludedGames') || '[]')); } catch { return new Set(); }
}
function saveExcludedSet(s) { localStorage.setItem('excludedGames', JSON.stringify([...s])); }
function isExcluded(appid) { return getExcludedSet().has(appid); }
function toggleExcluded(appid) {
  const s = getExcludedSet();
  if (s.has(appid)) s.delete(appid); else s.add(appid);
  saveExcludedSet(s);
  return s.has(appid);
}

function getGameWeight(appid) {
  return state.gameWeights[appid] ?? 3;
}
function setGameWeight(appid, weight) {
  state.gameWeights[appid] = weight;
  try { localStorage.setItem('gameWeights', JSON.stringify(state.gameWeights)); } catch {}
}
function cleanupGameWeights() {
  const validAppids = new Set(state.playerGames.map(g => g.appid));
  let changed = false;
  for (const k in state.gameWeights) {
    if (!validAppids.has(+k)) {
      delete state.gameWeights[k];
      changed = true;
    }
  }
  if (changed) {
    try { localStorage.setItem('gameWeights', JSON.stringify(state.gameWeights)); } catch {}
  }
}
function loadGameWeights() {
  try { state.gameWeights = JSON.parse(localStorage.getItem('gameWeights') || '{}'); } catch { state.gameWeights = {}; }
  try { state.showWeights = JSON.parse(localStorage.getItem('showWeights') || 'false'); } catch {}
}
function weightLabel(w) {
  return ['', '无关', '次要', '一般', '重要', '核心'][w] || w;
}

function getCustomGames() {
  try { return JSON.parse(localStorage.getItem('customGames') || '[]'); } catch { return []; }
}
function saveCustomGames(games) {
  localStorage.setItem('customGames', JSON.stringify(games));
}
function extractAppid(input) {
  const s = input.trim();
  if (/^\d{1,7}$/.test(s)) return s;
  let m = s.match(/store\.steampowered\.com\/app\/(\d+)/);
  if (m) return m[1];
  m = s.match(/steamcommunity\.com\/app\/(\d+)/);
  if (m) return m[1];
  return null;
}
async function lookupGameInfo(appid) {
  const res = await fetch(proxyUrl(`https://store.steampowered.com/api/appdetails?appids=${appid}`));
  if (!res.ok) return null;
  const d = await res.json();
  if (!d[appid]?.success) return null;
  return d[appid].data;
}
function mergeCustomGames(games) {
  const custom = getCustomGames();
  const customMap = {};
  custom.forEach(g => { customMap[g.appid] = g; });
  const merged = games.map(g => customMap[g.appid] || g);
  custom.forEach(g => {
    if (!merged.some(m => m.appid === g.appid)) merged.push(g);
  });
  return merged;
}
function recomputeMatches() {
  for (const f of state.friendsData) {
    f.score = computeMatchScore(f.games);
  }
  state.friendsData.sort((a, b) => b.score - a.score);
  renderMatches();
  if (state.strangersData) renderStrangersResults();
}

function remergeCustomGames() {
  state.playerGames = mergeCustomGames(state.rawPlayerGames);
  state.playerTopGames = getTopGames(state.playerGames, TOP_N);
  cleanupGameWeights();
  renderLibrary();
  if (state.friendsData.length) recomputeMatches();
}

function showAddGameModal(editAppid) {
  const existing = document.getElementById('addGameOverlay');
  if (existing) existing.remove();
  const editMode = editAppid !== undefined;
  const custom = getCustomGames();
  const editGame = editMode ? custom.find(g => g.appid === editAppid) : null;
  const overlay = document.createElement('div');
  overlay.id = 'addGameOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;';
  overlay.innerHTML = `
    <div style="background:#fff;border:3px solid var(--border-thick);border-radius:28px;padding:36px;max-width:480px;width:90%;box-shadow:var(--shadow-pop);">
      <h3 style="font-size:20px;font-weight:900;margin-bottom:24px;color:var(--border-thick);">${editMode ? '编辑游戏' : '手动添加游戏'}</h3>
      <div style="display:flex;flex-direction:column;gap:16px;">
        <label style="font-size:13px;font-weight:900;color:var(--border-thick);display:flex;flex-direction:column;gap:6px;">
          Steam 商店 URL 或 AppID
          <input type="text" id="addGameAppid" value="${editMode ? editGame?.appid || '' : ''}" ${editMode ? 'readonly' : ''} placeholder="例: 730 或 store.steampowered.com/app/730" style="padding:14px 18px;border:3px solid var(--border-thick);border-radius:14px;font-size:15px;font-weight:700;">
        </label>
        <div id="addGamePreview" style="display:${editMode ? 'flex' : 'none'};align-items:center;gap:14px;padding:12px;background:var(--surface);border-radius:14px;border:2px solid var(--border-thick);">
          <img src="${editMode ? `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${editGame?.appid}/header.jpg` : ''}" alt="" style="width:60px;height:28px;border-radius:6px;border:2px solid var(--border-thick);object-fit:cover;" onerror="this.style.display='none'">
          <span id="addGameName" style="font-weight:800;font-size:15px;">${editMode ? editGame?.name || '' : ''}</span>
        </div>
        <label style="font-size:13px;font-weight:900;color:var(--border-thick);display:flex;flex-direction:column;gap:6px;">
          游戏时长（小时）
          <input type="number" id="addGameHours" value="${editMode ? Math.round((editGame?.playtime_forever || 0) / 60) : ''}" min="0" step="1" placeholder="输入总时长" style="padding:14px 18px;border:3px solid var(--border-thick);border-radius:14px;font-size:15px;font-weight:700;">
        </label>
        <div style="display:flex;gap:12px;margin-top:8px;">
          <button id="addGameCancelBtn" class="btn btn-ghost" style="flex:1;padding:14px;">取消</button>
          <button id="addGameSaveBtn" class="btn btn-primary" style="flex:2;padding:14px;">${editMode ? '保存' : '添加'}</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  if (!editMode) {
    const appidInput = document.getElementById('addGameAppid');
    let lookupTimer;
    appidInput.addEventListener('input', () => {
      clearTimeout(lookupTimer);
      lookupTimer = setTimeout(async () => {
        const appid = extractAppid(appidInput.value);
        if (!appid) return;
        const info = await lookupGameInfo(appid);
        if (!info) return;
        document.getElementById('addGamePreview').style.display = 'flex';
        document.getElementById('addGameName').textContent = info.name;
        const previewImg = document.querySelector('#addGamePreview img');
        if (previewImg) {
          previewImg.src = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/header.jpg`;
          previewImg.style.display = '';
        }
        appidInput.dataset.lookedUpAppid = appid;
        appidInput.dataset.lookedUpName = info.name;
      }, 500);
    });
  }

  document.getElementById('addGameSaveBtn').addEventListener('click', async () => {
    const appidInput = document.getElementById('addGameAppid');
    const hoursInput = document.getElementById('addGameHours');
    const hours = parseFloat(hoursInput.value);
    let appid, name;
    if (editMode) {
      appid = editGame.appid;
      name = editGame.name;
    } else {
      const extracted = extractAppid(appidInput.value);
      if (!extracted) { showToast('请输入有效的 AppID 或商店 URL'); return; }
      appid = +extracted;
      if (appidInput.dataset.lookedUpAppid == appid) {
        name = appidInput.dataset.lookedUpName;
      } else {
        const info = await lookupGameInfo(appid);
        if (!info) { showToast('未找到该游戏，请检查 AppID'); return; }
        name = info.name;
      }
    }
    if (!hours || hours < 0) { showToast('请输入有效时长'); return; }
    const arr = getCustomGames();
    const idx = arr.findIndex(g => g.appid === appid);
    const entry = { appid, name, playtime_forever: Math.round(hours * 60), _custom: true };
    if (idx >= 0) arr[idx] = { ...arr[idx], ...entry };
    else arr.push(entry);
    saveCustomGames(arr);
    overlay.remove();
    remergeCustomGames();
    showToast(editMode ? '已更新' : '已添加');
  });

  document.getElementById('addGameCancelBtn').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}

async function apiFetch(endpoint, params) {
  const url = steamApiUrl(endpoint, params);
  const cached = apiCache.get(url);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;
  const res = await fetch(url);
  if (!res.ok) {
    let detail = '';
    try { const e = await res.json(); detail = e.error || ''; } catch(e) {}
    if (res.status === 403) throw new Error('API 密钥无效或被 Steam 拒绝，请检查密钥是否正确');
    if (res.status === 429) throw new Error('Steam API 请求过于频繁，请稍后再试');
    if (res.status >= 500) throw new Error('Steam 服务器暂时不可用，请稍后再试');
    throw new Error(`请求失败 (${res.status})${detail ? ': ' + detail : ''}`);
  }
  const data = await res.json();
  apiCache.set(url, { data, ts: Date.now() });
  return data;
}

document.addEventListener('DOMContentLoaded', () => {
  if (window.IS_SHARE_PAGE) { initSharePage(); return; }
  // Load saved API key
  const saved = localStorage.getItem('steamApiKey');
  if (saved) document.getElementById('apiKey').value = saved;
  loadGameWeights();
  // event listeners
  document.getElementById('fetchBtn').addEventListener('click', startFetch);
  document.getElementById('apiToggle').addEventListener('click', () => {
    const s = document.getElementById('apiSection');
    s.style.display = s.style.display === 'none' ? 'block' : 'none';
  });
  document.getElementById('saveApiKeyBtn').addEventListener('click', () => {
    const key = document.getElementById('apiKey').value.trim();
    if (!key) { showToast('请输入 API 密钥'); return; }
    localStorage.setItem('steamApiKey', key);
    document.getElementById('apiSection').style.display = 'none';
    showToast('API 密钥已保存');
  });
  document.getElementById('tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab-btn');
    if (btn) {
      switchTab(btn.dataset.tab);
      if (btn.dataset.tab === 'tab-strangers') loadStrangers();
      if (btn.dataset.tab === 'tab-recruit') renderRecruit();
      if (btn.dataset.tab === 'tab-weekly') renderWeeklyReport();
    }
  });
  document.getElementById('matchesContent').addEventListener('click', (e) => {
    const card = e.target.closest('.friend-card');
    if (card && card.dataset.steamid) showPersonDetail(card.dataset.steamid);
  });
  document.getElementById('strangersContent').addEventListener('click', (e) => {
    const card = e.target.closest('.friend-card');
    if (card && card.dataset.steamid) showStrangerDetail(card.dataset.steamid);
  });
  document.getElementById('recruitContent').addEventListener('click', (e) => {
    const card = e.target.closest('.friend-card');
    if (card && card.dataset.steamid) {
      if (state._recruitMode === 'team') return;
      const sid = card.dataset.steamid;
      if (state._recruitMode === 'recent') {
        showRecentDetail(sid);
      } else {
        if (state.friendsData.some(f => f.steamid === sid)) {
          showPersonDetail(sid);
        } else {
          showStrangerDetail(sid);
        }
      }
      state._detailSource = 'recruit';
    }
  });
  document.getElementById('detailContent').addEventListener('click', (e) => {
    if (e.target.id === 'backBtn') {
      if (state._detailSource === 'recruit') { switchTab('tab-recruit'); return; }
      switchTab(state._detailSource === 'strangers' ? 'tab-strangers' : 'tab-matches');
    }
    if (e.target.id === 'shareDetailBtn') shareDetailResults();
    if (e.target.id === 'addFriendBtn') {
      const steamid = state._detailSteamId;
      if (steamid) window.open(`https://steamcommunity.com/profiles/${steamid}`, '_blank');
    }
  });
  document.getElementById('contributorsLink')?.addEventListener('click', showContributors);
});

function steamId2to64(id2) {
  const m = id2.match(/^STEAM_[0-5]:([0-1]):(\d+)$/i);
  if (!m) return null;
  return 76561197960265728 + parseInt(m[2]) * 2 + parseInt(m[1]) + '';
}

function steamId3to64(id3) {
  const m = id3.match(/^\[U:(\d+):(\d+)\]$/);
  if (!m) return null;
  return 76561197960265728 + parseInt(m[2]) + '';
}

async function resolveSteamId(input, apiKey) {
  let id = input.trim();

  // SteamID2 format: STEAM_X:Y:Z
  const s2 = steamId2to64(id);
  if (s2) return s2;

  // SteamID3 format: [U:X:Z]
  const s3 = steamId3to64(id);
  if (s3) return s3;

  // Extract from full profile URLs
  const urlMatch = id.match(/(?:steamcommunity\.com\/)?(?:profiles\/(\d{17})|id\/([a-zA-Z0-9_]+))/);
  if (urlMatch) {
    if (urlMatch[1]) return urlMatch[1];
    id = urlMatch[2];
  }

  // Direct 64-bit Steam ID
  if (/^7656119\d{10}$/.test(id)) return id;

  // Friend code detection (8-10 digit codes)
  if (/^\d{8,10}$/.test(id) && !/^7656/.test(id)) {
    throw new Error('好友码无法通过 API 查询，请使用个人资料链接或 64 位 ID');
  }

  // Try as vanity URL
  const d = await apiFetch('/ISteamUser/ResolveVanityURL/v1/', { key: apiKey, vanityurl: id, format: 'json' });
  if (d.response.success !== 1) throw new Error('未找到该 Steam 标识，请检查是否正确');
  return d.response.steamid;
}

function yieldToPaint() { return new Promise(r => setTimeout(r, 0)); }

async function startFetch() {
  const steamInput = document.getElementById('steamId').value.trim();
  const fetchBtn = document.getElementById('fetchBtn');
  if (!steamInput) { showError('请填写 Steam ID'); return; }
  let apiKey = document.getElementById('apiKey').value.trim();
  if (!apiKey) apiKey = localStorage.getItem('steamApiKey') || '';
  if (!apiKey) { showError('请先点击「配置 Steam API 密钥」并填写保存'); return; }
  fetchBtn.disabled = true;
  showProgress('正在获取游戏数据...', 10); await yieldToPaint();

  try {
    const steamId = await resolveSteamId(steamInput, apiKey);
    state.mySteamId = steamId; state.myApiKey = apiKey;
    showProgress('正在获取个人资料...', 15); await yieldToPaint();
    const mySummary = await fetchPlayerSummaries([steamId], apiKey);
    state.myProfile = (mySummary && mySummary[0]) || null;
    showProgress('正在获取游戏库...', 20); await yieldToPaint();
    const games = await fetchOwnedGames(steamId, apiKey);
    state.rawPlayerGames = games;
    state.playerGames = mergeCustomGames(games);
    state.playerTopGames = getTopGames(state.playerGames, TOP_N);
    showProgress('正在获取近期游戏数据...', 30); await yieldToPaint();
    try { state.myRecentGames = await fetchRecentGames(steamId, apiKey); } catch (e) { state.myRecentGames = []; }
    showProgress(`已获取 ${games.length} 款游戏，正在分析好友...`, 40); await yieldToPaint();
    await fetchFriendMatches(steamId, apiKey);
    showProgress('正在生成报告...', 90);
    renderLibrary(); renderMatches();
    document.getElementById('tabs').style.display = 'flex';
    switchTab('tab-library');
    updateProgress(100);
    hideProgress(500);
    // fire-and-forget weekly snapshot (deferred, payload-slimmed)
    setTimeout(() => {
      const payload = state.playerGames
        .filter(g => (g.playtime_forever || 0) > 0 && !g._custom)
        .map(g => ({ appid: g.appid, name: g.name, img_icon_url: g.img_icon_url || '', playtime_forever: g.playtime_forever }));
      if (!payload.length) return;
      fetch('/api/weekly/snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ steamid: state.mySteamId, games: payload }),
      }).catch(() => {});
    }, 0);
    // auto re-opt-in if previously opted in
    if (localStorage.getItem('strangerOptIn') === 'true') {
      await callStrangerOptIn(true, true);
    }
    // save steamId to chrome.storage
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.set({ steamId: steamInput });
    }
  } catch (err) {
    showError(err.message || '获取数据时出错');
    hideProgress();
  } finally { fetchBtn.disabled = false; }
}

async function fetchOwnedGames(steamId, apiKey) {
  const d = await apiFetch('/IPlayerService/GetOwnedGames/v1/', {
    key: apiKey, steamid: steamId, include_appinfo: true, include_played_free_games: true, format: 'json',
  });
  return (d.response && d.response.games) || [];
}

async function fetchFriendMatches(steamId, apiKey) {
  let d;
  try {
    d = await apiFetch('/ISteamUser/GetFriendList/v1/', { key: apiKey, steamid: steamId, relationship: 'friend', format: 'json' });
  } catch (e) {
    if (e.message.includes('不可用')) throw new Error('无法获取好友列表，请确保你的 Steam 个人资料的「好友列表」隐私设置为公开。可在 Steam 编辑个人资料 → 隐私设置中修改');
    throw e;
  }
  const friends = (d.friendslist && d.friendslist.friends) || [];
  if (friends.length === 0) {
    showToast('好友列表为空，请确认你的 Steam 好友列表已公开');
    state.friendsData = [];
    return;
  }

  const friendIds = friends.map(f => f.steamid);
  if (friendIds.length > 100) {
    showToast(`好友数 ${friendIds.length} 个，预计分析 ${Math.ceil(friendIds.length / 2)} 秒，请耐心等待`);
  }
  const summaries = await fetchPlayerSummaries(friendIds, apiKey);
  const summaryMap = {}; (summaries || []).forEach(s => { summaryMap[s.steamid] = s; });

  const results = [];
  for (let i = 0; i < friendIds.length; i++) {
    const fid = friendIds[i];
    updateProgress(40 + Math.round((i / friendIds.length) * 45));
    showProgress(`正在分析好友 ${i+1}/${friendIds.length}: ${summaryMap[fid]?.personaname || fid}...`);
    try {
      const fg = await fetchOwnedGames(fid, apiKey);
      const score = computeMatchScore(fg);
      const fTop5 = getTopGames(fg, TOP_N);
      results.push({
        steamid: fid, summary: summaryMap[fid] || null, games: fg, topGames: fTop5, score,
        totalHours: fg.reduce((s, g) => s + (g.playtime_forever || 0), 0),
        totalGames: fg.length, source: 'friend',
      });
    } catch (e) { console.warn(`Failed: ${fid}:`, e); }
  }
  results.sort((a, b) => b.score - a.score);
  state.friendsData = results;
}

async function fetchPlayerSummaries(steamids, apiKey) {
  const chunks = [];
  for (let i = 0; i < steamids.length; i += 100) chunks.push(steamids.slice(i, i + 100));
  const all = [];
  for (const chunk of chunks) {
    const d = await apiFetch('/ISteamUser/GetPlayerSummaries/v2/', { key: apiKey, steamids: chunk.join(','), format: 'json' });
    if (d.response && d.response.players) all.push(...d.response.players);
  }
  return all;
}

function getTopGames(games, n = TOP_N) {
  const excluded = getExcludedSet();
  return [...games].filter(g => (g.playtime_forever || 0) > 0 && !excluded.has(g.appid))
    .sort((a, b) => (b.playtime_forever || 0) - (a.playtime_forever || 0))
    .slice(0, n);
}

async function fetchRecentGames(steamId, apiKey) {
  const d = await apiFetch('/IPlayerService/GetRecentlyPlayedGames/v1/', {
    key: apiKey, steamid: steamId, count: TOP_N, format: 'json',
  });
  return (d.response && d.response.games) || [];
}

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
    const myH = toHrs(g.playtime_forever);
    if (myH <= 0) continue;
    const theirH = theirMap[g.appid];
    if (theirH !== undefined && theirH > 0) {
      const w = getGameWeight(g.appid);
      overlapCount++;
      if (w > 1) {
        const myL = toLog(myH), theirL = toLog(theirH);
        const sim = 1 - Math.abs(myL - theirL) / (myL + theirL);
        weightedSimSum += w * sim;
        matchedWeight += w;
      }
    }
  }

  const weightedSim = matchedWeight > 0 ? weightedSimSum / matchedWeight : 0;
  const top5Overlap = overlapCount / activeCount;

  let jaccard = 0;
  if (!noLibrary && theirGames.length > 0) {
    const theirSet = new Set(theirGames.map(g => g.appid));
    let shared = 0, myFilteredTotal = 0;
    for (const g of state.playerGames) {
      if (excluded.has(g.appid)) continue;
      myFilteredTotal++;
      if (theirSet.has(g.appid)) shared++;
    }
    const denom = myFilteredTotal + theirGames.length - shared;
    if (denom > 0) jaccard = shared / denom;
  }

  return Math.min(weightedSim * top5Overlap + jaccard, 1.0);
}

function computeMatchScore(theirGames, opts = {}) {
  const { noLibrary = false, activeCount = TOP_N } = opts;
  return computeUnifiedScore(state.playerTopGames, theirGames, activeCount, noLibrary);
}

function computeRecentMatchScore(myRecent, otherRecent) {
  const excluded = getExcludedSet();
  const valid = myRecent
    .filter(g => (g.playtime_forever || 0) > 0 && !excluded.has(g.appid))
    .sort((a, b) => b.playtime_forever - a.playtime_forever);
  const myTopN = valid.slice(0, TOP_N);
  return computeUnifiedScore(myTopN, otherRecent, Math.min(TOP_N, myTopN.length), true);
}

function scoreColor(pct) {
  if (pct > 80) return 'var(--brand-primary)';
  if (pct > 60) return 'var(--brand-yellow)';
  if (pct > 40) return 'var(--brand-success)';
  if (pct > 20) return 'var(--brand-secondary)';
  return 'var(--text-muted)';
}

function scoreColorHex(pct) {
  if (pct > 80) return '#ff5e62';
  if (pct > 60) return '#fbc531';
  if (pct > 40) return '#10b981';
  if (pct > 20) return '#3b82f6';
  return '#94a3b8';
}

function showToast(text) {
  const t = document.getElementById('toast');
  t.textContent = text;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}


const PLACEHOLDER_COLORS = ['#ff5e62','#3b82f6','#10b981','#8c7ae6','#fbc531'];

function generatePlaceholder(size, letter) {
  return new Promise(r => {
    const c = document.createElement('canvas'); c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    const ci = (letter.charCodeAt(0)||0) % PLACEHOLDER_COLORS.length;
    ctx.fillStyle = PLACEHOLDER_COLORS[ci]; ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#ffffff'; ctx.font = `800 ${Math.round(size*0.45)}px system-ui,sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(letter.toUpperCase(), size/2, size/2+1);
    r(c.toDataURL());
  });
}

async function downloadImage(name, fn) {
  const url = await fn();
  if (!url) return;
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function shareDetailResults() {
  const p = state.friendsData.find(f => f.steamid === state._detailSteamId);
  if (!p) return;
  const name = p.summary?.personaname || p.steamid;
  downloadImage(`Steam玩伴探测_${name}.png`, () => generateShareImageForDetail());
}

async function captureAndFooter(el, scale, title) {
  if (!window.html2canvas) { showToast('html2canvas 未加载'); return null; }
  const s = scale||2;
  const clone = el.cloneNode(true);
  // Remove UI buttons from clone
  clone.querySelectorAll('.share-section, .btn, [id$="Btn"], [id$="btn"]').forEach(e => e.remove());
  // Prepend platform badge + title
  const b = document.createElement('div');
  b.style.cssText = 'text-align:center;margin-bottom:14px;';
  const bi = document.createElement('span');
  bi.textContent = 'STEAM 玩伴探测';
  bi.style.cssText = 'display:inline-block;background:#fbc531;color:#0f172a;font-weight:900;font-size:18px;padding:10px 30px;border-radius:12px;border:2.5px solid #0f172a;';
  b.appendChild(bi);
  clone.insertBefore(b, clone.firstChild);
  if (title) {
    const h = document.createElement('div');
    h.textContent = title;
    h.style.cssText = 'text-align:center;font-size:28px;font-weight:800;color:#0f172a;padding:0 0 16px 0;';
    clone.insertBefore(h, b.nextSibling);
  }
  const wrap = document.createElement('div');
  wrap.style.cssText = `position:fixed;left:-9999px;top:0;width:${el.scrollWidth||600}px;background:#f8fafc;font-family:system-ui,sans-serif;padding:20px;box-sizing:border-box;`;
  wrap.appendChild(clone);
  document.body.appendChild(wrap);
  for (const img of clone.querySelectorAll('img')) {
    if (img.style.display === 'none') img.style.display = '';
    if (!img.src || !img.src.startsWith('http')) continue;
    const letter = (img.alt && img.alt[0]) || '?';
    img.removeAttribute('srcset');
    try {
      const r=await fetch(proxyUrl(img.src));
      if (r.ok) {
        const b=await r.blob();
        img.src = URL.createObjectURL(b);
      } else {
        img.src = await generatePlaceholder(36, letter);
      }
    } catch {
      img.src = await generatePlaceholder(36, letter);
    }
  }
  // Wait for all blob URL images to finish loading
  await Promise.allSettled([...clone.querySelectorAll('img')].map(img => img.complete ? Promise.resolve() : new Promise(r => { img.onload=r; img.onerror=r; })));
  try {
    const raw = await html2canvas(wrap, { useCORS: false, scale: s, backgroundColor: '#f8fafc', logging: false });
    document.body.removeChild(wrap);
    const w = raw.width, h = raw.height;
    const c = document.createElement('canvas'); c.width = w; c.height = h + Math.round(60*s);
    const ctx = c.getContext('2d'); ctx.drawImage(raw, 0, 0);
    ctx.fillStyle = '#94a3b8'; ctx.font = `${Math.round(12*s)}px system-ui,sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('由 Steam 玩伴探测生成 · github.com/Pomran/steam-friend-finder', w/2, h + Math.round(30*s));
    return c;
  } catch(e) { document.body.removeChild(wrap); showToast('截图失败: '+e.message); return null; }
}

async function generateShareImageForDetail() {
  const el = document.getElementById('detailContent');
  if (!el||!el.children.length) return showToast('暂无数据');
  const c = await captureAndFooter(el, 2, '匹配详情');
  if (!c) return null;
  return new Promise(r=>c.toBlob(b=>r(b?URL.createObjectURL(b):null),'image/png'));
}

function getSharedGames(pgs, fgs) {
  const m = {}; (fgs || []).forEach(g => { m[g.appid] = g; });
  return (pgs || []).filter(pg => m[pg.appid]).map(pg => ({
    appid: pg.appid, name: pg.name, icon: pg.img_icon_url || (m[pg.appid] && m[pg.appid].img_icon_url) || '',
    playerHours: pg.playtime_forever || 0, friendHours: m[pg.appid].playtime_forever || 0,
  })).sort((a, b) => (b.playerHours + b.friendHours) - (a.playerHours + a.friendHours));
}

function renderLibrary() {
  const top5 = state.playerTopGames;
  const all = state.playerGames;
  const totalH = Math.round(all.reduce((s,g) => s+(g.playtime_forever||0), 0) / 60);
  const excluded = getExcludedSet();

  const custom = getCustomGames();
  const customBadge = (g) => g._custom ? ' <span style="font-size:10px;color:var(--brand-secondary);background:#eef6ff;padding:1px 6px;border-radius:4px;border:1.5px solid var(--border-thick);font-weight:800;">手动</span>' : '';

  document.getElementById('libraryContent').innerHTML = `
    <div class="stats-grid">
      <div class="stat-item"><div class="stat-value">${all.length}</div><div class="stat-label">游戏总数</div></div>
      <div class="stat-item"><div class="stat-value">${totalH}</div><div class="stat-label">总时长 (h)</div></div>
      <div class="stat-item"><div class="stat-value">${top5.length}</div><div class="stat-label">已分析</div></div>
    </div>
    <div class="card">
      <div class="card-title">
        <span>我的 Top ${TOP_N}</span>
        <div class="title-toolbox" style="display:inline-flex;align-items:center;background:var(--surface);border:2.5px solid var(--border-thick);border-radius:14px;padding:4px 6px;margin-left:auto;box-shadow:2px 2px 0px var(--border-thick);vertical-align:middle;gap:4px;font-family:inherit;">
          <button class="open-add-game" type="button" style="background:transparent;border:2px solid transparent;border-radius:9px;padding:5px 12px;font-size:13px;font-weight:800;color:var(--text);cursor:pointer;transition:all 0.1s cubic-bezier(0.175,0.885,0.32,1);display:inline-flex;align-items:center;gap:4px;outline:none;" onmouseover="this.style.background='#ffffff';this.style.borderColor='var(--border-thick)';this.style.color='var(--brand-success)';this.style.transform='translate(-1px,-1px)';this.style.boxShadow='1.5px 1.5px 0px var(--border-thick)';" onmouseout="this.style.background='transparent';this.style.borderColor='transparent';this.style.color='var(--text)';this.style.transform='none';this.style.boxShadow='none';">添加游戏+</button>
          <button id="createShareCodeBtn" type="button" style="background:transparent;border:2px solid transparent;border-radius:9px;padding:5px 12px;font-size:13px;font-weight:800;color:var(--text);cursor:pointer;transition:all 0.1s cubic-bezier(0.175,0.885,0.32,1);display:inline-flex;align-items:center;gap:2px;outline:none;" onmouseover="this.style.background='#ffffff';this.style.borderColor='var(--border-thick)';this.style.color='var(--brand-secondary)';this.style.transform='translate(-1px,-1px)';this.style.boxShadow='1.5px 1.5px 0px var(--border-thick)';" onmouseout="this.style.background='transparent';this.style.borderColor='transparent';this.style.color='var(--text)';this.style.transform='none';this.style.boxShadow='none';">分享码</button>
          <button id="toggleWeightsBtn" type="button" style="border:2px solid var(--border-thick);border-radius:9px;padding:5px 14px;font-size:12px;font-weight:950;letter-spacing:0.3px;cursor:pointer;outline:none;transition:all 0.15s cubic-bezier(0.175,0.885,0.32,1);background:${state.showWeights ? 'var(--brand-primary)' : '#ffffff'};color:${state.showWeights ? '#ffffff' : 'var(--text-dim)'};box-shadow:${state.showWeights ? '2px 2px 0px var(--border-thick)' : '0px 0px 0px var(--border-thick)'};transform:${state.showWeights ? 'translate(-1px,-1px)' : 'none'};" onmouseover="if(!${state.showWeights}){this.style.background='var(--bg)';this.style.transform='translate(-1px,-1px)';this.style.boxShadow='2px 2px 0px var(--border-thick)';}" onmouseout="if(!${state.showWeights}){this.style.background='#ffffff';this.style.transform='none';this.style.boxShadow='0px 0px 0px var(--border-thick)'};">权重</button>
        </div>
      </div>
      ${top5.length ? top5.map((g, i) => {
        const h = Math.round((g.playtime_forever||0)/60);
        const iconUrl = g._custom ? `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${g.appid}/header.jpg` : (g.img_icon_url ? `https://media.steampowered.com/steamcommunity/public/images/apps/${g.appid}/${g.img_icon_url}.jpg` : '');
        const exc = excluded.has(g.appid);
        const w = getGameWeight(g.appid);
        return `<div class="game-row" style="${exc ? 'opacity:0.4;' : ''}">
          ${iconUrl ? `<div class="game-icon"><img src="${iconUrl}" class="lib-icon" alt=""></div>` : `<div class="game-icon" style="background:var(--surface);display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:12px;font-weight:800;">?</div>`}
          <span style="width:18px;font-size:12px;color:var(--text-muted);font-weight:600;text-align:center;">${i+1}</span>
          <span class="game-name" style="${exc ? 'text-decoration:line-through;' : ''}">${g.name}${customBadge(g)}</span>
          <div class="weight-control" style="${state.showWeights ? '' : 'display:none;'}">
            <input type="range" class="game-weight" min="1" max="5" step="1" value="${w}" data-appid="${g.appid}" title="匹配权重: ${weightLabel(w)}">
            <span class="weight-label" data-appid="${g.appid}">${weightLabel(w)}</span>
          </div>
          <span style="color:var(--brand-primary);font-weight:600;font-size:13px;">${h}h</span>
          <span class="exclude-btn" data-appid="${g.appid}" style="margin-left:8px;cursor:pointer;font-size:14px;font-weight:800;color:${exc ? 'var(--text-muted)' : 'var(--text-muted)'};">${exc ? '取消排除' : '排除'}</span>
        </div>`;
      }).join('') : '<div style="color:var(--text-dim);padding:20px;text-align:center;">暂无游戏数据</div>'}
    </div>
    <div class="card"><div class="card-title">全部游戏 (${all.length})</div><div style="display:flex;flex-wrap:wrap;gap:4px;">${sortedGameChips(all, excluded).join('')}</div></div>
    <div class="card" id="customGamesCard">
      <div class="card-title">
        <span>手动添加的游戏</span>
        <button class="btn btn-ghost open-add-game" style="margin-left:auto;padding:6px 14px;font-size:12px;">+ 添加</button>
      </div>
      ${custom.length ? custom.map((g, i) => {
        const h = Math.round(g.playtime_forever / 60);
        return `<div class="game-row" style="background:#f0f7ff;">
          <div class="game-icon"><img src="https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${g.appid}/header.jpg" alt="" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display='none'"></div>
          <span class="game-name">${g.name}</span>
          <input type="number" class="cg-hours" value="${h}" min="0" step="1" data-cg-appid="${g.appid}" style="width:70px;padding:6px 10px;border:2px solid var(--border-thick);border-radius:8px;font-size:14px;font-weight:700;">
          <span style="font-size:13px;color:var(--text-dim);font-weight:600;">h</span>
          <button class="cg-save" data-cg-appid="${g.appid}" style="padding:6px 12px;background:var(--brand-success);color:#fff;border:2px solid var(--border-thick);border-radius:8px;font-size:12px;font-weight:800;cursor:pointer;">保存</button>
          <button class="cg-delete" data-cg-appid="${g.appid}" style="padding:6px 12px;background:#fee2e2;color:var(--danger);border:2px solid var(--border-thick);border-radius:8px;font-size:12px;font-weight:800;cursor:pointer;">删除</button>
        </div>`;
      }).join('') : '<div style="color:var(--text-dim);text-align:center;padding:12px;font-size:13px;font-weight:600;">还没有手动添加的游戏</div>'}
      <div style="margin-top:14px;padding-top:14px;border-top:2px dashed #cbd5e1;font-size:12px;color:var(--text-muted);font-weight:600;line-height:1.6;">
        手动添加其他 Steam 账号的游戏数据到当前分析中。输入商店 URL 或 AppID，填写时长即可。<br>
        如果某款游戏已在当前账号中，手动数据会<strong>覆盖</strong>原有数据；如果不存在则追加。
      </div>
    </div>
  `;
  document.querySelectorAll('img.lib-icon').forEach(img => {
    img.addEventListener('error', () => { img.style.display = 'none'; });
  });
  document.querySelectorAll('.exclude-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      toggleExcluded(+btn.dataset.appid);
      state.playerTopGames = getTopGames(state.playerGames, TOP_N);
      renderLibrary();
      if (state.friendsData.length) recomputeMatches();
      switchTab('tab-library');
    });
  });
  document.querySelectorAll('.game-chip').forEach(el => {
    el.addEventListener('click', () => {
      toggleExcluded(+el.dataset.appid);
      state.playerTopGames = getTopGames(state.playerGames, TOP_N);
      renderLibrary();
      if (state.friendsData.length) recomputeMatches();
      switchTab('tab-library');
    });
  });
  document.querySelectorAll('.open-add-game').forEach(el => {
    el.addEventListener('click', () => showAddGameModal());
  });
  document.getElementById('createShareCodeBtn')?.addEventListener('click', createShareCode);
  document.querySelectorAll('.cg-save').forEach(btn => {
    btn.addEventListener('click', () => {
      const appid = +btn.dataset.cgAppid;
      const input = document.querySelector(`.cg-hours[data-cg-appid="${appid}"]`);
      const hours = parseFloat(input?.value);
      if (!hours || hours < 0) { showToast('请输入有效时长'); return; }
      const arr = getCustomGames();
      const g = arr.find(c => c.appid === appid);
      if (g) { g.playtime_forever = Math.round(hours * 60); saveCustomGames(arr); remergeCustomGames(); showToast('已更新'); }
    });
  });
  document.querySelectorAll('.cg-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      const appid = +btn.dataset.cgAppid;
      if (!confirm('确定删除？')) return;
      saveCustomGames(getCustomGames().filter(c => c.appid !== appid));
      remergeCustomGames();
      showToast('已删除');
    });
  });
  document.querySelectorAll('input.game-weight').forEach(slider => {
    slider.addEventListener('input', () => {
      const appid = +slider.dataset.appid;
      const w = +slider.value;
      setGameWeight(appid, w);
      const label = document.querySelector(`.weight-label[data-appid="${appid}"]`);
      if (label) label.textContent = weightLabel(w);
      if (state.friendsData.length) recomputeMatches();
    });
  });
  document.getElementById('toggleWeightsBtn')?.addEventListener('click', () => {
    state.showWeights = !state.showWeights;
    try { localStorage.setItem('showWeights', JSON.stringify(state.showWeights)); } catch {}
    renderLibrary();
  });
}

function sortedGameChips(games, excluded) {
  return [...games].sort((a,b)=>(b.playtime_forever||0)-(a.playtime_forever||0)).map(g => {
    const h = Math.round((g.playtime_forever||0)/60);
    const exc = excluded && excluded.has(g.appid);
    return `<span class="game-chip" data-appid="${g.appid}" style="display:inline-block;background:${exc?'#fee2e2':'var(--surface)'};padding:4px 10px;border-radius:6px;font-size:11px;border:2px solid var(--border-thick);margin:2px;cursor:pointer;text-decoration:${exc?'line-through':'none'};opacity:${exc?0.5:1};">${g.name} <span style="color:var(--text-muted);">${h}h</span></span>`;
  });
}

function renderMatches() {
  const el = document.getElementById('matchesContent');
  const f = state.friendsData;
  if (!f.length) {
    el.innerHTML = `<div class="empty"><p>暂无好友数据</p></div>`;
    return;
  }
  const best = f.reduce((a,b) => a.score > b.score ? a : b);
  el.innerHTML = `
    <div class="stats-grid">
      <div class="stat-item"><div class="stat-value">${f.length}</div><div class="stat-label">好友分析</div></div>
      <div class="stat-item"><div class="stat-value">${f.filter(x=>x.score>0.3).length}</div><div class="stat-label">高度匹配</div></div>
      <div class="stat-item"><div class="stat-value" style="color:var(--brand-yellow);">${(best.score*100).toFixed(1)}%</div><div class="stat-label">最高匹配</div></div>
    </div>
    <div class="card"><div class="card-title">匹配排行</div><div class="friend-list">${f.map((x, i) => renderPersonCard(x, i)).join('')}</div></div>
  `;
}

function renderPersonCard(person, rank) {
  const pct = (person.score*100).toFixed(1);
  const name = person.summary?.personaname || person.steamid;
  const avatar = person.summary?.avatarmedium || '';
  const h = Math.round(person.totalHours/60);
  const shared = state.playerGames ? state.playerGames.filter(pg => person.games.some(fg => fg.appid===pg.appid)).length : 0;
  const fgMap = {}; (person.games||[]).forEach(g => { fgMap[g.appid] = g; });

  const dots = state.playerTopGames.map(pg => {
    const owns = fgMap[pg.appid];
    const label = pg.name.length > 6 ? pg.name.slice(0,5)+'…' : pg.name;
    return `<span class="top5-dot ${owns?'owned':'missing'}" title="${pg.name}">${owns?'✓':'–'}</span>`;
  }).join('');

  return `<div class="friend-card" data-steamid="${person.steamid}" style="animation-delay:${(rank||0)*0.04}s">
    <div class="friend-avatar">${avatar?`<img src="${avatar}" alt="">`:`<div class="placeholder">${name[0]}</div>`}</div>
    <div class="friend-info">
      <div class="friend-name">${name}</div>
      <div class="friend-meta">${person.totalGames} 款游戏 · ${h}h · 共同 ${shared} 款</div>
      <div class="top5-dots">${dots}</div>
    </div>
    <div class="friend-score-col">
      <div class="score-value" style="color:${scoreColor(parseFloat(pct))}">${pct}%</div>
      <div class="score-bar"><div class="score-bar-fill" style="width:${pct}%;background:${scoreColor(parseFloat(pct))}"></div></div>
    </div>
  </div>`;
}

function showPersonDetail(steamid) {
  const p = state.friendsData.find(f => f.steamid === steamid); if (!p) return;
  state._detailSteamId = steamid;
  state._detailSource = 'matches';
  switchTab('tab-detail');
  const name = p.summary?.personaname || steamid;
  const avatar = p.summary?.avatarfull || p.summary?.avatarmedium || '';
  const pct = (p.score*100).toFixed(1);
  const shared = getSharedGames(state.playerGames, p.games);
  const pH = Math.round(state.playerGames.reduce((s,g)=>s+(g.playtime_forever||0),0)/60);
  const fH = Math.round(p.totalHours/60);
  const myTop5 = state.playerTopGames;
  const fgMap = {}; (p.games||[]).forEach(g => { fgMap[g.appid] = g; });
  const matchCount = myTop5.filter(g => fgMap[g.appid]).length;

  const dc = document.getElementById('detailContent');
  dc.innerHTML = `
    <div class="detail-header">
      <div class="detail-avatar">${avatar?`<img src="${avatar}" alt="">`:`<div class="placeholder">${name[0]}</div>`}</div>
      <div class="detail-info">
        <h2>${name}</h2>
        <div class="match-badge">${pct}% 匹配 · Top5 重合 ${matchCount}/${TOP_N}</div>
      </div>
      <div style="display:flex;gap:8px;justify-content:center;width:100%;"><button class="btn btn-share" id="shareDetailBtn" style="font-size:13px;padding:8px 16px;flex:1;">分享</button><button class="btn btn-ghost" id="backBtn" style="flex:1;">← 返回</button></div>
    </div>
    <div class="detail-body">
      <div class="card">
        <div class="card-title">Top${TOP_N} 时长对比</div>
        ${myTop5.map((g) => {
          const pT = g.playtime_forever || 0;
          const fT = (fgMap[g.appid]?.playtime_forever) || 0;
          const has = fgMap[g.appid];
          const maxT = Math.max(pT, fT, 1);
          return `<div class="game-row">
            <span style="width:24px;height:24px;border-radius:6px;overflow:hidden;flex-shrink:0;background:var(--surface);display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:${has?'var(--brand-success)':'var(--text-muted)'}">${has?'✓':'✕'}</span>
            <span class="game-name">${g.name}</span>
            <div class="game-hours-compare">
              <span><span class="hour-dot me"></span>${Math.round(pT/60)}h</span>
              <span><span class="hour-dot them"></span>${Math.round(fT/60)}h</span>
            </div>
          </div>`;
        }).join('')}
      </div>
      <div class="card">
        <div class="card-title">匹配概况</div>
        <div class="stats-grid" style="grid-template-columns:1fr 1fr;">
          <div class="stat-item"><div class="stat-value" style="font-size:18px;">${pH}h</div><div class="stat-label">我的时长</div></div>
          <div class="stat-item"><div class="stat-value" style="font-size:18px;color:var(--brand-yellow);">${fH}h</div><div class="stat-label">${name}</div></div>
          <div class="stat-item"><div class="stat-value">${state.playerGames.length}</div><div class="stat-label">我的游戏</div></div>
          <div class="stat-item"><div class="stat-value">${p.totalGames}</div><div class="stat-label">${name}</div></div>
        </div>
        <div style="margin-top:12px;padding-top:12px;border-top:3px dashed #cbd5e1;">
          <div style="display:flex;justify-content:space-between;font-size:13px;">
            <span style="color:var(--text-dim);">共同游戏</span>
            <span style="color:var(--brand-yellow);font-weight:700;">${shared.length} 款</span>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:13px;margin-top:6px;">
            <span style="color:var(--text-dim);">匹配度</span>
            <span style="color:var(--brand-primary);font-weight:600;">${pct}%</span>
          </div>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-title">共同游戏 (${shared.length})</div>
      <div class="shared-grid">
        ${shared.length ? shared.slice(0,40).map(g => `<div class="shared-item">
          <div class="game-icon"><img src="https://media.steampowered.com/steamcommunity/public/images/apps/${g.appid}/${g.icon||''}.jpg" class="detail-img" alt="${g.name}"></div>
          <span class="game-name">${g.name}</span>
          <span class="game-hours"><strong class="my-hours">${Math.round(g.playerHours/60)}h</strong> · <strong class="friend-hours">${Math.round(g.friendHours/60)}h</strong></span>
        </div>`).join('') : '<div style="color:var(--text-dim);padding:12px;text-align:center;">暂无共同游戏</div>'}
        ${shared.length > 40 ? `<div style="text-align:center;color:var(--text-muted);font-size:12px;margin-top:8px;">+ ${shared.length-40} 款更多</div>` : ''}
      </div>
    </div>
  `;
  dc.querySelectorAll('img.detail-img').forEach(img => {
    img.addEventListener('error', () => { img.style.display = 'none'; });
  });
}

function switchTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
  const target = document.getElementById(tabId);
  if (target) {
    target.classList.add('active');
  }
  const btn = document.querySelector(`[data-tab="${tabId}"]`);
  if (btn) btn.classList.add('active');
}

function showProgress(text, pct) {
  document.getElementById('progressArea').style.display = 'block';
  document.getElementById('progressText').textContent = text;
  document.getElementById('progressFill').style.width = (pct||0)+'%';
}
function updateProgress(pct) { document.getElementById('progressFill').style.width = pct+'%'; }
function hideProgress(d) { setTimeout(() => document.getElementById('progressArea').style.display='none', d||0); }

function showError(msg) {
  let extra = '';
  if (msg.includes('API 密钥')) extra = '<p style="margin-top:8px;font-size:13px;">请点击上方的「配置 Steam API 密钥」申请并填入正确的密钥</p>';
  else if (msg.includes('好友码')) extra = '';
  else if (msg.includes('Steam 标识')) extra = '';
  else if (msg.includes('网络') || msg.includes('fetch') || msg.includes('Failed to fetch')) extra = '<p style="margin-top:8px;font-size:13px;">网络连接异常，请检查网络后重试</p>';
  else if (msg.includes('过于频繁')) extra = '';
  else if (msg.includes('好友列表')) extra = '';
  else if (msg.includes('不可用')) extra = '';
  else extra = '<p style="margin-top:8px;font-size:13px;">请检查 Steam ID 和 API 密钥是否正确</p>';
  document.getElementById('detailContent').innerHTML = `<div class="error">${msg}${extra}</div>`;
  switchTab('tab-detail');
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
}

async function callStrangerOptIn(optIn, silent) {
  const p = state.myProfile;
  if (!p || !state.mySteamId || !state.playerTopGames.length) {
    if (optIn) showToast('请先完成扫描');
    return;
  }
  try {
    const res = await fetch(`${STRANGER_API_BASE}/api/opt-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        steamid: state.mySteamId,
        personaname: p.personaname || '',
        avatar: p.avatarfull || p.avatarmedium || '',
        top5: state.playerTopGames.map(g => ({
          appid: g.appid, name: g.name,
          img_icon_url: g.img_icon_url || '',
          playtime_forever: g.playtime_forever || 0,
        })),
        recentTop5: state.myRecentGames.filter(g => (g.playtime_2weeks || 0) > 0)
          .sort((a, b) => (b.playtime_2weeks || 0) - (a.playtime_2weeks || 0))
          .slice(0, TOP_N).map(g => ({
            appid: g.appid, name: g.name,
            img_icon_url: g.img_icon_url || '',
            playtime_2weeks: g.playtime_2weeks || 0,
          })),
        opt_in: optIn,
        heybox_id: localStorage.getItem('heyboxId') || '',
      }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error || `HTTP ${res.status}`);
    }
    if (!silent) showToast(optIn ? '已开放陌生人匹配' : '已关闭陌生人匹配');
  } catch (err) {
    if (!silent) showToast('陌生人匹配暂时不可用');
    console.warn('Stranger opt-in failed:', err);
  }
}

function renderStrangersToggle() {
  const el = document.getElementById('strangersContent');
  const optIn = localStorage.getItem('strangerOptIn') === 'true';
  const isCurrentOn = optIn;
  el.innerHTML = `
    <div class="card" id="strangerOptInCard" style="padding:32px 28px;display:flex;flex-direction:column;gap:20px;">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px;">
        <div style="display:flex;align-items:center;gap:24px;flex-wrap:wrap;">
          <h3 style="margin:0;font-size:16px;font-weight:900;white-space:nowrap;color:var(--border-thick);">对陌生人开放匹配</h3>
          <div style="width:1px;height:18px;background:rgba(17,20,36,0.1);border-radius:2px;flex-shrink:0;margin:0 4px 0 2px;"></div>
          <div id="heyboxWrapper" style="display:flex;align-items:center;gap:8px;transition:opacity 0.2s, filter 0.2s;opacity:${isCurrentOn ? '1' : '0.35'};filter:${isCurrentOn ? 'none' : 'grayscale(100%)'};">
            <span style="font-size:12px;font-weight:700;color:#8e95a5;white-space:nowrap;">小黑盒 ID:</span>
            <input type="text" id="heyboxId"
              placeholder="输入数字 ID"
              ${isCurrentOn ? '' : 'disabled'}
              value="${localStorage.getItem('heyboxId') || ''}"
               style="padding:5px 12px;border:none;border-radius:10px;font-size:12px;font-weight:700;background:#f4f6f8;outline:none;font-family:inherit;width:130px;cursor:${isCurrentOn ? 'text' : 'not-allowed'};box-sizing:border-box;">
          </div>
        </div>
        <label class="switch" style="flex-shrink:0;">
          <input type="checkbox" id="strangerToggle" ${isCurrentOn ? 'checked' : ''}>
          <span class="switch-slider"></span>
        </label>
      </div>
      <p style="font-size:12px;margin:0;color:#8e95a5;font-weight:500;line-height:1.5;">
        * 开启后，其他使用本工具的用户将能看到你的 Top5 游戏数据并计算匹配度。你的 Steam ID 和个人资料仅用于展示。
      </p>
    </div>
    <div id="strangerResults"></div>
  `;
  const toggle = document.getElementById('strangerToggle');
  if (toggle) {
    toggle.addEventListener('change', async (e) => {
      const on = e.target.checked;
      localStorage.setItem('strangerOptIn', on ? 'true' : 'false');
      const input = document.getElementById('heyboxId');
      const wrapper = document.getElementById('heyboxWrapper');
      if (input && wrapper) {
        input.disabled = !on;
        input.style.cursor = on ? 'text' : 'not-allowed';
        wrapper.style.opacity = on ? '1' : '0.35';
        wrapper.style.filter = on ? 'none' : 'grayscale(100%)';
      }
      await callStrangerOptIn(on);
      strangersCache.ts = 0;
      loadStrangers(true);
    });
  }
  const heyboxInput = document.getElementById('heyboxId');
  if (heyboxInput) {
    const saveHeybox = async () => {
      let val = heyboxInput.value.trim();
      if (val.includes('profile/')) val = val.split('profile/')[1].split('/')[0].split('?')[0];
      val = val.replace(/\D/g, '');
      heyboxInput.value = val;
      localStorage.setItem('heyboxId', val);
      const toggleEl = document.getElementById('strangerToggle');
      if (toggleEl && toggleEl.checked) await callStrangerOptIn(true);
    };
    heyboxInput.addEventListener('blur', saveHeybox);
  }
}

function renderStrangersResults() {
  const el = document.getElementById('strangerResults');
  if (!el) return;
  const strangers = state.strangersData;
  const myTop5 = state.playerTopGames;
  if (state.strangersError) {
    el.innerHTML = `<div class="card"><div class="card-title">陌生人匹配</div><div class="error">陌生人匹配暂时不可用</div></div>`;
  } else if (!strangers || !strangers.length) {
    el.innerHTML = `<div class="empty"><p>暂无其他玩家开启陌生人匹配</p></div>`;
  } else {
    const scored = strangers.map(s => ({
      ...s, score: computeUnifiedScore(state.playerGames, s.top5 || [], TOP_N, true)
    })).sort((a, b) => b.score - a.score);
    const display = scored.slice(0, strangersDisplayCount);
    const hasMore = scored.length > strangersDisplayCount;
    el.innerHTML = `
      <div class="stats-grid">
        <div class="stat-item"><div class="stat-value">${scored.length}</div><div class="stat-label">陌生玩伴</div></div>
        <div class="stat-item"><div class="stat-value">${scored.filter(x => x.score > 0.3).length}</div><div class="stat-label">高度匹配</div></div>
        <div class="stat-item"><div class="stat-value" style="color:var(--brand-purple);">${(scored[0].score * 100).toFixed(1)}%</div><div class="stat-label">最佳匹配</div></div>
      </div>
      <div class="card">
        <div class="card-title">陌生玩伴 <span class="stranger-badge">陌生人</span></div>
        <div class="friend-list">${display.map((s, i) => renderStrangerCard(s, i)).join('')}</div>
        ${hasMore ? `<button class="btn btn-ghost" onclick="loadMoreStrangers()" style="width:100%;margin-top:16px;">显示更多（${scored.length - strangersDisplayCount} 人）</button>` : ''}
    </div>
  `;
  }
}

// ====== 车队招募 ======

let recruitPosts = null;
let myRecruits = null;

function parseRecruitMeta(desc) {
  const meta = { isNew: false, goal: '', time: '' };
  if (!desc) return meta;
  if (desc === '__new_team__') { meta.isNew = true; return meta; }
  if (desc.startsWith('{')) {
    try { const d = JSON.parse(desc); meta.isNew = !!d.n; meta.goal = d.g || ''; meta.time = d.t || ''; } catch {}
  }
  return meta;
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return `${Math.floor(days / 30)} 个月前`;
}

let recruitPage = 1;
let recruitTotal = 0;
let recruitGameFilter = '';
const RECRUIT_PAGE_SIZE = 10;

function renderRecruitTeam(container) {
  const games = state.playerGames.filter(g => (g.playtime_forever || 0) > 0).sort((a, b) => (b.playtime_forever || 0) - (a.playtime_forever || 0));
  container.innerHTML = `
    <div class="card">
      <div class="card-title">创建招募</div>
      <div class="custom-form">
        <label>
          选择游戏
           <select id="recruitTeamGameSelect">
             <option value="">-- 选择游戏 --</option>
             <option value="__custom__">手动输入游戏...</option>
             ${games.map(g => `<option value="${g.appid}">${g.name}</option>`).join('')}
           </select>
         </label>
         <div id="recruitTeamCustomGame" style="display:none;">
           <label style="font-size:13px;font-weight:900;color:var(--border-thick);display:flex;flex-direction:column;gap:6px;">
             Steam 商店 URL 或 AppID
             <input type="text" id="recruitTeamCustomAppid" placeholder="例: 730 或 store.steampowered.com/app/730" style="padding:14px 18px;border:3px solid var(--border-thick);border-radius:14px;font-size:15px;font-weight:700;">
           </label>
           <div id="recruitTeamCustomPreview" style="display:none;align-items:center;gap:14px;padding:12px;background:var(--surface);border-radius:14px;border:2px solid var(--border-thick);margin-top:8px;">
             <img src="" alt="" style="width:60px;height:28px;border-radius:6px;border:2px solid var(--border-thick);object-fit:cover;" onerror="this.style.display='none'">
             <span id="recruitTeamCustomName" style="font-weight:800;font-size:15px;"></span>
           </div>
        </div>
        <label>
目标
           <div style="display:flex;gap:6px;flex-wrap:wrap;">
             ${['娱乐','冲分','日常'].map(t => `<div class="pill-option" data-group="recruitGoal" data-value="${t}" onclick="togglePill(this)">${t}</div>`).join('')}
           </div>
         </label>
         <label>
           在线时段
           <div style="display:flex;gap:6px;flex-wrap:wrap;">
             ${['早上','下午','晚上','深夜'].map(t => `<div class="pill-option" data-group="recruitTime" data-value="${t}" onclick="togglePill(this)">${t}</div>`).join('')}
           </div>
        </label>
        <div style="display:flex;gap:12px;align-items:flex-end;">
          <label style="flex:1;">
            最大人数
            <select id="recruitTeamMaxMembers">
              ${[2,3,4,5,6,7,8].map(n => `<option value="${n}" ${n===4?'selected':''}>${n}人队</option>`).join('')}
            </select>
          </label>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;padding-bottom:2px;user-select:none;">
            <input type="checkbox" id="recruitTeamNewTag" style="width:16px;height:16px;accent-color:var(--brand-purple);cursor:pointer;">
            <span style="font-size:13px;color:var(--text);">标记为「新坑」</span>
          </label>
        </div>
        <button class="btn btn-primary" id="recruitSubmitBtn" onclick="createRecruitPost()">发布招募</button>
      </div>
    </div>
    <div id="recruitTeamOpenList"></div>
    <div id="recruitTeamMyList"></div>
  `;
  const sel = document.getElementById('recruitTeamGameSelect');
  sel.addEventListener('change', () => {
    document.getElementById('recruitTeamCustomGame').style.display = sel.value === '__custom__' ? 'block' : 'none';
  });
  let recruitLookupTimer;
  const customAppidInput = document.getElementById('recruitTeamCustomAppid');
  customAppidInput.addEventListener('input', () => {
    clearTimeout(recruitLookupTimer);
    recruitLookupTimer = setTimeout(async () => {
      const appid = extractAppid(customAppidInput.value);
      if (!appid) return;
      const info = await lookupGameInfo(appid);
      if (!info) return;
      const preview = document.getElementById('recruitTeamCustomPreview');
      preview.style.display = 'flex';
      document.getElementById('recruitTeamCustomName').textContent = info.name;
      const previewImg = preview.querySelector('img');
      if (previewImg) {
        previewImg.src = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/header.jpg`;
        previewImg.style.display = '';
      }
      customAppidInput.dataset.lookedUpAppid = appid;
      customAppidInput.dataset.lookedUpName = info.name;
    }, 500);
  });
  loadRecruitPosts(true);
  loadMyRecruits();
}

async function createRecruitPost() {
  if (!state.mySteamId || !state.myProfile) { showToast('请先完成扫描'); return; }
  const now = Date.now();
  if (now - recruitLastPostTime < 30000) { showToast(`请 ${Math.ceil((30000 - (now - recruitLastPostTime))/1000)} 秒后再发布`); return; }
  const btn = document.getElementById('recruitSubmitBtn');
  if (btn.disabled) return;
  btn.disabled = true; btn.textContent = '发布中...';
  const gameSelect = document.getElementById('recruitTeamGameSelect');
  const rawVal = gameSelect.value;
  let appid, gameName, gameIcon = '';
  if (rawVal === '__custom__') {
    const input = document.getElementById('recruitTeamCustomAppid');
    const extracted = extractAppid(input.value);
    if (!extracted) { showToast('请输入有效的 AppID 或商店 URL'); btn.disabled = false; btn.textContent = '发布招募'; return; }
      appid = +extracted;
      if (input.dataset.lookedUpAppid == appid) {
        gameName = input.dataset.lookedUpName;
      } else {
        const info = await lookupGameInfo(appid);
        if (!info) { showToast('未找到该游戏，请检查 AppID'); btn.disabled = false; btn.textContent = '发布招募'; return; }
        gameName = info.name;
      }
      gameIcon = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/header.jpg`;
  } else {
    appid = parseInt(rawVal);
    const game = state.playerGames.find(g => g.appid === appid);
    if (!game) { showToast('请选择游戏'); btn.disabled = false; btn.textContent = '发布招募'; return; }
    gameName = game.name;
    gameIcon = game._custom ? `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/header.jpg` : (game.img_icon_url || '');
  }
  const maxMembers = parseInt(document.getElementById('recruitTeamMaxMembers').value) || 4;
  const teamType = document.getElementById('recruitTeamNewTag').checked ? 'new' : '';
  const goalEl = document.querySelector('.pill-option.active[data-group="recruitGoal"]');
  const timeEl = document.querySelector('.pill-option.active[data-group="recruitTime"]');
  const goalType = goalEl ? goalEl.dataset.value : '';
  const playTime = timeEl ? timeEl.dataset.value : '';
  const description = teamType === 'new' ? '__new_team__' : '';
  try {
    const res = await fetch('/api/recruit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create',
        creator_steamid: state.mySteamId,
        creator_name: state.myProfile.personaname || '',
        creator_avatar: state.myProfile.avatarfull || state.myProfile.avatarmedium || '',
        game_appid: appid,
        game_name: gameName,
        game_img_icon_url: gameIcon,
        max_members: maxMembers,
        description: description,
        goal_type: goalType,
        play_time: playTime,
      }),
    });
    if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.error || `HTTP ${res.status}`); }
    showToast('招募已发布');
    recruitLastPostTime = Date.now();
    document.getElementById('recruitTeamNewTag').checked = false;
    document.querySelectorAll('.pill-option.active[data-group="recruitGoal"]').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.pill-option.active[data-group="recruitTime"]').forEach(p => p.classList.remove('active'));
    recruitPage = 1; recruitGameFilter = '';
    loadRecruitPosts(true);
    loadMyRecruits();
  } catch (err) {
    showToast('发布失败: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = '发布招募';
  }
}

async function loadRecruitPosts(reset) {
  if (reset) { recruitPage = 1; }
  const el = document.getElementById('recruitTeamOpenList');
  if (!el) return;
  if (reset) el.innerHTML = `<div class="loading"><div class="spinner"></div><p>加载招募列表...</p></div>`;
  try {
    const params = new URLSearchParams({ page: recruitPage, limit: RECRUIT_PAGE_SIZE });
    if (recruitGameFilter) params.set('game_appid', recruitGameFilter);
    params.set('action', 'list');
    const res = await fetch(`/api/recruit?${params}`);
    if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.error || `HTTP ${res.status}`); }
    const data = await res.json();
    recruitTotal = data.total || 0;
    if (reset) recruitPosts = data.posts || [];
    else recruitPosts = [...recruitPosts, ...(data.posts || [])];
  } catch (err) {
    if (reset) recruitPosts = [];
    showToast('加载招募失败: ' + err.message);
  }
  renderRecruitPosts();
}

function loadMoreRecruitPosts() {
  recruitPage++;
  loadRecruitPosts(false);
}

function setRecruitGameFilter(appid) {
  recruitGameFilter = appid;
  loadRecruitPosts(true);
}

function renderRecruitPosts() {
  const el = document.getElementById('recruitTeamOpenList');
  if (!el) return;
  const posts = recruitPosts || [];
  if (!posts.length) {
    el.innerHTML = `<div class="card"><div class="card-title">公开招募${recruitGameFilter ? ' <button class="btn btn-ghost" onclick="setRecruitGameFilter(\'\')" style="font-size:12px;padding:2px 8px;">清除筛选</button>' : ''}</div><div class="empty"><p>暂无公开招募</p></div></div>`;
    return;
  }
  const gamePills = [...new Set((recruitPosts || []).filter(p => p.status === 1).map(p => p.game_appid))].slice(0, 12);
  const gameNames = {};
  (recruitPosts || []).forEach(p => { gameNames[p.game_appid] = p.game_name; });
  let html = `<div class="card"><div class="card-title">公开招募${recruitGameFilter ? ' <button class="btn btn-ghost" onclick="setRecruitGameFilter(\'\')" style="font-size:12px;padding:2px 8px;">清除筛选</button>' : ''}</div>`;
  if (gamePills.length > 0) {
    html += `<div style="display:flex;gap:6px;flex-wrap:wrap;margin:0 0 12px 16px;">
      <button class="btn btn-ghost" onclick="setRecruitGameFilter('')" style="font-size:12px;padding:4px 10px;${!recruitGameFilter ? 'background:var(--brand-purple);color:#fff;' : ''}">全部</button>
      ${gamePills.map(a => `<button class="btn btn-ghost" onclick="setRecruitGameFilter('${a}')" style="font-size:12px;padding:4px 10px;${recruitGameFilter === a ? 'background:var(--brand-purple);color:#fff;' : ''}">${gameNames[a] || a}</button>`).join('')}
    </div>`;
  }
  html += `<div class="recruit-list">${posts.map(p => renderRecruitCard(p, true)).join('')}</div>`;
  if (recruitTotal > recruitPosts.length) {
    html += `<button class="btn btn-ghost" onclick="loadMoreRecruitPosts()" style="width:100%;margin-top:12px;">显示更多（${recruitTotal - recruitPosts.length} 条）</button>`;
  }
  html += `</div>`;
  el.innerHTML = html;
}

function renderRecruitCard(post, showKick) {
  const members = post.member_list || [];
  const memberCount = members.length;
  const isCreator = state.mySteamId === post.creator_steamid;
  const isMember = members.some(m => m.steamid === state.mySteamId);
  const isFull = memberCount >= post.max_members;
  const appid = parseInt(post.game_appid);
  const iconUrl = post.game_img_icon_url ? `https://media.steampowered.com/steamcommunity/public/images/apps/${appid}/${post.game_img_icon_url}.jpg` : '';
  const meta = parseRecruitMeta(post.description);
  const badges = [];
  if (meta.isNew || post.description === '__new_team__') badges.push('新坑');
  if (meta.goal) badges.push(meta.goal);
  if (meta.time) badges.push(meta.time);
  const badgeClass = b => { const m={'新坑':'badge-purple','娱乐':'badge-green','冲分':'badge-red','日常':'badge-blue','早上':'badge-amber','下午':'badge-orange','晚上':'badge-indigo','深夜':'badge-violet'}; return m[b]||'badge-gray'; };
  const memberAvatars = members.map((m, idx) => {
    const href = `https://steamcommunity.com/profiles/${m.steamid}`;
    const avatarHtml = m.avatar ? `<img src="${m.avatar}" alt="" loading="lazy">` : `<div class="placeholder">${(m.personaname||'?')[0]}</div>`;
    if (showKick && isCreator && m.steamid !== state.mySteamId) {
      return `<div class="recruit-member-avatar is-kickable" title="${m.personaname || m.steamid}"><a href="${href}" target="_blank">${avatarHtml}</a><button class="recruit-kick-btn" onclick="event.stopPropagation();kickMember(${post.id},'${m.steamid}')">×</button></div>`;
    }
    return `<a class="recruit-member-avatar" href="${href}" target="_blank" title="${m.personaname || m.steamid}">${avatarHtml}</a>`;
  }).join('');
  const memberNames = members.map(m => `<a href="https://steamcommunity.com/profiles/${m.steamid}" target="_blank" style="color:var(--brand-purple);text-decoration:none;font-weight:600;">${m.personaname || m.steamid}</a>`).join(' · ');
  return `<div class="recruit-card">
    <div class="recruit-card-top">
      <div class="recruit-game-icon">${iconUrl ? `<img src="${iconUrl}" alt="" loading="lazy">` : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:var(--surface);font-weight:700;font-size:10px;">G</div>`}</div>
      <div class="recruit-game-info">
        <div class="recruit-game-name">${post.game_name} ${isCreator ? '<span class="stranger-badge" style="font-size:9px;padding:1px 6px;">创建者</span>' : ''}</div>
        <div class="recruit-meta">${badges.length ? badges.map(b => `<span class="recruit-badge ${badgeClass(b)}">${b}</span>`).join(' ') : ''} ${memberCount}/${post.max_members} 人 · ${timeAgo(post.created_at)}</div>
      </div>
    </div>
    <div class="recruit-members">${memberAvatars}<span class="recruit-member-names">${memberNames || '-'}</span></div>
    <div class="recruit-card-actions">
      ${post.status === 0 ? '<span class="stranger-badge" style="background:var(--text-muted);">已关闭</span>' :
        isCreator ? `<button class="btn btn-ghost" onclick="closeRecruitPost(${post.id})">关闭招募</button>` :
        isMember ? `<button class="btn btn-ghost" onclick="leaveRecruitPost(${post.id})">退出队伍</button>` :
        isFull ? '<span class="stranger-badge" style="background:var(--text-muted);">已满员</span>' :
        `<button class="btn btn-primary" onclick="joinRecruitPost(${post.id})">加入队伍</button>`}
    </div>
  </div>`;
}

async function joinRecruitPost(postId) {
  if (!state.mySteamId || !state.myProfile) { showToast('请先完成扫描'); return; }
  try {
    const res = await fetch('/api/recruit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'join', post_id: postId, steamid: state.mySteamId, personaname: state.myProfile.personaname || '', avatar: state.myProfile.avatarfull || state.myProfile.avatarmedium || '' }),
    });
    if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.error || `HTTP ${res.status}`); }
    showToast('已加入该招募');
    loadRecruitPosts(true);
    loadMyRecruits();
  } catch (err) {
    showToast(err.message);
  }
}

async function leaveRecruitPost(postId) {
  if (!state.mySteamId) return;
  try {
    const res = await fetch('/api/recruit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'leave', post_id: postId, steamid: state.mySteamId }),
    });
    if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.error || `HTTP ${res.status}`); }
    showToast('已退出该招募');
    loadRecruitPosts(true);
    loadMyRecruits();
  } catch (err) {
    showToast(err.message);
  }
}

async function closeRecruitPost(postId) {
  if (!state.mySteamId) return;
  try {
    const res = await fetch('/api/recruit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'close', post_id: postId, steamid: state.mySteamId }),
    });
    if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.error || `HTTP ${res.status}`); }
    showToast('招募已关闭');
    loadRecruitPosts(true);
    loadMyRecruits();
  } catch (err) {
    showToast(err.message);
  }
}

async function kickMember(postId, targetSteamId) {
  if (!state.mySteamId) return;
  if (!confirm('确定将该成员移出队伍？')) return;
  try {
    const res = await fetch('/api/recruit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'kick', post_id: postId, steamid: state.mySteamId, target_steamid: targetSteamId }),
    });
    if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.error || `HTTP ${res.status}`); }
    showToast('已将该成员移出');
    loadRecruitPosts(true);
    loadMyRecruits();
  } catch (err) {
    showToast(err.message);
  }
}

async function loadMyRecruits() {
  const el = document.getElementById('recruitTeamMyList');
  if (!el) return;
  if (!state.mySteamId) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="loading"><div class="spinner"></div><p>加载我的招募...</p></div>`;
  try {
    const res = await fetch(`/api/recruit?action=mine&steamid=${encodeURIComponent(state.mySteamId)}`);
    if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.error || `HTTP ${res.status}`); }
    myRecruits = await res.json();
  } catch (err) {
    myRecruits = [];
    showToast('加载我的招募失败: ' + err.message);
  }
  renderMyRecruits();
}

function renderMyRecruits() {
  const el = document.getElementById('recruitTeamMyList');
  if (!el) return;
  const posts = myRecruits || [];
  if (!posts.length) {
    el.innerHTML = `<div class="card"><div class="card-title">我的招募</div><div class="empty"><p>你还没有参与任何招募</p></div></div>`;
    return;
  }
  const dismissed = getDismissedRecruits();
  const filtered = posts.filter(p => !dismissed.has(p.id));
  const closedCount = posts.filter(p => p.status === 0).length;
  if (!filtered.length) {
    el.innerHTML = `<div class="card"><div class="card-title">我的招募</div><div class="empty"><p>已清除，刷新页面可恢复</p></div></div>`;
    return;
  }
  const created = filtered.filter(p => p.creator_steamid === state.mySteamId);
  const joined = filtered.filter(p => p.creator_steamid !== state.mySteamId && (p.member_list || []).some(m => m.steamid === state.mySteamId));
  let html = `<div class="card"><div class="card-title">我的招募</div>`;
  if (closedCount > 0) {
    html += `<button class="btn btn-ghost" onclick="dismissClosedRecruits()" style="font-size:12px;padding:4px 10px;margin:0 0 10px 16px;">清除已关闭 (${closedCount})</button>`;
  }
  if (created.length) {
    html += `<div style="font-size:12px;color:var(--text-dim);font-weight:600;margin:0 0 8px 16px;">创建的（${created.length}）</div>
      <div class="recruit-list">${created.map(p => renderRecruitCard(p, true) + `<div style="text-align:right;margin-top:-6px;margin-bottom:10px;"><button class="btn btn-ghost" onclick="dismissRecruit(${p.id})" style="font-size:11px;padding:2px 8px;color:var(--text-muted);">清除</button></div>`).join('')}</div>`;
  }
  if (joined.length) {
    html += `<div style="font-size:12px;color:var(--text-dim);font-weight:600;margin:${created.length?'16px 0 8px 16px':'0 0 8px 16px'};">加入的（${joined.length}）</div>
      <div class="recruit-list">${joined.map(p => renderRecruitCard(p, true) + `<div style="text-align:right;margin-top:-6px;margin-bottom:10px;"><button class="btn btn-ghost" onclick="dismissRecruit(${p.id})" style="font-size:11px;padding:2px 8px;color:var(--text-muted);">清除</button></div>`).join('')}</div>`;
  }
  html += `</div>`;
  el.innerHTML = html;
}

function getDismissedRecruits() {
  try { return new Set(JSON.parse(localStorage.getItem('recruitDismissed') || '[]')); } catch { return new Set(); }
}
function saveDismissedRecruits(s) {
  localStorage.setItem('recruitDismissed', JSON.stringify([...s]));
}
function dismissRecruit(id) {
  const s = getDismissedRecruits();
  s.add(id);
  saveDismissedRecruits(s);
  renderMyRecruits();
}
function dismissClosedRecruits() {
  const posts = myRecruits || [];
  const s = getDismissedRecruits();
  posts.filter(p => p.status === 0).forEach(p => s.add(p.id));
  saveDismissedRecruits(s);
  renderMyRecruits();
}

function loadMoreStrangers() {
  strangersDisplayCount += STRANGERS_PAGE_SIZE;
  renderStrangersResults();
}

async function loadStrangers(force) {
  const el = document.getElementById('strangersContent');
  if (!state.mySteamId) {
    el.innerHTML = `<div class="empty"><p>请先完成扫描</p></div>`;
    return;
  }
  if (!document.getElementById('strangerOptInCard')) renderStrangersToggle();
  if (!force && strangersCache.data && Date.now() - strangersCache.ts < STRANGERS_CACHE_TTL) {
    state.strangersData = strangersCache.data;
    state.strangersError = null;
    renderStrangersResults();
    return;
  }
  const resultsEl = document.getElementById('strangerResults');
  if (resultsEl) resultsEl.innerHTML = `<div class="loading"><div class="spinner"></div><p>正在寻找陌生玩伴...</p></div>`;
  try {
    const res = await fetch(`${STRANGER_API_BASE}/api/strangers?steamid=${encodeURIComponent(state.mySteamId)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.strangersData = data || [];
    state.strangersError = null;
    strangersCache.data = state.strangersData;
    strangersCache.ts = Date.now();
    strangersDisplayCount = STRANGERS_PAGE_SIZE;
  } catch (err) {
    if (!strangersCache.data) {
      state.strangersData = null;
      state.strangersError = err.message || '网络错误';
    }
    console.warn('Load strangers failed:', err);
  }
  renderStrangersResults();
}

function renderStrangerCard(person, rank) {
  const pct = (person.score * 100).toFixed(1);
  const name = person.personaname || person.steamid;
  const avatar = person.avatar || '';
  const dot = (person.top5 || []).map(g => {
    const owns = state.playerTopGames.some(pg => pg.appid === g.appid);
    return `<span class="top5-dot ${owns ? 'owned' : 'missing'}" title="${g.name}">${owns ? '✓' : '–'}</span>`;
  }).join('');
  return `<div class="friend-card" data-steamid="${person.steamid}" style="animation-delay:${(rank || 0) * 0.04}s;">
    <div class="friend-avatar">${avatar ? `<img src="${avatar}" alt="">` : `<div class="placeholder">${name[0]}</div>`}</div>
    <div class="friend-info">
      <div class="friend-name">${name} <span class="stranger-badge">陌生人</span>${person.heybox_id ? `
          <a href="https://www.xiaoheihe.cn/app/user/profile/${encodeURIComponent(person.heybox_id)}"
             target="_blank" rel="noopener noreferrer"
             style="display:inline-flex;align-items:center;background:#222;color:#fff;font-size:10px;font-weight:800;padding:3px 6px;border-radius:6px;text-decoration:none;border:2px solid var(--border-thick);vertical-align:middle;margin-left:4px;">
             小黑盒
          </a>` : ''}</div>
      <div class="friend-meta" style="margin-top:4px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
        <span>Top5 游戏 ${(person.top5 || []).length} 款</span>
      </div>
      <div class="top5-dots">${dot}</div>
    </div>
    <div class="friend-score-col">
      <div class="score-value" style="color:${scoreColor(parseFloat(pct))}">${pct}%</div>
      <div class="score-bar"><div class="score-bar-fill" style="width:${pct}%;background:${scoreColor(parseFloat(pct))}"></div></div>
    </div>
  </div>`;
}

function showStrangerDetail(steamid) {
  const sd = state.strangersData;
  const p = sd && sd.find(s => s.steamid === steamid);
  if (!p || !state.playerTopGames.length) return;
  state._detailSteamId = steamid;
  state._detailSource = 'strangers';
  switchTab('tab-detail');
  const name = p.personaname || steamid;
  const avatar = p.avatar || '';
  const myTop5 = state.playerTopGames;
  const sTop5 = p.top5 || [];
  const sMap = {}; sTop5.forEach(g => { sMap[g.appid] = g; });
  const matchCount = myTop5.filter(g => sMap[g.appid]).length;
  const score = computeUnifiedScore(state.playerGames, sTop5, TOP_N, true);
  const pct = (score * 100).toFixed(1);
  const dc = document.getElementById('detailContent');
  dc.innerHTML = `
    <div class="detail-header">
      <div class="detail-avatar">${avatar ? `<img src="${avatar}" alt="">` : `<div class="placeholder">${name[0]}</div>`}</div>
      <div class="detail-info">
        <h2>${name}</h2>
        <div class="match-badge">Top5 重合 ${matchCount}/${TOP_N} · 匹配 ${pct}%</div>
      </div>
      <button class="btn btn-share" id="addFriendBtn" style="font-size:13px;padding:8px 16px;background:var(--brand-secondary);color:#fff;">添加好友</button>
      <button class="btn btn-ghost" id="backBtn">← 返回</button>
    </div>
    <div class="detail-body">
      <div class="card">
        <div class="card-title">双方 Top${TOP_N} 时长对比</div>
        ${myTop5.map((g) => {
          const pT = g.playtime_forever || 0;
          const sT = (sMap[g.appid]?.playtime_forever) || 0;
          const has = sMap[g.appid];
          return `<div class="game-row">
            <span style="width:24px;height:24px;border-radius:6px;overflow:hidden;flex-shrink:0;background:var(--surface);display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:${has ? 'var(--brand-success)' : 'var(--text-muted)'}">${has ? '✓' : '✕'}</span>
            <span class="game-name">${g.name}</span>
            <div class="game-hours-compare">
              <span><span class="hour-dot me"></span>${Math.round(pT / 60)}h</span>
              <span><span class="hour-dot them"></span>${Math.round(sT / 60)}h</span>
            </div>
          </div>`;
        }).join('')}
      </div>
      <div class="card">
        <div class="card-title">对方 Top${TOP_N}</div>
        ${sTop5.length ? sTop5.map((g, i) => {
          const h = Math.round((g.playtime_forever || 0) / 60);
          const iconUrl = g.img_icon_url ? `https://media.steampowered.com/steamcommunity/public/images/apps/${g.appid}/${g.img_icon_url}.jpg` : '';
          return `<div class="game-row">
            ${iconUrl ? `<div class="game-icon"><img src="${iconUrl}" alt="" style="width:100%;height:100%;object-fit:cover;"></div>` : `<div class="game-icon" style="background:var(--surface);display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:10px;font-weight:800;">${i + 1}</div>`}
            <span class="game-name">${g.name}</span>
            <span style="color:var(--brand-yellow);font-weight:600;font-size:13px;">${h}h</span>
          </div>`;
        }).join('') : '<div style="color:var(--text-dim);padding:12px;text-align:center;">暂无数据</div>'}
      </div>
    </div>
    <div class="card" style="text-align:center;border-width:4px;">
      <div style="display:flex;flex-direction:column;gap:16px;width:100%;">
        <a href="https://steamcommunity.com/profiles/${steamid}" target="_blank" class="btn-retro-base btn-retro-red">前往 Steam 添加好友</a>
        ${p.heybox_id ? `
          <a href="https://www.xiaoheihe.cn/app/user/profile/${encodeURIComponent(p.heybox_id)}"
             target="_blank" rel="noopener noreferrer"
             class="btn-retro-base btn-retro-white">
             查看小黑盒主页
          </a>` : ''}
      </div>
    </div>
  `;
}

let recruitLastPostTime = 0;
function togglePill(el) {
  const group = el.dataset.group;
  if (el.classList.contains('active')) {
    el.classList.remove('active');
    return;
  }
  document.querySelectorAll(`.pill-option[data-group="${group}"]`).forEach(p => p.classList.remove('active'));
  el.classList.add('active');
}

function renderWeeklyReport(useCache) {
  const el = document.getElementById('weeklyContent');
  const sid = state.mySteamId;
  if (!sid || !state.playerGames.length) {
    el.innerHTML = `<div class="empty"><p>请先完成扫描</p></div>`;
    return;
  }

  const uid = sid;

  const myRecentH = Math.round(state.playerGames.reduce((s, g) => s + ((g.playtime_2weeks || 0) / 60), 0) * 10) / 10;

  const top3 = state.playerGames
    .filter(g => (g.playtime_2weeks || 0) > 0)
    .sort((a, b) => (b.playtime_2weeks || 0) - (a.playtime_2weeks || 0))
    .slice(0, 3)
    .map(g => ({
      appid: g.appid, name: g.name,
      hours: Math.round((g.playtime_2weeks || 0) / 6) / 10,
      iconUrl: g.img_icon_url ? `https://media.steampowered.com/steamcommunity/public/images/apps/${g.appid}/${g.img_icon_url}.jpg` : '',
    }));

  const similarFriend = findMostSimilarFriend();

  const friendRace = state.friendsData
    .filter(f => f.games && f.games.length > 0)
    .map(f => {
      const recentH = Math.round(f.games.reduce((s, g) => s + ((g.playtime_2weeks || 0) / 60), 0) * 10) / 10;
      const totalH = Math.round(f.games.reduce((s, g) => s + (g.playtime_forever || 0), 0) / 60);
      return {
        steamid: f.steamid,
        name: f.summary?.personaname || f.steamid.slice(-4),
        avatar: f.summary?.avatarmedium || '',
        totalH, recentH,
      };
    })
    .sort((a, b) => b.recentH - a.recentH);
  friendRaceDisplayCount = Math.min(friendRaceDisplayCount, friendRace.length);

  const friendGameAgg = {};
  for (const f of state.friendsData) {
    if (!f.games) continue;
    for (const g of f.games) {
      const h = (g.playtime_2weeks || 0) / 60;
      if (h > 0) {
        if (!friendGameAgg[g.appid]) {
          friendGameAgg[g.appid] = { appid: g.appid, name: g.name, iconUrl: g.img_icon_url ? `https://media.steampowered.com/steamcommunity/public/images/apps/${g.appid}/${g.img_icon_url}.jpg` : '', totalHours: 0, players: 0 };
        }
        friendGameAgg[g.appid].totalHours += h;
        friendGameAgg[g.appid].players++;
      }
    }
  }
  const friendTopGames = Object.values(friendGameAgg)
    .map(g => ({ ...g, score: g.players * Math.log(g.totalHours + 1) }))
    .sort((a, b) => b.score - a.score).slice(0, 5);

  if (useCache && state.weeklyReport !== null) {
    renderWeeklyContent(el, state.weeklyReport, friendRace, myRecentH, top3, similarFriend, friendTopGames);
    return;
  }

  el.innerHTML = `<div class="loading"><div class="spinner"></div><p>加载周报数据...</p></div>`;

  fetch(`/api/weekly/report?steamid=${encodeURIComponent(uid)}`)
    .then(r => r.ok ? r.json() : null)
    .then(myReport => {
      state.weeklyReport = myReport;
      renderWeeklyContent(el, myReport, friendRace, myRecentH, top3, similarFriend, friendTopGames);
    })
    .catch(() => {
      renderWeeklyContent(el, null, friendRace, myRecentH, top3, similarFriend, friendTopGames);
    });
}

function findMostSimilarFriend() {
  const myRecent = {};
  state.playerGames.forEach(g => {
    const h = (g.playtime_2weeks || 0) / 60;
    if (h > 0) myRecent[g.appid] = h;
  });
  const myApps = Object.keys(myRecent);
  if (!myApps.length) return null;

  let best = null, bestScore = 0;
  for (const f of state.friendsData) {
    if (!f.games || !f.games.length) continue;
    const fgMap = {};
    f.games.forEach(g => { fgMap[g.appid] = (g.playtime_2weeks || 0) / 60; });
    let overlap = 0;
    for (const appid of myApps) {
      if (fgMap[appid] > 0) overlap++;
    }
    if (overlap > bestScore) {
      bestScore = overlap;
      best = {
        steamid: f.steamid,
        name: f.summary?.personaname || f.steamid.slice(-4),
        avatar: f.summary?.avatarmedium || '',
        overlap,
        sharedApps: myApps.filter(a => fgMap[a] > 0),
      };
    }
  }
  return best;
}

function renderWeeklyContent(el, myReport, friendRace, myRecentH, top3, similarFriend, friendTopGames) {
  const weeks = myReport?.weeks || [];
  const current = weeks.length > 0 ? JSON.parse(weeks[0].snapshot) : null;
  const prev = weeks.length > 1 ? JSON.parse(weeks[1].snapshot) : null;

  const currentTotal = Math.round((current?.total || 0) / 60);
  const deltaHtml = prev ? (() => {
    const prevTotal = Math.round((prev.total || 0) / 60);
    const d = currentTotal - prevTotal;
    const label = d > 0 ? '升' : (d < 0 ? '降' : '平');
    return `<div class="stat-item"><div class="stat-value ${d > 0 ? '' : 'stat-value-down'}">${d > 0 ? '+' : ''}${d}h</div><div class="stat-label">较上周 ${label}</div></div>`;
  })() : `<div class="stat-item"><div class="stat-value">基准周</div><div class="stat-label">首次记录</div></div>`;

  const thisWeekGames = prev ? computeWeeklyDiffs(current.games, prev.games) : [];
  const winners = thisWeekGames.filter(g => g.diff > 1).sort((a, b) => b.diff - a.diff).slice(0, 5);
  const losers = thisWeekGames.filter(g => g.diff < -1).sort((a, b) => a.diff - b.diff).slice(0, 5);

  const newGames = prev ? detectNewGames(current.games, prev.games) : [];
  const streak = countStreak(weeks);

  let historyHtml = '';
  if (weeks.length > 1) {
    const sorted = weeks.slice().reverse();
    const historyPoints = sorted.map((w, i, arr) => {
      const s = JSON.parse(w.snapshot);
      const cur = Math.round((s.total || 0) / 60);
      const prev = i > 0 ? Math.round((JSON.parse(sorted[i - 1].snapshot).total || 0) / 60) : cur;
      return { week: w.week, total: Math.max(cur - prev, 0), isFirst: i === 0 };
    });
    const maxH = Math.max(...historyPoints.map(p => p.total), 1);
    historyHtml = `<div class="card">
      <div class="card-title">近期趋势</div>
      <div style="display:flex;align-items:flex-end;gap:6px;height:80px;padding:8px 0;">
        ${historyPoints.map(p => {
          const barH = Math.max(Math.round((p.total / maxH) * 64), 8);
          return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;">
            <div style="width:100%;background:var(--brand-primary);border-radius:6px 6px 0 0;border:2px solid var(--border-thick);height:${barH}px;"></div>
            <span style="font-size:9px;font-weight:700;color:var(--text-dim);white-space:nowrap;">${p.isFirst ? '基准周' : isoWeekToDateRange(p.week)}</span>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }

  el.innerHTML = `
    <div class="stats-grid">
      <div class="stat-item"><div class="stat-value">${currentTotal}h</div><div class="stat-label">总游戏时长</div></div>
      ${deltaHtml}
      <div class="stat-item"><div class="stat-value">${(current?.games || []).length}</div><div class="stat-label">游戏总数</div></div>
    </div>
    ${streak > 1 ? `<div style="text-align:center;padding:8px 0 16px 0;font-size:13px;font-weight:700;color:var(--text-muted);">连续记录 ${streak} 周</div>` : ''}
    ${historyHtml}
    ${top3.length ? `<div class="card">
      <div class="card-title" style="display:flex;align-items:center;justify-content:space-between;">
        <span>本周 TOP3</span>
        ${myRecentH > 0 ? `<span style="font-size:13px;font-weight:600;color:var(--text-dim);">本周 ${myRecentH}h</span>` : ''}
      </div>
      ${top3.map(g => `<div class="game-row">
        ${g.iconUrl ? `<div class="game-icon"><img src="${g.iconUrl}" alt=""></div>` : `<div class="game-icon" style="display:flex;align-items:center;justify-content:center;background:var(--surface);font-size:12px;font-weight:800;color:var(--text-muted);">?</div>`}
        <span class="game-name">${g.name}</span>
        <span style="font-size:13px;font-weight:700;color:var(--brand-primary);">${g.hours}h</span>
      </div>`).join('')}
    </div>` : ''}
    ${winners.length ? `<div class="card">
      <div class="card-title">本周飙升</div>
      ${winners.map(g => `<div class="game-row">
        ${g.iconUrl ? `<div class="game-icon"><img src="${g.iconUrl}" alt=""></div>` : `<div class="game-icon" style="display:flex;align-items:center;justify-content:center;background:var(--surface);font-size:12px;font-weight:800;color:var(--text-muted);">?</div>`}
        <span class="game-name">${g.name}</span>
        <span style="font-size:13px;font-weight:700;color:var(--brand-success);">+${g.diff}h</span>
        <span style="font-size:12px;color:var(--text-dim);font-weight:600;">${g.thisWeek}h</span>
      </div>`).join('')}
    </div>` : ''}
    ${losers.length ? `<div class="card">
      <div class="card-title">本周熄火</div>
      ${losers.map(g => `<div class="game-row" style="opacity:0.6;">
        <span class="game-name" style="text-decoration:line-through;">${g.name}</span>
        <span style="font-size:13px;font-weight:700;color:var(--text-muted);">${g.diff}h</span>
        <span style="font-size:12px;color:var(--text-dim);font-weight:600;">上周 ${g.lastWeek}h</span>
      </div>`).join('')}
    </div>` : ''}
    ${newGames.length ? `<div class="card">
      <div class="card-title">本周新游 / 回坑</div>
      ${newGames.slice(0, 5).map(g => `<div class="game-row">
        ${g.iconUrl ? `<div class="game-icon"><img src="${g.iconUrl}" alt=""></div>` : `<div class="game-icon" style="display:flex;align-items:center;justify-content:center;background:var(--surface);font-size:12px;font-weight:800;color:var(--text-muted);">?</div>`}
        <span class="game-name">${g.name}</span>
        <span style="font-size:12px;color:var(--brand-success);font-weight:700;">${g.label}</span>
      </div>`).join('')}
    </div>` : ''}
    <div class="card">
      <div class="card-title">本周好友赛马</div>
      ${renderFriendRace(friendRace, myRecentH)}
    </div>
    ${similarFriend ? `<div class="card">
      <div class="card-title">和你本周最像的人</div>
      <div class="friend-card" style="cursor:default;padding:16px 22px;">
        <div class="friend-avatar" style="width:46px;height:46px;border-radius:14px;">
          ${similarFriend.avatar ? `<img src="${similarFriend.avatar}" alt="" style="width:100%;height:100%;object-fit:cover;">` : `<div class="placeholder">${similarFriend.name[0]}</div>`}
        </div>
        <div class="friend-info">
          <div class="friend-name">${similarFriend.name}</div>
          <div class="friend-meta"><strong>${similarFriend.overlap}</strong> 款共同游戏</div>
        </div>
        <div style="font-size:20px;font-weight:900;color:var(--brand-purple);">#1</div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:8px;">
        ${similarFriend.sharedApps.slice(0, 6).map(a => `<span style="font-size:11px;font-weight:700;background:var(--surface);padding:4px 10px;border-radius:6px;border:2px solid var(--border-thick);">${state.playerGames.find(g => g.appid === +a)?.name || a}</span>`).join('')}
        ${similarFriend.sharedApps.length > 6 ? `<span style="font-size:11px;color:var(--text-muted);font-weight:600;padding:4px 6px;">+${similarFriend.sharedApps.length - 6}</span>` : ''}
      </div>
    </div>` : ''}
    ${friendTopGames && friendTopGames.length ? `<div class="card">
      <div class="card-title">本周好友在玩游戏 Top5</div>
      ${friendTopGames.map(g => `<div class="game-row">
        ${g.iconUrl ? `<div class="game-icon"><img src="${g.iconUrl}" alt=""></div>` : `<div class="game-icon" style="display:flex;align-items:center;justify-content:center;background:var(--surface);font-size:12px;font-weight:800;color:var(--text-muted);">?</div>`}
        <span class="game-name">${g.name}</span>
        <span style="font-size:12px;color:var(--text-dim);font-weight:600;">${g.players} 人在玩</span>
        <span style="font-size:13px;font-weight:700;color:var(--brand-primary);">${Math.round(g.totalHours * 10) / 10}h</span>
      </div>`).join('')}
    </div>` : ''}
    <div style="text-align:center;margin-top:8px;">
      <button class="btn btn-ghost" onclick="shareWeeklyReport()" style="font-size:12px;padding:10px 20px;">分享周报</button>
    </div>
  `;
}

function isoWeekToDateRange(weekStr) {
  const [year, weekNum] = weekStr.split('-W').map(Number);
  const jan4 = new Date(year, 0, 4);
  const dayOffset = (jan4.getDay() + 6) % 7;
  const jan4Week = Math.ceil(((jan4 - new Date(year, 0, 1)) / 86400000 + jan4.getDay() + 1) / 7);
  const monday = new Date(year, 0, 1 + (weekNum - jan4Week) * 7 - dayOffset);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = d => `${d.getMonth()+1}/${d.getDate()}`;
  return `${fmt(monday)}-${fmt(sunday)}`;
}

function computeWeeklyDiffs(currentGames, prevGames) {
  const prevMap = {};
  (prevGames || []).forEach(g => { prevMap[g.appid] = Math.round((g.playtime_forever || 0) / 6) / 10; });
  return (currentGames || []).map(g => {
    const prev = prevMap[g.appid] || 0;
    const cur = Math.round((g.playtime_forever || 0) / 6) / 10;
    const diff = Math.round((cur - prev) * 10) / 10;
    if (Math.abs(diff) < 0.1) return null;
    const iconUrl = g.img_icon_url ? `https://media.steampowered.com/steamcommunity/public/images/apps/${g.appid}/${g.img_icon_url}.jpg` : '';
    return { appid: g.appid, name: g.name, iconUrl, thisWeek: cur, lastWeek: prev, diff };
  }).filter(Boolean);
}

function detectNewGames(currentGames, prevGames) {
  const prevMap = {};
  (prevGames || []).forEach(g => { prevMap[g.appid] = Math.round((g.playtime_forever || 0) / 6) / 10; });
  return (currentGames || []).map(g => {
    const prevH = prevMap[g.appid] || 0;
    const curH = Math.round((g.playtime_forever || 0) / 6) / 10;
    if (prevH <= 0 && curH > 0) {
      const iconUrl = g.img_icon_url ? `https://media.steampowered.com/steamcommunity/public/images/apps/${g.appid}/${g.img_icon_url}.jpg` : '';
      return { appid: g.appid, name: g.name, iconUrl, hours: curH, label: '新游' };
    }
    if (prevH > 0 && curH > prevH + 5 && prevH < 1) {
      const iconUrl = g.img_icon_url ? `https://media.steampowered.com/steamcommunity/public/images/apps/${g.appid}/${g.img_icon_url}.jpg` : '';
      return { appid: g.appid, name: g.name, iconUrl, hours: curH, label: '回坑' };
    }
    return null;
  }).filter(Boolean).sort((a, b) => b.hours - a.hours);
}

function countStreak(weeks) {
  if (!weeks.length) return 0;
  let count = 1;
  for (let i = 0; i < weeks.length - 1; i++) {
    const cur = weeks[i].week;
    const next = weeks[i + 1].week;
    const curNum = parseInt(cur.split('-W')[1]);
    const nextNum = parseInt(next.split('-W')[1]);
    const curYear = parseInt(cur.split('-W')[0]);
    const nextYear = parseInt(next.split('-W')[0]);
    if (curYear === nextYear && curNum - nextNum === 1) count++;
    else if (curYear === nextYear + 1 && nextNum >= 51 && curNum === 1) count++;
    else break;
  }
  return count;
}

async function shareWeeklyReport() {
  const el = document.getElementById('weeklyContent');
  if (!el || !el.children.length) return;
  const c = await captureAndFooter(el, 2, '周报');
  if (!c) return;
  const blob = await new Promise(r => c.toBlob(b => r(b), 'image/png'));
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `Steam周报_${new Date().toISOString().slice(0, 10)}.png`;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function expandFriendRace() {
  friendRaceDisplayCount += FRIEND_RACE_PAGE;
  renderWeeklyReport(true);
}

function renderFriendRace(race, myRecentH) {
  if (!race || !race.length) {
    return `<div style="color:var(--text-dim);padding:12px;text-align:center;font-size:13px;font-weight:600;">暂无好友周报数据</div>`;
  }

  const shown = race.slice(0, friendRaceDisplayCount);
  const hasMore = race.length > friendRaceDisplayCount;

  return `<div class="friend-list">
    ${shown.map((f, i) => {
      const diff = Math.round((f.recentH - myRecentH) * 10) / 10;
      const rank = i + 1;
      return `<div class="friend-card" style="padding:16px 22px;gap:14px;cursor:default;">
        <div class="friend-avatar" style="width:40px;height:40px;border-radius:12px;">
          ${f.avatar ? `<img src="${f.avatar}" alt="" style="width:100%;height:100%;object-fit:cover;">` : `<div class="placeholder" style="font-size:16px;">${rank}</div>`}
        </div>
        <div class="friend-info">
          <div class="friend-name" style="font-size:14px;">${f.name}</div>
          <div class="friend-meta" style="font-size:11px;">总 ${f.totalH}h</div>
        </div>
        <div class="friend-score-col">
          <div class="score-value" style="font-size:20px;">${f.recentH}h</div>
          <div style="font-size:11px;font-weight:700;color:${diff > 0 ? 'var(--brand-success)' : 'var(--text-dim)'};">${diff > 0 ? '比你多' + diff + 'h' : diff < 0 ? '比你少' + Math.abs(diff) + 'h' : '持平'}</div>
        </div>
      </div>`;
    }).join('')}
  </div>
  ${hasMore ? `<button class="btn btn-ghost" onclick="expandFriendRace()" style="width:100%;margin-top:12px;">显示更多（${race.length - friendRaceDisplayCount} 人）</button>` : ''}`;
}

function renderRecruit() {
  const el = document.getElementById('recruitContent');
  const mode = state._recruitMode || 'match';
  const games = state.playerGames;
  if (!games || !games.length) {
    el.innerHTML = `<div class="empty"><p>请先完成扫描</p></div>`;
    return;
  }
  if (!document.getElementById('recruitStyles')) {
    const s = document.createElement('style');
    s.id = 'recruitStyles';
    s.textContent = `
      .recruit-mode-btn{flex:1;padding:12px 14px;border-radius:12px;border:2.5px solid transparent;font-weight:900;font-size:13px;cursor:pointer;transition:all 0.2s;background:transparent;color:var(--text-dim);position:relative;text-align:center;}
      .recruit-mode-btn:hover{background:rgba(255,255,255,0.5);}
      .recruit-mode-btn.active{background:#fff0f0;color:var(--brand-primary);border-color:var(--border-thick);box-shadow:2px 2px 0 var(--border-thick);}
      .recruit-mode-btn.active::before{content:'';position:absolute;left:-1px;top:7px;bottom:7px;width:4px;background:var(--brand-primary);border-radius:0 3px 3px 0;border:2px solid var(--border-thick);border-left:none;}
      .pill-option{display:inline-flex;align-items:center;gap:4px;cursor:pointer;padding:4px 10px;border:2px solid var(--border-thick);border-radius:8px;background:var(--surface);font-size:12px;font-weight:600;user-select:none;transition:all 0.15s;}
      .pill-option.active{background:var(--brand-yellow);}
      .recruit-list{display:flex;flex-direction:column;gap:8px;}
      .recruit-card{background:var(--surface);border:3px solid var(--border-thick);border-radius:14px;padding:12px;}
      .recruit-card-top{display:flex;gap:10px;align-items:center;margin-bottom:4px;}
      .recruit-game-icon{width:36px;height:36px;border-radius:8px;overflow:hidden;flex-shrink:0;border:2px solid var(--border-thick);}
      .recruit-game-icon img{width:100%;height:100%;object-fit:cover;}
      .recruit-game-info{flex:1;min-width:0;}
      .recruit-game-name{font-weight:700;font-size:13px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
      .recruit-meta{font-size:11px;color:var(--text-dim);font-weight:600;margin-top:1px;}

      .recruit-card-actions{display:flex;gap:6px;justify-content:flex-end;margin-top:4px;}
      .recruit-card-actions .btn{padding:6px 14px;font-size:12px;border-radius:10px;}
      .recruit-members{display:flex;gap:3px;flex-wrap:wrap;align-items:center;}
      .recruit-member-avatar{width:24px;height:24px;border-radius:6px;overflow:hidden;border:2px solid var(--border-thick);position:relative;flex-shrink:0;}
      .recruit-member-avatar img,.recruit-member-avatar .placeholder{width:100%;height:100%;object-fit:cover;display:flex;align-items:center;justify-content:center;background:var(--surface);font-size:8px;font-weight:700;color:var(--text-muted);}
      .recruit-member-names{font-size:11px;color:var(--text-dim);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;}
      .recruit-kick-btn{position:absolute;top:-4px;right:-4px;width:14px;height:14px;border-radius:50%;border:2px solid var(--border-thick);background:#fff;color:#e53e3e;font-size:9px;font-weight:700;line-height:1;cursor:pointer;display:none;align-items:center;justify-content:center;padding:0;}
      .recruit-member-avatar.is-kickable:hover .recruit-kick-btn{display:flex;}
      .recruit-badge{display:inline-block;font-size:10px;padding:1px 5px;border-radius:5px;font-weight:700;border:2px solid var(--border-thick);vertical-align:middle;margin-right:2px;}
      .badge-purple{background:#e9d8fd;color:#6b46c1;}
      .badge-green{background:#c6f6d5;color:#276749;}
      .badge-red{background:#fed7d7;color:#9b2c2c;}
      .badge-blue{background:#bee3f8;color:#2a4365;}
      .badge-amber{background:#fefcbf;color:#744210;}
      .badge-orange{background:#feebc8;color:#7b341e;}
      .badge-indigo{background:#c3dafe;color:#3730a3;}
      .badge-violet{background:#e9d8fd;color:#553c9a;}
      .badge-gray{background:#e2e8f0;color:#4a5568;}
    `;
    document.head.appendChild(s);
  }
  el.innerHTML = `
    <div class="card" style="padding:20px;">
      <div style="display:flex;gap:6px;background:#e2e8f0;border:3px solid var(--border-thick);border-radius:16px;padding:5px;">
        <button class="recruit-mode-btn ${mode === 'match' ? 'active' : ''}" data-mode="match">
          <div>指定匹配</div>
          <div style="font-size:11px;font-weight:600;opacity:0.6;margin-top:3px;">按游戏+时长筛选</div>
        </button>
        <button class="recruit-mode-btn ${mode === 'recent' ? 'active' : ''}" data-mode="recent">
          <div>近期推荐</div>
          <div style="font-size:11px;font-weight:600;opacity:0.6;margin-top:3px;">按近两周活跃度推荐</div>
        </button>
        <button class="recruit-mode-btn ${mode === 'team' ? 'active' : ''}" data-mode="team">
          <div>车队招募</div>
          <div style="font-size:11px;font-weight:600;opacity:0.6;margin-top:3px;">发布或加入游戏队伍</div>
        </button>
      </div>
    </div>
    <div id="recruitModeContent"></div>
  `;
  document.querySelectorAll('.recruit-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.recruit-mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state._recruitMode = btn.dataset.mode;
      renderRecruitModeContent();
    });
  });
  renderRecruitModeContent();
}

function renderRecruitModeContent() {
  const mode = state._recruitMode || 'match';
  const el = document.getElementById('recruitModeContent');
  if (mode === 'match') renderRecruitMatch(el);
  else if (mode === 'recent') renderRecruitRecent(el);
  else {
    try { renderRecruitTeam(el); }
    catch (e) { console.error('Recruit team error:', e); el.innerHTML = `<div class="card"><div class="empty"><p>车队招募暂时不可用: ${e.message}</p></div></div>`; }
  }
}

function renderRecruitMatch(container) {
  const games = state.playerGames;
  const id = 'recruitMatch';
  container.innerHTML = `
    <div class="card">
      <div class="card-title">指定匹配</div>
      <div class="custom-form">
        <label>
          选择游戏
          <select id="${id}GameSelect">
            ${games.filter(g => (g.playtime_forever || 0) > 0).sort((a, b) => (b.playtime_forever || 0) - (a.playtime_forever || 0)).map(g => {
              const h = Math.round((g.playtime_forever || 0) / 60);
              const excluded = isExcluded(g.appid);
              return `<option value="${g.appid}" ${excluded ? 'disabled style="color:var(--text-muted);"' : ''}>${g.name} (${h}h)${excluded ? ' [已排除]' : ''}</option>`;
            }).join('')}
          </select>
        </label>
        <div style="display:flex;gap:12px;">
          <label style="flex:1;">
            最低时长（小时）
            <input type="number" id="${id}MinHours" value="0" min="0" step="1">
          </label>
          <label style="flex:1;">
            最高时长（小时）
            <input type="number" id="${id}MaxHours" value="" min="0" step="1" placeholder="不设上限">
          </label>
        </div>
        <label style="flex-direction:row;align-items:center;gap:12px;">
          <span>匹配范围</span>
          <span class="radio-group">
            <label><input type="radio" name="${id}Target" value="friends" checked> 好友</label>
            <label><input type="radio" name="${id}Target" value="strangers"> 游戏搭子</label>
            <label><input type="radio" name="${id}Target" value="all"> 全部</label>
          </span>
        </label>
        <button class="btn btn-primary" id="${id}Btn">开始匹配</button>
      </div>
    </div>
    <div id="${id}Results"></div>
  `;
  document.getElementById(`${id}Btn`).addEventListener('click', runRecruitMatch);
}

function runRecruitMatch() {
  const id = 'recruitMatch';
  const appid = parseInt(document.getElementById(`${id}GameSelect`).value);
  const minHours = parseFloat(document.getElementById(`${id}MinHours`).value) || 0;
  const maxHours = parseFloat(document.getElementById(`${id}MaxHours`).value);
  const target = document.querySelector(`input[name="${id}Target"]:checked`).value;
  const myGame = state.playerGames.find(g => g.appid === appid);
  if (!myGame) { showToast('未找到该游戏'); return; }
  if (maxHours && maxHours < minHours) { showToast('最高时长不能低于最低时长'); return; }
  const myHours = (myGame.playtime_forever || 0) / 60;
  const results = [];

  if (target === 'friends' || target === 'all') {
    for (const f of state.friendsData) {
      const fg = (f.games || []).find(g => g.appid === appid);
      if (!fg) continue;
      const fHours = (fg.playtime_forever || 0) / 60;
      if (fHours < minHours) continue;
      if (maxHours && fHours > maxHours) continue;
      results.push({
        steamid: f.steamid, name: f.summary?.personaname || f.steamid,
        avatar: f.summary?.avatarmedium || '', hours: fHours,
        diff: Math.abs(myHours - fHours), source: '好友',
      });
    }
  }
  if ((target === 'strangers' || target === 'all') && state.strangersData) {
    for (const s of state.strangersData) {
      const sg = (s.top5 || []).find(g => g.appid === appid);
      if (!sg) continue;
      const sHours = (sg.playtime_forever || 0) / 60;
      if (sHours < minHours) continue;
      if (maxHours && sHours > maxHours) continue;
      results.push({
        steamid: s.steamid, name: s.personaname || s.steamid,
        avatar: s.avatar || '', hours: sHours,
        diff: Math.abs(myHours - sHours), source: '游戏搭子',
      });
    }
  }

  results.sort((a, b) => a.diff - b.diff);

  const resEl = document.getElementById(`${id}Results`);
  if (!results.length) {
    resEl.innerHTML = `<div class="empty"><p>未找到符合条件的玩家</p></div>`;
    return;
  }
  const sLabel = (s) => s === '好友' ? 'var(--brand-primary)' : 'var(--brand-purple)';
  resEl.innerHTML = `
    <div class="stats-grid">
      <div class="stat-item"><div class="stat-value">${results.length}</div><div class="stat-label">匹配结果</div></div>
      <div class="stat-item"><div class="stat-value" style="font-size:16px;">${myGame.name}</div><div class="stat-label">我: ${myHours.toFixed(1)}h</div></div>
      <div class="stat-item"><div class="stat-value" style="color:var(--brand-secondary);">${results[0].hours.toFixed(1)}h</div><div class="stat-label">最接近: ${results[0].name}</div></div>
    </div>
    <div class="card"><div class="card-title">指定匹配结果</div><div class="friend-list">${results.map((r, i) => `
      <div class="friend-card" data-steamid="${r.steamid}" data-source="${r.source}" style="animation-delay:${i * 0.04}s;">
        <div class="friend-avatar">${r.avatar ? `<img src="${r.avatar}" alt="">` : `<div class="placeholder">${r.name[0]}</div>`}</div>
        <div class="friend-info">
          <div class="friend-name">${r.name} <span class="stranger-badge" style="background:${sLabel(r.source)};">${r.source}</span></div>
          <div class="friend-meta" style="margin-top:2px;">${r.source} · ${r.hours.toFixed(1)}h</div>
        </div>
        <div class="friend-score-col">
          <div class="score-value" style="color:var(--brand-secondary);font-size:20px;">${r.hours.toFixed(1)}h</div>
          <div style="font-size:11px;color:var(--text-dim);margin-top:4px;font-weight:600;">相差 ${(Math.abs(myHours - r.hours)).toFixed(1)}h</div>
        </div>
      </div>`).join('')}</div></div>
  `;
}

function renderRecruitRecent(container) {
  if (!state.myRecentGames || !state.myRecentGames.length) {
    container.innerHTML = `<div class="empty"><p>暂无近期游戏数据</p></div>`;
    return;
  }

  const myRecent = state.myRecentGames
    .filter(g => (g.playtime_2weeks || 0) > 0 && !getExcludedSet().has(g.appid))
    .sort((a, b) => (b.playtime_2weeks || 0) - (a.playtime_2weeks || 0))
    .slice(0, TOP_N)
    .map(g => ({ ...g, playtime_forever: g.playtime_2weeks }));

  if (!myRecent.length) {
    container.innerHTML = `<div class="empty"><p>近两周未游玩游戏</p></div>`;
    return;
  }

  container.innerHTML = `
    <div class="card">
      <div class="card-title">我的近期游戏</div>
      ${myRecent.map((g, i) => {
        const h = Math.round((g.playtime_2weeks || 0) / 60);
        const iconUrl = g.img_icon_url ? `https://media.steampowered.com/steamcommunity/public/images/apps/${g.appid}/${g.img_icon_url}.jpg` : '';
        return `<div class="game-row">
          ${iconUrl ? `<div class="game-icon"><img src="${iconUrl}" alt="" style="width:100%;height:100%;object-fit:cover;"></div>` : `<div class="game-icon" style="background:var(--surface);display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:10px;font-weight:800;">${i + 1}</div>`}
          <span style="width:18px;font-size:12px;color:var(--text-muted);font-weight:600;text-align:center;">${i + 1}</span>
          <span class="game-name">${g.name}</span>
          <span style="color:var(--brand-primary);font-weight:600;font-size:13px;">${h}h</span>
        </div>`;
      }).join('')}
    </div>
    <div class="card">
      <div class="custom-form">
        <label style="flex-direction:row;align-items:center;gap:12px;">
          <span>匹配范围</span>
          <span class="radio-group">
            <label><input type="radio" name="recentTarget" value="friends" checked> 好友</label>
            <label><input type="radio" name="recentTarget" value="strangers"> 游戏搭子</label>
            <label><input type="radio" name="recentTarget" value="all"> 全部</label>
          </span>
        </label>
        <button class="btn btn-primary" id="runRecentMatchBtn">开始匹配</button>
      </div>
    </div>
    <div id="recentMatchResults"></div>
  `;
  document.getElementById('runRecentMatchBtn').addEventListener('click', () => runRecentMatch(myRecent));
}

async function runRecentMatch(myRecent) {
  const target = document.querySelector('input[name="recentTarget"]:checked').value;
  const container = document.getElementById('recentMatchResults');
  const allResults = [];

  if (target === 'friends' || target === 'all') {
    container.innerHTML = `<div class="loading"><div class="spinner"></div><p>正在获取好友近期数据...</p></div>`;
    const fResults = [];
    for (let i = 0; i < state.friendsData.length; i++) {
      const f = state.friendsData[i];
      try {
        const recent = await fetchRecentGames(f.steamid, state.myApiKey);
        const fRecent = recent.filter(g => (g.playtime_2weeks || 0) > 0).map(g => ({ ...g, playtime_forever: g.playtime_2weeks }));
        const score = computeRecentMatchScore(myRecent, fRecent);
        fResults.push({ steamid: f.steamid, name: f.summary?.personaname || f.steamid, avatar: f.summary?.avatarmedium || '', score, games: fRecent, source: '好友' });
      } catch (e) { console.warn(`Recent failed: ${f.steamid}`, e); }
    }
    state.friendsRecentData = fResults;
    state.friendsRecentLoaded = true;
    allResults.push(...fResults);
  }

  if (target === 'strangers' || target === 'all') {
    if (state.strangersData && state.strangersData.length) {
      for (const s of state.strangersData) {
        const sRecent = (s.recentTop5 || []).filter(g => (g.playtime_2weeks || 0) > 0).map(g => ({ ...g, playtime_forever: g.playtime_2weeks }));
        if (!sRecent.length) continue;
        const score = computeRecentMatchScore(myRecent, sRecent);
        allResults.push({ steamid: s.steamid, name: s.personaname || s.steamid, avatar: s.avatar || '', score, games: sRecent, source: '游戏搭子' });
      }
    }
  }

  allResults.sort((a, b) => (b.score || 0) - (a.score || 0));
  state.recentMatchResults = allResults;

  if (!allResults.length) {
    container.innerHTML = `<div class="empty"><p>未找到匹配结果</p></div>`;
    return;
  }

  const best = allResults.reduce((a, b) => (a.score || 0) > (b.score || 0) ? a : b);
  const sColor = (s) => s === '好友' ? 'var(--brand-primary)' : 'var(--brand-purple)';
  container.innerHTML = `
    <div class="stats-grid">
      <div class="stat-item"><div class="stat-value">${allResults.length}</div><div class="stat-label">匹配结果</div></div>
      <div class="stat-item"><div class="stat-value">${allResults.filter(x => (x.score || 0) > 0.3).length}</div><div class="stat-label">近期活跃</div></div>
      <div class="stat-item"><div class="stat-value" style="color:var(--brand-success);">${((best.score || 0) * 100).toFixed(1)}%</div><div class="stat-label">最佳匹配</div></div>
    </div>
    <div class="card"><div class="card-title">近期推荐</div><div class="friend-list">${allResults.map((r, i) => {
      const pct = ((r.score || 0) * 100).toFixed(1);
      const dots = myRecent.map(pg => {
        const owns = (r.games || []).some(g => g.appid === pg.appid);
        return `<span class="top5-dot ${owns ? 'owned' : 'missing'}" title="${pg.name}">${owns ? '✓' : '–'}</span>`;
      }).join('');
      return `<div class="friend-card" data-steamid="${r.steamid}" data-source="${r.source}" style="animation-delay:${i * 0.04}s;">
        <div class="friend-avatar">${r.avatar ? `<img src="${r.avatar}" alt="">` : `<div class="placeholder">${r.name[0]}</div>`}</div>
        <div class="friend-info">
          <div class="friend-name">${r.name} <span class="stranger-badge" style="background:${sColor(r.source)};">${r.source}</span></div>
          <div class="friend-meta">近期活跃 · 匹配 ${pct}%</div>
          <div class="top5-dots">${dots}</div>
        </div>
    <div class="friend-score-col">
      <div class="score-value" style="color:${scoreColor(parseFloat(pct))}">${pct}%</div>
      <div class="score-bar"><div class="score-bar-fill" style="width:${pct}%;background:${scoreColor(parseFloat(pct))}"></div></div>
    </div>
      </div>`;
    }).join('')}</div></div>
  `;
}

function showRecentDetail(steamid) {
  const p = state.recentMatchResults && state.recentMatchResults.find(r => r.steamid === steamid);
  if (!p) return;
  state._detailSteamId = steamid;
  state._detailSource = 'recruit';
  switchTab('tab-detail');
  const name = p.name || steamid;
  const avatar = p.avatar || '';
  const myRecent = state.myRecentGames
    .filter(g => (g.playtime_2weeks || 0) > 0)
    .sort((a, b) => (b.playtime_2weeks || 0) - (a.playtime_2weeks || 0))
    .slice(0, TOP_N);
  const theirGames = p.games || [];
  const theirMap = {};
  theirGames.forEach(g => { theirMap[g.appid] = g; });
  const matchCount = myRecent.filter(g => theirMap[g.appid]).length;
  const pct = ((p.score || 0) * 100).toFixed(1);
  const dc = document.getElementById('detailContent');
  dc.innerHTML = `
    <div class="detail-header">
      <div class="detail-avatar">${avatar ? `<img src="${avatar}" alt="">` : `<div class="placeholder">${name[0]}</div>`}</div>
      <div class="detail-info">
        <h2>${name}</h2>
        <div class="match-badge">${pct}% 近期匹配 · 重合 ${matchCount}/${TOP_N}</div>
      </div>
      <button class="btn btn-ghost" id="backBtn">← 返回</button>
    </div>
    <div class="detail-body">
      <div class="card">
        <div class="card-title">近两周 Top5 时长对比</div>
        ${myRecent.map((g) => {
          const pT = g.playtime_2weeks || 0;
          const fT = (theirMap[g.appid]?.playtime_2weeks) || 0;
          const has = theirMap[g.appid];
          return `<div class="game-row">
            <span style="width:24px;height:24px;border-radius:6px;overflow:hidden;flex-shrink:0;background:var(--surface);display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:${has ? 'var(--brand-success)' : 'var(--text-muted)'}">${has ? '✓' : '✕'}</span>
            <span class="game-name">${g.name}</span>
            <div class="game-hours-compare">
              <span><span class="hour-dot me"></span>${Math.round(pT/60)}h</span>
              <span><span class="hour-dot them"></span>${Math.round(fT/60)}h</span>
            </div>
          </div>`;
        }).join('')}
      </div>
      <div class="card">
        <div class="card-title">对方近期 Top${TOP_N}</div>
        ${theirGames.length ? theirGames.map((g, i) => {
          const h = Math.round((g.playtime_2weeks || 0) / 60);
          const iconUrl = g.img_icon_url ? `https://media.steampowered.com/steamcommunity/public/images/apps/${g.appid}/${g.img_icon_url}.jpg` : '';
          return `<div class="game-row">
            ${iconUrl ? `<div class="game-icon"><img src="${iconUrl}" alt="" style="width:100%;height:100%;object-fit:cover;"></div>` : `<div class="game-icon" style="background:var(--surface);display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:10px;font-weight:800;">${i + 1}</div>`}
            <span class="game-name">${g.name}</span>
            <span style="color:var(--brand-yellow);font-weight:600;font-size:13px;">${h}h</span>
          </div>`;
        }).join('') : '<div style="color:var(--text-dim);padding:12px;text-align:center;">无近期游戏数据</div>'}
      </div>
    </div>
    <div class="card" style="text-align:center;">
      <a href="https://steamcommunity.com/profiles/${steamid}" target="_blank" class="btn btn-primary" style="text-decoration:none;display:inline-flex;">前往 Steam 添加好友</a>
    </div>
  `;
}

// ====== 分享码 (share.html) ======

function initSharePage() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const el = document.getElementById('shareContent');
  if (!code) {
    el.innerHTML = `<div class="card"><div class="empty"><p>缺少分享码，请检查链接</p></div></div>`;
    return;
  }
  fetch(`/api/share/lookup?code=${encodeURIComponent(code)}`)
    .then(r => r.ok ? r.json() : Promise.reject('Code not found'))
    .then(data => renderShareLookup(el, data))
    .catch(() => {
      el.innerHTML = `<div class="card"><div class="empty"><p>分享码无效或已失效</p></div></div>`;
    });
}

function renderShareLookup(container, theirData) {
  const top5 = theirData.top5 || [];
  const name = theirData.personaname || '未知玩家';
  const avatar = theirData.avatar || '';
  container.innerHTML = `
    <div class="card">
      <div class="profile-row">
        <div class="avatar">${avatar ? `<img src="${avatar}" alt="">` : `<div class="placeholder">${name[0]}</div>`}</div>
        <div>
          <div class="profile-name">${name}</div>
          <div class="match-badge">分享码 · Top5 游戏</div>
        </div>
      </div>
      ${top5.length ? top5.map((g, i) => {
        const h = Math.round((g.playtime_forever || 0) / 60);
        const iconUrl = g.img_icon_url ? `https://media.steampowered.com/steamcommunity/public/images/apps/${g.appid}/${g.img_icon_url}.jpg` : '';
        return `<div class="game-row">
          ${iconUrl ? `<div class="game-icon"><img src="${iconUrl}" alt=""></div>` : `<div class="game-icon" style="display:flex;align-items:center;justify-content:center;background:var(--surface);font-size:12px;font-weight:800;color:var(--text-muted);">${i+1}</div>`}
          <span class="game-name">${g.name}</span>
          <span class="game-hours">${h}h</span>
        </div>`;
      }).join('') : '<div style="color:var(--text-dim);text-align:center;padding:12px;">暂无游戏数据</div>'}
    </div>
    <div class="config-panel">
      <div class="config-row">
        <div class="config-group">
          <label>你的 Steam ID 或主页链接</label>
          <input type="text" id="shareSteamId" placeholder="在这里粘贴你的主页链接...">
        </div>
        <button class="btn btn-primary btn-full" id="shareStartBtn">开始分析</button>
      </div>
    </div>
    <div id="shareResult"></div>
  `;
  document.getElementById('shareStartBtn').addEventListener('click', () => {
    startShareMatch(theirData);
  });
  document.getElementById('shareSteamId').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') startShareMatch(theirData);
  });
}

async function createShareCode() {
  if (!state.mySteamId) { showToast('请先完成扫描'); return; }
  const btn = document.getElementById('createShareCodeBtn');
  btn.textContent = '生成中...';
  try {
    const recentTop5 = (state.myRecentGames || [])
      .filter(g => (g.playtime_2weeks || 0) > 0)
      .sort((a, b) => (b.playtime_2weeks || 0) - (a.playtime_2weeks || 0))
      .slice(0, TOP_N);
    const res = await fetch('/api/share/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        steamid: state.mySteamId,
        personaname: state.myProfile?.personaname || '',
        avatar: state.myProfile?.avatarfull || state.myProfile?.avatarmedium || '',
        top5: state.playerTopGames.map(g => ({
          appid: g.appid, name: g.name,
          img_icon_url: g.img_icon_url || '',
          playtime_forever: g.playtime_forever || 0,
        })),
        recentTop5: recentTop5.map(g => ({
          appid: g.appid, name: g.name,
          img_icon_url: g.img_icon_url || '',
          playtime_2weeks: g.playtime_2weeks || 0,
        })),
      }),
    });
    if (!res.ok) throw new Error('创建失败');
    const { code } = await res.json();
    const link = `${window.location.origin}/share?code=${code}`;
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(link);
      showToast(`分享码已复制: ${code}`);
    } else {
      showToast(`分享码: ${code}`);
    }
  } catch (e) {
    showToast(e.message || '创建分享码失败');
  } finally {
    btn.textContent = '分享码';
  }
}

async function startShareMatch(theirData) {
  const input = document.getElementById('shareSteamId').value.trim();
  if (!input) { showToast('请输入 Steam ID'); return; }
  const btn = document.getElementById('shareStartBtn');
  btn.disabled = true;
  btn.textContent = '分析中...';

  let apiKey = localStorage.getItem('steamApiKey') || '';
  if (!apiKey) {
    apiKey = prompt('请先输入你的 Steam API 密钥：');
    if (!apiKey) { btn.disabled = false; btn.textContent = '开始分析'; return; }
    localStorage.setItem('steamApiKey', apiKey);
  }

  try {
    const steamId = await resolveSteamId(input, apiKey);
    const resultEl = document.getElementById('shareResult');
    resultEl.innerHTML = `<div class="loading"><div class="spinner"></div><p>正在拉取游戏数据...</p></div>`;

    const games = await fetchOwnedGames(steamId, apiKey);
    const myTop5 = getTopGames(games, TOP_N);

    const isSelf = steamId === theirData.steamid;
    const score = isSelf ? 1.0 : computeUnifiedScore(games, theirData.top5 || [], TOP_N, true);
    const pct = (score * 100).toFixed(1);

    const shared = (theirData.top5 || []).filter(tg => myTop5.some(mg => mg.appid === tg.appid));
    const sharedCount = shared.length;

    window._shareMatchData = { myGames: games, myTop5, mySteamId: steamId, theirData, score, pct, shared };

    resultEl.innerHTML = isSelf ? `
      <div class="card">
        <div class="card-title">匹配结果</div>
        <div class="friend-card" style="border-color:var(--brand-success);text-align:center;flex-direction:column;cursor:default;">
          <div class="friend-info" style="text-align:center;">
            <div class="friend-name" style="font-size:22px;">这是你自己的分享码</div>
            <div class="friend-meta" style="color:var(--brand-success);font-weight:800;font-size:15px;">和你的匹配度</div>
          </div>
          <div class="friend-score-col">
            <div class="score-value" style="font-size:36px;">100%</div>
            <div class="score-bar"><div class="score-bar-fill" style="width:100%;background:var(--brand-success);"></div></div>
          </div>
        </div>
      </div>
    ` : `
      <div class="card">
        <div class="card-title">匹配结果</div>
        <div class="friend-card" id="shareResultCard" style="cursor:pointer;">
          <div class="friend-avatar">${theirData.avatar ? `<img src="${theirData.avatar}" alt="">` : `<div class="placeholder">${(theirData.personaname || '?')[0]}</div>`}</div>
          <div class="friend-info">
            <div class="friend-name">${theirData.personaname || '未知玩家'} <span style="font-size:11px;color:var(--text-muted);font-weight:600;">点击查看详情</span></div>
            <div class="friend-meta">Top5 重合 ${sharedCount}/${TOP_N}</div>
          </div>
          <div class="friend-score-col">
            <div class="score-value" style="color:${scoreColor(parseFloat(pct))}">${pct}%</div>
            <div class="score-bar"><div class="score-bar-fill" style="width:${pct}%;background:${scoreColor(parseFloat(pct))}"></div></div>
          </div>
        </div>
        <div style="margin-top:16px;">
          <a href="https://steamcommunity.com/profiles/${theirData.steamid}" target="_blank" class="btn btn-primary btn-full" style="text-decoration:none;">前往 Steam 添加好友</a>
        </div>
      </div>
    `;
    if (!isSelf) document.getElementById('shareResultCard').addEventListener('click', showShareDetail);
  } catch (e) {
    showToast(e.message || '分析失败');
  } finally {
    btn.disabled = false;
    btn.textContent = '开始分析';
  }
}

function showContributors() {
  const existing = document.getElementById('contributorsOverlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'contributorsOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.6);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;';

  overlay.innerHTML = `
    <div style="background:#ffffff;border:3.5px solid var(--border-thick);border-radius:32px;padding:36px;max-width:580px;width:100%;max-height:80vh;display:flex;flex-direction:column;box-shadow:var(--shadow-pop);position:relative;animation:popIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) both;">
      
      <div style="position:absolute;top:-14px;right:32px;background:var(--brand-yellow);border:2.5px solid var(--border-thick);color:var(--border-thick);padding:4px 14px;border-radius:100px;font-size:11px;font-weight:950;letter-spacing:0.5px;box-shadow:2px 2px 0px var(--border-thick);transform:rotate(2deg);user-select:none;">
        THANK YOU
      </div>

      <h3 style="font-size:24px;font-weight:950;letter-spacing:-0.5px;margin-bottom:6px;color:var(--border-thick);">致谢名单</h3>
      <p style="font-size:13px;color:var(--text-dim);font-weight:700;margin-bottom:24px;display:flex;align-items:center;gap:6px;">
        <span>🤝</span> 感谢以下盒友的建议、反馈和无私支持
      </p>
      
      <div style="border:2.5px solid var(--border-thick);border-radius:18px;background:var(--surface);padding:12px 6px 12px 12px;box-sizing:border-box;max-height:420px;overflow:hidden;">
        <div id="contributorsList" style="overflow-y:auto;max-height:396px;display:flex;flex-wrap:wrap;gap:8px;padding:12px 8px 12px 12px;content-visibility:auto;">
          <div style="width:100%;text-align:center;padding:40px 20px;color:var(--text-muted);font-weight:800;font-size:14px;">
            <div style="width:24px;height:24px;border:3px solid #e2e8f0;border-top-color:var(--brand-primary);border-radius:50%;animation:spin 0.55s linear infinite;margin:0 auto 12px;"></div>
            正在读取盒友宇宙...
          </div>
        </div>
      </div>
      
      <button id="contributorsClose" type="button" style="width:100%;margin-top:24px;padding:16px;font-size:15px;font-weight:950;color:#ffffff;background:var(--border-thick);border:3px solid var(--border-thick);border-radius:16px;cursor:pointer;box-shadow:3px 3px 0px rgba(0,0,0,0.15);transition:all 0.1s cubic-bezier(0.175, 0.885, 0.32, 1);outline:none;" 
              onmouseover="this.style.transform='translate(-2px, -2px)'; this.style.boxShadow='5px 5px 0px var(--brand-primary)';" 
              onmouseout="this.style.transform='none'; this.style.boxShadow='3px 3px 0px rgba(0,0,0,0.15)';"
              onmousedown="this.style.transform='translate(3px, 3px)'; this.style.boxShadow='0px 0px 0px var(--border-thick)';">
        返回主页
      </button>
    </div>
  `;

  document.body.appendChild(overlay);

  fetch('contributors.json')
    .then(r => r.ok ? r.json() : [])
    .then(names => {
      const list = document.getElementById('contributorsList');
      if (!names.length) {
        list.innerHTML = '<div style="width:100%;text-align:center;padding:40px 20px;color:var(--text-muted);font-weight:800;font-size:14px;">🛸 宇宙深处空无一人</div>';
        return;
      }
      list.innerHTML = names.map(n => `
        <span style="font-size:12px;font-weight:800;color:var(--text);background:#ffffff;padding:6px 12px;border-radius:10px;border:2px solid var(--border-thick);box-shadow:1.5px 1.5px 0px var(--border-thick);white-space:nowrap;transition:all 0.1s ease;user-select:none;cursor:default;"
              onmouseover="this.style.transform='translate(-1px, -1px)'; this.style.boxShadow='2.5px 2.5px 0px var(--brand-secondary)'; this.style.background='#f1f5f9';"
              onmouseout="this.style.transform='none'; this.style.boxShadow='1.5px 1.5px 0px var(--border-thick)'; this.style.background='#ffffff';">
          ${n}
        </span>
      `).join('');
    })
    .catch(() => {
      const list = document.getElementById('contributorsList');
      list.innerHTML = '<div style="width:100%;text-align:center;padding:40px 20px;color:var(--danger);font-weight:800;font-size:14px;">💥 通信故障（加载失败）</div>';
    });

  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.getElementById('contributorsClose').addEventListener('click', () => overlay.remove());
}

function showShareDetail() {
  const d = window._shareMatchData;
  if (!d) return;
  const { myTop5, theirData, pct, shared } = d;
  const name = theirData.personaname || '未知玩家';
  const avatar = theirData.avatar || '';
  const theirMap = {}; (theirData.top5 || []).forEach(g => { theirMap[g.appid] = g; });
  const el = document.getElementById('shareContent');
  el.innerHTML = `
    <div class="card">
      <div class="profile-row">
        <div class="avatar">${avatar ? `<img src="${avatar}" alt="">` : `<div class="placeholder">${name[0]}</div>`}</div>
        <div>
          <div class="profile-name">${name}</div>
          <div class="match-badge">匹配 ${pct}% · Top5 重合 ${shared.length}/${TOP_N}</div>
        </div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px;">
      <div class="card">
        <div class="card-title">我的 Top5</div>
        ${myTop5.map((g, i) => {
          const h = Math.round((g.playtime_forever || 0) / 60);
          const iconUrl = g.img_icon_url ? `https://media.steampowered.com/steamcommunity/public/images/apps/${g.appid}/${g.img_icon_url}.jpg` : '';
          const has = theirMap[g.appid];
          return `<div class="game-row" style="${has ? 'border-color:var(--brand-success);' : ''}">
            ${iconUrl ? `<div class="game-icon"><img src="${iconUrl}" alt=""></div>` : `<div class="game-icon" style="display:flex;align-items:center;justify-content:center;background:var(--surface);font-size:12px;font-weight:800;color:var(--text-muted);">${i+1}</div>`}
            <span class="game-name">${g.name}</span>
            <span class="game-hours">${h}h</span>
          </div>`;
        }).join('')}
      </div>
      <div class="card">
        <div class="card-title">${name} 的 Top5</div>
        ${(theirData.top5 || []).map((g, i) => {
          const h = Math.round((g.playtime_forever || 0) / 60);
          const iconUrl = g.img_icon_url ? `https://media.steampowered.com/steamcommunity/public/images/apps/${g.appid}/${g.img_icon_url}.jpg` : '';
          const has = myTop5.some(mg => mg.appid === g.appid);
          return `<div class="game-row" style="${has ? 'border-color:var(--brand-success);' : ''}">
            ${iconUrl ? `<div class="game-icon"><img src="${iconUrl}" alt=""></div>` : `<div class="game-icon" style="display:flex;align-items:center;justify-content:center;background:var(--surface);font-size:12px;font-weight:800;color:var(--text-muted);">${i+1}</div>`}
            <span class="game-name">${g.name}</span>
            <span class="game-hours">${h}h</span>
          </div>`;
        }).join('')}
      </div>
    </div>
    <div class="card" style="text-align:center;">
      <a href="https://steamcommunity.com/profiles/${theirData.steamid}" target="_blank" class="btn btn-primary btn-full" style="text-decoration:none;margin-bottom:12px;">前往 Steam 添加好友</a>
      <button class="btn btn-ghost btn-full" onclick="initSharePage()" style="background:#fff;border:3px solid var(--border-thick);border-radius:16px;padding:14px;font-weight:900;cursor:pointer;font-size:14px;">← 重新匹配</button>
    </div>
  `;
}

