#!/bin/bash
# scrape-gmaps-cli.sh — Scrape Google Maps business data using openclaw browser CLI
#
# Usage: bash scripts/scrape-gmaps-cli.sh "Business Name" "Area" "slug"
#
# Extracts: name, address, phone, hours, category, highlights, about info
# Saves to: output/assets/<slug>/gmaps-scraped.json
# Note: Reviews are NOT available in Google Maps "limited view" (not signed in)
#       Reviews should be sourced from Zomato/JustDial via enrich-business.sh

set -e

NAME="${1:?Usage: scrape-gmaps-cli.sh 'Business Name' 'Area' 'slug'}"
AREA="${2:-}"
SLUG="${3:-$(echo "$NAME" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g')}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ASSET_DIR="$SCRIPT_DIR/../output/assets/$SLUG"
mkdir -p "$ASSET_DIR"

echo "🗺️  Scraping Google Maps: $NAME ($AREA)"

# URL encode the search query
QUERY=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$NAME $AREA'))")
MAPS_URL="https://www.google.com/maps/search/$QUERY"

# 1. Open Google Maps
echo "  [1/4] Opening Google Maps..."
openclaw browser open "$MAPS_URL" > /dev/null 2>&1 || true
sleep 8

# 2. Take snapshot of overview
echo "  [2/4] Extracting overview data..."
OVERVIEW=$(openclaw browser snapshot --compact 2>/dev/null || echo "")

# 3. Click About tab for more details
echo "  [3/4] Checking About tab..."
# Find the About tab ref
ABOUT_REF=$(echo "$OVERVIEW" | grep -oP 'tab "About[^"]*" \[ref=(\w+)\]' | grep -oP 'ref=\K\w+' | head -1)
ABOUT_DATA=""
if [ -n "$ABOUT_REF" ]; then
  openclaw browser click "$ABOUT_REF" > /dev/null 2>&1 || true
  sleep 3
  ABOUT_DATA=$(openclaw browser snapshot --compact 2>/dev/null || echo "")
fi

# 4. Parse and save
echo "  [4/4] Parsing data..."
python3 << PYEOF
import json, re, os

overview = '''$OVERVIEW'''
about = '''$ABOUT_DATA'''
name = "$NAME"
area = "$AREA"
slug = "$SLUG"
asset_dir = "$ASSET_DIR"

data = {
    "name": name,
    "area": area, 
    "slug": slug,
    "scrapedVia": "openclaw-browser-cli",
    "scrapedAt": None,
}

# Parse overview
# Rating - look for pattern like "4.6" near "stars" or in heading context
rating_m = re.search(r'(\d\.\d)\s*(?:stars?|★)', overview)
if rating_m:
    data["rating"] = float(rating_m.group(1))

# Review count
review_m = re.search(r'([\d,]+)\s*(?:reviews?|Google reviews)', overview)
if review_m:
    data["reviewCount"] = int(review_m.group(1).replace(",", ""))

# Business name from heading
h1_m = re.search(r'heading "([^"]+)" \[ref=\w+\] \[level=1\]', overview)
if h1_m:
    data["name"] = h1_m.group(1)

# Category
cat_m = re.search(r'button "([^"]+)" \[ref=\w+\]\s*\n\s*-\s*img', overview)
if cat_m:
    data["category"] = cat_m.group(1)

# Address
addr_m = re.search(r'Address:\s*([^"]+)"', overview)
if addr_m:
    data["address"] = addr_m.group(1).strip()

# Phone
phone_m = re.search(r'Phone:\s*([^"]+)"', overview)
if phone_m:
    data["phone"] = phone_m.group(1).strip()

# Hours
hours_m = re.search(r'text:\s*((?:Open|Closed)\s*[^"\n]+)', overview)
if hours_m:
    data["hours"] = hours_m.group(1).strip()

# Highlights (like "LGBTQ+ friendly", "Wheelchair accessible", etc.)
highlights = []
for m in re.finditer(r'text:\s*(LGBTQ\+\s*friendly|Wheelchair[^"\n]*|Women-owned[^"\n]*|Veteran-owned[^"\n]*)', overview):
    highlights.append(m.group(1).strip())
if highlights:
    data["highlights"] = highlights

# Has online ordering?
if "Order online" in overview:
    data["hasOnlineOrdering"] = True

# Has website?
if "Add website" in overview:
    data["hasWebsite"] = False
else:
    website_m = re.search(r'button "Website:\s*([^"]+)"', overview)
    if website_m:
        data["hasWebsite"] = True
        data["websiteUrl"] = website_m.group(1).strip()

# Parse About tab
if about:
    # Accessibility features
    access = []
    for m in re.finditer(r'listitem:\s*([^\n]+)', about):
        feat = m.group(1).strip()
        if feat and len(feat) > 3:
            access.append(feat)
    if access:
        data["accessibility"] = access
    
    # Service options (dine-in, takeout, delivery, etc.)
    services = []
    for m in re.finditer(r'listitem:\s*((?:Dine-in|Takeout|Delivery|Drive-through|Curbside pickup|No-contact delivery)[^\n]*)', about):
        services.append(m.group(1).strip())
    if services:
        data["serviceOptions"] = services

# Save
from datetime import datetime
data["scrapedAt"] = datetime.utcnow().isoformat() + "Z"

# Merge with existing details.json
details_path = os.path.join(asset_dir, "details.json")
existing = {}
if os.path.exists(details_path):
    try:
        existing = json.load(open(details_path))
    except:
        pass

# Smart merge: keep existing data, add new fields
merged = {**existing}
for k, v in data.items():
    if v is not None and (k not in merged or merged[k] is None):
        merged[k] = v
    elif k in ("rating", "reviewCount", "phone", "address") and v is not None:
        merged[k] = v  # Always update these core fields

# Save merged
with open(details_path, "w") as f:
    json.dump(merged, f, indent=2)

# Also save raw gmaps data separately
with open(os.path.join(asset_dir, "gmaps-scraped.json"), "w") as f:
    json.dump(data, f, indent=2)

# Report
print(f"  ✅ Name: {data.get('name', 'n/a')}")
print(f"  ✅ Rating: {data.get('rating', 'n/a')}★ ({data.get('reviewCount', 'n/a')} reviews)")
print(f"  ✅ Phone: {data.get('phone', 'n/a')}")
print(f"  ✅ Address: {data.get('address', 'n/a')}")
print(f"  ✅ Hours: {data.get('hours', 'n/a')}")
print(f"  ✅ Category: {data.get('category', 'n/a')}")
print(f"  ✅ Has website: {data.get('hasWebsite', 'unknown')}")
if data.get('highlights'):
    print(f"  ✅ Highlights: {', '.join(data['highlights'])}")
PYEOF

# Close the browser tab
echo "  Closing browser tab..."
openclaw browser close > /dev/null 2>&1 || true

echo "✅ Done: $ASSET_DIR/details.json"
