'use strict';

const fs = require('fs');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (!String(key).startsWith('--')) continue;
    args[String(key).slice(2)] = argv[i + 1];
    i += 1;
  }
  return args;
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function confidenceFromResolutionM(resolutionM, sampleCount) {
  const meters = Math.max(0.1, toNumber(resolutionM, 30));
  let base = 0.56;
  if (meters <= 1.5) base = 0.9;
  else if (meters <= 3) base = 0.82;
  else if (meters <= 5) base = 0.75;
  else if (meters <= 10) base = 0.68;
  const boost = Math.min(0.06, sampleCount / 3000);
  return Number(clamp(base + boost, 0.3, 0.97).toFixed(4));
}

function sampleEdgePoints(coords, intervalM, sampleElevationAt) {
  if (!Array.isArray(coords) || coords.length < 2) return [];

  const points = [];
  let cumulative = 0;

  const first = coords[0];
  const firstLon = Number(first[0]);
  const firstLat = Number(first[1]);
  points.push({
    lon: firstLon,
    lat: firstLat,
    position_m: 0,
    elevation_m: sampleElevationAt(firstLon, firstLat)
  });

  for (let i = 1; i < coords.length; i += 1) {
    const prev = coords[i - 1];
    const next = coords[i];
    const lon1 = Number(prev[0]);
    const lat1 = Number(prev[1]);
    const lon2 = Number(next[0]);
    const lat2 = Number(next[1]);

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
        elevation_m: sampleElevationAt(lon, lat)
      });
    }
  }

  return points;
}

function summarizeSlope(points) {
  let ascentM = 0;
  let descentM = 0;
  let maxSlopePct = 0;
  let weightedAbsSlope = 0;
  let measuredDistanceM = 0;
  const slopeSamples = [];

  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const next = points[i];
    const span = Math.max(0, Number(next.position_m) - Number(prev.position_m));
    if (span <= 0) continue;
    if (!Number.isFinite(prev.elevation_m) || !Number.isFinite(next.elevation_m)) continue;

    const dz = Number(next.elevation_m) - Number(prev.elevation_m);
    const slopePct = (dz / span) * 100;
    const absSlope = Math.abs(slopePct);

    if (dz > 0) ascentM += dz;
    if (dz < 0) descentM += Math.abs(dz);

    maxSlopePct = Math.max(maxSlopePct, absSlope);
    weightedAbsSlope += absSlope * span;
    measuredDistanceM += span;

    slopeSamples.push({
      position_m: Number(Number(next.position_m).toFixed(3)),
      slope_pct: Number(slopePct.toFixed(4)),
      elevation_m: Number(Number(next.elevation_m).toFixed(3)),
      method: 'js_geotiff_sample'
    });
  }

  const avgSlopePct = measuredDistanceM > 0 ? weightedAbsSlope / measuredDistanceM : 0;
  return {
    ascent_m: Number(ascentM.toFixed(3)),
    descent_m: Number(descentM.toFixed(3)),
    slope_avg_pct: Number(avgSlopePct.toFixed(4)),
    slope_max_pct: Number(maxSlopePct.toFixed(4)),
    slope_samples: slopeSamples,
    length_m: points.length ? Number(Number(points[points.length - 1].position_m).toFixed(3)) : 0
  };
}

