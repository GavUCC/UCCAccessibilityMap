'use strict';

function isObstacleActive(obstacle, atTime) {
  const now = atTime ? new Date(atTime) : new Date();
  const start = obstacle?.start_time ? new Date(obstacle.start_time) : null;
  const end = obstacle?.end_time ? new Date(obstacle.end_time) : null;
  if (start && Number.isFinite(start.getTime()) && now < start) return false;
  if (end && Number.isFinite(end.getTime()) && now > end) return false;
  return true;
}

function toPenaltyMultiplier(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, parsed);
}

function computeEdgeStatusMap(graph, obstacles, atTime) {
  const statusMap = new Map();
  const incidentEdgeIdsByNode = new Map();

  for (const edge of graph.edges) {
    if (!incidentEdgeIdsByNode.has(edge.from_node_id)) incidentEdgeIdsByNode.set(edge.from_node_id, new Set());
    if (!incidentEdgeIdsByNode.has(edge.to_node_id)) incidentEdgeIdsByNode.set(edge.to_node_id, new Set());
    incidentEdgeIdsByNode.get(edge.from_node_id).add(edge.id);
    incidentEdgeIdsByNode.get(edge.to_node_id).add(edge.id);
  }

  const active = Array.isArray(obstacles)
    ? obstacles.filter((row) => isObstacleActive(row, atTime))
    : [];

  function applyOnEdge(edgeId, obstacle) {
    if (!graph.edgesById.has(edgeId)) return;

    const prev = statusMap.get(edgeId) || {
      status: 'open',
      penaltyMultiplier: 1,
      reasons: []
    };

    const mode = String(obstacle?.mode || 'hard_block').toLowerCase();
    const severity = String(obstacle?.severity || 'medium').toLowerCase();

    if (mode === 'hard_block') {
      statusMap.set(edgeId, {
        status: 'blocked_hard',
        penaltyMultiplier: Number.POSITIVE_INFINITY,
        reasons: [...prev.reasons, `Obstacle ${obstacle.type || 'unknown'} (${severity}) hard block`]
      });
      return;
    }

    if (prev.status === 'blocked_hard') return;

    const multiplier = toPenaltyMultiplier(obstacle?.penalty_multiplier || (severity === 'high' ? 3 : severity === 'medium' ? 1.8 : 1.3));
    statusMap.set(edgeId, {
      status: 'open_with_penalty',
      penaltyMultiplier: Math.max(prev.penaltyMultiplier, multiplier),
      reasons: [...prev.reasons, `Obstacle ${obstacle.type || 'unknown'} (${severity}) penalty x${multiplier.toFixed(2)}`]
    });
  }

  for (const obstacle of active) {
    const edgeId = obstacle?.edge_id ? String(obstacle.edge_id) : '';
    const nodeId = obstacle?.node_id ? String(obstacle.node_id) : '';
    if (edgeId) {
      applyOnEdge(edgeId, obstacle);
      continue;
    }
    if (nodeId && incidentEdgeIdsByNode.has(nodeId)) {
      for (const incidentEdgeId of incidentEdgeIdsByNode.get(nodeId).values()) {
        applyOnEdge(incidentEdgeId, obstacle);
      }
    }
  }

  return statusMap;
}

module.exports = {
  computeEdgeStatusMap,
  isObstacleActive
};
