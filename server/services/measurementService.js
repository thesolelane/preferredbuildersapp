// server/services/measurementService.js
// Orchestrates all building measurement sources in priority order:
//
//  Tier 1 (Free, instant):   Microsoft Building Footprints — polygon-derived dimensions
//  Tier 2 (Free, instant):   Google Solar API — roof area + segments (needs GOOGLE_MAPS_API_KEY)
//  Tier 3 (Paid, 24-48hr):   Hover — 3D property model + wall/roof breakdown
//  Tier 4 (Paid, 24-48hr):   EagleView — aerial roof measurement report
//
// The AI bot calls get_building_measurements (free tiers) automatically.
// Hover/EagleView orders are placed only when explicitly requested.

const { getMicrosoftFootprint } = require('./buildingFootprints');
const { getSolarBuildingData, isConfigured: solarConfigured } = require('./googleSolarService');
const hover = require('./hoverService');
const eagleView = require('./eagleViewService');

/**
 * Get free building measurements for a lat/lng coordinate.
 * Tries Microsoft footprints first, then Google Solar as fallback.
 *
 * @param {number} lat
 * @param {number} lng
 * @param {string} [address] - for logging
 * @returns {Promise<object>} merged measurement result
 */
async function getFreeMeasurements(lat, lng, address) {
  console.log(`[Measurements] Free lookup for ${address || `${lat},${lng}`}`);

  let result = {};
  let source = [];

  // Tier 1: Microsoft Building Footprints
  try {
    const ms = await getMicrosoftFootprint(lat, lng);
    if (ms) {
      result = { ...result, ...ms };
      source.push('Microsoft Building Footprints');
      console.log(`[Measurements] Got Microsoft footprint: ${ms.widthFt}ft × ${ms.depthFt}ft`);
    }
  } catch (err) {
    console.warn('[Measurements] Microsoft footprints error:', err.message);
  }

  // Tier 2: Google Solar API (adds roof area + pitch info)
  if (solarConfigured()) {
    try {
      const solar = await getSolarBuildingData(lat, lng);
      if (solar) {
        // Fill in any gaps from Microsoft data
        if (!result.widthFt && solar.widthFt) result.widthFt = solar.widthFt;
        if (!result.depthFt && solar.depthFt) result.depthFt = solar.depthFt;
        result.roofAreaFt2 = solar.roofAreaFt2;
        result.roofSegments = solar.roofSegments;
        result.imageryDate = solar.imageryDate;
        source.push('Google Solar API');
        console.log(`[Measurements] Got Solar data: roofArea=${solar.roofAreaFt2} sq ft`);
      }
    } catch (err) {
      console.warn('[Measurements] Google Solar error:', err.message);
    }
  }

  if (!source.length) return null;

  // Compute a human-readable summary
  result.sources = source;
  result.summary = buildSummary(result, address);
  return result;
}

function buildSummary(data, address) {
  const lines = [];
  if (address) lines.push(`**Building measurements for ${address}**`);
  if (data.widthFt && data.depthFt)
    lines.push(`- Footprint (bounding box): ${data.widthFt} ft wide × ${data.depthFt} ft deep`);
  if (data.areaFt2) lines.push(`- Ground floor area: ~${data.areaFt2.toLocaleString()} sq ft`);
  if (data.perimeterFt) lines.push(`- Building perimeter: ~${data.perimeterFt} ft`);
  if (data.roofAreaFt2)
    lines.push(`- Total roof area: ~${data.roofAreaFt2.toLocaleString()} sq ft`);
  if (data.roofSegments?.length) {
    const seg = data.roofSegments
      .map((s) => `${s.areaFt2} sq ft at ${s.pitchDeg}° pitch`)
      .join('; ');
    lines.push(`- Roof segments: ${seg}`);
  }
  lines.push(`- Source: ${data.sources.join(' + ')}`);
  lines.push(
    `\n*Note: These are satellite-derived estimates. For exact wall dimensions and roof pitch, order a Hover or EagleView report (charged per job).*`,
  );
  return lines.join('\n');
}

/**
 * Place a Hover measurement order for a job.
 * Returns order details to store against the job record.
 */
async function orderHoverReport({ address, name, email, phone, jobId }) {
  if (!hover.isConfigured()) {
    throw new Error(
      'Hover API credentials not yet configured. Contact Hover at developers.hover.to to get client credentials, then add HOVER_CLIENT_ID and HOVER_CLIENT_SECRET to the app secrets.',
    );
  }
  return await hover.createHoverJob({ address, name, email, phone, jobId });
}

/**
 * Place an EagleView measurement order for a job.
 */
async function orderEagleViewReport({ address, city, state, zip, reportType, jobId }) {
  if (!eagleView.isConfigured()) {
    throw new Error(
      'EagleView credentials not yet configured. Register at developer.eagleview.com, then add EAGLEVIEW_CLIENT_ID and EAGLEVIEW_CLIENT_SECRET to the app secrets.',
    );
  }
  return await eagleView.createOrder({ address, city, state, zip, reportType, jobId });
}

/**
 * Check status of a previously placed Hover or EagleView order.
 */
async function getOrderStatus(provider, orderId) {
  if (provider === 'hover') {
    const job = await hover.getHoverJob(orderId);
    return {
      provider: 'Hover',
      orderId,
      status: job.state,
      label: hover.hoverStatusLabel(job.state),
      measurementsReady: job.state === 'complete',
    };
  }
  if (provider === 'eagleview') {
    const order = await eagleView.getOrderStatus(orderId);
    return {
      provider: 'EagleView',
      orderId,
      status: order.status,
      label: eagleView.eagleViewStatusLabel(order.status),
      measurementsReady: order.status === 'complete',
    };
  }
  throw new Error(`Unknown provider: ${provider}`);
}

module.exports = {
  getFreeMeasurements,
  orderHoverReport,
  orderEagleViewReport,
  getOrderStatus,
};
