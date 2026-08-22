let currentUser = null;
let roomId = new URLSearchParams(location.search).get('room');
let loginState = new URLSearchParams(location.search).get('login');

// 本机 Steam 联动状态
let localSteam = null;                 // Native Host 返回的本机状态
let autoFilter = true;                 // 是否允许按当前游戏自动筛选
let currentFilterAppId = null;          // 当前大厅筛选的 appid
let lastAutoFilterAppId = null;         // 上一次自动筛选的 appid（避免重复触发）
let presenceData = [];                  // 在线玩家列表
let presenceOptIn = localStorage.getItem('presenceOptIn') === 'true';
let lobbyTimer = null;
let presenceRefreshTimer = null;
let heartbeatTimer = null;

const LOBBY_REFRESH_MS = 90 * 1000;    // 大厅 90 秒
const PRESENCE_REFRESH_MS = 180 * 1000; // 在线状态 180 秒
const HEARTBEAT_MS = 180 * 1000;        // 心跳 180 秒（与 5 分钟在线判定匹配）

window.addEventListener('DOMContentLoaded', async () => {
  await loadBootstrap();
  initServiceWorker();
  initLocalSteamBridge();
  updatePresenceButton();
  initAutoRefresh();
  if (presenceOptIn && currentUser) sendPresenceHeartbeat();
  if (roomId) openRoomDetail(roomId);
  if (loginState === 'success') toast('Steam 登录成功！');
  if (loginState === 'failed') toast('登录失败：无法完成 Steam 身份校验，请重试');
  history.replaceState(null, '', location.pathname);
});

async function loadBootstrap() {
  try {
    const res = await fetch('/api/bootstrap');
    const data = await res.json();
    if (data.me && data.me.loggedIn) {
      currentUser = data.me.user;
    }
    updateAuthSection();
    if (Array.isArray(data.lobby)) renderLobbies(data.lobby, true);
    if (Array.isArray(data.presence)) {
      presenceData = data.presence;
      renderOnlineSection();
    }
  } catch (e) {
    console.error('bootstrap failed:', e);
    // 兜底：按原接口逐个拉取
    await checkLogin();
    await fetchLobbies(true);
    await fetchPresence();
  }
}

function initAutoRefresh() {
  // 只在页面可见时轮询；切到后台立即停止，回到前台立即刷新并恢复
  function startTimers() {
    stopTimers();
    lobbyTimer = setInterval(() => { fetchLobbies(true); }, LOBBY_REFRESH_MS);
    presenceRefreshTimer = setInterval(() => { fetchPresence(); }, PRESENCE_REFRESH_MS);
    if (presenceOptIn && currentUser) {
      heartbeatTimer = setInterval(sendPresenceHeartbeat, HEARTBEAT_MS);
    }
  }

  function stopTimers() {
    if (lobbyTimer) clearInterval(lobbyTimer);
    if (presenceRefreshTimer) clearInterval(presenceRefreshTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    lobbyTimer = null;
    presenceRefreshTimer = null;
    heartbeatTimer = null;
  }

  startTimers();

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopTimers();
    } else {
      fetchLobbies(true);
      fetchPresence();
      if (presenceOptIn && currentUser) sendPresenceHeartbeat();
      startTimers();
    }
  });
}

async function checkLogin() {
  const res = await fetch('/api/me');
  const data = await res.json();
  currentUser = data.loggedIn ? data.user : null;
  updateAuthSection();
}

