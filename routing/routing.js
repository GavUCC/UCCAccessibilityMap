'use strict';

const { buildGraph, nearestNodeId, haversineMeters } = require('./graph');
const { computeEdgeCost } = require('./weighting');
const { computeEdgeStatusMap } = require('./obstacles');
const { routeConfidence, summarizeRouteReasons } = require('./confidence');

function pickMinScoreNode(openSet, fScore) {
  let selected = null;
  let best = Number.POSITIVE_INFINITY;
  for (const nodeId of openSet.values()) {
    const score = Number(fScore.get(nodeId) ?? Number.POSITIVE_INFINITY);
    if (score < best) {
      best = score;
      selected = nodeId;
    }
  }
  return selected;
}

function reconstructRoute(graph, destinationNodeId, cameFrom, totalCost, profile) {
  const nodeIds = [destinationNodeId];
  const edgeTraversals = [];

  let cursor = destinationNodeId;
  while (cameFrom.has(cursor)) {
    const step = cameFrom.get(cursor);
    edgeTraversals.push(step);
    nodeIds.push(step.prevNodeId);
    cursor = step.prevNodeId;
  }

  nodeIds.reverse();
  edgeTraversals.reverse();

  const routeEdges = [];
  const edgeExplanations = [];
  const coordinates = [];

  let totalLengthM = 0;
  let totalAscentM = 0;
  let totalDescentM = 0;
  let maxSlopePct = 0;

  for (let i = 0; i < edgeTraversals.length; i += 1) {
    const step = edgeTraversals[i];
    const edge = graph.edgesById.get(step.edgeTraversal.edge_id);
    if (!edge) continue;

    routeEdges.push(edge);

    totalLengthM += Number(edge.length_m || 0);
    if (step.edgeTraversal.reversed) {
      totalAscentM += Number(edge.descent_m || 0);
      totalDescentM += Number(edge.ascent_m || 0);
    } else {
      totalAscentM += Number(edge.ascent_m || 0);
      totalDescentM += Number(edge.descent_m || 0);
    }
    maxSlopePct = Math.max(maxSlopePct, Math.abs(Number(edge.slope_max_pct || 0)));

    edgeExplanations.push({
      edge_id: edge.id,
      from_node_id: step.edgeTraversal.from,
      to_node_id: step.edgeTraversal.to,
      edge_cost: Number(step.edgeCost.cost.toFixed(4)),
      reasons: step.edgeCost.reasons
    });

    const geom = Array.isArray(edge.geometry) ? [...edge.geometry] : [];
    if (!geom.length) {
      const fromNode = graph.nodesById.get(step.edgeTraversal.from);
      const toNode = graph.nodesById.get(step.edgeTraversal.to);
      if (fromNode && toNode) {
        coordinates.push([fromNode.lon, fromNode.lat], [toNode.lon, toNode.lat]);
      }
      continue;
    }

    const oriented = step.edgeTraversal.reversed ? geom.slice().reverse() : geom;
    if (!coordinates.length) {
      coordinates.push(...oriented);
    } else {
      const start = oriented[0];
      const last = coordinates[coordinates.length - 1];
      if (Array.isArray(start) && Array.isArray(last)
        && start[0] === last[0] && start[1] === last[1]) {
        coordinates.push(...oriented.slice(1));
      } else {
        coordinates.push(...oriented);
      }
    }
  }

  const confidence = routeConfidence(routeEdges);
  const topReasons = summarizeRouteReasons(edgeExplanations, 5);

  return {
    profile_id: profile.id,
    nodes: nodeIds,
    edges: edgeTraversals.map((step) => step.edgeTraversal.edge_id),
    total_length_m: Number(totalLengthM.toFixed(3)),
    total_ascent_m: Number(totalAscentM.toFixed(3)),
    total_descent_m: Number(totalDescentM.toFixed(3)),
    max_slope_pct: Number(maxSlopePct.toFixed(3)),
    total_cost: Number(totalCost.toFixed(6)),
    estimated_time_ms: Math.round((totalLengthM / Math.max(0.35, Number(profile.walkSpeedMps || 1.25))) * 1000),
    confidence_score: Number(confidence.toFixed(4)),
    geometry: {
      type: 'LineString',
      coordinates
    },
    explanation: {
      top_reasons: topReasons,
      edge_costs: edgeExplanations
    }
  };
}

