#!/bin/bash
# deploy-gh-pages.sh — Build and deploy a salon website to GitHub Pages
# Usage: ./deploy-gh-pages.sh <repo-url> <slug>
# Example: ./deploy-gh-pages.sh https://github.com/alokit-bot/envoq-salon-website envoq-salon-website

set -e

REPO_URL="${1:-}"
SLUG="${2:-}"
GH_PAT="${GH_PAT:-${GH_PAT}}"
GH_USER="alokit-bot"

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

echo ""
echo "[4/5] Building..."
PUBLIC_URL="/${SLUG}" npm run build 2>&1 | tail -5

# 4. Post-process build
BUILD_DIR="$FRONTEND_DIR/build"

echo ""
echo "[4.5/5] Post-processing build..."
python3 -c "
import re, os

# Read index.html
with open('${BUILD_DIR}/index.html', 'r') as f:
    content = f.read()

# Remove emergent-main.js (causes blank page without backend)
content = content.replace('<script src=\"https://assets.emergent.sh/scripts/emergent-main.js\"></script>', '')

# Fix title
content = re.sub(r'<title>[^<]*</title>', '<title>${SLUG} | Website</title>', content)

# Write back
with open('${BUILD_DIR}/index.html', 'w') as f:
    f.write(content)

# Create 404.html for SPA routing
with open('${BUILD_DIR}/404.html', 'w') as f:
    f.write(content)

print('  emergent-main.js removed')
print('  404.html created for SPA routing')
"

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
