
const state = {
  playerGames: [],
  playerTopGames: [],
  friendsData: [],
  mySteamId: null, myApiKey: null,
  myProfile: null,
  strangersData: null,
  strangersError: null,
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
  // Load saved API key
  const saved = localStorage.getItem('steamApiKey');
  if (saved) document.getElementById('apiKey').value = saved;
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
      if (btn.dataset.tab === 'tab-custom') renderCustomMatch();
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
  document.getElementById('detailContent').addEventListener('click', (e) => {
    if (e.target.id === 'backBtn') {
      switchTab(state._detailSource === 'strangers' ? 'tab-strangers' : 'tab-matches');
    }
    if (e.target.id === 'shareDetailBtn') shareDetailResults();
    if (e.target.id === 'addFriendBtn') {
      const steamid = state._detailSteamId;
      if (steamid) window.open(`https://steamcommunity.com/profiles/${steamid}`, '_blank');
    }
  });
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
    state.playerGames = games;
    state.playerTopGames = getTopGames(games, TOP_N);
    showProgress(`已获取 ${games.length} 款游戏，正在分析好友...`, 40); await yieldToPaint();
    await fetchFriendMatches(steamId, apiKey);
    showProgress('正在生成报告...', 90);
    renderLibrary(); renderMatches();
    document.getElementById('tabs').style.display = 'flex';
    switchTab('tab-library');
    updateProgress(100);
    hideProgress(500);
    // auto re-opt-in if previously opted in
    if (localStorage.getItem('strangerOptIn') === 'true') {
      await callStrangerOptIn(true);
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
  const d = await apiFetch('/ISteamUser/GetFriendList/v1/', { key: apiKey, steamid: steamId, relationship: 'friend', format: 'json' });
  const friends = (d.friendslist && d.friendslist.friends) || [];
  if (friends.length === 0) { state.friendsData = []; return; }

  const friendIds = friends.map(f => f.steamid);
  const summaries = await fetchPlayerSummaries(friendIds, apiKey);
  const summaryMap = {}; (summaries || []).forEach(s => { summaryMap[s.steamid] = s; });

  const results = [];
  for (let i = 0; i < friendIds.length; i++) {
    const fid = friendIds[i];
    updateProgress(40 + Math.round((i / friendIds.length) * 45));
    showProgress(`正在分析好友 ${i+1}/${friendIds.length}: ${summaryMap[fid]?.personaname || fid}...`);
    try {
      const fg = await fetchOwnedGames(fid, apiKey);
      const shared = state.playerGames.filter(pg => fg.some(fg2 => fg2.appid === pg.appid)).length;
      const score = computeMatchScore(state.playerTopGames, fg, shared);
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

function computeMatchScore(playerTop5, friendGames, sharedCount) {
  if (!playerTop5 || !playerTop5.length || !friendGames) return 0;
  const fMap = {}; friendGames.forEach(g => { fMap[g.appid] = g; });
  let weightedSum = 0;
  let maxWeight = 0;
  let matched = 0;
  for (let i = 0; i < playerTop5.length; i++) {
    const pg = playerTop5[i];
    const w = TOP_N - i;
    maxWeight += w;
    const fg = fMap[pg.appid];
    if (!fg) continue;
    matched++;
    const pT = pg.playtime_forever || 0;
    const fT = fg.playtime_forever || 0;
    const sim = 1 - Math.abs(pT - fT) / (pT + fT + 1);
    weightedSum += w * sim;
  }
  const norm = weightedSum / maxWeight;
  const matchBonus = matched / TOP_N;
  const sharedRatio = Math.min((sharedCount || 0) / 20, 1.0);
  return Math.min((norm * 0.5 + matchBonus * 0.3 + sharedRatio * 0.2) * 1.3, 1.0);
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
    appid: pg.appid, name: pg.name, icon: pg.img_icon_url,
    playerHours: pg.playtime_forever || 0, friendHours: m[pg.appid].playtime_forever || 0,
  })).sort((a, b) => (b.playerHours + b.friendHours) - (a.playerHours + a.friendHours));
}

function renderLibrary() {
  const top5 = state.playerTopGames;
  const all = state.playerGames;
  const totalH = Math.round(all.reduce((s,g) => s+(g.playtime_forever||0), 0) / 60);
  const excluded = getExcludedSet();

  document.getElementById('libraryContent').innerHTML = `
    <div class="stats-grid">
      <div class="stat-item"><div class="stat-value">${all.length}</div><div class="stat-label">游戏总数</div></div>
      <div class="stat-item"><div class="stat-value">${totalH}</div><div class="stat-label">总时长 (h)</div></div>
      <div class="stat-item"><div class="stat-value">${top5.length}</div><div class="stat-label">已分析</div></div>
    </div>
    <div class="card">
      <div class="card-title">
        <span>我的 Top ${TOP_N}</span>
        <span id="toggleExcludeMode" style="margin-left:auto;font-size:12px;cursor:pointer;color:var(--text-muted);text-decoration:underline dotted;">排除游戏</span>
      </div>
      ${top5.length ? top5.map((g, i) => {
        const h = Math.round((g.playtime_forever||0)/60);
        const iconUrl = g.img_icon_url ? `https://media.steampowered.com/steamcommunity/public/images/apps/${g.appid}/${g.img_icon_url}.jpg` : '';
        const exc = excluded.has(g.appid);
        return `<div class="game-row" style="${exc ? 'opacity:0.4;' : ''}">
          ${iconUrl ? `<div class="game-icon"><img src="${iconUrl}" class="lib-icon" alt=""></div>` : `<div class="game-icon" style="background:var(--surface);display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:12px;font-weight:800;">?</div>`}
          <span style="width:18px;font-size:12px;color:var(--text-muted);font-weight:600;text-align:center;">${i+1}</span>
          <span class="game-name" style="${exc ? 'text-decoration:line-through;' : ''}">${g.name}</span>
          <span style="color:var(--brand-primary);font-weight:600;font-size:13px;">${h}h</span>
          <span class="exclude-btn" data-appid="${g.appid}" style="margin-left:8px;cursor:pointer;font-size:14px;font-weight:800;color:${exc ? 'var(--text-muted)' : 'var(--text-muted)'};">${exc ? '取消排除' : '排除'}</span>
        </div>`;
      }).join('') : '<div style="color:var(--text-dim);padding:20px;text-align:center;">暂无游戏数据</div>'}
    </div>
    <div class="card"><div class="card-title">全部游戏 (${all.length})</div><div style="display:flex;flex-wrap:wrap;gap:4px;">${sortedGameChips(all, excluded).join('')}</div></div>
  `;
  document.querySelectorAll('img.lib-icon').forEach(img => {
    img.addEventListener('error', () => { img.style.display = 'none'; });
  });
  document.querySelectorAll('.exclude-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      toggleExcluded(+btn.dataset.appid);
      state.playerTopGames = getTopGames(state.playerGames, TOP_N);
      renderLibrary();
      renderMatches();
      switchTab('tab-library');
    });
  });
  document.querySelectorAll('.game-chip').forEach(el => {
    el.addEventListener('click', () => {
      toggleExcluded(+el.dataset.appid);
      state.playerTopGames = getTopGames(state.playerGames, TOP_N);
      renderLibrary();
      renderMatches();
      switchTab('tab-library');
    });
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
      <button class="btn btn-share" id="shareDetailBtn" style="font-size:13px;padding:8px 16px;">分享</button>
      <button class="btn btn-ghost" id="backBtn">← 返回</button>
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
  document.getElementById(tabId)?.classList.add('active');
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
  else if (msg.includes('不可用')) extra = '';
  else extra = '<p style="margin-top:8px;font-size:13px;">请检查 Steam ID 和 API 密钥是否正确</p>';
  document.getElementById('detailContent').innerHTML = `<div class="error">${msg}${extra}</div>`;
  switchTab('tab-detail');
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
}

async function callStrangerOptIn(optIn) {
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
        opt_in: optIn,
      }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error || `HTTP ${res.status}`);
    }
    showToast(optIn ? '已开放陌生人匹配' : '已关闭陌生人匹配');
  } catch (err) {
    showToast('陌生人匹配暂时不可用');
    console.warn('Stranger opt-in failed:', err);
  }
}

async function loadStrangers() {
  const el = document.getElementById('strangersContent');
  if (!state.mySteamId) {
    el.innerHTML = `<div class="empty"><p>请先完成扫描</p></div>`;
    return;
  }
  el.innerHTML = `<div class="loading"><div class="spinner"></div><p>正在寻找陌生玩伴...</p></div>`;
  try {
    const res = await fetch(`${STRANGER_API_BASE}/api/strangers?steamid=${encodeURIComponent(state.mySteamId)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.strangersData = data || [];
    state.strangersError = null;
  } catch (err) {
    state.strangersData = null;
    state.strangersError = err.message || '网络错误';
    console.warn('Load strangers failed:', err);
  }
  renderStrangers();
}