function findAccessibleRoute(params) {
  const graph = params?.graph?.adjacency ? params.graph : buildGraph(params?.graph || {});
  const profile = params.profile;
  const context = params.context || {};

  const startNodeId = params.originNodeId || nearestNodeId(graph, params.startLat, params.startLon);
  const endNodeId = params.destNodeId || nearestNodeId(graph, params.endLat, params.endLon);

  if (!startNodeId || !endNodeId) {
    return {
      status: 'invalid_request',
      error: 'Could not map coordinates to graph nodes.'
    };
  }

  if (startNodeId === endNodeId) {
    const node = graph.nodesById.get(startNodeId);
    return {
      status: 'ok',
      route: {
        profile_id: profile.id,
        nodes: [startNodeId],
        edges: [],
        total_length_m: 0,
        total_ascent_m: 0,
        total_descent_m: 0,
        max_slope_pct: 0,
        total_cost: 0,
        confidence_score: 1,
        geometry: {
          type: 'LineString',
          coordinates: node ? [[node.lon, node.lat]] : []
        },
        explanation: {
          top_reasons: [],
          edge_costs: []
        }
      }
    };
  }

  const edgeStatusMap = computeEdgeStatusMap(graph, params.obstacles || [], context.atTime);
  const openSet = new Set([startNodeId]);
  const cameFrom = new Map();
  const gScore = new Map([[startNodeId, 0]]);
  const fScore = new Map();

  const endNode = graph.nodesById.get(endNodeId);
  const startNode = graph.nodesById.get(startNodeId);
  const startHeuristic = endNode && startNode
    ? haversineMeters(startNode.lat, startNode.lon, endNode.lat, endNode.lon)
    : 0;
  fScore.set(startNodeId, startHeuristic);

  while (openSet.size) {
    const currentNodeId = pickMinScoreNode(openSet, fScore);
    if (!currentNodeId) break;

    if (currentNodeId === endNodeId) {
      return {
        status: 'ok',
        route: reconstructRoute(graph, endNodeId, cameFrom, gScore.get(endNodeId) ?? 0, profile)
      };
    }

    openSet.delete(currentNodeId);
    const neighbors = graph.adjacency.get(currentNodeId) || [];
    for (const edgeTraversal of neighbors) {
      const edge = graph.edgesById.get(edgeTraversal.edge_id);
      if (!edge) continue;

      const edgeStatus = edgeStatusMap.get(edge.id) || { status: 'open', penaltyMultiplier: 1, reasons: [] };
      const edgeCost = computeEdgeCost(edge, profile, {
        ...context,
        edgeStatus,
        reversed: edgeTraversal.reversed
      });

      if (!Number.isFinite(edgeCost.cost)) continue;

      const currentG = Number(gScore.get(currentNodeId) ?? 0);
      const tentative = currentG + edgeCost.cost;
      const known = Number(gScore.get(edgeTraversal.to) ?? Number.POSITIVE_INFINITY);
      if (tentative >= known) continue;

      cameFrom.set(edgeTraversal.to, {
        prevNodeId: currentNodeId,
        edgeTraversal,
        edgeCost
      });
      gScore.set(edgeTraversal.to, tentative);

      const nextNode = graph.nodesById.get(edgeTraversal.to);
      const heuristic = nextNode && endNode
        ? haversineMeters(nextNode.lat, nextNode.lon, endNode.lat, endNode.lon)
        : 0;
      fScore.set(edgeTraversal.to, tentative + heuristic);
      openSet.add(edgeTraversal.to);
    }
  }

  return {
    status: 'no_path',
    error: 'No viable route for selected profile constraints.'
  };
}

module.exports = {
  findAccessibleRoute
};
