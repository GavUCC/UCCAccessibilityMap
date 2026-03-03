'use strict';

function clamp01(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(1, parsed));
}

function sourceBaseConfidence(source) {
  const key = String(source || '').toLowerCase();
  if (key.includes('lidar')) return 0.88;
  if (key.includes('dem')) return 0.76;
  if (key.includes('inclinometer')) return 0.92;
  if (key.includes('route-elevation')) return 0.52;
  if (key.includes('seed')) return 0.62;
  return 0.5;
}

function edgeConfidenceFromSignals(edge, options = {}) {
  const base = Number.isFinite(Number(edge?.confidence_score))
    ? clamp01(Number(edge.confidence_score))
    : sourceBaseConfidence(edge?.source);

  const slopeSampleCount = Math.max(0, Number(options.slopeSampleCount || edge?.slope_samples?.length || 0));
  const inclinometerCount = Math.max(0, Number(options.inclinometerCount || edge?.spot_check_count || 0));
  const disagreementPct = Math.max(0, Number(options.disagreementPct || 0));

  const sampleBoost = Math.min(0.08, slopeSampleCount / 2000);
  const inclinometerBoost = Math.min(0.24, Math.log1p(inclinometerCount) / 8);
  const disagreementPenalty = Math.min(0.25, disagreementPct / 100);

  return clamp01(base + sampleBoost + inclinometerBoost - disagreementPenalty);
}

function routeConfidence(edges) {
  if (!Array.isArray(edges) || !edges.length) return 0;

  let weightedTotal = 0;
  let lengthTotal = 0;
  let minEdge = 1;

  for (const edge of edges) {
    const len = Math.max(0.1, Number(edge.length_m || 0.1));
    const c = edgeConfidenceFromSignals(edge);
    weightedTotal += c * len;
    lengthTotal += len;
    minEdge = Math.min(minEdge, c);
  }

  if (lengthTotal <= 0) return 0;
  const weighted = weightedTotal / lengthTotal;
  return clamp01((weighted * 0.7) + (minEdge * 0.3));
}

function summarizeRouteReasons(edgeBreakdowns, limit = 5) {
  const aggregate = new Map();

  for (const item of Array.isArray(edgeBreakdowns) ? edgeBreakdowns : []) {
    for (const reason of Array.isArray(item?.reasons) ? item.reasons : []) {
      const term = String(reason.term || 'unknown');
      const contribution = Number(reason.contribution || 0);
      const prev = aggregate.get(term) || 0;
      aggregate.set(term, prev + contribution);
    }
  }

  return Array.from(aggregate.entries())
    .map(([term, total]) => ({ term, total: Number(total.toFixed(4)) }))
    .sort((a, b) => Math.abs(b.total) - Math.abs(a.total))
    .slice(0, limit);
}

module.exports = {
  edgeConfidenceFromSignals,
  routeConfidence,
  summarizeRouteReasons,
  sourceBaseConfidence,
  clamp01
};
