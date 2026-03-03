'use strict';

const fs = require('fs');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    const value = argv[i + 1];
    args[key.slice(2)] = value;
    i += 1;
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const toRad = (v) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getGridValue(grid, row, col) {
  if (!Array.isArray(grid.values) || !grid.values.length) return null;
  if (!Array.isArray(grid.values[row])) return null;
  const value = Number(grid.values[row][col]);
  return Number.isFinite(value) ? value : null;
}

function bilinearElevation(grid, lat, lon) {
  const rows = Number(grid?.rows);
  const cols = Number(grid?.cols);
  const minLat = Number(grid?.minLat);
  const minLon = Number(grid?.minLon);
  const maxLat = Number(grid?.maxLat);
  const maxLon = Number(grid?.maxLon);

  if (![rows, cols, minLat, minLon, maxLat, maxLon].every(Number.isFinite)) return null;
  if (rows < 2 || cols < 2) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const latRatio = (lat - minLat) / (maxLat - minLat || Number.EPSILON);
  const lonRatio = (lon - minLon) / (maxLon - minLon || Number.EPSILON);

  const y = clamp(latRatio, 0, 1) * (rows - 1);
  const x = clamp(lonRatio, 0, 1) * (cols - 1);

  const x0 = Math.floor(x);
  const x1 = Math.min(cols - 1, x0 + 1);
  const y0 = Math.floor(y);
  const y1 = Math.min(rows - 1, y0 + 1);

  const q11 = getGridValue(grid, y0, x0);
  const q21 = getGridValue(grid, y0, x1);
  const q12 = getGridValue(grid, y1, x0);
  const q22 = getGridValue(grid, y1, x1);
  if ([q11, q21, q12, q22].some((value) => !Number.isFinite(value))) return null;

  const fx = x - x0;
  const fy = y - y0;
  const r1 = q11 + ((q21 - q11) * fx);
  const r2 = q12 + ((q22 - q12) * fx);
  return r1 + ((r2 - r1) * fy);
}

function sampleEdge(coords, intervalM, grid) {
  if (!Array.isArray(coords) || coords.length < 2) return [];
  const points = [];
  let cumulative = 0;

  const first = coords[0];
  points.push({
    lon: Number(first[0]),
    lat: Number(first[1]),
    position_m: 0,
    elevation_m: bilinearElevation(grid, Number(first[1]), Number(first[0]))
  });

  for (let i = 1; i < coords.length; i += 1) {
    const prev = coords[i - 1];
    const cur = coords[i];
    const lon1 = Number(prev[0]);
    const lat1 = Number(prev[1]);
    const lon2 = Number(cur[0]);
    const lat2 = Number(cur[1]);

    const segmentM = haversineMeters(lat1, lon1, lat2, lon2);
    if (!Number.isFinite(segmentM) || segmentM <= 0) continue;

    const steps = Math.max(1, Math.ceil(segmentM / intervalM));
    for (let step = 1; step <= steps; step += 1) {
      const ratio = step / steps;
      const lon = lon1 + ((lon2 - lon1) * ratio);
      const lat = lat1 + ((lat2 - lat1) * ratio);
      cumulative += segmentM / steps;
      points.push({
        lon,
        lat,
        position_m: cumulative,
        elevation_m: bilinearElevation(grid, lat, lon)
      });
    }
  }

  return points;
}

function summarizeEdge(points) {
  let ascent = 0;
  let descent = 0;
  let weightedAbsSlope = 0;
  let sampledDistance = 0;
  let maxSlope = 0;
  const slopeSamples = [];

  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const cur = points[i];
    const span = Math.max(0, Number(cur.position_m) - Number(prev.position_m));
    if (span <= 0) continue;
    if (!Number.isFinite(prev.elevation_m) || !Number.isFinite(cur.elevation_m)) continue;

    const dz = Number(cur.elevation_m) - Number(prev.elevation_m);
    const slopePct = (dz / span) * 100;
    const absSlope = Math.abs(slopePct);

    if (dz > 0) ascent += dz;
    if (dz < 0) descent += Math.abs(dz);

    weightedAbsSlope += absSlope * span;
    sampledDistance += span;
    maxSlope = Math.max(maxSlope, absSlope);

    slopeSamples.push({
      position_m: Number(Number(cur.position_m).toFixed(3)),
      slope_pct: Number(slopePct.toFixed(4)),
      elevation_m: Number(Number(cur.elevation_m).toFixed(3)),
      method: 'lut_bilinear'
    });
  }

  const avgSlope = sampledDistance > 0 ? (weightedAbsSlope / sampledDistance) : 0;
  return {
    length_m: points.length ? Number(Number(points[points.length - 1].position_m).toFixed(3)) : 0,
    ascent_m: Number(ascent.toFixed(3)),
    descent_m: Number(descent.toFixed(3)),
    slope_avg_pct: Number(avgSlope.toFixed(4)),
    slope_max_pct: Number(maxSlope.toFixed(4)),
    slope_samples: slopeSamples
  };
}

function confidenceFromGrid(grid, sampleCount) {
  const meters = toNumber(grid?.resolution_m, 30);
  let base = 0.56;
  if (meters <= 1.5) base = 0.88;
  else if (meters <= 3) base = 0.8;
  else if (meters <= 5) base = 0.74;
  else if (meters <= 10) base = 0.66;
  const boost = Math.min(0.05, sampleCount / 3000);
  return Number(Math.max(0.3, Math.min(0.95, base + boost)).toFixed(4));
}

function main() {
  const args = parseArgs(process.argv);
  const graphIn = args['graph-in'];
  const gridIn = args['grid-in'];
  const graphOut = args['graph-out'];
  const sampleIntervalM = Math.max(0.5, toNumber(args['sample-interval-m'], 2));
  const sourceName = String(args['source-name'] || 'lut-fallback').trim() || 'lut-fallback';

  if (!graphIn || !gridIn || !graphOut) {
    throw new Error('Usage: node lut_sampler.js --graph-in <graph.json> --grid-in <grid.json> --graph-out <out.json> [--sample-interval-m 2]');
  }

  const graph = readJson(graphIn);
  const grid = readJson(gridIn);
  graph.nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  graph.edges = Array.isArray(graph.edges) ? graph.edges : [];

  for (const node of graph.nodes) {
    const lat = Number(node.lat);
    const lon = Number(node.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const elevation = bilinearElevation(grid, lat, lon);
    if (Number.isFinite(elevation)) {
      node.elevation_m = Number(elevation.toFixed(3));
      node.source = sourceName;
    }
  }

  for (const edge of graph.edges) {
    const coords = Array.isArray(edge.geometry) ? edge.geometry : [];
    if (coords.length < 2) continue;

    const sampled = sampleEdge(coords, sampleIntervalM, grid);
    const summary = summarizeEdge(sampled);

    edge.length_m = summary.length_m || toNumber(edge.length_m, 0);
    edge.ascent_m = summary.ascent_m;
    edge.descent_m = summary.descent_m;
    edge.slope_avg_pct = summary.slope_avg_pct;
    edge.slope_max_pct = summary.slope_max_pct;
    edge.slope_samples = summary.slope_samples;
    edge.source = sourceName;
    edge.confidence_score = confidenceFromGrid(grid, summary.slope_samples.length);
  }

  fs.writeFileSync(graphOut, `${JSON.stringify(graph, null, 2)}\n`);
  process.stdout.write(`Wrote enriched graph: ${graphOut}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
