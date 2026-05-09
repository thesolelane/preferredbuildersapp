// server/services/propertyEnrichment.js
// Non-blocking background enrichment: runs MassGIS + MRPC + lead check for a
// job or lead and stores the result in the property_data JSON column.
//
// MRPC (Montachusett Regional Planning Commission) adds, for covered towns:
//   - RECORD_CARD: direct URL to assessor field card with exterior photo and
//     hand-drawn sketch showing actual room/exterior dimensions
//   - Last sale date and price
//   - Zoning district
//   - Registry book/page for deed records

const { lookupPropertyByAddress, parseAddress } = require('./massGisService');
const { lookupMrpcByAddress } = require('./mrpcService');
const { checkLeadRecord } = require('./leadCheckService');
const perplexity = require('./perplexityService');

/**
 * Enrich a record with property data. Runs in the background (fire-and-forget).
 *
 * @param {object} db - better-sqlite3 database instance
 * @param {'job'|'lead'} type - record type
 * @param {string} id - record id
 * @param {string} address - full address string (e.g. "123 Main St, Fitchburg, MA 01420")
 */
async function enrichProperty(db, type, id, address) {
  if (!address) return;

  const table = type === 'lead' ? 'leads' : 'jobs';

  try {
    console.log(`[PropertyEnrichment] Starting enrichment for ${type} ${id} at "${address}"`);

    let massGisData = null;
    let mrpcData = null;
    let leadData = null;

    // ── MassGIS L3 Parcel lookup (statewide: year built, areas, assessed value,
    //    lot dimensions from polygon geometry, estimated building perimeter) ──
    try {
      massGisData = await lookupPropertyByAddress(address);
      if (!massGisData && perplexity.isConfigured()) {
        console.log(
          `[PropertyEnrichment] MassGIS no result — falling back to web_search for ${address}`,
        );
        const webResult = await perplexity.search(
          `property assessor data year built ${address} Massachusetts`,
          'general',
        );
        if (webResult) {
          massGisData = { webSearchFallback: true, webResult, queriedAt: new Date().toISOString() };
        }
      }
    } catch (err) {
      console.warn(`[PropertyEnrichment] MassGIS error for ${type} ${id}:`, err.message);
    }

    // ── MRPC lookup (Montachusett towns: field card URL with sketch + last sale
    //    + zoning; silently skips towns not in MRPC coverage) ──────────────────
    try {
      mrpcData = await lookupMrpcByAddress(address);
      if (mrpcData) {
        console.log(
          `[PropertyEnrichment] MRPC found for ${type} ${id} — ` +
            `record card: ${mrpcData.recordCardUrl || 'none'}, ` +
            `last sale: ${mrpcData.lastSaleDate || '—'} $${mrpcData.lastSalePrice || '—'}`,
        );
      }
    } catch (err) {
      console.warn(`[PropertyEnrichment] MRPC error for ${type} ${id}:`, err.message);
    }

    // ── Lead paint inspection check (CLPPP database) ─────────────────────────
    try {
      const parsed = parseAddress(address);
      if (parsed?.town && parsed?.streetName) {
        leadData = await checkLeadRecord({
          town: parsed.town,
          street: parsed.streetName,
          number: parsed.streetNumber,
        });
      }
    } catch (err) {
      console.warn(`[PropertyEnrichment] Lead check error for ${type} ${id}:`, err.message);
    }

    const propertyData = {
      massGis: massGisData,
      mrpc: mrpcData,
      leadCheck: leadData,
      enrichedAt: new Date().toISOString(),
    };

    db.prepare(`UPDATE ${table} SET property_data = ? WHERE id = ?`).run(
      JSON.stringify(propertyData),
      id,
    );

    console.log(
      `[PropertyEnrichment] Saved property_data for ${type} ${id} — ` +
        `MassGIS: ${massGisData ? 'found' : 'null'}, ` +
        `MRPC: ${mrpcData ? 'found' : 'not covered'}, ` +
        `Lead: ${leadData ? (leadData.hasRecord ? 'found' : 'not found') : 'null'}`,
    );
  } catch (err) {
    console.error(`[PropertyEnrichment] Unexpected error for ${type} ${id}:`, err.message);
  }
}

/**
 * Fire-and-forget wrapper — never throws, never blocks the caller.
 */
function enrichPropertyBackground(db, type, id, address) {
  if (!address || !id) return;
  setImmediate(() => {
    enrichProperty(db, type, id, address).catch((err) =>
      console.error('[PropertyEnrichment] Unhandled:', err.message),
    );
  });
}

module.exports = { enrichPropertyBackground, enrichProperty };
