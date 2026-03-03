'use strict';

function toRadians(value) {
  return (Number(value) || 0) * (Math.PI / 180);
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalizeNode(node) {
  return {
    id: String(node.id),
    lat: Number(node.lat),
    lon: Number(node.lon),
    elevation_m: Number.isFinite(Number(node.elevation_m)) ? Number(node.elevation_m) : null,
    source: node.source || null,
    updated_at: node.updated_at || new Date().toISOString()
  };
}

function normalizeEdge(edge) {
  return {
    ...edge,
    id: String(edge.id),
    from_node_id: String(edge.from_node_id),
    to_node_id: String(edge.to_node_id),
    length_m: Number(edge.length_m),
    ascent_m: Number(edge.ascent_m || 0),
    descent_m: Number(edge.descent_m || 0),
    slope_avg_pct: Number(edge.slope_avg_pct || 0),
    slope_max_pct: Number(edge.slope_max_pct || 0),
    cross_slope_pct: Number.isFinite(Number(edge.cross_slope_pct)) ? Number(edge.cross_slope_pct) : null,
    width_m: Number.isFinite(Number(edge.width_m)) ? Number(edge.width_m) : null,
    is_step_free: Boolean(edge.is_step_free),
    is_covered: Boolean(edge.is_covered),
    lighting_score: Number.isFinite(Number(edge.lighting_score)) ? Number(edge.lighting_score) : null,
    confidence_score: Number.isFinite(Number(edge.confidence_score)) ? Number(edge.confidence_score) : 0.5,
    unprotected_crossing: Boolean(edge.unprotected_crossing),
    tactile_paving: Boolean(edge.tactile_paving),
    noise_score: Number.isFinite(Number(edge.noise_score)) ? Number(edge.noise_score) : 0,
    crowd_density_score: Number.isFinite(Number(edge.crowd_density_score)) ? Number(edge.crowd_density_score) : 0,
    turn_severity: Number.isFinite(Number(edge.turn_severity)) ? Number(edge.turn_severity) : 0,
    source: edge.source || null,
    updated_at: edge.updated_at || new Date().toISOString(),
    geometry: Array.isArray(edge.geometry) ? edge.geometry : [],
    slope_samples: Array.isArray(edge.slope_samples) ? edge.slope_samples : []
  };
}

function buildGraph(rawData, options = {}) {
  const bidirectional = options.bidirectional !== false;
  const nodeList = Array.isArray(rawData?.nodes) ? rawData.nodes.map(normalizeNode) : [];
  const edgeList = Array.isArray(rawData?.edges) ? rawData.edges.map(normalizeEdge) : [];
  const nodesById = new Map(nodeList.map((node) => [node.id, node]));
  const edgesById = new Map(edgeList.map((edge) => [edge.id, edge]));
  const adjacency = new Map();

  for (const node of nodeList) {
    adjacency.set(node.id, []);
  }

  for (const edge of edgeList) {
    if (!nodesById.has(edge.from_node_id) || !nodesById.has(edge.to_node_id)) continue;

    const forward = {
      edge_id: edge.id,
      from: edge.from_node_id,
      to: edge.to_node_id,
      reversed: false
    };
    adjacency.get(edge.from_node_id).push(forward);

    if (bidirectional) {
      const reverse = {
        edge_id: edge.id,
        from: edge.to_node_id,
        to: edge.from_node_id,
        reversed: true
      };
      adjacency.get(edge.to_node_id).push(reverse);
    }
  }

  return {
    nodes: nodeList,
    edges: edgeList,
    nodesById,
    edgesById,
    adjacency
  };
}

function nearestNodeId(graph, lat, lon) {
  const targetLat = Number(lat);
  const targetLon = Number(lon);
  if (!Number.isFinite(targetLat) || !Number.isFinite(targetLon)) return null;

  let best = null;
  for (const node of graph.nodes) {
    const d = haversineMeters(targetLat, targetLon, node.lat, node.lon);
    if (!Number.isFinite(d)) continue;
    if (!best || d < best.distance) {
      best = { id: node.id, distance: d };
    }
  }
  return best ? best.id : null;
}

module.exports = {
  buildGraph,
  nearestNodeId,
  haversineMeters
};
