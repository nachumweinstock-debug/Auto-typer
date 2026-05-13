// ══════════════════════════════════════════════════════════════════════════════
// CableNOI — content script
// Runs on all linkedin.com pages. Handles scraping AND messaging automation.
// ══════════════════════════════════════════════════════════════════════════════

// ── Scraper: keyword list ─────────────────────────────────────────────────────

const MULTIFAMILY_KEYWORDS = [
  "multifamily", "multi-family", "multi family",
  "apartment", "apartments", "residential",
  "property owner", "property investor", "real estate investor",
  "real estate owner", "building owner", "landlord",
  "reit", "asset management", "portfolio manager",
  "real estate", "realty", "housing",
  "cre", "commercial real estate",
  "acquisition", "acquisitions", "acquisitions manager",
  "developer", "real estate developer", "development",
  "property management", "property manager",
  "syndication", "syndicator",
];

function matchesKeywords(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return MULTIFAMILY_KEYWORDS.some((kw) => lower.includes(kw));
}

// ── Scraper: page scrapers ────────────────────────────────────────────────────

function scrapeSearchResults() {
  const leads = [];
  const cards = document.querySelectorAll(
    "li.reusable-search__result-container, li[class*='search-result']"
  );

  cards.forEach((card) => {
    const nameEl = card.querySelector(
      "span[aria-hidden='true'], .entity-result__title-text a span[aria-hidden='true']"
    );
    const name = nameEl?.textContent?.trim() || "";
    if (!name) return;

    const title = card.querySelector(
      ".entity-result__primary-subtitle, [class*='primary-subtitle']"
    )?.textContent?.trim() || "";

    const company = card.querySelector(
      ".entity-result__secondary-subtitle, [class*='secondary-subtitle']"
    )?.textContent?.trim() || "";

    const location = card.querySelector(
      ".entity-result__tertiary-subtitle, [class*='tertiary-subtitle']"
    )?.textContent?.trim() || "";

    const linkEl = card.querySelector("a.app-aware-link, a[href*='/in/'], a[href*='/company/']");
    const profileUrl = linkEl?.href?.split("?")[0] || "";

    const snippet = card.querySelector(".entity-result__summary")?.textContent?.trim() || "";
    const relevant = matchesKeywords(title) || matchesKeywords(company) || matchesKeywords(snippet);

    leads.push({ name, title, company, location, profileUrl, relevant, source: "search" });
  });

  return leads;
}

function scrapeProfilePage() {
  const name = document.querySelector(
    "h1.text-heading-xlarge, h1[class*='heading']"
  )?.textContent?.trim() || "";
  if (!name) return [];

  const title = document.querySelector(
    ".text-body-medium.break-words"
  )?.textContent?.trim() || "";

  const location = document.querySelector(
    ".text-body-small.inline.t-black--light.break-words"
  )?.textContent?.trim() || "";

  const company = document.querySelector(
    "[data-field='experience_company_logo'] .hoverable-link-text, .pv-text-details__right-panel .hoverable-link-text"
  )?.textContent?.trim() || "";

  const profileUrl = window.location.href.split("?")[0];
  const relevant = matchesKeywords(title) || matchesKeywords(company);
  return [{ name, title, company, location, profileUrl, relevant, source: "profile" }];
}

function scrapeCompanyPage() {
  const name = document.querySelector(
    "h1.org-top-card-summary__title"
  )?.textContent?.trim() || "";
  if (!name) return [];

  const items = document.querySelectorAll(".org-top-card-summary-info-list__info-item");
  const industry = items[0]?.textContent?.trim() || "";
  const location = items[2]?.textContent?.trim() || "";
  const profileUrl = window.location.href.split("?")[0];
  const relevant = matchesKeywords(industry) || matchesKeywords(name);

  return [{ name, title: industry, company: name, location, profileUrl, relevant, source: "company" }];
}

function detectPageType() {
  const url = window.location.href;
  if (url.includes("/search/results/")) return "search";
  if (url.includes("/in/")) return "profile";
  if (url.includes("/company/")) return "company";
  return "unknown";
}