function updateAuthSection() {
  const el = document.getElementById('auth-section');
  if (!el) return;

  const local = !!(localSteam && localSteam.ok);
  const localRunning = local && localSteam.runningAppId > 0;
  const localName = local ? (localSteam.activePersonaName || localSteam.activeSteamId) : '';
  const localGame = localRunning ? (localSteam.runningGameName || ('AppID ' + localSteam.runningAppId)) : '';

  if (currentUser) {
    const localMatch = local && localSteam.activeSteamId === currentUser.steamId;
    const subText = localMatch
      ? (localRunning ? '本机游戏中' : '本机在线')
      : (localName ? `本机账号：${localName}` : '未检测到本机 Steam');
    el.innerHTML = `
      <div class="user-status-pill" title="${localMatch ? '本机 Steam 与登录账号一致' : '本机 Steam 与登录账号不一致'}">
        ${currentUser.avatar ? `<img src="${escapeHtml(currentUser.avatar)}" alt="">` : ''}
        <div class="usp-info">
          <span class="name">${escapeHtml(currentUser.nickname || currentUser.steamId)}</span>
          <span class="sub">${escapeHtml(subText)}</span>
        </div>
        ${localMatch ? `<span class="status-dot ${localRunning ? '' : 'off'}"></span>` : ''}
        ${localRunning ? `<span class="game-tag">${escapeHtml(localGame)}</span>` : ''}
        <a href="/auth/logout" class="logout">退出</a>
      </div>`;
    return;
  }

  if (localName) {
    el.innerHTML = `
      <div class="auth-login-group">
        <a href="/auth/login" class="btn btn-primary">以 ${escapeHtml(localName)} 登录 Steam</a>
        ${localRunning ? `<span class="game-tag">${escapeHtml(localGame)}</span>` : ''}
      </div>`;
    return;
  }

  el.innerHTML = `<a href="/auth/login" class="btn btn-primary">Steam 官方登录</a>`;
}

async function fetchLobbies(silent = false) {
  const btn = document.getElementById('refresh-btn');
  if (!silent && btn) {
    btn.disabled = true;
    btn.textContent = '刷新中…';
  }

  const qs = currentFilterAppId ? `?appid=${encodeURIComponent(currentFilterAppId)}` : '';
  let lobbies;
  try {
    const res = await fetch(`/api/lobby${qs}`);
    lobbies = await res.json();
  } catch (e) {
    console.error('fetchLobbies failed:', e);
    if (!silent && btn) {
      btn.disabled = false;
      btn.textContent = '刷新大厅';
    }
    if (!silent) toast('大厅刷新失败：请确认开发服务器已启动，或检查 F12 网络请求');
    return;
  }

  if (!silent && btn) {
    btn.disabled = false;
    btn.textContent = '刷新大厅';
  }

  if (!Array.isArray(lobbies)) {
    if (!silent) toast('大厅数据格式错误，请稍后重试');
    return;
  }

  renderLobbies(lobbies, silent);
}

function renderLobbies(lobbies, silent = false) {
  const container = document.getElementById('lobby-list');
  if (!container) return;

  if (lobbies.length === 0) {
    container.innerHTML = currentFilterAppId
      ? `<div class="empty" style="grid-column:1/-1;"><p>当前游戏暂无招募车队，去发一个？</p><button class="btn btn-primary" style="margin-top:14px;" onclick="openCreateModal()">为当前游戏发车</button></div>`
      : `<div class="empty" style="grid-column:1/-1;"><p>当前暂无正在招募的车队，快去发起一个吧！</p></div>`;
    if (!silent) toast('已刷新：当前暂无车队');
    return;
  }

  container.innerHTML = lobbies.map(l => {
    const full = l.players.length >= l.maxPlayers;
    return `
    <div class="lobby-card" onclick="openRoomDetail('${l.id}')">
      <div class="lobby-card-head">
        <h4 class="lobby-game">${escapeHtml(l.gameName)}</h4>
        <span class="lobby-count ${full ? 'full' : 'open'}">${l.players.length} / ${l.maxPlayers} 人</span>
      </div>
      <div class="lobby-time">发车时间：${escapeHtml(l.playTime || '立刻')}</div>
      <div class="lobby-tags">
        ${l.requireApproval ? `<span class="lobby-tag">需房主同意</span>` : ''}
        ${(l.tags || []).map(t => `<span class="lobby-tag">${escapeHtml(t)}</span>`).join('')}
      </div>
      <div class="lobby-foot">
        <div class="lobby-host">
          ${l.host.avatar ? `<img src="${escapeHtml(l.host.avatar)}" alt="">` : ''}
          <span class="host-name">${escapeHtml(l.host.nickname || l.host.steamId)} <span class="host-label">(房主)</span></span>
        </div>
        <span class="btn btn-primary" style="padding:8px 18px;font-size:13px;">上车</span>
      </div>
    </div>`;
  }).join('');

  if (!silent) toast(`已刷新：${lobbies.length} 个车队`);
}