function renderStrangers() {
  const el = document.getElementById('strangersContent');
  const optIn = localStorage.getItem('strangerOptIn') === 'true';
  const strangers = state.strangersData;
  const myTop5 = state.playerTopGames;
  let content = '';
  if (state.strangersError) {
    content = `<div class="card"><div class="card-title">陌生人匹配</div><div class="error">陌生人匹配暂时不可用</div></div>`;
  } else if (!strangers || !strangers.length) {
    content = `<div class="empty"><p>暂无其他玩家开启陌生人匹配</p></div>`;
  } else {
    const scored = strangers.map(s => ({
      ...s,
      score: computeStrangerMatchScore(myTop5, s.top5 || []),
    })).sort((a, b) => b.score - a.score);
    content = `
      <div class="stats-grid">
        <div class="stat-item"><div class="stat-value">${scored.length}</div><div class="stat-label">陌生玩伴</div></div>
        <div class="stat-item"><div class="stat-value">${scored.filter(x => x.score > 0.3).length}</div><div class="stat-label">高度匹配</div></div>
        <div class="stat-item"><div class="stat-value" style="color:var(--brand-purple);">${(scored[0].score * 100).toFixed(1)}%</div><div class="stat-label">最佳匹配</div></div>
      </div>
      <div class="card"><div class="card-title">陌生玩伴 <span class="stranger-badge">陌生人</span></div><div class="friend-list">${scored.map((s, i) => renderStrangerCard(s, i)).join('')}</div></div>
    `;
  }
  el.innerHTML = `
    <div class="card" id="strangerOptInCard">
      <div class="card-title" style="font-size:16px;">对陌生人开放匹配</div>
      <div class="stranger-toggle-row">
        <div class="stranger-toggle-desc">开启后，其他使用本工具的用户将能看到你的 Top5 游戏数据并计算匹配度。你的 Steam ID 和个人资料仅用于展示。</div>
        <label class="switch">
          <input type="checkbox" id="strangerToggle" ${optIn ? 'checked' : ''}>
          <span class="switch-slider"></span>
        </label>
      </div>
    </div>
    ${content}
  `;
  const toggle = document.getElementById('strangerToggle');
  if (toggle) {
    toggle.addEventListener('change', async (e) => {
      const on = e.target.checked;
      localStorage.setItem('strangerOptIn', on ? 'true' : 'false');
      await callStrangerOptIn(on);
    });
  }
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
      <div class="friend-name">${name} <span class="stranger-badge">陌生人</span></div>
      <div class="friend-meta" style="margin-top:2px;">Top5 游戏 ${(person.top5 || []).length} 款</div>
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
  const pct = computeStrangerMatchScore(myTop5, sTop5);
  const pctStr = (pct * 100).toFixed(1);
  const dc = document.getElementById('detailContent');
  dc.innerHTML = `
    <div class="detail-header">
      <div class="detail-avatar">${avatar ? `<img src="${avatar}" alt="">` : `<div class="placeholder">${name[0]}</div>`}</div>
      <div class="detail-info">
        <h2>${name}</h2>
        <div class="match-badge">${pctStr}% 匹配 · Top5 重合 ${matchCount}/${TOP_N}</div>
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
    <div class="card" style="text-align:center;">
      <p style="font-size:14px;color:var(--text-dim);margin-bottom:16px;font-weight:600;">点击下方按钮前往 Steam 添加好友</p>
      <a href="https://steamcommunity.com/profiles/${steamid}" target="_blank" class="btn btn-primary" style="text-decoration:none;display:inline-flex;">前往 Steam 添加好友</a>
    </div>
  `;
}

