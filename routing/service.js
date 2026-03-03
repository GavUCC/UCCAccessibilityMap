'use strict';

const { findAccessibleRoute } = require('./routing');
const { applySlopeSamplingMode, normalizeMode, clampInterval } = require('./sampling');

function parseRouteContext(input = {}) {
  const weather = String(input.weather || '').trim().toLowerCase();
  const timeOfDay = String(input.timeOfDay || '').trim().toLowerCase() || null;
  const atTime = input.atTime ? new Date(input.atTime) : new Date();
  return {
    weather: weather || null,
    timeOfDay: timeOfDay || null,
    atTime: Number.isFinite(atTime.getTime()) ? atTime.toISOString() : new Date().toISOString(),
    isWet: weather === 'wet' || weather === 'rain' || weather === 'raining'
  };
}

function parseRouteRequest(input = {}) {
  const slopeSampleMode = normalizeMode(input.slopeSampleMode || input.slope_sample_mode);
  const slopeSampleIntervalM = clampInterval(input.slopeSampleIntervalM || input.slope_sample_interval_m || 5);

  return {
    startLat: Number(input.startLat),
    startLon: Number(input.startLon),
    endLat: Number(input.endLat),
    endLon: Number(input.endLon),
    originNodeId: input.originNodeId ? String(input.originNodeId) : null,
    destNodeId: input.destNodeId ? String(input.destNodeId) : null,
    profileId: String(input.profileId || 'default-walking').trim().toLowerCase() || 'default-walking',
    context: parseRouteContext(input.context || {}),
    slopeSampleMode,
    slopeSampleIntervalM
  };
}

function validCoordinate(lat, lon) {
  return Number.isFinite(lat)
    && Number.isFinite(lon)
    && lat >= -90
    && lat <= 90
    && lon >= -180
    && lon <= 180;
}

function createRoutingService(dataAccess) {
  async function routeWithProfile(rawInput) {
    const request = parseRouteRequest(rawInput);

    if (!request.originNodeId || !request.destNodeId) {
      if (!validCoordinate(request.startLat, request.startLon)
        || !validCoordinate(request.endLat, request.endLon)) {
        return {
          status: 'invalid_request',
          error: 'Valid start/end coordinates or node IDs are required.'
        };
      }
    }

    const [profile, rawGraph, obstacles] = await Promise.all([
      dataAccess.getProfile(request.profileId),
      dataAccess.getGraphData(),
      dataAccess.getActiveObstacles(request.context.atTime)
    ]);

    const graph = applySlopeSamplingMode(rawGraph, {
      mode: request.slopeSampleMode,
      intervalM: request.slopeSampleIntervalM
    });

    const result = findAccessibleRoute({
      graph,
      profile,
      obstacles,
      context: request.context,
      startLat: request.startLat,
      startLon: request.startLon,
      endLat: request.endLat,
      endLon: request.endLon,
      originNodeId: request.originNodeId,
      destNodeId: request.destNodeId
    });

    if (result.status === 'ok' && result.route) {
      await dataAccess.logRouteRequest({
        profile_id: profile.id,
        origin_node_id: result.route.nodes[0] || null,
        dest_node_id: result.route.nodes[result.route.nodes.length - 1] || null,
        origin_lat: request.startLat,
        origin_lon: request.startLon,
        dest_lat: request.endLat,
        dest_lon: request.endLon,
        result_status: 'ok',
        total_cost: result.route.total_cost,
        total_length_m: result.route.total_length_m,
        total_ascent_m: result.route.total_ascent_m,
        max_slope_pct: result.route.max_slope_pct,
        confidence_score: result.route.confidence_score,
        explanation_json: result.route.explanation
      });
    } else {
      await dataAccess.logRouteRequest({
        profile_id: profile.id,
        origin_lat: request.startLat,
        origin_lon: request.startLon,
        dest_lat: request.endLat,
        dest_lon: request.endLon,
        result_status: result.status,
        explanation_json: { error: result.error || 'route_not_found' }
      });
    }

    return {
      ...result,
      profile: {
        id: profile.id,
        name: profile.name,
        description: profile.description
      },
      request: {
        startLat: request.startLat,
        startLon: request.startLon,
        endLat: request.endLat,
        endLon: request.endLon,
        profileId: profile.id,
        context: request.context,
        slopeSampleMode: request.slopeSampleMode,
        slopeSampleIntervalM: request.slopeSampleIntervalM
      }
    };
  }

  return {
    routeWithProfile,
    parseRouteRequest,
    parseRouteContext
  };
}

module.exports = {
  createRoutingService,
  parseRouteRequest,
  parseRouteContext
};
