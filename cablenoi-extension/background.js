chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(console.error);

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "leadsScraped") {
    chrome.runtime.sendMessage({ action: "updateLeads", leads: msg.leads }).catch(() => {});
  }
  if (msg.action === "scrapeError") {
    chrome.runtime.sendMessage({ action: "scrapeError", error: msg.error }).catch(() => {});
  }
  if (msg.action === "scrapeProgress") {
    chrome.runtime.sendMessage({ action: "scrapeProgress", text: msg.text }).catch(() => {});
  }
  if (msg.action === "triggerScrape") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) return;
      chrome.tabs.sendMessage(tabs[0].id, { action: "scrape" }).catch(console.error);
    });
  }
  if (msg.action === "clearLeads") {
    chrome.storage.local.remove("leads");
  }
  sendResponse({});
  return true;
});