function computeStrangerMatchScore(myTop5, strangerTop5) {
  if (!myTop5 || !myTop5.length || !strangerTop5 || !strangerTop5.length) return 0;
  const sMap = {};
  strangerTop5.forEach(g => { sMap[g.appid] = g; });
  let weightedSum = 0, maxWeight = 0, matched = 0;
  for (let i = 0; i < myTop5.length; i++) {
    const pg = myTop5[i];
    const w = TOP_N - i;
    maxWeight += w;
    const sg = sMap[pg.appid];
    if (!sg) continue;
    matched++;
    const pT = pg.playtime_forever || 0;
    const sT = sg.playtime_forever || 0;
    weightedSum += w * (1 - Math.abs(pT - sT) / (pT + sT + 1));
  }
  return Math.min(((weightedSum / maxWeight) * 0.6 + (matched / TOP_N) * 0.4) * 1.3, 1.0);
}

function renderCustomMatch() {
  const el = document.getElementById('customContent');
  const games = state.playerGames;
  if (!games || !games.length) {
    el.innerHTML = `<div class="empty"><p>请先完成扫描</p></div>`;
    return;
  }
  const mySteamId = state.mySteamId;
  el.innerHTML = `
    <div class="card">
      <div class="card-title">自定义匹配</div>
      <div class="custom-form">
        <label>
          选择游戏
          <select id="customGameSelect">
            ${games.filter(g => (g.playtime_forever || 0) > 0).sort((a, b) => (b.playtime_forever || 0) - (a.playtime_forever || 0)).map(g => {
              const h = Math.round((g.playtime_forever || 0) / 60);
              const excluded = isExcluded(g.appid);
              return `<option value="${g.appid}" ${excluded ? 'disabled style="color:var(--text-muted);"' : ''}>${g.name} (${h}h)${excluded ? ' [已排除]' : ''}</option>`;
            }).join('')}
          </select>
        </label>
        <label>
          最低时长（小时）
          <input type="number" id="customMinHours" value="1" min="0" step="1">
        </label>
        <label style="flex-direction:row;align-items:center;gap:12px;">
          <span>匹配范围</span>
          <span class="radio-group">
            <label><input type="radio" name="customTarget" value="friends" checked> 好友</label>
            <label><input type="radio" name="customTarget" value="strangers"> 陌生人</label>
            <label><input type="radio" name="customTarget" value="all"> 全部</label>
          </span>
        </label>
        <button class="btn btn-primary" id="runCustomMatchBtn">开始匹配</button>
      </div>
    </div>
    <div id="customResults"></div>
  `;
  document.getElementById('runCustomMatchBtn').addEventListener('click', runCustomMatch);
}