async function submitCreate() {
  if (!currentUser) return alert('请先登录 Steam！');
  const gameName = document.getElementById('create-game').value.trim();
  if (!gameName) return alert('请填写游戏名称');

  // 只有游戏名和本机正在运行的游戏一致时才附带 appid，避免张冠李戴
  const running = localSteam && localSteam.ok && localSteam.runningAppId > 0;
  const appid = running && localSteam.runningGameName && gameName === localSteam.runningGameName
    ? String(localSteam.runningAppId)
    : '';

  const body = {
    action: 'create',
    gameName,
    appid,
    maxPlayers: document.getElementById('create-max-players').value,
    playTime: document.getElementById('create-time').value.trim(),
    roomCode: document.getElementById('create-code').value.trim(),
    voiceUrl: document.getElementById('create-voice').value.trim(),
    requireApproval: document.getElementById('create-require-approval').checked,
  };

  const res = await fetch('/api/lobby', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.error) return alert(data.error);

  closeModal('create-modal');
  document.getElementById('create-game').value = '';
  await fetchLobbies();
  openRoomDetail(data.id);
}

async function openRoomDetail(id) {
  const res = await fetch(`/api/lobby?id=${id}`);
  const lobby = await res.json();
  if (lobby.error) { alert(lobby.error); await fetchLobbies(); return; }

  const isHost = currentUser && lobby.host.steamId === currentUser.steamId;
  const isJoined = currentUser && lobby.players.some(p => p.steamId === currentUser.steamId);
  const isPending = currentUser && (lobby.pending || []).some(p => p.steamId === currentUser.steamId);
  const full = lobby.players.length >= lobby.maxPlayers;

  const pendingHtml = (isHost && lobby.pending && lobby.pending.length > 0) ? `
    <div class="section-title">入队申请 (${lobby.pending.length})</div>
    <div class="member-list">
      ${lobby.pending.map(p => `
        <div class="member-item">
          ${p.avatar ? `<img src="${escapeHtml(p.avatar)}" alt="">` : ''}
          <span class="m-name">${escapeHtml(p.nickname || p.steamId)}</span>
          <div class="member-actions">
            <button onclick="approveJoin('${lobby.id}','${p.steamId}')" class="btn-tiny">同意</button>
            <button onclick="rejectJoin('${lobby.id}','${p.steamId}')" class="btn-tiny danger">拒绝</button>
          </div>
        </div>`).join('')}
    </div>` : '';

  const joinAction = isHost ? `
    <button onclick="closeLobby('${lobby.id}')" class="btn btn-ghost">解散车队</button>
  ` : isJoined ? `
    <button onclick="leaveLobby('${lobby.id}')" class="btn btn-ghost">退出车队</button>
  ` : full ? `
    <div class="status-pill full">车队已满员</div>
  ` : isPending ? `
    <div class="status-pill joined">已申请，等待房主同意</div>
    <button onclick="cancelJoinRequest('${lobby.id}')" class="btn btn-ghost">取消申请</button>
  ` : `
    <button onclick="joinLobby('${lobby.id}')" class="btn btn-primary">${lobby.requireApproval ? '申请加入' : '立即上车'}</button>
  `;

  const detailBox = document.getElementById('room-detail');
  detailBox.innerHTML = `
    <div class="room-head">
      <div>
        <div class="room-title">${escapeHtml(lobby.gameName)} 车队</div>
        <div class="room-meta">发车时间：${escapeHtml(lobby.playTime || '立刻')} · 房码 ${lobby.id}${lobby.requireApproval ? ' · 需房主同意' : ''}</div>
      </div>
      <button onclick="closeModal('room-modal')" class="room-close">✕</button>
    </div>

    <div class="board">
      <div class="board-row">
        <span class="k">联机代码 / IP / 游戏id</span>
        <span>
          <code>${lobby.roomCode ? escapeHtml(lobby.roomCode) : '房主未填写/进语音告知'}</code>
          ${lobby.roomCode ? `<button data-code="${escapeHtml(lobby.roomCode)}" onclick="copyRoomCode(this)" class="btn-tiny" style="margin-left:8px;">复制</button>` : ''}
        </span>
      </div>
      <div class="board-row">
        <span class="k">开黑语音</span>
        <span>${voiceLink(lobby.voiceUrl)}</span>
      </div>
    </div>

    <div class="section-title">车队成员 (${lobby.players.length}/${lobby.maxPlayers})</div>
    <div class="member-list">
      ${lobby.players.map(p => `
        <div class="member-item">
          ${p.avatar ? `<img src="${escapeHtml(p.avatar)}" alt="">` : ''}
          <span class="m-name">${escapeHtml(p.nickname || p.steamId)}${p.steamId === lobby.host.steamId ? ' (房主)' : ''}</span>
          <div class="member-actions">
            ${isHost && p.steamId !== currentUser.steamId ? `<button onclick="kickPlayer('${lobby.id}','${p.steamId}')" class="btn-tiny danger">移除</button>` : ''}
            <a href="https://steamcommunity.com/profiles/${p.steamId}" target="_blank" class="btn-tiny">加好友</a>
          </div>
        </div>`).join('')}
    </div>

    ${pendingHtml}

    <div class="room-actions">${joinAction}</div>
  `;

  showModal('room-modal');
}

