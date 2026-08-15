// 内容脚本：把扩展 Native Messaging 拿到的本机 Steam 状态转给网页。
// 页面通过 window message 监听 { source: 'steam-friend-finder-extension', type: 'steam-local-status' }
(function () {
  const EXT_SOURCE = 'steam-friend-finder-extension';
  const PAGE_SOURCE = 'steam-friend-finder-page';

  function post(payload) {
    window.postMessage({ source: EXT_SOURCE, type: 'steam-local-status', payload }, '*');
  }

  function queryStatus() {
    try {
      chrome.runtime.sendMessage({ type: 'steam-local-status' }, (res) => {
        if (chrome.runtime.lastError) {
          post({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        post(res || { ok: false, error: 'empty response' });
      });
    } catch (e) {
      post({ ok: false, error: String(e) });
    }
  }

  // 页面请求立即刷新
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const d = event.data;
    if (d && d.source === PAGE_SOURCE && d.type === 'steam-local-refresh') {
      queryStatus();
    }
  });

  queryStatus();
  setInterval(queryStatus, 5000);
})();