function runCustomMatch() {
  const appid = parseInt(document.getElementById('customGameSelect').value);
  const minHours = parseFloat(document.getElementById('customMinHours').value) || 0;
  const target = document.querySelector('input[name="customTarget"]:checked').value;
  const myGame = state.playerGames.find(g => g.appid === appid);
  if (!myGame) { showToast('未找到该游戏'); return; }
  const myHours = (myGame.playtime_forever || 0) / 60;
  const results = [];

  if (target === 'friends' || target === 'all') {
    for (const f of state.friendsData) {
      const fg = (f.games || []).find(g => g.appid === appid);
      if (!fg) continue;
      const fHours = (fg.playtime_forever || 0) / 60;
      if (fHours < minHours) continue;
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
      results.push({
        steamid: s.steamid, name: s.personaname || s.steamid,
        avatar: s.avatar || '', hours: sHours,
        diff: Math.abs(myHours - sHours), source: '陌生人',
      });
    }
  }

  results.sort((a, b) => a.diff - b.diff);

  const resEl = document.getElementById('customResults');
  if (!results.length) {
    resEl.innerHTML = `<div class="empty"><p>未找到符合条件的玩家</p></div>`;
    return;
  }
  resEl.innerHTML = `
    <div class="stats-grid">
      <div class="stat-item"><div class="stat-value">${results.length}</div><div class="stat-label">匹配结果</div></div>
      <div class="stat-item"><div class="stat-value" style="font-size:16px;">${myGame.name}</div><div class="stat-label">我: ${myHours.toFixed(1)}h</div></div>
      <div class="stat-item"><div class="stat-value" style="color:var(--brand-secondary);">${results[0].hours.toFixed(1)}h</div><div class="stat-label">最接近: ${results[0].name}</div></div>
    </div>
    <div class="card"><div class="card-title">自定义匹配结果</div><div class="friend-list">${results.map((r, i) => `
      <div class="friend-card" style="animation-delay:${i * 0.04}s;">
        <div class="friend-avatar">${r.avatar ? `<img src="${r.avatar}" alt="">` : `<div class="placeholder">${r.name[0]}</div>`}</div>
        <div class="friend-info">
          <div class="friend-name">${r.name} <span class="stranger-badge" style="background:${r.source === '好友' ? 'var(--brand-primary)' : 'var(--brand-purple)'};">${r.source}</span></div>
          <div class="friend-meta" style="margin-top:2px;">${r.source} · ${r.hours.toFixed(1)}h</div>
        </div>
        <div class="friend-score-col">
          <div class="score-value" style="color:var(--brand-secondary);font-size:20px;">${r.hours.toFixed(1)}h</div>
          <div style="font-size:11px;color:var(--text-dim);margin-top:4px;font-weight:600;">相差 ${(Math.abs(myHours - r.hours)).toFixed(1)}h</div>
        </div>
      </div>`).join('')}</div></div>
  `;
}
