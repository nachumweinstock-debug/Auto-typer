# CableNOI Lead Scraper — Chrome Extension

Scrapes LinkedIn for multifamily property owner leads and surfaces them in a Chrome side panel.

## Load locally in Chrome

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select this `cablenoi-extension` folder
5. The CableNOI icon will appear in your toolbar

## Usage

1. Click the CableNOI icon in the toolbar → side panel opens
2. Go to LinkedIn and run a **People search** (e.g. search "property owner multifamily")
3. Click **Scrape This Page** in the side panel
4. Scroll down on LinkedIn to load more results, then scrape again to accumulate leads
5. Use the **Multifamily matches only** filter to focus on auto-detected relevant leads
6. Click **Export CSV** to download all visible leads

## What it scrapes

- **Search results pages** (`linkedin.com/search/results/people/`) — name, title, company, location, profile URL
- **Profile pages** (`linkedin.com/in/username`) — individual lead
- **Company pages** (`linkedin.com/company/name`) — company info

Leads tagged **MF** are auto-detected as multifamily-relevant based on title/company keywords.

## Iterating

All scraping logic is in `content.js`. The keyword list is at the top — add/remove keywords to tune relevance detection. The side panel UI is in `sidepanel.html` + `sidepanel.js`.
