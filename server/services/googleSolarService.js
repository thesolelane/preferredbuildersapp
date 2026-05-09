// server/services/googleSolarService.js
// Google Solar API — building footprint, roof area, and roof segments.
// Free tier: 10,000 buildingInsights calls / month.
// Requires GOOGLE_MAPS_API_KEY environment variable.

const https = require('https');

const BASE = 'https://solar.googleapis.com/v1';

function isConfigured() {
  return !!process.env.GOOGLE_MAPS_API_KEY;
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { timeout: 10000 }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString()));
          } catch (e) {
            reject(e);
          }
        });
        res.on('error', reject);
      })
      .on('error', reject);
  });
}

const M2_TO_FT2 = 10.7639;
const M_TO_FT = 3.28084;

/**
 * Query Google Solar API for building insights at a lat/lng.
 * Returns parsed dimensions or null.
 */
async function getSolarBuildingData(lat, lng) {
  if (!isConfigured()) {
    console.warn('[GoogleSolar] GOOGLE_MAPS_API_KEY not set — skipping');
    return null;
  }
  try {
    const url =
      `${BASE}/buildingInsights:findClosest` +
      `?location.latitude=${lat}&location.longitude=${lng}` +
      `&requiredQuality=MEDIUM&key=${process.env.GOOGLE_MAPS_API_KEY}`;

    console.log(`[GoogleSolar] Querying lat=${lat} lng=${lng}`);
    const data = await fetchJson(url);

    if (data.error) {
      console.warn('[GoogleSolar] API error:', data.error.message);
      return null;
    }

    const bbox = data.boundingBox;
    const solar = data.solarPotential;

    // Bounding box dimensions
    let widthFt = null,
      depthFt = null;
    if (bbox) {
      const widthM = haversineM(
        bbox.sw.latitude,
        bbox.sw.longitude,
        bbox.sw.latitude,
        bbox.ne.longitude,
      );
      const depthM = haversineM(
        bbox.sw.latitude,
        bbox.sw.longitude,
        bbox.ne.latitude,
        bbox.sw.longitude,
      );
      widthFt = Math.round(widthM * M_TO_FT);
      depthFt = Math.round(depthM * M_TO_FT);
    }

    const roofAreaFt2 = solar?.wholeRoofStats?.areaMeters2
      ? Math.round(solar.wholeRoofStats.areaMeters2 * M2_TO_FT2)
      : null;

    // Roof segments (pitch, azimuth, area per face)
    const segments = (solar?.roofSegmentStats || []).map((s) => ({
      pitchDeg: s.pitchDeg ? Math.round(s.pitchDeg * 10) / 10 : null,
      azimuthDeg: s.azimuthDeg ? Math.round(s.azimuthDeg) : null,
      areaFt2: s.stats?.areaMeters2 ? Math.round(s.stats.areaMeters2 * M2_TO_FT2) : null,
    }));

    return {
      source: 'google_solar',
      widthFt,
      depthFt,
      roofAreaFt2,
      roofSegments: segments.length ? segments : undefined,
      imageryDate: data.imageryDate,
      center: data.center,
    };
  } catch (err) {
    console.warn('[GoogleSolar] Error:', err.message);
    return null;
  }
}

function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

module.exports = { getSolarBuildingData, isConfigured };
