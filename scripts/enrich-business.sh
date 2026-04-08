#!/bin/bash
# enrich-business.sh — Scrape Google Maps for rich business data using OpenClaw browser
#
# Usage: bash scripts/enrich-business.sh "Business Name" "Area" "slug"
#
# This script uses `openclaw browser` CLI commands to:
# 1. Search Google Maps for the business
# 2. Extract reviews, hours, services, photos
# 3. Save enriched data for prompt generation
#
# Designed to be called from cron/isolated sessions where `browser` tool isn't available.

set -e

NAME="${1:?Usage: enrich-business.sh 'Business Name' 'Area' 'slug'}"
AREA="${2:-}"
SLUG="${3:-$(echo "$NAME" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g')}"

ASSET_DIR="$(dirname "$0")/../output/assets/$SLUG"
mkdir -p "$ASSET_DIR"

echo "🔍 Enriching: $NAME ($AREA)"

# Use web_fetch to get data from Google Maps search via a regular HTTP request
# Google Maps doesn't work well with curl, so we'll scrape from Zomato/JustDial instead

# 1. Try Zomato for restaurants
echo "  Checking Zomato..."
ZOMATO_HTML=$(curl -sL "https://html.duckduckgo.com/html/?q=$(python3 -c "import urllib.parse; print(urllib.parse.quote('\"$NAME\" $AREA site:zomato.com'))")" \
  -H "User-Agent: Mozilla/5.0" --max-time 10 2>/dev/null || echo "")

ZOMATO_URL=$(echo "$ZOMATO_HTML" | grep -oP 'uddg=\K[^&"]+' | python3 -c "import sys,urllib.parse; [print(urllib.parse.unquote(l.strip())) for l in sys.stdin]" 2>/dev/null | grep "zomato.com" | head -1)

if [ -n "$ZOMATO_URL" ]; then
  echo "  Found Zomato: $ZOMATO_URL"
  ZOMATO_PAGE=$(curl -sL "$ZOMATO_URL" -H "User-Agent: Mozilla/5.0" --max-time 10 2>/dev/null || echo "")
  
  # Extract JSON-LD structured data
  echo "$ZOMATO_PAGE" | python3 -c "
import sys, json, re

html = sys.stdin.read()
data = {}

# Extract from JSON-LD
ld_matches = re.findall(r'<script type=\"application/ld\+json\">(.*?)</script>', html, re.DOTALL)
for ld in ld_matches:
    try:
        d = json.loads(ld)
        if isinstance(d, dict):
            if 'servesCuisine' in d:
                data['cuisines'] = d['servesCuisine'] if isinstance(d['servesCuisine'], str) else ', '.join(d['servesCuisine'])
            if 'priceRange' in d:
                data['priceRange'] = d['priceRange']
            if 'address' in d:
                data['address'] = d['address'].get('streetAddress', '')
            if 'aggregateRating' in d:
                data['zomatoRating'] = d['aggregateRating'].get('ratingValue')
                data['zomatoReviewCount'] = d['aggregateRating'].get('ratingCount')
            if 'review' in d and isinstance(d['review'], list):
                data['reviews'] = []
                for r in d['review'][:5]:
                    data['reviews'].append({
                        'text': r.get('reviewBody', r.get('description', ''))[:300],
                        'author': r.get('author', {}).get('name', 'Customer'),
                        'rating': r.get('reviewRating', {}).get('ratingValue'),
                        'source': 'Zomato'
                    })
    except: pass

if data:
    print(json.dumps(data, indent=2))
else:
    print('{}')
" > "$ASSET_DIR/zomato-data.json" 2>/dev/null
  
  echo "  Zomato data extracted"
fi

# 2. Try JustDial
echo "  Checking JustDial..."
JD_HTML=$(curl -sL "https://html.duckduckgo.com/html/?q=$(python3 -c "import urllib.parse; print(urllib.parse.quote('\"$NAME\" $AREA site:justdial.com'))")" \
  -H "User-Agent: Mozilla/5.0" --max-time 10 2>/dev/null || echo "")

JD_URL=$(echo "$JD_HTML" | grep -oP 'uddg=\K[^&"]+' | python3 -c "import sys,urllib.parse; [print(urllib.parse.unquote(l.strip())) for l in sys.stdin]" 2>/dev/null | grep "justdial.com" | head -1)

if [ -n "$JD_URL" ]; then
  echo "  Found JustDial: $JD_URL"
fi

# 3. Compile enriched data
echo "  Compiling enrichment..."
python3 << PYEOF
import json, os

slug = "$SLUG"
name = "$NAME"
area = "$AREA"
asset_dir = "$ASSET_DIR"

enriched = {
    "name": name,
    "area": area,
    "slug": slug,
    "reviews": [],
    "cuisines": None,
    "priceRange": None,
    "menuHighlights": [],
    "about": None,
    "scrapedAt": None,
}

# Load Zomato data if available
zomato_path = os.path.join(asset_dir, "zomato-data.json")
if os.path.exists(zomato_path):
    try:
        zd = json.load(open(zomato_path))
        if zd.get("reviews"):
            enriched["reviews"] = zd["reviews"]
        if zd.get("cuisines"):
            enriched["cuisines"] = zd["cuisines"]
        if zd.get("priceRange"):
            enriched["priceRange"] = zd["priceRange"]
    except: pass

# Load existing details.json reviews if available
details_path = os.path.join(asset_dir, "details.json")
if os.path.exists(details_path):
    try:
        dd = json.load(open(details_path))
        if dd.get("reviews") and not enriched["reviews"]:
            enriched["reviews"] = [
                {"text": r["text"][:300], "author": r["name"], "rating": r["rating"], "source": "Google Maps"}
                for r in dd["reviews"][:5]
            ]
        if dd.get("regularOpeningHours", {}).get("weekdayDescriptions"):
            enriched["hours"] = dd["regularOpeningHours"]["weekdayDescriptions"]
    except: pass

# Generate prompt enrichment
prompt = ""
if enriched["reviews"]:
    prompt += "\\n## REAL_CUSTOMER_REVIEWS\\nUse these exact quotes as testimonials:\\n"
    for r in enriched["reviews"][:5]:
        rating = f" ({r['rating']}★)" if r.get("rating") else ""
        prompt += f'\\n> "{r["text"]}"\\n> — {r.get("author", "Customer")}{rating}\\n'

if enriched["cuisines"]:
    prompt += f"\\n## CUISINES: {enriched['cuisines']}\\n"

if enriched["priceRange"]:
    prompt += f"## PRICE_RANGE: {enriched['priceRange']}\\n"

if enriched.get("hours"):
    prompt += "\\n## HOURS\\n" + "\\n".join(enriched["hours"]) + "\\n"

if prompt:
    prompt = "\\n# ═══ ENRICHED DATA (real business information) ═══" + prompt
    prompt += "\\n**Use this real data to make the website authentic. Do NOT use generic placeholder text when real data is available.**\\n"

# Save
with open(os.path.join(asset_dir, "enriched-data.json"), "w") as f:
    json.dump(enriched, f, indent=2)

with open(os.path.join(asset_dir, "prompt-enrichment.md"), "w") as f:
    f.write(prompt)

review_count = len(enriched["reviews"])
print(f"  ✅ Enriched: {review_count} reviews, cuisines={'yes' if enriched['cuisines'] else 'no'}, price={'yes' if enriched['priceRange'] else 'no'}")
PYEOF

echo "✅ Done: $ASSET_DIR"
