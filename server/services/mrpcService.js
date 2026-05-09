// server/services/mrpcService.js
// Queries the Montachusett Regional Planning Commission (MRPC) ArcGIS server
// for town-specific parcel data. Provides:
//   - RECORD_CARD: direct URL to the assessor's field card (exterior photo +
//     hand-drawn sketch with actual room/exterior dimensions)
//   - Last sale date and price
//   - Zoning district
//   - Shape perimeter (lot perimeter in meters, converted to feet)
//
// Coverage: Ayer, Clinton, Royalston, Shirley, Templeton, Townsend, Westminster
// (Fitchburg, Leominster, Gardner, Lunenburg etc. use MassGIS L3 + Vision GIS)
/* global AbortSignal */

const BASE = 'https://mrmapper.mrpc.org/arcgis6443/rest/services';

// town name (uppercase) → { path, serverType }
// serverType: 'FeatureServer' or 'MapServer'
const MRPC_TOWNS = {
  AYE: null, // alias — see below
  AYER: { path: 'Ayer/Ayer_ParcelsFY26_TaxParFeatureService', type: 'FeatureServer' },
  CLINTON: { path: 'Clinton/Clinton_Parcels_OpenGov', type: 'MapServer' },
  ROYALSTON: {
    path: 'Royalston/Royalston_ParcelsFY25_TaxParFeatureService',
    type: 'FeatureServer',
  },
  SHIRLEY: { path: 'Shirley/Shirley_ParcelsFY26_TaxParFeatureService', type: 'FeatureServer' },
  TOWNSEND: { path: 'Townsend/Townsend_ParcelsFY26', type: 'MapServer' },
  WESTMINSTER: {
    path: 'Westminster/Westminster_ParcelsFY25_TaxParFeatureService',
    type: 'FeatureServer',
  },
  ASHBURNHAM: null, // not yet available
  TEMPLETON: null, // not yet available
};
// Remove placeholder nulls
delete MRPC_TOWNS.AYE;

const MRPC_FIELDS =
  'RECORD_CARD,SITE_ADDR,PROP_ID,MAP_PAR_ID,OWNER1,LS_DATE,LS_PRICE,LS_BOOK,LS_PAGE,REG_ID,ZONING,YEAR_BUILT,BLD_AREA,STORIES,STYLE,USE_CODE,USE_DESC,TOTAL_VAL';

function buildQueryUrl(townConfig, where) {
  const { path, type } = townConfig;
  return `${BASE}/${path}/${type}/0/query?${new URLSearchParams({
    where,
    outFields: MRPC_FIELDS,
    returnGeometry: 'false',
    resultRecordCount: 5,
    f: 'json',
  })}`;
}

function normalizeTownKey(town) {
  return (town || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

function formatLastSaleDate(raw) {
  // Raw format: YYYYMMDD string e.g. "20160930"
  if (!raw || raw.length !== 8) return raw || null;
  const y = raw.slice(0, 4);
  const m = raw.slice(4, 6);
  const d = raw.slice(6, 8);
  return `${m}/${d}/${y}`;
}

function normalizeResult(attrs) {
  if (!attrs) return null;
  return {
    recordCardUrl: attrs.RECORD_CARD || null,
    siteAddress: attrs.SITE_ADDR || null,
    propId: attrs.PROP_ID || null,
    owner: attrs.OWNER1 || null,
    lastSaleDate: formatLastSaleDate(attrs.LS_DATE),
    lastSalePrice: attrs.LS_PRICE || null,
    lastSaleBook: attrs.LS_BOOK || null,
    lastSalePage: attrs.LS_PAGE || null,
    registryId: attrs.REG_ID || null,
    zoning: attrs.ZONING || null,
    yearBuilt: attrs.YEAR_BUILT || null,
    buildingArea: attrs.BLD_AREA || null,
    stories: attrs.STORIES || null,
    style: attrs.STYLE || null,
    useCode: attrs.USE_CODE || null,
    useDesc: attrs.USE_DESC || null,
    totalAssessedValue: attrs.TOTAL_VAL || null,
    source: 'MRPC Parcel',
    queriedAt: new Date().toISOString(),
  };
}

/**
 * Look up a property in the MRPC parcel database.
 * Returns a normalized result or null if town not covered / address not found.
 *
 * @param {object} opts
 * @param {string} opts.town  - Town name (e.g. "TOWNSEND", "Ayer")
 * @param {string} opts.address - Street address without town/state (e.g. "123 MAIN ST")
 */
async function lookupMrpcProperty({ town, address } = {}) {
  const townKey = normalizeTownKey(town);
  const townConfig = MRPC_TOWNS[townKey];
  if (!townConfig) return null; // Town not covered by MRPC

  const addrClean = (address || '').trim().toUpperCase().replace(/'/g, "''");
  const where = addrClean ? `SITE_ADDR LIKE '%${addrClean}%'` : '1=1';

  const url = buildQueryUrl(townConfig, where);

  let data;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'PreferredBuilders/1.0 (+property-lookup)' },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) {
      console.warn(`[MRPC] HTTP ${res.status} for ${town}`);
      return null;
    }
    data = await res.json();
  } catch (err) {
    console.warn('[MRPC] fetch error:', err.message);
    return null;
  }

  if (data?.error) {
    console.warn('[MRPC] API error:', data.error.message);
    return null;
  }

  const features = data?.features || [];
  if (!features.length) return null;

  // If only one result, use it; otherwise pick closest address match
  if (features.length === 1) return normalizeResult(features[0].attributes);

  const norm = (s) =>
    (s || '')
      .toUpperCase()
      .replace(/[^A-Z0-9 ]/g, '')
      .trim();
  const target = norm(address);
  let best = features[0];
  let bestScore = 0;
  for (const f of features) {
    const candidate = norm(f.attributes?.SITE_ADDR || '');
    const overlap = target.split(' ').filter((t) => candidate.includes(t)).length;
    if (overlap > bestScore) {
      bestScore = overlap;
      best = f;
    }
  }
  return normalizeResult(best.attributes);
}

/**
 * Convenience wrapper — accepts a full address string like "123 Main St, Townsend, MA".
 * Parses the town from the address and queries MRPC if the town is covered.
 */
async function lookupMrpcByAddress(fullAddress) {
  if (!fullAddress) return null;

  // Extract town from "street, town, MA [zip]" format
  const parts = fullAddress.split(',').map((p) => p.trim());
  let street = parts[0] || '';
  let town = '';

  for (let i = 1; i < parts.length; i++) {
    const p = parts[i].trim();
    // Skip state abbreviation and zip
    if (/^MA\s*\d{0,5}$/i.test(p) || /^\d{5}$/.test(p)) continue;
    // Skip if it looks like "MA" embedded with a zip
    const stateMatch = p.match(/^([A-Za-z\s]+)\s+MA\s*\d{0,5}$/i);
    if (stateMatch) {
      town = town || stateMatch[1].trim();
      continue;
    }
    if (!town) town = p;
  }

  // Fallback: try last token before "MA"
  if (!town) {
    const m = fullAddress.match(/^(.*?),\s*([A-Za-z\s]+),?\s*MA/i);
    if (m) {
      street = m[1].trim();
      town = m[2].trim();
    }
  }

  if (!town) return null;

  return lookupMrpcProperty({ town: town.toUpperCase(), address: street });
}

module.exports = { lookupMrpcProperty, lookupMrpcByAddress, MRPC_TOWNS };