async function buildGeotiffSampler(rasterPath) {
  let GeoTIFF;
  try {
    GeoTIFF = require('geotiff');
  } catch {
    throw new Error('Missing npm package "geotiff". Install with: npm install geotiff');
  }

  const bytes = fs.readFileSync(rasterPath);
  const tiff = await GeoTIFF.fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const image = await tiff.getImage();

  const tiePoints = image.getTiePoints();
  const tie = Array.isArray(tiePoints) && tiePoints.length ? tiePoints[0] : null;
  const resolution = image.getResolution();
  if (!tie || !Array.isArray(resolution) || resolution.length < 2) {
    throw new Error('GeoTIFF is missing tie-points or resolution metadata.');
  }

  const originX = Number(tie.x);
  const originY = Number(tie.y);
  const resX = Number(resolution[0]);
  const resY = Number(resolution[1]);

  if (![originX, originY, resX, resY].every(Number.isFinite)) {
    throw new Error('GeoTIFF coordinate metadata is invalid.');
  }

  // This JS implementation assumes raster coordinates are already EPSG:4326.
  // Reproject rasters before use if needed.
  const sampleElevationAt = (lon, lat) => {
    const pixelX = Math.floor((lon - originX) / resX);
    const pixelY = Math.floor((lat - originY) / resY);

    if (!Number.isFinite(pixelX) || !Number.isFinite(pixelY)) return null;
    if (pixelX < 0 || pixelY < 0 || pixelX >= image.getWidth() || pixelY >= image.getHeight()) return null;

    const window = [pixelX, pixelY, pixelX + 1, pixelY + 1];
    return image.readRasters({ window, width: 1, height: 1, interleave: true })
      .then((values) => {
        const value = Number(values?.[0]);
        return Number.isFinite(value) ? value : null;
      })
      .catch(() => null);
  };

  return {
    async sample(lon, lat) {
      return sampleElevationAt(lon, lat);
    },
    resolutionM: Math.max(Math.abs(resX), Math.abs(resY)) * 111320
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const graphIn = args['graph-in'];
  const graphOut = args['graph-out'];
  const raster = args.raster;
  const sampleIntervalM = Math.max(0.5, toNumber(args['sample-interval-m'], 2));
  const sourceName = String(args['source-name'] || 'js-geotiff').trim() || 'js-geotiff';

  if (!graphIn || !graphOut || !raster) {
    throw new Error('Usage: node tools/elevation/enrich_graph.js --graph-in <graph.json> --graph-out <out.json> --raster <dem.tif> [--sample-interval-m 2]');
  }

  const graph = JSON.parse(fs.readFileSync(graphIn, 'utf8'));
  graph.nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  graph.edges = Array.isArray(graph.edges) ? graph.edges : [];

  const nodeById = new Map(graph.nodes.map((node) => [String(node.id), node]));
  const sampler = await buildGeotiffSampler(raster);

  for (const node of graph.nodes) {
    const lat = Number(node.lat);
    const lon = Number(node.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const elevation = await sampler.sample(lon, lat);
    if (Number.isFinite(elevation)) {
      node.elevation_m = Number(Number(elevation).toFixed(3));
      node.source = sourceName;
    }
  }

  for (const edge of graph.edges) {
    let coords = Array.isArray(edge.geometry) ? edge.geometry : [];
    if (coords.length < 2) {
      const fromNode = nodeById.get(String(edge.from_node_id));
      const toNode = nodeById.get(String(edge.to_node_id));
      if (fromNode && toNode) {
        coords = [
          [Number(fromNode.lon), Number(fromNode.lat)],
          [Number(toNode.lon), Number(toNode.lat)]
        ];
      }
    }
    if (!Array.isArray(coords) || coords.length < 2) continue;

    const sampledPoints = [];
    const rawPoints = sampleEdgePoints(coords, sampleIntervalM, () => null);
    for (const point of rawPoints) {
      const elevation = await sampler.sample(point.lon, point.lat);
      sampledPoints.push({
        ...point,
        elevation_m: Number.isFinite(elevation) ? Number(elevation) : null
      });
    }

    const summary = summarizeSlope(sampledPoints);
    edge.length_m = summary.length_m || toNumber(edge.length_m, 0);
    edge.ascent_m = summary.ascent_m;
    edge.descent_m = summary.descent_m;
    edge.slope_avg_pct = summary.slope_avg_pct;
    edge.slope_max_pct = summary.slope_max_pct;
    edge.slope_samples = summary.slope_samples;
    edge.source = sourceName;
    edge.confidence_score = confidenceFromResolutionM(sampler.resolutionM, summary.slope_samples.length);
  }

  fs.writeFileSync(graphOut, `${JSON.stringify(graph, null, 2)}\n`);
  process.stdout.write(`Wrote enriched graph: ${graphOut}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
