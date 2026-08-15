const NATIVE_HOST_NAME = 'com.steam.friendfinder';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'steam-local-status') {
    chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, { cmd: 'status' }, (res) => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse(res || { ok: false, error: 'empty response from native host' });
      }
    });
    return true; // 异步响应
  }
  return false;
});

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: 'https://steam.i-test.top/play' });
});
