// server/services/buildingFootprints.js
// Microsoft GlobalMLBuildingFootprints — free building polygon data for any address.
// Converts lat/lng → Bing Maps quadkey (zoom 9) → looks up tile URL in the
// dataset-links index → downloads the compressed tile → finds the nearest
// building polygon → calculates width, depth, area, and perimeter.
//
// No API key required. Data is publicly available under CDLA Permissive 2.0.

const https = require('https');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(__dirname, '../../.local/footprint_cache');
const LINKS_CACHE = path.join(CACHE_DIR, 'dataset-links.csv');
const LINKS_URL = 'https://minedbuildings.blob.core.windows.net/global-buildings/dataset-links.csv';
const LINKS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // refresh index weekly
const TILE_MAX_BYTES = 20 * 1024 * 1024; // skip tiles > 20 MB uncompressed
const TILE_TIMEOUT_MS = 15000;

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

// ── Bing Maps Quadkey math ────────────────────────────────────────────────────

function latLngToQuadKey(lat, lng, zoom = 9) {
  const sinLat = Math.sin((lat * Math.PI) / 180);
  const pixelX = Math.floor(((lng + 180) / 360) * 256 * Math.pow(2, zoom));
  const pixelY = Math.floor(
    (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * 256 * Math.pow(2, zoom),
  );
  const tileX = Math.floor(pixelX / 256);
  const tileY = Math.floor(pixelY / 256);

  let quadKey = '';
  for (let i = zoom; i > 0; i--) {
    let digit = 0;
    const mask = 1 << (i - 1);
    if (tileX & mask) digit += 1;
    if (tileY & mask) digit += 2;
    quadKey += digit.toString();
  }
  return quadKey;
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function fetchText(url, maxBytes = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { timeout: TILE_TIMEOUT_MS }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          return fetchText(res.headers.location, maxBytes).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        const chunks = [];
        let total = 0;
        res.on('data', (chunk) => {
          total += chunk.length;
          if (total > maxBytes) {
            res.destroy();
            reject(new Error('Response too large'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        res.on('error', reject);
      })
      .on('error', reject);
  });
}

function fetchGzip(url, maxBytes = TILE_MAX_BYTES) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { timeout: TILE_TIMEOUT_MS }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          return fetchGzip(res.headers.location, maxBytes).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        const gunzip = zlib.createGunzip();
        const chunks = [];
        let total = 0;
        res.pipe(gunzip);
        gunzip.on('data', (chunk) => {
          total += chunk.length;
          if (total > maxBytes) {
            gunzip.destroy();
            reject(new Error('Tile too large'));
            return;
          }
          chunks.push(chunk);
        });
        gunzip.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        gunzip.on('error', reject);
        res.on('error', reject);
      })
      .on('error', reject);
  });
}

// ── Dataset links index ───────────────────────────────────────────────────────

async function getDatasetLinks() {
  // Use cached file if fresh enough
  if (fs.existsSync(LINKS_CACHE)) {
    const age = Date.now() - fs.statSync(LINKS_CACHE).mtimeMs;
    if (age < LINKS_MAX_AGE_MS) {
      return fs.readFileSync(LINKS_CACHE, 'utf8');
    }
  }
  console.log('[Footprints] Downloading dataset-links index…');
  const csv = await fetchText(LINKS_URL, 10 * 1024 * 1024);
  fs.writeFileSync(LINKS_CACHE, csv);
  return csv;
}

function findTileUrl(linksCsv, quadKey, location = 'UnitedStates') {
  // CSV columns: Location,QuadKey,Size,UploadDate,Url
  const lines = linksCsv.split('\n');
  for (const line of lines) {
    if (!line.trim() || line.startsWith('Location')) continue;
    const cols = line.split(',');
    if (cols.length < 5) continue;
    const loc = cols[0].replace(/\s+/g, '');
    const qk = cols[1].trim();
    if (qk === quadKey && loc.toLowerCase().includes('unitedstates')) {
      // URL may contain commas — join remaining cols
      return cols.slice(4).join(',').trim().replace(/^"|"$/g, '');
    }
  }
  return null;
}

// ── GeoJSON geometry math ─────────────────────────────────────────────────────

function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function polygonAreaM2(coords) {
  // Shoelace formula — coords in [lng, lat] pairs, converted to meters using haversine
  let area = 0;
  const n = coords.length;
  for (let i = 0; i < n - 1; i++) {
    const [lng1, lat1] = coords[i];
    const [lng2, lat2] = coords[i + 1];
    // Simple planar approximation using degree-to-meter at 42°N
    const mPerDegLat = 111320;
    const mPerDegLng = 111320 * Math.cos((lat1 * Math.PI) / 180);
    const x1 = lng1 * mPerDegLng;
    const y1 = lat1 * mPerDegLat;
    const x2 = lng2 * mPerDegLng;
    const y2 = lat2 * mPerDegLat;
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area / 2);
}