async function joinLobby(id) {
  const res = await postLobby({ action: 'join', id });
  if (res.error) return alert(res.error);
  if (res.requested) toast('已申请加入，等待房主同意');
  await fetchLobbies();
  openRoomDetail(id);
}

async function leaveLobby(id) {
  const res = await postLobby({ action: 'leave', id });
  if (res.error) return alert(res.error);
  await fetchLobbies();
  openRoomDetail(id);
}

async function closeLobby(id) {
  if (!confirm('确认解散这个车队？')) return;
  const res = await postLobby({ action: 'close', id });
  if (res.error) return alert(res.error);
  closeModal('room-modal');
  await fetchLobbies();
}

async function kickPlayer(id, targetSteamId) {
  const res = await postLobby({ action: 'kick', id, targetSteamId });
  if (res.error) return alert(res.error);
  openRoomDetail(id);
}

async function approveJoin(id, targetSteamId) {
  const res = await postLobby({ action: 'approve', id, targetSteamId });
  if (res.error) return alert(res.error);
  await fetchLobbies(true);
  openRoomDetail(id);
}

async function rejectJoin(id, targetSteamId) {
  const res = await postLobby({ action: 'reject', id, targetSteamId });
  if (res.error) return alert(res.error);
  openRoomDetail(id);
}

async function cancelJoinRequest(id) {
  const res = await postLobby({ action: 'cancel_join', id });
  if (res.error) return alert(res.error);
  toast('已取消入队申请');
  await fetchLobbies(true);
  openRoomDetail(id);
}

