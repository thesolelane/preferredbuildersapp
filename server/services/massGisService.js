// server/services/massGisService.js
// Wraps the MassGIS L3 Parcel ArcGIS Feature Server endpoint.
// Accepts town + address (and optionally owner name); returns a normalized
// property data object or null.
/* global AbortSignal */

const FS_URL =
  'https://services1.arcgis.com/hGdibHYSPO59RG1h/arcgis/rest/services/L3_TAXPAR_POLY_ASSESS_gdb/FeatureServer/1/query';

const FIELDS =
  'TOWN,SITE_ADDR,OWNER1,OWNER2,OWN_ADDR,OWN_CITY,OWN_STATE,OWN_ZIP,' +
  'LAND_VAL,BLDG_VAL,TOTAL_VAL,LAND_AREA,LOT_SIZE,BLDG_AREA,FY,' +
  'USE_CODE,NUM_BEDRMS,NUM_BATHRMS,YEAR_BUILT,STYLE,HEAT_TYPE,STORIES,' +
  'CONDO_UNIT,PROP_ID,MAP_PAR_ID';

/**
 * Calculate approximate lot dimensions from an ArcGIS polygon geometry.
 * Geometry must be in WGS84 (outSR=4326) — rings are [lng, lat] pairs.
 * Returns { lotWidthFt, lotDepthFt, lotPerimeterFt } or null.
 */
function calcParcelDimensions(geometry) {
  if (!geometry || !geometry.rings || !geometry.rings[0]) return null;
  const ring = geometry.rings[0];
  if (ring.length < 3) return null;

  const lngs = ring.map((p) => p[0]);
  const lats = ring.map((p) => p[1]);
  const minLat = Math.min(...lats),
    maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs),
    maxLng = Math.max(...lngs);
  const midLat = ((minLat + maxLat) / 2) * (Math.PI / 180);

  // Earth radius in feet
  const R = 20902231;
  const dLat = (maxLat - minLat) * (Math.PI / 180);
  const dLng = (maxLng - minLng) * (Math.PI / 180);

  const depthFt = Math.round(R * dLat);
  const widthFt = Math.round(R * Math.cos(midLat) * dLng);
  const perimFt = Math.round(2 * (widthFt + depthFt));

  return { lotWidthFt: widthFt, lotDepthFt: depthFt, lotPerimeterFt: perimFt };
}

const USE_CODES = {
  0: 'Undeveloped Land',
  101: 'Single Family Residential',
  102: 'Condominium',
  103: 'Mobile Home',
  104: 'Two Family',
  105: 'Three Family',
  106: 'Apartment 4-8 Units',
  107: 'Apartment 9+ Units',
  111: 'Apt w/ Store',
  112: 'Apt 4-8 Mixed',
  300: 'Commercial',
  310: 'Restaurant / Food',
  320: 'Motor Vehicle',
  325: 'Parking',
  340: 'Office Building',
  360: 'Medical / Dental',
  400: 'Industrial',
  401: 'Manufacturing',
  500: 'Mixed Use',
  600: 'Cemetery / Church',
  700: 'Agricultural',
  800: 'Recreational',
  900: 'Exempt',
  903: 'Tax Exempt (Govt)',
  910: 'Utilities',
};

function normalizeTown(town) {
  return (town || '').trim().toUpperCase();
}

function normalizeAddr(addr) {
  return (addr || '').trim().toUpperCase();
}

