# Local Leads Scraper

Find high-rated local businesses **without websites** — lead gen for web development outreach.

## What it does

1. Searches Google Local results for configurable categories + areas
2. Filters by minimum rating and review count
3. Checks each business's Google Maps listing for a website
4. Exports a clean CSV of leads (no-website businesses) + a JSON with full data

## Requirements

- Node.js 18+
- Chromium/Chrome installed
- Linux: Xvfb for headless display (`sudo apt install xvfb chromium-browser`)
- macOS: Chrome/Chromium (no Xvfb needed)

## Setup

```bash
npm install
```

## Usage

```bash
# Basic run with defaults (south Bengaluru, all categories, rating ≥ 4.0, reviews ≥ 200)
node scraper.js

# Custom config
node scraper.js --rating 4.2 --reviews 500 --areas "HSR Layout,Koramangala,BTM Layout" --categories "restaurants,salons,gyms"

# Specific output file
node scraper.js --output my_leads.csv

# Headless (auto-detects, but can force)
node scraper.js --headless

# Use existing Chrome with remote debugging already running on port 9222
node scraper.js --cdp-port 9222
```

## Output

Two files are written:
- `leads_YYYY-MM-DD.csv` — businesses with no website (your leads)
- `leads_YYYY-MM-DD.json` — full data including businesses that have websites

### CSV columns
```
Name, Rating, Reviews, Category, Area, Address, Phone, Maps URL
```

## Configuration file

You can also edit `config.json` to set defaults:

```json
{
  "minRating": 4.0,
  "minReviews": 200,
  "areas": ["HSR Layout", "Koramangala", "BTM Layout", "Jayanagar", ...],
  "categories": ["restaurants", "salons", "gyms", ...]
}
```

## How website detection works

For each qualifying business, the scraper visits its Google Maps listing and looks for:
- External links (non-Google URLs) in the listing
- A "Website" button with a non-Google href

If neither is found → **lead** (no website).

## Notes

- Google may throttle searches after ~100 requests. The scraper adds 3–4s delays.
- Review counts are approximate (Google shows "5.1K" not exact numbers).
- "No bot reviews" filter: 200+ reviews + 4.0+ rating is a strong signal of genuine popularity.