async function postLobby(body) {
  const res = await fetch('/api/lobby', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

function copyRoomCode(btn) {
  navigator.clipboard.writeText(btn.dataset.code).then(() => alert('已复制房间代码！')).catch(() => {});
}

function voiceLink(voiceUrl) {
  if (/^https?:\/\//i.test(voiceUrl || '')) {
    return `<a href="${escapeHtml(voiceUrl)}" target="_blank" rel="noopener noreferrer">点击直达语音频道</a>`;
  }
  if (voiceUrl) return `<span style="color:var(--text-dim)">${escapeHtml(voiceUrl)}</span>`;
  return '<span style="color:var(--text-muted)">未设置</span>';
}

async function smartMatch() {
  const btn = document.getElementById('smart-match-btn');
  if (!currentUser) return alert('请先登录 Steam 后再使用智能匹配');
  if (!localSteam || !localSteam.ok || !(localSteam.runningAppId > 0)) {
    return alert('请先启动一个 Steam 游戏，再使用智能匹配');
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = '匹配中…';
  }

  const appid = String(localSteam.runningAppId);
  const gameName = localSteam.runningGameName || ('AppID ' + appid);

  try {
    const [lobbyRes, presenceRes] = await Promise.all([
      fetch(`/api/lobby?appid=${encodeURIComponent(appid)}`),
      fetch(`/api/presence?appid=${encodeURIComponent(appid)}`),
    ]);
    const lobbies = await lobbyRes.json();
    const players = await presenceRes.json();
    renderMatchResult(gameName, appid, Array.isArray(lobbies) ? lobbies : [], Array.isArray(players) ? players : []);
    showModal('match-modal');
  } catch (e) {
    console.error('smartMatch failed:', e);
    alert('智能匹配失败：请检查网络或稍后重试');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '智能匹配';
    }
  }
}

function renderMatchResult(gameName, appid, lobbies, players) {
  const sub = document.getElementById('match-sub');
  if (sub) sub.textContent = `当前游戏：${gameName}（AppID ${appid}）`;

  const el = document.getElementById('match-result');
  if (!el) return;

  let html = '';

  html += `<div class="section-title">可加入的车队（${lobbies.length}）</div>`;
  if (lobbies.length === 0) {
    html += `<div class="online-empty">当前没有正在招募的车队</div>`;
  } else {
    html += `<div class="member-list">` + lobbies.map(l => {
      const full = l.players.length >= l.maxPlayers;
      return `
        <div class="member-item">
          <div class="usp-info" style="flex:1;min-width:0;">
            <span class="name">${escapeHtml(l.gameName)}</span>
            <span class="sub">${escapeHtml(l.host.nickname || l.host.steamId)} · ${l.players.length}/${l.maxPlayers} 人 · ${escapeHtml(l.playTime || '立刻')}</span>
          </div>
          ${full
            ? '<span class="status-pill full" style="width:auto;padding:6px 12px;">已满</span>'
            : `<button class="btn-tiny" onclick="joinLobbyFromMatch('${l.id}')">加入</button>`}
        </div>`;
    }).join('') + `</div>`;
  }

  html += `<div class="section-title">正在玩同款游戏的玩家（${players.length}）</div>`;
  if (players.length === 0) {
    html += `<div class="online-empty">暂无在线玩家</div>`;
  } else {
    html += `<div class="online-list">` + players.map(p => `
      <span class="online-chip">
        ${p.avatar ? `<img src="${escapeHtml(p.avatar)}" alt="">` : ''}
        <span class="chip-name">${escapeHtml(p.nickname || p.steamId)}</span>
        <a href="https://steamcommunity.com/profiles/${escapeHtml(p.steamId)}" target="_blank" class="btn-tiny" title="Steam 加好友">加好友</a>
      </span>`).join('') + `</div>`;
  }

  html += `<div style="margin-top:18px;">
    <button class="btn btn-primary" style="width:100%;" onclick="createForCurrentGame()">为当前游戏发车</button>
  </div>`;

  el.innerHTML = html;
}

function joinLobbyFromMatch(id) {
  closeModal('match-modal');
  joinLobby(id);
}

function createForCurrentGame() {
  closeModal('match-modal');
  openCreateModal();
}

function openCreateModal() {
  if (!currentUser) return alert('请先登录 Steam 后再发车！');
  const input = document.getElementById('create-game');
  if (!input.value && localSteam && localSteam.ok && localSteam.runningAppId > 0 && localSteam.runningGameName) {
    input.value = localSteam.runningGameName;
  }
  showModal('create-modal');
}
function openPushModal() {
  if (!currentUser) return alert('请先登录 Steam！');
  showModal('push-modal');
}
function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}
function showModal(id) {
  document.getElementById(id).classList.remove('hidden');
}

