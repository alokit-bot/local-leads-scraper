#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const args = process.argv.slice(2);
function getFlag(flag, fallback) {
  const idx = args.indexOf(flag);
  if (idx !== -1) {
    return args[idx + 1];
  }
  return fallback;
}
function hasFlag(flag) {
  return args.includes(flag);
}

if (hasFlag('--help') || hasFlag('-h')) {
  console.log(`\nUsage:\n  node scripts/fetch-place-assets.js --name "Business Name" --area "HSR Layout" [--slug somras-bar-kitchen] [--creds /path/key.json]\n\nOptions:\n  --name <string>   Business name (required)\n  --area <string>   Area or locality to bias search (recommended)\n  --slug <string>   Output folder slug (default: derived from name)\n  --creds <path>    Service account JSON (default: ../firebase-service-account.json)\n  --photos <num>    Number of photos to download (default: 3)\n`);
  process.exit(0);
}

const businessName = getFlag('--name', null) || args[0];
if (!businessName) {
  console.error('Error: --name is required');
  process.exit(1);
}
const area = getFlag('--area', '');
const slug = getFlag('--slug', slugify(businessName));
const photosToDownload = parseInt(getFlag('--photos', '3'), 10) || 3;

const credentialsPath = getFlag('--creds', path.join(__dirname, '..', '..', 'firebase-service-account.json'));
if (!fs.existsSync(credentialsPath)) {
  console.error(`Error: credentials file not found at ${credentialsPath}`);
  process.exit(1);
}
const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));

const OUTPUT_ROOT = path.join(__dirname, '..', 'output', 'assets', slug);
const PHOTO_DIR = path.join(OUTPUT_ROOT, 'photos');
fs.mkdirSync(PHOTO_DIR, { recursive: true });

const scopes = ['https://www.googleapis.com/auth/maps-platform.places'];
let cachedToken = null;
let cachedExpiry = 0;

function slugify(str) {
  return str
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && cachedExpiry - 60000 > now) {
    return cachedToken;
  }
  const header = { alg: 'RS256', typ: 'JWT' };
  const iat = Math.floor(now / 1000);
  const payload = {
    iss: credentials.client_email,
    scope: scopes.join(' '),
    aud: 'https://oauth2.googleapis.com/token',
    exp: iat + 3600,
    iat,
  };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const toSign = `${encodedHeader}.${encodedPayload}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(toSign);
  signer.end();
  const signature = signer.sign(credentials.private_key, 'base64');
  const assertion = `${toSign}.${base64UrlEscape(signature)}`;

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  });

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(`OAuth token error: ${resp.status} ${data.error} ${data.error_description || ''}`);
  }
  cachedToken = data.access_token;
  cachedExpiry = now + data.expires_in * 1000;
  return cachedToken;
}

function base64UrlEncode(str) {
  return base64UrlEscape(Buffer.from(str).toString('base64'));
}
function base64UrlEscape(str) {
  return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function placesFetch(endpoint, options = {}) {
  const token = await getAccessToken();
  const headers = Object.assign({
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }, options.headers || {});
  const resp = await fetch(`https://places.googleapis.com/v1${endpoint}`, {
    ...options,
    headers,
  });
  if (!resp.ok) {
    let errText = `${resp.status} ${resp.statusText}`;
    try {
      const errJson = await resp.json();
      errText += ` - ${errJson.error?.message || JSON.stringify(errJson)}`;
    } catch (_) {}
    throw new Error(`Places API error: ${errText}`);
  }
  return resp;
}

async function searchPlace(query) {
  const fieldMask = [
    'places.id',
    'places.displayName',
    'places.formattedAddress',
    'places.types',
    'places.rating',
    'places.userRatingCount',
    'places.googleMapsUri',
    'places.photos',
  ].join(',');
  const resp = await placesFetch('/places:searchText', {
    method: 'POST',
    headers: { 'X-Goog-FieldMask': fieldMask },
    body: JSON.stringify({
      textQuery: query,
      languageCode: 'en',
      regionCode: 'IN',
      pageSize: 5,
    }),
  });
  const data = await resp.json();
  if (!data.places || data.places.length === 0) {
    throw new Error(`No places found for "${query}"`);
  }
  data.places.sort((a, b) => (b.rating || 0) - (a.rating || 0));
  return data.places[0];
}

