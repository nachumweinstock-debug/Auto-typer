// Ping the service worker every 20 seconds to keep it alive while the bot runs.
setInterval(() => {
  chrome.runtime.sendMessage({ action: "keepAlive" }).catch(() => {});
}, 20000);