function polygonPerimeterM(coords) {
  let perim = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const [lng1, lat1] = coords[i];
    const [lng2, lat2] = coords[i + 1];
    perim += haversineM(lat1, lng1, lat2, lng2);
  }
  return perim;
}

function polygonBoundingBox(coords) {
  let minLat = Infinity,
    maxLat = -Infinity,
    minLng = Infinity,
    maxLng = -Infinity;
  for (const [lng, lat] of coords) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }
  return { minLat, maxLat, minLng, maxLng };
}

function centroid(coords) {
  let sumLat = 0,
    sumLng = 0;
  const n = coords.length - 1; // last coord repeats first
  for (let i = 0; i < n; i++) {
    sumLng += coords[i][0];
    sumLat += coords[i][1];
  }
  return { lat: sumLat / n, lng: sumLng / n };
}

function calculateDimensions(geometry) {
  if (!geometry || geometry.type !== 'Polygon') return null;
  const coords = geometry.coordinates[0];
  const bbox = polygonBoundingBox(coords);
  const widthM = haversineM(bbox.minLat, bbox.minLng, bbox.minLat, bbox.maxLng);
  const depthM = haversineM(bbox.minLat, bbox.minLng, bbox.maxLat, bbox.minLng);
  const areaM2 = polygonAreaM2(coords);
  const perimM = polygonPerimeterM(coords);

  const m2ft = 3.28084;
  return {
    widthFt: Math.round(widthM * m2ft),
    depthFt: Math.round(depthM * m2ft),
    areaFt2: Math.round(areaM2 * m2ft * m2ft),
    perimeterFt: Math.round(perimM * m2ft),
    widthM: Math.round(widthM),
    depthM: Math.round(depthM),
    areaM2: Math.round(areaM2),
    perimeterM: Math.round(perimM),
  };
}

// ── Tile parsing ──────────────────────────────────────────────────────────────

function parseTileBuildings(tileText) {
  // Each line is a JSON object with a "geometry" key (GeoJSON Polygon)
  const buildings = [];
  for (const line of tileText.split('\n')) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      // Format varies — sometimes { geometry: {...} }, sometimes GeoJSON Feature
      const geo = obj.geometry || (obj.type === 'Polygon' ? obj : null);
      if (geo && geo.type === 'Polygon' && geo.coordinates?.length) {
        const center = centroid(geo.coordinates[0]);
        buildings.push({ geometry: geo, lat: center.lat, lng: center.lng });
      }
    } catch {
      /* skip malformed lines */
    }
  }
  return buildings;
}

function findNearestBuilding(buildings, lat, lng) {
  let best = null;
  let bestDist = Infinity;
  for (const b of buildings) {
    const d = haversineM(lat, lng, b.lat, b.lng);
    if (d < bestDist) {
      bestDist = d;
      best = b;
    }
  }
  // Only return if building is within 100m (0.1km) of the query point
  return bestDist < 100 ? best : null;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Look up Microsoft building footprint dimensions for a lat/lng coordinate.
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<object|null>} dimensions object or null
 */
async function getMicrosoftFootprint(lat, lng) {
  try {
    const quadKey = latLngToQuadKey(lat, lng, 9);
    console.log(`[Footprints] lat=${lat} lng=${lng} → quadKey=${quadKey}`);

    // Check for a cached tile for this quadkey
    const tileCachePath = path.join(CACHE_DIR, `tile_${quadKey}.jsonl`);
    let tileText;

    if (fs.existsSync(tileCachePath)) {
      console.log(`[Footprints] Using cached tile for ${quadKey}`);
      tileText = fs.readFileSync(tileCachePath, 'utf8');
    } else {
      const linksCsv = await getDatasetLinks();
      const tileUrl = findTileUrl(linksCsv, quadKey);
      if (!tileUrl) {
        console.warn(`[Footprints] No tile found for quadKey=${quadKey}`);
        return null;
      }
      console.log(`[Footprints] Downloading tile: ${tileUrl.slice(0, 80)}…`);
      tileText = await fetchGzip(tileUrl);
      // Cache the decompressed tile
      try {
        fs.writeFileSync(tileCachePath, tileText);
      } catch {
        /* non-critical */
      }
    }

    const buildings = parseTileBuildings(tileText);
    console.log(`[Footprints] Parsed ${buildings.length} buildings in tile`);

    const nearest = findNearestBuilding(buildings, lat, lng);
    if (!nearest) {
      console.warn(`[Footprints] No building found within 100m of ${lat}, ${lng}`);
      return null;
    }

    const dims = calculateDimensions(nearest.geometry);
    return {
      source: 'microsoft_footprints',
      quadKey,
      ...dims,
      polygon: nearest.geometry,
    };
  } catch (err) {
    console.warn('[Footprints] Error:', err.message);
    return null;
  }
}

module.exports = { getMicrosoftFootprint, latLngToQuadKey };