async function sendTestPush() {
  const res = await fetch('/api/push/test', { method: 'POST' });
  const data = await res.json();
  console.log('sendTestPush response:', data);
  if (data.error) return alert(data.error);
  if (data.webpushOk === false) return alert('桌面推送发送失败：推送服务未接受。请强刷后重试，或打开 F12 控制台看报错。');
  if (data.webpushOk === null || data.webpushOk === undefined) return alert('测试通知未走桌面推送（webpushOk 为空），请先点「授权开启本电脑桌面弹窗」。');
  alert('已发送测试通知！请留意桌面右下角弹窗（1-3 秒内到达）。');
}

async function initServiceWorker() {
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('/play-sw.js');
      navigator.serviceWorker.addEventListener('message', (event) => {
        console.log('SW message:', event.data);
      });
    } catch (e) {
      console.error('SW register failed:', e);
    }
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

async function enableWebPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return alert('当前浏览器不支持桌面通知');
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      return alert('通知权限未开启（当前状态：' + permission + '）。请点击地址栏左侧的站点图标 → 网站设置，把「通知」改为「允许」后重试。');
    }

    const vapidRes = await fetch('/api/push/vapid');
    const { publicKey } = await vapidRes.json();
    if (!publicKey) return alert('服务端未配置 VAPID 密钥');

    // 等待 Service Worker 就绪，加超时避免永久卡住
    const reg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Service Worker 超时未就绪，请刷新页面重试')), 8000)),
    ]);
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
    }

    const res = await fetch('/api/push/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webPushSub: sub.toJSON() }),
    });
    const data = await res.json();
    if (data.error) return alert(data.error);
    console.log('WebPush subscription saved:', sub.endpoint);
    alert('桌面通知已授权！车队有动静时右下角将弹窗。');
  } catch (err) {
    console.error('WebPush 授权失败：', err);
    alert('授权失败：' + (err && err.message ? err.message : err));
  }
}

// ------- 本机 Steam 联动 -------

function initLocalSteamBridge() {
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const d = event.data;
    if (d && d.source === 'steam-friend-finder-extension' && d.type === 'steam-local-status') {
      handleLocalSteamStatus(d.payload);
    }
  });
  // 页面加载后请扩展立即上报一次
  window.postMessage({ source: 'steam-friend-finder-page', type: 'steam-local-refresh' }, '*');
  updateAuthSection();
}

function handleLocalSteamStatus(payload) {
  localSteam = payload;
  updateAuthSection();

  if (payload && payload.ok && payload.runningAppId > 0) {
    // 检测到正在玩游戏 → 自动按当前游戏筛选（用户手动清除后不再自动打扰）
    if (autoFilter && String(payload.runningAppId) !== lastAutoFilterAppId) {
      lastAutoFilterAppId = String(payload.runningAppId);
      currentFilterAppId = lastAutoFilterAppId;
      updateFilterBar();
      fetchLobbies(true);
      fetchPresence();
    }
  } else if (payload && payload.ok && payload.runningAppId === 0) {
    // 游戏已退出 → 自动清除按游戏筛选并刷新列表/在线状态
    if (currentFilterAppId) {
      currentFilterAppId = null;
      lastAutoFilterAppId = null;
      updateFilterBar();
      fetchLobbies(true);
    }
    fetchPresence();
  }

  // 用户已开启共享在线状态 → 心跳上报（游戏启动/退出时立即同步）
  if (presenceOptIn && currentUser) sendPresenceHeartbeat();
}

