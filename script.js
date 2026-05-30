
const state = {
  playerGames: [],
  playerTopGames: [],
  friendsData: [],
  mySteamId: null, myApiKey: null,
};

const TOP_N = 5;

const PROXY_BASE = 'https://api.steam.i-test.top';

function proxyUrl(url) {
  return PROXY_BASE ? `${PROXY_BASE}?url=${encodeURIComponent(url)}` : url;
}

function steamApiUrl(endpoint, params) {
  const qs = Object.entries(params).map(([k,v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return proxyUrl(`https://api.steampowered.com${endpoint}?${qs}`);
}

const apiCache = new Map();
const CACHE_TTL = 10 * 60 * 1000;

async function apiFetch(endpoint, params) {
  const url = steamApiUrl(endpoint, params);
  const cached = apiCache.get(url);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;
  const res = await fetch(url);
  if (!res.ok) {
    let detail = '';
    try { const e = await res.json(); detail = e.error || ''; } catch(e) {}
    if (res.status === 403) throw new Error('Steam API 请求失败 (403) — 内置密钥可能已失效，请联系作者更新');
    throw new Error(`Steam API 请求失败 (${res.status})${detail ? ': ' + detail : ''}`);
  }
  const data = await res.json();
  apiCache.set(url, { data, ts: Date.now() });
  return data;
}

document.addEventListener('DOMContentLoaded', () => {
  // Clear any previously saved default
  if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.local.remove('steamId');
  }
  // event listeners
  document.getElementById('fetchBtn').addEventListener('click', startFetch);
  document.getElementById('tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab-btn');
    if (btn) switchTab(btn.dataset.tab);
  });
  document.getElementById('matchesContent').addEventListener('click', (e) => {
    const card = e.target.closest('.friend-card');
    if (card) showPersonDetail(card.dataset.steamid);
  });
  document.getElementById('detailContent').addEventListener('click', (e) => {
    if (e.target.id === 'backBtn') switchTab('tab-matches');
    if (e.target.id === 'shareDetailBtn') shareDetailResults();
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
  const apiKey = document.getElementById('apiKey').value.trim();
  if (!apiKey) { showError('请先填写下方的 Steam API 密钥'); return; }
  fetchBtn.disabled = true;
  showProgress('正在获取游戏数据...', 10); await yieldToPaint();

  try {
    const steamId = await resolveSteamId(steamInput, apiKey);
    state.mySteamId = steamId; state.myApiKey = apiKey;
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
  return [...games].filter(g => (g.playtime_forever || 0) > 0)
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

async function loadIcon(appid, iconUrl) {
  if (!iconUrl) return null;
  const url = `https://media.steampowered.com/steamcommunity/public/images/apps/${appid}/${iconUrl}.jpg`;
  try {
    const res = await fetch(proxyUrl(url));
    if (!res.ok) return null;
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => { resolve(img); URL.revokeObjectURL(blobUrl); };
      img.onerror = () => { resolve(null); URL.revokeObjectURL(blobUrl); };
      img.src = blobUrl;
    });
  } catch {
    return null;
  }
}

const FONT = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const RANK_COLORS = ['#fbc531', '#94a3b8', '#cd7f32'];
const ICON_COLORS = ['#ff5e62', '#3b82f6', '#10b981', '#8c7ae6', '#fbc531'];

function drawRoundRect(ctx, x, y, w, h, r, fill, stroke, lw) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 2; ctx.stroke(); }
}

function drawGameIcon(ctx, x, y, size, icon, letter) {
  const cx = x + size/2, cy = y + size/2;
  ctx.save();
  ctx.beginPath(); ctx.roundRect(x, y, size, size, 6); ctx.clip();
  if (icon) {
    try { ctx.drawImage(icon, x, y, size, size); } catch(e) { icon = null; }
  }
  if (!icon) {
    const ci = (letter.charCodeAt(0) || 0) % ICON_COLORS.length;
    ctx.fillStyle = ICON_COLORS[ci]; ctx.fillRect(x, y, size, size);
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 ${Math.round(size*0.45)}px ${FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(letter.toUpperCase(), cx, cy+1);
  }
  ctx.restore();
  ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.roundRect(x, y, size, size, 6); ctx.stroke();
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

  document.getElementById('libraryContent').innerHTML = `
    <div class="stats-grid">
      <div class="stat-item"><div class="stat-value">${all.length}</div><div class="stat-label">游戏总数</div></div>
      <div class="stat-item"><div class="stat-value">${totalH}</div><div class="stat-label">总时长 (h)</div></div>
      <div class="stat-item"><div class="stat-value">${top5.length}</div><div class="stat-label">已分析</div></div>
    </div>
    <div class="card">
      <div class="card-title">我的 Top ${TOP_N}</div>
      ${top5.length ? top5.map((g, i) => {
        const h = Math.round((g.playtime_forever||0)/60);
        const iconUrl = g.img_icon_url ? `https://media.steampowered.com/steamcommunity/public/images/apps/${g.appid}/${g.img_icon_url}.jpg` : '';
        return `<div class="game-row">
          ${iconUrl ? `<div class="game-icon"><img src="${iconUrl}" class="lib-icon" alt=""></div>` : `<div class="game-icon" style="background:var(--surface);display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:12px;font-weight:800;">?</div>`}
          <span style="width:18px;font-size:12px;color:var(--text-muted);font-weight:600;text-align:center;">${i+1}</span>
          <span class="game-name">${g.name}</span>
          <span style="color:var(--brand-primary);font-weight:600;font-size:13px;">${h}h</span>
        </div>`;
      }).join('') : '<div style="color:var(--text-dim);padding:20px;text-align:center;">暂无游戏数据</div>'}
    </div>
    <div class="card"><div class="card-title">全部游戏 (${all.length})</div><div style="display:flex;flex-wrap:wrap;gap:4px;">${sortedGameChips(all).join('')}</div></div>
  `;
  document.querySelectorAll('img.lib-icon').forEach(img => {
    img.addEventListener('error', () => { img.style.display = 'none'; });
  });
}

function sortedGameChips(games) {
  return [...games].sort((a,b)=>(b.playtime_forever||0)-(a.playtime_forever||0)).map(g => {
    const h = Math.round((g.playtime_forever||0)/60);
    return `<span style="display:inline-block;background:var(--surface);padding:4px 10px;border-radius:6px;font-size:11px;border:2px solid var(--border-thick);margin:2px;">${g.name} <span style="color:var(--text-muted);">${h}h</span></span>`;
  });
}

function renderMatches() {
  const el = document.getElementById('matchesContent');
  const f = state.friendsData;
  if (!f.length) { el.innerHTML = `<div class="empty"><p>暂无好友数据</p></div>`; return; }
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
  document.getElementById('detailContent').innerHTML = `<div class="error">${msg}<p>请检查 Steam ID 是否正确</p></div>`;
  switchTab('tab-detail');
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
}