async function fetchPlaceDetails(placeId) {
  const fieldMask = [
    'id',
    'displayName',
    'formattedAddress',
    'shortFormattedAddress',
    'location',
    'rating',
    'userRatingCount',
    'businessStatus',
    'priceLevel',
    'primaryType',
    'primaryTypeDisplayName',
    'types',
    'internationalPhoneNumber',
    'nationalPhoneNumber',
    'websiteUri',
    'googleMapsUri',
    'regularOpeningHours',
    'currentOpeningHours',
    'editorialSummary',
    'reviews',
    'photos',
  ].join(',');
  const resp = await placesFetch(`/places/${placeId}?languageCode=en&regionCode=IN`, {
    method: 'GET',
    headers: { 'X-Goog-FieldMask': fieldMask },
  });
  return resp.json();
}

async function downloadPhoto(photoName, index) {
  const mediaResp = await placesFetch(`/${photoName}/media?maxWidthPx=1600`, {
    method: 'GET',
  });
  const buffer = Buffer.from(await mediaResp.arrayBuffer());
  const photoPath = path.join(PHOTO_DIR, `photo-${index + 1}.jpg`);
  fs.writeFileSync(photoPath, buffer);
  return photoPath;
}

function summarizePlace(place, selectedPhotos) {
  const cleanedReviews = (place.reviews || []).slice(0, 5).map((rev) => ({
    name: rev.authorAttribution?.displayName,
    rating: rev.rating,
    relativePublishTimeDescription: rev.relativePublishTimeDescription,
    text: rev.text?.text || rev.text?.plainText,
    publishTime: rev.publishTime,
    authorUri: rev.authorAttribution?.uri,
  }));
  return {
    id: place.id,
    name: place.displayName?.text,
    formattedAddress: place.formattedAddress,
    shortAddress: place.shortFormattedAddress,
    location: place.location,
    rating: place.rating,
    reviewCount: place.userRatingCount,
    businessStatus: place.businessStatus,
    priceLevel: place.priceLevel,
    primaryType: place.primaryType,
    primaryTypeDisplayName: place.primaryTypeDisplayName,
    types: place.types,
    internationalPhoneNumber: place.internationalPhoneNumber,
    nationalPhoneNumber: place.nationalPhoneNumber,
    website: place.websiteUri,
    googleMapsUri: place.googleMapsUri,
    regularOpeningHours: place.regularOpeningHours,
    currentOpeningHours: place.currentOpeningHours,
    editorialSummary: place.editorialSummary,
    reviews: cleanedReviews,
    capturedAt: new Date().toISOString(),
    photos: selectedPhotos.map((photo, idx) => ({
      name: photo.photo.name,
      widthPx: photo.photo.widthPx,
      heightPx: photo.photo.heightPx,
      authorAttributions: photo.photo.authorAttributions,
      localPath: path.relative(OUTPUT_ROOT, photo.localPath),
    })),
  };
}

(async () => {
  const query = `${businessName} ${area ? ' ' + area : ''} Bengaluru`.trim();
  console.error(`Searching Places API for: ${query}`);
  const candidate = await searchPlace(query);
  console.error(`Found place: ${candidate.displayName?.text} (${candidate.id})`);

  const details = await fetchPlaceDetails(candidate.id);
  console.error('Fetched detailed place record');

  const selectedPhotos = [];
  const photos = details.photos || [];
  for (let i = 0; i < Math.min(photos.length, photosToDownload); i++) {
    try {
      const localPath = await downloadPhoto(photos[i].name, i);
      console.error(`Downloaded photo ${i + 1} -> ${localPath}`);
      selectedPhotos.push({ photo: photos[i], localPath });
    } catch (err) {
      console.error(`Photo ${i + 1} failed: ${err.message}`);
    }
  }

  const summary = summarizePlace(details, selectedPhotos);
  const outputPath = path.join(OUTPUT_ROOT, 'details.json');
  fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2));
  console.error(`Saved details -> ${outputPath}`);

  console.log(JSON.stringify({
    slug,
    outputPath,
    photoCount: selectedPhotos.length,
    rating: summary.rating,
    reviewCount: summary.reviewCount,
    phone: summary.nationalPhoneNumber || summary.internationalPhoneNumber,
    website: summary.website,
    googleMapsUri: summary.googleMapsUri,
  }, null, 2));
})().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