function useCurrentGameFilter() {
  if (!localSteam || !localSteam.ok || !(localSteam.runningAppId > 0)) return;
  autoFilter = true;
  currentFilterAppId = String(localSteam.runningAppId);
  lastAutoFilterAppId = currentFilterAppId;
  updateFilterBar();
  fetchLobbies();
  fetchPresence();
}

function clearGameFilter() {
  autoFilter = false;
  currentFilterAppId = null;
  updateFilterBar();
  fetchLobbies();
  fetchPresence();
}

function updateFilterBar() {
  const el = document.getElementById('game-filter-bar');
  if (!el) return;
  if (currentFilterAppId) {
    el.classList.remove('hidden');
    const game = localSteam && localSteam.ok && localSteam.runningAppId === +currentFilterAppId
      ? localSteam.runningGameName
      : '';
    el.innerHTML = `
      <span>已按 <strong>${game ? escapeHtml(game) : ('AppID ' + escapeHtml(currentFilterAppId))}</strong> 筛选</span>
      <button class="btn-tiny" onclick="clearGameFilter()">清除筛选</button>`;
  } else {
    el.classList.add('hidden');
    el.innerHTML = '';
  }
}

// ------- 在线玩家 / 当前游戏匹配 -------

function updatePresenceButton() {
  const input = document.getElementById('presence-toggle');
  if (!input) return;
  input.checked = presenceOptIn;
}

function togglePresence() {
  if (!currentUser) return alert('请先登录 Steam！');
  presenceOptIn = !presenceOptIn;
  localStorage.setItem('presenceOptIn', presenceOptIn ? 'true' : 'false');
  updatePresenceButton();

  if (presenceOptIn) {
    sendPresenceHeartbeat();
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(sendPresenceHeartbeat, HEARTBEAT_MS);
  } else {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    fetch('/api/presence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: false }),
    }).catch(() => {});
  }
  fetchPresence();
}

function sendPresenceHeartbeat() {
  if (!presenceOptIn || !currentUser) return;
  const running = localSteam && localSteam.ok && localSteam.runningAppId > 0;
  fetch('/api/presence', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      appid: running ? String(localSteam.runningAppId) : '',
      gameName: running ? (localSteam.runningGameName || '') : '',
    }),
  }).catch(() => {});
}

async function fetchPresence() {
  const qs = currentFilterAppId ? `?appid=${encodeURIComponent(currentFilterAppId)}` : '';
  try {
    const res = await fetch(`/api/presence${qs}`);
    const data = await res.json();
    if (!Array.isArray(data)) return;
    presenceData = data;
    renderOnlineSection();
  } catch (e) {}
}

function renderOnlineSection() {
  const el = document.getElementById('online-section');
  if (!el) return;

  const heading = currentFilterAppId ? '正在玩同一款游戏的人' : '全站在线玩家';
  let html = `<div class="online-head"><h3>${heading}</h3><span class="online-count">${presenceData.length} 人在线</span></div>`;

  if (presenceData.length === 0) {
    html += `<div class="online-empty">${currentFilterAppId ? '当前还没有人在玩这款游戏' : '暂无在线玩家，点击上方「共享在线状态」让大家看到你'}</div>`;
  } else {
    html += '<div class="online-list">' + presenceData.map(p => `
      <span class="online-chip">
        ${p.avatar ? `<img src="${escapeHtml(p.avatar)}" alt="">` : ''}
        <span class="chip-name">${escapeHtml(p.nickname || p.steamId)}</span>
        ${p.gameName ? `<span class="chip-game">${escapeHtml(p.gameName)}</span>` : ''}
        <a href="https://steamcommunity.com/profiles/${escapeHtml(p.steamId)}" target="_blank" class="btn-tiny" title="Steam 加好友">加好友</a>
      </span>`).join('') + '</div>';
  }
  el.innerHTML = html;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toast(msg) {
  const el = document.getElementById('lobby-toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3000);
}
