#!/bin/bash
# deploy-gh-pages.sh — Build and deploy a business website to GitHub Pages
# Usage: ./deploy-gh-pages.sh <repo-url> <slug> [details-json-path]
# Example: ./deploy-gh-pages.sh https://github.com/alokit-bot/envoq-salon-website envoq-salon-website output/assets/envoq-salon/details.json
#
# If details-json-path is provided, business name/description/category are read from it
# for proper OG meta tags. Otherwise, they're auto-extracted from the built HTML.

set -e

REPO_URL="${1:-}"
SLUG="${2:-}"
DETAILS_JSON="${3:-}"
GH_USER="alokit-bot"

# Load .env if present
if [ -f "$(dirname "$0")/../.env" ]; then
  export $(grep -v '^#' "$(dirname "$0")/../.env" | xargs)
fi

if [ -z "$GH_PAT" ]; then
  echo "Error: GH_PAT environment variable is required. Set it in .env or export it."
  exit 1
fi

if [ -z "$REPO_URL" ] || [ -z "$SLUG" ]; then
  echo "Usage: $0 <repo-url> <slug>"
  echo "Example: $0 https://github.com/alokit-bot/envoq-salon-website envoq-salon-website"
  exit 1
fi

DEPLOY_DIR="/tmp/deploy-${SLUG}"
PAGES_URL="https://${GH_USER}.github.io/${SLUG}/"

echo "=== Deploying ${SLUG} to GitHub Pages ==="
echo "Repo: ${REPO_URL}"
echo "Pages URL: ${PAGES_URL}"

# 1. Clone the repo
echo ""
echo "[1/5] Cloning repo..."
rm -rf "$DEPLOY_DIR"
AUTH_REPO_URL="${REPO_URL/https:\/\//https:\/\/${GH_USER}:${GH_PAT}@}"
git clone "$AUTH_REPO_URL" "$DEPLOY_DIR" 2>&1

# 2. Find the frontend directory
FRONTEND_DIR="$DEPLOY_DIR"
if [ -d "$DEPLOY_DIR/frontend" ]; then
  FRONTEND_DIR="$DEPLOY_DIR/frontend"
  echo "[2/5] Found frontend/ directory"
else
  echo "[2/5] Using root as frontend directory"
fi

# 3. Install and build
echo ""
echo "[3/5] Installing dependencies..."
cd "$FRONTEND_DIR"

# Fix package.json: set homepage for correct asset paths
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
pkg.homepage = 'https://${GH_USER}.github.io/${SLUG}';
fs.writeFileSync('./package.json', JSON.stringify(pkg, null, 2));
console.log('  homepage set to:', pkg.homepage);
"

# Fix App.js: add BrowserRouter basename for gh-pages sub-path
if [ -f "src/App.js" ]; then
  sed -i "s|<BrowserRouter>|<BrowserRouter basename=\"/${SLUG}\">|g" src/App.js
  echo "  BrowserRouter basename set"
fi

npm install --legacy-peer-deps 2>&1 | tail -3

# Fix ajv compatibility with Node 22+ (CRACO/CRA webpack dep)
npm install ajv@8 ajv-keywords@5 --legacy-peer-deps 2>&1 | tail -1
echo "  ajv@8 fix applied"

echo ""
echo "[4/5] Building..."
# Use CRACO if available (handles @/ path aliases), fallback to react-scripts
if [ -f "node_modules/.bin/craco" ]; then
  echo "  Building with CRACO..."
  PUBLIC_URL="/${SLUG}" ./node_modules/.bin/craco build 2>&1 | tail -5
else
  PUBLIC_URL="/${SLUG}" npm run build 2>&1 | tail -5
fi

# 4. Post-process build
BUILD_DIR="$FRONTEND_DIR/build"

echo ""
echo "[4.5/5] Post-processing build (de-brand + OG tags)..."
DEPLOY_BUILD_DIR="$BUILD_DIR" DEPLOY_SLUG="$SLUG" DEPLOY_DETAILS_JSON="$DETAILS_JSON" DEPLOY_GH_USER="$GH_USER" python3 << 'PYEOF'
import re, os, json

build_dir = os.environ["DEPLOY_BUILD_DIR"]
slug = os.environ["DEPLOY_SLUG"]
details_json = os.environ.get("DEPLOY_DETAILS_JSON", "")
gh_user = os.environ["DEPLOY_GH_USER"]
pages_url = f"https://{gh_user}.github.io/{slug}/"

# --- Load business info ---
biz_name = None
biz_desc = None
biz_category = None
biz_area = None

# Try details.json first
if details_json and os.path.isfile(details_json):
    with open(details_json) as f:
        d = json.load(f)
    biz_name = d.get("name")
    biz_desc = d.get("description")
    biz_category = d.get("category")
    biz_area = d.get("area")
    print(f"  Loaded business info from {details_json}")