function esc(s) {
  return s.replace(/'/g, "''");
}

function addressSimilarity(a, b) {
  if (!a || !b) return 0;
  const normalize = (s) =>
    s
      .toUpperCase()
      .replace(/[^A-Z0-9 ]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 1;
  const tokensA = new Set(na.split(' '));
  const tokensB = new Set(nb.split(' '));
  let overlap = 0;
  for (const t of tokensA) if (tokensB.has(t)) overlap++;
  return overlap / Math.max(tokensA.size, tokensB.size);
}

function normalize(attrs, geometry) {
  if (!attrs) return null;
  const useCode = attrs.USE_CODE != null ? String(attrs.USE_CODE) : null;

  // Lot dimensions from polygon geometry
  const parcelDims = calcParcelDimensions(geometry);

  // Building footprint & perimeter estimate from area ÷ stories
  let footprintSqFt = null;
  let estBuildingPerimFt = null;
  const bldgArea = attrs.BLDG_AREA || null;
  const stories = attrs.STORIES || null;
  if (bldgArea && stories && stories > 0) {
    footprintSqFt = Math.round(bldgArea / stories);
    // Approximate perimeter assuming rectangular footprint (square gives minimum perimeter)
    estBuildingPerimFt = Math.round(4 * Math.sqrt(footprintSqFt));
  }

  return {
    town: attrs.TOWN || null,
    siteAddress: attrs.SITE_ADDR || null,
    owner1: attrs.OWNER1 || null,
    owner2: attrs.OWNER2 || null,
    ownerAddress:
      [attrs.OWN_ADDR, attrs.OWN_CITY, attrs.OWN_STATE, attrs.OWN_ZIP].filter(Boolean).join(', ') ||
      null,
    landValue: attrs.LAND_VAL || null,
    buildingValue: attrs.BLDG_VAL || null,
    totalAssessedValue: attrs.TOTAL_VAL || null,
    landArea: attrs.LAND_AREA || null,
    lotSize: attrs.LOT_SIZE || null,
    buildingArea: bldgArea,
    fiscalYear: attrs.FY || null,
    useCode: useCode,
    useCodeLabel: useCode ? USE_CODES[useCode] || `Code ${useCode}` : null,
    numBedrooms: attrs.NUM_BEDRMS || null,
    numBathrooms: attrs.NUM_BATHRMS || null,
    yearBuilt: attrs.YEAR_BUILT || null,
    style: attrs.STYLE || null,
    heatType: attrs.HEAT_TYPE || null,
    stories: stories,
    condoUnit: attrs.CONDO_UNIT || null,
    propId: attrs.PROP_ID || null,
    mapParId: attrs.MAP_PAR_ID || null,
    // Assessor field card (exterior photo + hand-drawn sketch with actual dimensions)
    assessorFieldCardUrl: getAssessorUrl(attrs.TOWN, attrs.PROP_ID, attrs.MAP_PAR_ID),
    // Lot exterior dimensions (from parcel polygon bounding box)
    lotWidthFt: parcelDims?.lotWidthFt || null,
    lotDepthFt: parcelDims?.lotDepthFt || null,
    lotPerimeterFt: parcelDims?.lotPerimeterFt || null,
    // Building dimensions (estimated from floor area ÷ stories)
    footprintSqFt: footprintSqFt,
    estBuildingPerimFt: estBuildingPerimFt,
    source: 'MassGIS L3 Parcel',
    queriedAt: new Date().toISOString(),
  };
}

/**
 * Look up a property by town + address (+ optional owner).
 * Returns a normalized property object or null.
 */
async function lookupProperty({ town, address, owner } = {}) {
  if (!town && !address) return null;

  const where = [];
  if (town) where.push(`TOWN LIKE '${esc(normalizeTown(town))}%'`);
  if (address) where.push(`SITE_ADDR LIKE '%${esc(normalizeAddr(address))}%'`);
  if (owner) where.push(`OWNER1 LIKE '%${esc(owner.toUpperCase())}%'`);

  const params = new URLSearchParams({
    where: where.join(' AND '),
    outFields: FIELDS,
    returnGeometry: 'true',
    outSR: '4326',
    resultRecordCount: 10,
    orderByFields: 'TOWN,SITE_ADDR',
    f: 'json',
  });

  const url = `${FS_URL}?${params}`;

  let data;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'PreferredBuilders/1.0 (+property-lookup)' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.warn(`[MassGIS] HTTP ${res.status}`);
      return null;
    }
    data = await res.json();
  } catch (err) {
    console.warn('[MassGIS] fetch error:', err.message);
    return null;
  }

  if (data?.error) {
    console.warn('[MassGIS] API error:', data.error.message);
    return null;
  }

  const features = data?.features || [];
  if (!features.length) return null;

  if (features.length === 1) return normalize(features[0].attributes, features[0].geometry);

  // Multiple results — pick best match by address similarity
  const scored = features.map((f) => ({
    attrs: f.attributes,
    geometry: f.geometry,
    score: addressSimilarity(f.attributes.SITE_ADDR || '', address || ''),
  }));
  scored.sort((a, b) => b.score - a.score);

  return normalize(scored[0].attrs, scored[0].geometry);
}

