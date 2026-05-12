const MULTIFAMILY_KEYWORDS = [
  "multifamily", "multi-family", "multi family",
  "apartment", "apartments", "residential",
  "property owner", "property investor", "real estate investor",
  "real estate owner", "building owner", "landlord",
  "reit", "asset management", "portfolio manager",
  "real estate", "realty", "housing",
  "cre", "commercial real estate",
  "acquisition", "acquisitions manager",
  "development", "developer", "real estate developer",
  "property management", "property manager",
  "syndication", "syndicator",
];

function matchesKeywords(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return MULTIFAMILY_KEYWORDS.some((kw) => lower.includes(kw));
}

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

    const titleEl = card.querySelector(
      ".entity-result__primary-subtitle, [class*='primary-subtitle']"
    );
    const title = titleEl?.textContent?.trim() || "";

    const subtitleEl = card.querySelector(
      ".entity-result__secondary-subtitle, [class*='secondary-subtitle']"
    );
    const company = subtitleEl?.textContent?.trim() || "";

    const locationEl = card.querySelector(
      ".entity-result__tertiary-subtitle, [class*='tertiary-subtitle']"
    );
    const location = locationEl?.textContent?.trim() || "";

    const linkEl = card.querySelector("a.app-aware-link, a[href*='/in/'], a[href*='/company/']");
    const profileUrl = linkEl?.href || "";

    const snippet = card.querySelector(".entity-result__summary")?.textContent?.trim() || "";

    if (!name) return;

    const relevant = matchesKeywords(title) || matchesKeywords(company) || matchesKeywords(snippet);

    leads.push({ name, title, company, location, profileUrl, relevant, source: "search" });
  });

  return leads;
}

function scrapeProfilePage() {
  const nameEl = document.querySelector("h1.text-heading-xlarge, h1[class*='heading']");
  const name = nameEl?.textContent?.trim() || "";
  if (!name) return [];

  const titleEl = document.querySelector(".text-body-medium.break-words");
  const title = titleEl?.textContent?.trim() || "";

  const locationEl = document.querySelector(".text-body-small.inline.t-black--light.break-words");
  const location = locationEl?.textContent?.trim() || "";

  const companyEl = document.querySelector(
    "[data-field='experience_company_logo'] .hoverable-link-text, .pv-text-details__right-panel .hoverable-link-text"
  );
  const company = companyEl?.textContent?.trim() || "";

  const relevant = matchesKeywords(title) || matchesKeywords(company);

  return [{ name, title, company, location, profileUrl: location.href || window.location.href, relevant, source: "profile" }];
}

function scrapeCompanyPage() {
  const nameEl = document.querySelector("h1.org-top-card-summary__title");
  const name = nameEl?.textContent?.trim() || "";
  if (!name) return [];

  const industryEl = document.querySelector(".org-top-card-summary-info-list__info-item");
  const industry = industryEl?.textContent?.trim() || "";

  const locationEl = document.querySelectorAll(".org-top-card-summary-info-list__info-item")[2];
  const location = locationEl?.textContent?.trim() || "";

  const relevant = matchesKeywords(industry) || matchesKeywords(name);

  return [{
    name,
    title: industry,
    company: name,
    location,
    profileUrl: window.location.href,
    relevant,
    source: "company",
  }];
}

function detectPageType() {
  const url = window.location.href;
  if (url.includes("/search/results/")) return "search";
  if (url.includes("/in/")) return "profile";
  if (url.includes("/company/")) return "company";
  return "unknown";
}

function scrape() {
  const pageType = detectPageType();
  chrome.runtime.sendMessage({ action: "scrapeProgress", text: `Scraping ${pageType} page…` });

  let leads = [];
  if (pageType === "search") leads = scrapeSearchResults();
  else if (pageType === "profile") leads = scrapeProfilePage();
  else if (pageType === "company") leads = scrapeCompanyPage();
  else {
    chrome.runtime.sendMessage({ action: "scrapeError", error: "Navigate to a LinkedIn search, profile, or company page first." });
    return;
  }

  if (leads.length === 0) {
    chrome.runtime.sendMessage({ action: "scrapeError", error: "No leads found on this page. Try scrolling down to load more results first." });
    return;
  }

  chrome.storage.local.get("leads", ({ leads: existing = [] }) => {
    const merged = mergeLeads(existing, leads);
    chrome.storage.local.set({ leads: merged }, () => {
      chrome.runtime.sendMessage({ action: "leadsScraped", leads: merged });
    });
  });
}

function mergeLeads(existing, incoming) {
  const seen = new Set(existing.map((l) => l.profileUrl || l.name));
  const fresh = incoming.filter((l) => !seen.has(l.profileUrl || l.name));
  return [...existing, ...fresh];
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "scrape") scrape();
});