with open(os.path.join(build_dir, 'index.html'), 'r') as f:
    content = f.read()

# If no details.json, try to extract business name from the built HTML
if not biz_name:
    # Try: first <h1>, or first heading with text
    m = re.search(r'<h1[^>]*>([^<]+)</h1>', content)
    if m:
        biz_name = m.group(1).strip()
    if not biz_name or 'emergent' in biz_name.lower():
        # Fallback: prettify slug
        biz_name = slug.replace('-', ' ').title()
    print(f"  Auto-extracted business name: {biz_name}")

if not biz_desc:
    # Try existing meta description
    m = re.search(r'<meta name="description" content="([^"]*)"', content)
    if m and 'emergent' not in m.group(1).lower():
        biz_desc = m.group(1)
    else:
        biz_desc = f"{biz_name} — Website"

# --- Strip all Emergent branding ---

# Remove emergent-main.js script
content = content.replace('<script src="https://assets.emergent.sh/scripts/emergent-main.js"></script>', '')

# Remove 'Made with Emergent' badge (both <a> and <div> variants)
content = re.sub(r'<a\s+id="emergent-badge"[^>]*>.*?</a>', '', content, flags=re.DOTALL)
content = re.sub(r'<div[^>]*id="emergent-badge"[^>]*>.*?</div>\s*(?:</a>\s*</div>)?', '', content, flags=re.DOTALL)

# --- Fix title and meta tags ---

# Replace <title>
content = re.sub(r'<title>[^<]*</title>', f'<title>{biz_name}</title>', content)

# Replace meta description
content = re.sub(
    r'<meta name="description" content="[^"]*"',
    f'<meta name="description" content="{biz_desc}"',
    content
)

# Remove any existing OG/twitter tags (avoid duplicates)
content = re.sub(r'<meta property="og:[^"]*" content="[^"]*"\s*/?\s*>', '', content)
content = re.sub(r'<meta name="twitter:[^"]*" content="[^"]*"\s*/?\s*>', '', content)

# Add fresh OG + Twitter Card tags
og_tags = f'''<meta property="og:type" content="website"/>
<meta property="og:title" content="{biz_name}"/>
<meta property="og:description" content="{biz_desc}"/>
<meta property="og:url" content="{pages_url}"/>
<meta name="twitter:card" content="summary"/>
<meta name="twitter:title" content="{biz_name}"/>
<meta name="twitter:description" content="{biz_desc}"/>
'''
content = content.replace('</head>', og_tags + '</head>')

# --- Write output ---
with open(os.path.join(build_dir, 'index.html'), 'w') as f:
    f.write(content)
with open(os.path.join(build_dir, '404.html'), 'w') as f:
    f.write(content)

print(f'  ✅ Title: {biz_name}')
print(f'  ✅ Description: {biz_desc[:80]}...')
print(f'  ✅ OG tags added for: {pages_url}')
print(f'  ✅ Emergent branding stripped')
print(f'  ✅ 404.html created for SPA routing')
PYEOF

# 5. Push to gh-pages branch
echo ""
echo "[5/5] Pushing to gh-pages..."
PAGES_DEPLOY_DIR="/tmp/gh-pages-${SLUG}"
rm -rf "$PAGES_DEPLOY_DIR"
mkdir "$PAGES_DEPLOY_DIR"
cd "$PAGES_DEPLOY_DIR"

git init
git checkout -b gh-pages

# Copy build output
cp -r "${BUILD_DIR}/." .

git add -A
git config user.email "alokit-bot@users.noreply.github.com"
git config user.name "Alokit Bot"
git commit -m "Deploy ${SLUG} website - $(date -u +%Y-%m-%dT%H:%M:%SZ)"

git remote add origin "$AUTH_REPO_URL"
git push -f origin gh-pages 2>&1

# Enable GitHub Pages if not already enabled
echo ""
echo "Enabling GitHub Pages..."
REPO_NAME=$(echo "$REPO_URL" | sed 's|.*/||')
REPO_OWNER=$(echo "$REPO_URL" | sed 's|.*/\([^/]*\)/[^/]*$|\1|')

curl -s -X POST \
  -H "Authorization: token ${GH_PAT}" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/pages" \
  -d '{"source":{"branch":"gh-pages","path":"/"}}' > /dev/null 2>&1 || true

# Wait for build
echo "Waiting for GitHub Pages to build..."
sleep 20

STATUS=$(curl -s \
  -H "Authorization: token ${GH_PAT}" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/pages" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('status','unknown'))" 2>/dev/null)

echo ""
echo "=== DEPLOYMENT COMPLETE ==="
echo "Status: ${STATUS}"
echo "Live URL: ${PAGES_URL}"
echo ""
echo "Note: Open in a fresh browser tab (not cached) to see the latest version."