function mergeLeads(existing, incoming) {
  const seen = new Set(existing.map((l) => l.profileUrl || l.name));
  return [...existing, ...incoming.filter((l) => !seen.has(l.profileUrl || l.name))];
}

function scrape() {
  const pageType = detectPageType();
  chrome.runtime.sendMessage({ action: "scrapeProgress", text: `Scraping ${pageType} page…` });

  let leads = [];
  if (pageType === "search") leads = scrapeSearchResults();
  else if (pageType === "profile") leads = scrapeProfilePage();
  else if (pageType === "company") leads = scrapeCompanyPage();
  else {
    chrome.runtime.sendMessage({
      action: "scrapeError",
      error: "Navigate to a LinkedIn search, profile, or company page first.",
    });
    return;
  }

  if (leads.length === 0) {
    chrome.runtime.sendMessage({
      action: "scrapeError",
      error: "No leads found. Try scrolling to load more results first.",
    });
    return;
  }

  chrome.storage.local.get("leads", ({ leads: existing = [] }) => {
    const merged = mergeLeads(existing, leads);
    chrome.storage.local.set({ leads: merged }, () => {
      chrome.runtime.sendMessage({ action: "leadsScraped", leads: merged });
    });
  });
}

// ── Messaging automation ──────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findButtonByText(text) {
  for (const btn of document.querySelectorAll("button")) {
    if (btn.textContent.trim().toLowerCase().includes(text.toLowerCase())) return btn;
  }
  return null;
}

async function waitForEl(selectors, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    await sleep(400);
  }
  return null;
}

async function typeInto(el, text) {
  el.focus();
  await sleep(200);
  for (const ch of text) {
    const delay = 35 + Math.random() * 90;
    if (el.isContentEditable) {
      document.execCommand("insertText", false, ch);
    } else {
      const s = el.selectionStart ?? el.value.length;
      el.value = el.value.slice(0, s) + ch + el.value.slice(s);
      el.selectionStart = el.selectionEnd = s + 1;
    }
    el.dispatchEvent(new InputEvent("input", { bubbles: true, data: ch, inputType: "insertText" }));
    await sleep(delay);
  }
}

async function automateMessage(messageText) {
  // 1. Find the Message button
  const msgBtn =
    document.querySelector('button[aria-label*="Message"]') ||
    document.querySelector('button[aria-label*="message"]') ||
    findButtonByText("Message");

  if (!msgBtn) {
    return { success: false, error: "Message button not found — may need to connect first" };
  }

  msgBtn.click();
  await sleep(1200);

  // 2. Wait for message compose box (LinkedIn uses contenteditable div)
  const composeBox = await waitForEl([
    ".msg-form__contenteditable",
    "div.msg-form__contenteditable[contenteditable='true']",
    "div[data-placeholder][contenteditable='true']",
    "div[role='textbox'][contenteditable='true']",
    "div[contenteditable='true'].msg-form__contenteditable",
  ], 10000);

  if (!composeBox) {
    return { success: false, error: "Message compose box did not open" };
  }

  await sleep(400);
  composeBox.click();
  await sleep(300);

  // 3. Type the message with human-like pacing
  await typeInto(composeBox, messageText);

  // Random thinking pause before hitting send
  await sleep(800 + Math.random() * 1200);

  // 4. Find and click Send
  const sendBtn =
    document.querySelector(".msg-form__send-button") ||
    document.querySelector("button[data-control-name='send_message']") ||
    findButtonByText("Send");

  if (!sendBtn) {
    return { success: false, error: "Send button not found" };
  }

  sendBtn.click();
  await sleep(1000);

  // 5. Verify message area cleared (indicates send succeeded)
  const cleared = !composeBox.textContent?.trim();
  if (!cleared) {
    // Fallback: try keyboard shortcut
    composeBox.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
    await sleep(800);
  }

  return { success: true };
}

// ── Message listener ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === "scrape") {
    scrape();
    sendResponse({});
    return;
  }

  if (msg.action === "automateMessage") {
    automateMessage(msg.message).then((result) => {
      chrome.runtime.sendMessage({ action: "messagingResult", ...result });
    });
    sendResponse({});
    return;
  }
});
