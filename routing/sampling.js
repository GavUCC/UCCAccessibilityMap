'use strict';

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampInterval(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 5;
  return Math.max(1, Math.min(20, parsed));
}

function deriveSlopeSamplesFromStats(edge, intervalM = 5) {
  const lengthM = Math.max(0, safeNumber(edge?.length_m));
  if (lengthM <= 0) return [];

  const interval = clampInterval(intervalM);
  const sampleCount = Math.max(2, Math.ceil(lengthM / interval) + 1);
  const netRise = safeNumber(edge?.ascent_m) - safeNumber(edge?.descent_m);
  const inferredSlopePct = lengthM > 0 ? (netRise / lengthM) * 100 : safeNumber(edge?.slope_avg_pct, 0);

  const samples = [];
  for (let i = 0; i < sampleCount; i += 1) {
    const ratio = sampleCount === 1 ? 0 : i / (sampleCount - 1);
    const positionM = Number((lengthM * ratio).toFixed(3));
    samples.push({
      position_m: positionM,
      slope_pct: Number(inferredSlopePct.toFixed(4)),
      elevation_m: null,
      method: 'on_demand_derived'
    });
  }
  return samples;
}

function normalizeMode(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'on-demand' || raw === 'ondemand') return 'on-demand';
  if (raw === 'on-demand-force' || raw === 'ondemand-force') return 'on-demand-force';
  return 'precomputed';
}

function applySlopeSamplingMode(graphData, options = {}) {
  const mode = normalizeMode(options.mode);
  const intervalM = clampInterval(options.intervalM);

  if (!graphData || !Array.isArray(graphData.edges)) {
    return graphData;
  }
  if (mode === 'precomputed') {
    return {
      ...graphData,
      edges: graphData.edges.map((edge) => ({
        ...edge,
        slope_samples: Array.isArray(edge.slope_samples) ? edge.slope_samples : []
      }))
    };
  }

  const sampler = typeof options.sampler === 'function'
    ? options.sampler
    : (edge) => deriveSlopeSamplesFromStats(edge, intervalM);

  const edges = graphData.edges.map((edge) => {
    const existing = Array.isArray(edge.slope_samples) ? edge.slope_samples : [];
    const shouldSample = mode === 'on-demand-force' || existing.length < 2;
    if (!shouldSample) {
      return { ...edge, slope_samples: existing };
    }

    const sampled = sampler(edge, {
      intervalM,
      mode
    });
    return {
      ...edge,
      slope_samples: Array.isArray(sampled) ? sampled : existing
    };
  });

  return {
    ...graphData,
    edges
  };
}

module.exports = {
  applySlopeSamplingMode,
  deriveSlopeSamplesFromStats,
  normalizeMode,
  clampInterval
};
