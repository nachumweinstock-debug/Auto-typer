// content.js — LinkedIn People Search scraper

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "scrapeNow") {
    scrapeCurrentPage();
  }
});

async function scrapeCurrentPage() {
  if (!location.href.includes("linkedin.com/search/results/people")) return;

  await waitForResults();
  const leads = extractLeads();
  chrome.runtime.sendMessage({ action: "scraped", leads });
}

function waitForResults(maxWait = 10000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      const found = document.querySelectorAll(
        ".reusable-search__result-container, .entity-result"
      );
      if (found.length > 0) {
        resolve();
      } else if (Date.now() - start < maxWait) {
        setTimeout(check, 500);
      } else {
        resolve();
      }
    };
    check();
  });
}

function extractLeads() {
  const leads = [];
  const selectors = [
    ".reusable-search__result-container",
    "li.reusable-search__result-container",
    ".entity-result",
  ];

  let items = [];
  for (const sel of selectors) {
    items = Array.from(document.querySelectorAll(sel));
    if (items.length) break;
  }

  for (const item of items) {
    try {
      const lead = extractLeadFromItem(item);
      if (lead?.name) leads.push(lead);
    } catch (_) {
      // skip malformed result
    }
  }

  return leads;
}

function extractLeadFromItem(item) {
  const nameEl = item.querySelector(
    '.entity-result__title-text a span[aria-hidden="true"], ' +
    ".entity-result__title-text a, " +
    "span.entity-result__title-text"
  );
  const name = nameEl?.textContent?.trim();

  const linkEl = item.querySelector(
    'a.app-aware-link[href*="/in/"], ' +
    '.entity-result__title-text a[href*="/in/"]'
  );
  const profileUrl = linkEl ? linkEl.href.split("?")[0] : null;

  const titleEl = item.querySelector(
    ".entity-result__primary-subtitle, .subline-level-1"
  );
  const title = titleEl?.textContent?.trim();

  const companyEl = item.querySelector(
    ".entity-result__secondary-subtitle, .subline-level-2"
  );
  const company = companyEl?.textContent?.trim();

  const locationEl = item.querySelector(
    ".entity-result__tertiary-subtitle, .entity-result__simple-insight-text"
  );
  const location = locationEl?.textContent?.trim();

  return { name, profileUrl, title, company, location };
}

// Auto-trigger when content script loads on a matching page
if (location.href.includes("linkedin.com/search/results/people")) {
  setTimeout(scrapeCurrentPage, 4000);
}