/**
 * Parse a MA project address string into town + street + number components.
 * Works with formats like "123 Main St, Fitchburg, MA" or "123 Main St, Fitchburg".
 */
function parseAddress(fullAddress) {
  if (!fullAddress) return null;
  const parts = fullAddress.split(',').map((p) => p.trim());

  let streetFull = parts[0] || '';
  let town = '';
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i].trim();
    const stateMatch = p.match(/^([A-Za-z\s]+)\s+([A-Z]{2})\s*\d{0,5}$/);
    if (stateMatch) {
      town = town || stateMatch[1].trim();
    } else if (/^\d{5}$/.test(p)) {
      // zip only — skip
    } else if (!town) {
      town = p;
    }
  }

  // If no comma-separated town, try "CITY MA" at end of last token
  if (!town && parts.length === 1) {
    const m = streetFull.match(/^(.*?)\s+([A-Za-z]+)\s+MA\s*\d{0,5}$/i);
    if (m) {
      streetFull = m[1].trim();
      town = m[2].trim();
    }
  }

  // Extract street number from street
  const numMatch = streetFull.match(/^(\d+[A-Za-z]?)\s+(.+)/);
  const streetNumber = numMatch ? numMatch[1] : '';
  const streetName = numMatch ? numMatch[2] : streetFull;

  return { town: town.toUpperCase(), address: streetFull.toUpperCase(), streetNumber, streetName };
}

/**
 * Convenience: look up a property from a full address string.
 * Returns normalized property object or null.
 */
async function lookupPropertyByAddress(fullAddress) {
  const parsed = parseAddress(fullAddress);
  if (!parsed) return null;
  return lookupProperty({ town: parsed.town, address: parsed.address });
}

// ── Assessor field card URL generator ────────────────────────────────────────
// Most Central/North-Central MA towns use Vision Government Solutions (vgsi.com).
// Field cards include: exterior property photo, hand-drawn sketch with actual
// room/exterior dimensions, construction details, and full assessment history.
//
// Some towns use Patriot Properties or other systems — those are listed here.
// For unlisted towns we fall back to Vision GIS (the most common in MA).
//
// URL format:
//   Vision:  https://gis.vgsi.com/<town>ma/parcel.aspx?pid=<PROP_ID>
//   Patriot: https://<town>.patriotproperties.com/default.asp?town=<TOWN>&parcel=<MAP_PAR_ID>
const PATRIOT_TOWNS = new Set([
  'WORCESTER',
  'SPRINGFIELD',
  'LOWELL',
  'CAMBRIDGE',
  'NEWTON',
  'SOMERVILLE',
  'QUINCY',
  'LYNN',
  'FALL RIVER',
  'NEW BEDFORD',
  'WALTHAM',
  'MEDFORD',
]);

function getAssessorUrl(town, propId, mapParId) {
  if (!town) return null;
  const townSlug = town.trim().toLowerCase().replace(/\s+/g, '');
  const townUpper = town.trim().toUpperCase();

  if (PATRIOT_TOWNS.has(townUpper) && mapParId) {
    return `https://${townSlug}.patriotproperties.com/default.asp?town=${encodeURIComponent(townUpper)}&parcel=${encodeURIComponent(mapParId)}`;
  }

  if (propId) {
    return `https://gis.vgsi.com/${townSlug}ma/parcel.aspx?pid=${encodeURIComponent(propId)}`;
  }

  // Fallback: Vision search page for the town
  return `https://gis.vgsi.com/${townSlug}ma/search.aspx`;
}

module.exports = { lookupProperty, lookupPropertyByAddress, parseAddress, getAssessorUrl };
