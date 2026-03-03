'use strict';

const fs = require('fs');
const path = require('path');
const { PROFILE_CONFIGS, listProfiles } = require('./profiles');
const { edgeConfidenceFromSignals, sourceBaseConfidence } = require('./confidence');

const DEFAULT_SURFACES = [
  { id: 'asphalt', name: 'Asphalt', rolling_resistance_coeff: 1.0, slip_risk_wet_coeff: 1.0, notes: 'Default paved' },
  { id: 'concrete', name: 'Concrete', rolling_resistance_coeff: 1.05, slip_risk_wet_coeff: 1.1, notes: 'Stable paved' },
  { id: 'setts', name: 'Stone Setts', rolling_resistance_coeff: 1.35, slip_risk_wet_coeff: 1.4, notes: 'Uneven historic surface' }
];

function safeJsonParse(value, fallback) {
  try {
    const parsed = JSON.parse(value);
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function loadSeedGraph(seedPath) {
  const fallbackPath = path.join(__dirname, '..', 'fixtures', 'seed-routing-graph.json');
  const target = seedPath ? path.resolve(seedPath) : fallbackPath;
  const raw = fs.readFileSync(target, 'utf8');
  const payload = JSON.parse(raw);
  return {
    nodes: Array.isArray(payload.nodes) ? payload.nodes : [],
    edges: Array.isArray(payload.edges) ? payload.edges : [],
    surfaces: Array.isArray(payload.surfaces) ? payload.surfaces : [],
    obstacles: Array.isArray(payload.obstacles) ? payload.obstacles : []
  };
}

function computeBboxFromGeometry(geometry) {
  const coords = Array.isArray(geometry) ? geometry : [];
  let minLat = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  let minLon = Number.POSITIVE_INFINITY;
  let maxLon = Number.NEGATIVE_INFINITY;

  for (const point of coords) {
    if (!Array.isArray(point) || point.length < 2) continue;
    const lon = Number(point[0]);
    const lat = Number(point[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
  }

  if (!Number.isFinite(minLat) || !Number.isFinite(minLon) || !Number.isFinite(maxLat) || !Number.isFinite(maxLon)) {
    return {
      minLat: 0,
      minLon: 0,
      maxLat: 0,
      maxLon: 0
    };
  }

  return { minLat, minLon, maxLat, maxLon };
}

function normalizeBool(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const text = String(value || '').trim().toLowerCase();
  return text === '1' || text === 'true' || text === 'yes' || text === 'y';
}

function createSqliteAdapter(sqliteDb) {
  function run(sql, params = []) {
    return new Promise((resolve, reject) => {
      sqliteDb.run(sql, params, function onRun(err) {
        if (err) return reject(err);
        return resolve({ rowCount: this.changes || 0, lastID: this.lastID || null });
      });
    });
  }

  function get(sql, params = []) {
    return new Promise((resolve, reject) => {
      sqliteDb.get(sql, params, (err, row) => {
        if (err) return reject(err);
        return resolve(row || null);
      });
    });
  }

  function all(sql, params = []) {
    return new Promise((resolve, reject) => {
      sqliteDb.all(sql, params, (err, rows) => {
        if (err) return reject(err);
        return resolve(rows || []);
      });
    });
  }

  return { run, get, all, dialect: 'sqlite' };
}

function createPostgresAdapter(pgPool) {
  async function run(sql, params = []) {
    const result = await pgPool.query(sql, params);
    return { rowCount: result.rowCount || 0, rows: result.rows || [] };
  }

  async function get(sql, params = []) {
    const result = await pgPool.query(sql, params);
    return result.rows[0] || null;
  }

  async function all(sql, params = []) {
    const result = await pgPool.query(sql, params);
    return result.rows || [];
  }

  return { run, get, all, dialect: 'postgres' };
}

async function seedProfiles(adapter) {
  const profiles = Object.values(PROFILE_CONFIGS);
  for (const profile of profiles) {
    if (adapter.dialect === 'sqlite') {
      await adapter.run(
        `INSERT OR IGNORE INTO profiles(id, name, description) VALUES (?, ?, ?)`,
        [profile.id, profile.name, profile.description]
      );
      await adapter.run(
        `INSERT OR IGNORE INTO profile_rules(profile_id, rule_key, rule_value_json, priority) VALUES (?, ?, ?, ?)`,
        [profile.id, 'weights', JSON.stringify(profile), 100]
      );
    } else {
      await adapter.run(
        `INSERT INTO profiles(id, name, description) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO NOTHING`,
        [profile.id, profile.name, profile.description]
      );
      await adapter.run(
        `INSERT INTO profile_rules(profile_id, rule_key, rule_value_json, priority)
         VALUES ($1, $2, $3::jsonb, $4)
         ON CONFLICT DO NOTHING`,
        [profile.id, 'weights', JSON.stringify(profile), 100]
      );
    }
  }
}

async function seedSurfaceTypes(adapter, surfaces = DEFAULT_SURFACES) {
  for (const surface of surfaces) {
    if (adapter.dialect === 'sqlite') {
      await adapter.run(
        `INSERT OR IGNORE INTO surface_types(id, name, rolling_resistance_coeff, slip_risk_wet_coeff, notes)
         VALUES (?, ?, ?, ?, ?)`,
        [surface.id, surface.name, surface.rolling_resistance_coeff, surface.slip_risk_wet_coeff, surface.notes || null]
      );
    } else {
      await adapter.run(
        `INSERT INTO surface_types(id, name, rolling_resistance_coeff, slip_risk_wet_coeff, notes)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO NOTHING`,
        [surface.id, surface.name, surface.rolling_resistance_coeff, surface.slip_risk_wet_coeff, surface.notes || null]
      );
    }
  }
}

async function seedGraphIfEmpty(adapter, seedGraph) {
  const countRow = await adapter.get('SELECT COUNT(*) AS count FROM routing_nodes');
  const nodeCount = Number(countRow?.count || countRow?.['COUNT(*)'] || 0);
  if (nodeCount > 0) return false;

  for (const node of seedGraph.nodes) {
    if (adapter.dialect === 'sqlite') {
      await adapter.run(
        `INSERT INTO routing_nodes(id, lat, lon, elevation_m, source, updated_at, geometry_geojson, bbox_min_lat, bbox_min_lon, bbox_max_lat, bbox_max_lon)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?)`,
        [
          node.id,
          Number(node.lat),
          Number(node.lon),
          Number.isFinite(Number(node.elevation_m)) ? Number(node.elevation_m) : null,
          node.source || 'seed',
          JSON.stringify({ type: 'Point', coordinates: [Number(node.lon), Number(node.lat)] }),
          Number(node.lat),
          Number(node.lon),
          Number(node.lat),
          Number(node.lon)
        ]
      );
    } else {
      await adapter.run(
        `INSERT INTO routing_nodes(id, lat, lon, elevation_m, source, updated_at, geometry_geojson)
         VALUES ($1, $2, $3, $4, $5, NOW(), $6)
         ON CONFLICT (id) DO NOTHING`,
        [
          node.id,
          Number(node.lat),
          Number(node.lon),
          Number.isFinite(Number(node.elevation_m)) ? Number(node.elevation_m) : null,
          node.source || 'seed',
          JSON.stringify({ type: 'Point', coordinates: [Number(node.lon), Number(node.lat)] })
        ]
      );
    }
  }

  for (const edge of seedGraph.edges) {
    const geometry = Array.isArray(edge.geometry) ? edge.geometry : [];
    const bbox = computeBboxFromGeometry(geometry);
    const confidence = Number.isFinite(Number(edge.confidence_score))
      ? Number(edge.confidence_score)
      : sourceBaseConfidence(edge.source);

    if (adapter.dialect === 'sqlite') {
      await adapter.run(
        `INSERT INTO routing_edges (
          id, from_node_id, to_node_id, length_m, ascent_m, descent_m,
          slope_avg_pct, slope_max_pct, cross_slope_pct, surface_type_id,
          width_m, is_step_free, is_covered, lighting_score,
          unprotected_crossing, tactile_paving, noise_score, crowd_density_score, turn_severity,
          confidence_score, source, updated_at, geometry_geojson,
          bbox_min_lat, bbox_min_lon, bbox_max_lat, bbox_max_lon,
          spot_check_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, 0)`,
        [
          edge.id,
          edge.from_node_id,
          edge.to_node_id,
          Number(edge.length_m),
          Number(edge.ascent_m || 0),
          Number(edge.descent_m || 0),
          Number(edge.slope_avg_pct || 0),
          Number(edge.slope_max_pct || 0),
          Number.isFinite(Number(edge.cross_slope_pct)) ? Number(edge.cross_slope_pct) : null,
          edge.surface_type_id || null,
          Number.isFinite(Number(edge.width_m)) ? Number(edge.width_m) : null,
          normalizeBool(edge.is_step_free) ? 1 : 0,
          normalizeBool(edge.is_covered) ? 1 : 0,
          Number.isFinite(Number(edge.lighting_score)) ? Number(edge.lighting_score) : null,
          normalizeBool(edge.unprotected_crossing) ? 1 : 0,
          normalizeBool(edge.tactile_paving) ? 1 : 0,
          Number.isFinite(Number(edge.noise_score)) ? Number(edge.noise_score) : null,
          Number.isFinite(Number(edge.crowd_density_score)) ? Number(edge.crowd_density_score) : null,
          Number.isFinite(Number(edge.turn_severity)) ? Number(edge.turn_severity) : null,
          confidence,
          edge.source || 'seed',
          JSON.stringify(geometry),
          bbox.minLat,
          bbox.minLon,
          bbox.maxLat,
          bbox.maxLon
        ]
      );
    } else {
      await adapter.run(
        `INSERT INTO routing_edges (
          id, from_node_id, to_node_id, length_m, ascent_m, descent_m,
          slope_avg_pct, slope_max_pct, cross_slope_pct, surface_type_id,
          width_m, is_step_free, is_covered, lighting_score,
          unprotected_crossing, tactile_paving, noise_score, crowd_density_score, turn_severity,
          confidence_score, source, updated_at, geometry_geojson,
          spot_check_count
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10,
          $11, $12, $13, $14,
          $15, $16, $17, $18, $19,
          $20, $21, NOW(), $22,
          0
        ) ON CONFLICT (id) DO NOTHING`,
        [
          edge.id,
          edge.from_node_id,
          edge.to_node_id,
          Number(edge.length_m),
          Number(edge.ascent_m || 0),
          Number(edge.descent_m || 0),
          Number(edge.slope_avg_pct || 0),
          Number(edge.slope_max_pct || 0),
          Number.isFinite(Number(edge.cross_slope_pct)) ? Number(edge.cross_slope_pct) : null,
          edge.surface_type_id || null,
          Number.isFinite(Number(edge.width_m)) ? Number(edge.width_m) : null,
          normalizeBool(edge.is_step_free),
          normalizeBool(edge.is_covered),
          Number.isFinite(Number(edge.lighting_score)) ? Number(edge.lighting_score) : null,
          normalizeBool(edge.unprotected_crossing),
          normalizeBool(edge.tactile_paving),
          Number.isFinite(Number(edge.noise_score)) ? Number(edge.noise_score) : null,
          Number.isFinite(Number(edge.crowd_density_score)) ? Number(edge.crowd_density_score) : null,
          Number.isFinite(Number(edge.turn_severity)) ? Number(edge.turn_severity) : null,
          confidence,
          edge.source || 'seed',
          JSON.stringify(geometry)
        ]
      );
    }

    for (const sample of Array.isArray(edge.slope_samples) ? edge.slope_samples : []) {
      const method = String(sample.method || 'seed').trim() || 'seed';
      if (adapter.dialect === 'sqlite') {
        await adapter.run(
          `INSERT INTO edge_slope_samples(edge_id, position_m, slope_pct, elevation_m, method, measured_at, source)
           VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`,
          [
            edge.id,
            Number(sample.position_m || 0),
            Number(sample.slope_pct || 0),
            Number.isFinite(Number(sample.elevation_m)) ? Number(sample.elevation_m) : null,
            method,
            edge.source || 'seed'
          ]
        );
      } else {
        await adapter.run(
          `INSERT INTO edge_slope_samples(edge_id, position_m, slope_pct, elevation_m, method, measured_at, source)
           VALUES ($1, $2, $3, $4, $5, NOW(), $6)`,
          [
            edge.id,
            Number(sample.position_m || 0),
            Number(sample.slope_pct || 0),
            Number.isFinite(Number(sample.elevation_m)) ? Number(sample.elevation_m) : null,
            method,
            edge.source || 'seed'
          ]
        );
      }
    }
  }

  for (const obstacle of Array.isArray(seedGraph.obstacles) ? seedGraph.obstacles : []) {
    const id = String(obstacle.id || '').trim();
    if (!id) continue;
    const mode = String(obstacle.mode || 'hard_block').trim() || 'hard_block';
    const severity = String(obstacle.severity || 'medium').trim() || 'medium';
    const type = String(obstacle.type || 'temporary').trim() || 'temporary';
    const startTime = obstacle.start_time || new Date().toISOString();
    const endTime = obstacle.end_time || null;
    const reportedBy = obstacle.reported_by || 'seed';
    const verificationStatus = obstacle.verification_status || 'verified';
    const penaltyMultiplier = Number.isFinite(Number(obstacle.penalty_multiplier))
      ? Number(obstacle.penalty_multiplier)
      : null;
    const polygonGeojson = obstacle.polygon_geojson ? JSON.stringify(obstacle.polygon_geojson) : null;

    if (adapter.dialect === 'sqlite') {
      await adapter.run(
        `INSERT OR IGNORE INTO obstacles(
          id, edge_id, node_id, polygon_geojson, type, severity, mode, penalty_multiplier,
          start_time, end_time, reported_by, verification_status, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          obstacle.edge_id || null,
          obstacle.node_id || null,
          polygonGeojson,
          type,
          severity,
          mode,
          penaltyMultiplier,
          startTime,
          endTime,
          reportedBy,
          verificationStatus,
          obstacle.notes || null
        ]
      );
    } else {
      await adapter.run(
        `INSERT INTO obstacles(
          id, edge_id, node_id, polygon_geojson, type, severity, mode, penalty_multiplier,
          start_time, end_time, reported_by, verification_status, notes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (id) DO NOTHING`,
        [
          id,
          obstacle.edge_id || null,
          obstacle.node_id || null,
          polygonGeojson,
          type,
          severity,
          mode,
          penaltyMultiplier,
          startTime,
          endTime,
          reportedBy,
          verificationStatus,
          obstacle.notes || null
        ]
      );
    }
  }

  return true;
}

function hydrateProfile(row, ruleRows) {
  const base = PROFILE_CONFIGS[row.id] || PROFILE_CONFIGS['default-walking'];
  const merged = { ...base };

  for (const rule of ruleRows) {
    if (String(rule.rule_key) !== 'weights') continue;
    const value = typeof rule.rule_value_json === 'string'
      ? safeJsonParse(rule.rule_value_json, null)
      : rule.rule_value_json;
    if (value && typeof value === 'object') {
      Object.assign(merged, value);
    }
  }

  merged.id = row.id;
  merged.name = row.name || merged.name;
  merged.description = row.description || merged.description;
  return merged;
}

function groupSamplesByEdge(rows) {
  const map = new Map();
  for (const row of rows) {
    const edgeId = String(row.edge_id);
    if (!map.has(edgeId)) map.set(edgeId, []);
    map.get(edgeId).push({
      id: row.id,
      edge_id: edgeId,
      position_m: Number(row.position_m || 0),
      slope_pct: Number(row.slope_pct || 0),
      elevation_m: Number.isFinite(Number(row.elevation_m)) ? Number(row.elevation_m) : null,
      method: row.method || null,
      measured_at: row.measured_at || null,
      source: row.source || null,
      notes: row.notes || null
    });
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.position_m - b.position_m);
  }
  return map;
}

function parseEdgeRow(row, surfaceById, samplesByEdge) {
  const geometry = safeJsonParse(row.geometry_geojson, []);
  return {
    id: row.id,
    from_node_id: row.from_node_id,
    to_node_id: row.to_node_id,
    length_m: Number(row.length_m || 0),
    ascent_m: Number(row.ascent_m || 0),
    descent_m: Number(row.descent_m || 0),
    slope_avg_pct: Number(row.slope_avg_pct || 0),
    slope_max_pct: Number(row.slope_max_pct || 0),
    cross_slope_pct: Number.isFinite(Number(row.cross_slope_pct)) ? Number(row.cross_slope_pct) : null,
    surface_type_id: row.surface_type_id || null,
    width_m: Number.isFinite(Number(row.width_m)) ? Number(row.width_m) : null,
    is_step_free: normalizeBool(row.is_step_free),
    is_covered: normalizeBool(row.is_covered),
    lighting_score: Number.isFinite(Number(row.lighting_score)) ? Number(row.lighting_score) : null,
    unprotected_crossing: normalizeBool(row.unprotected_crossing),
    tactile_paving: normalizeBool(row.tactile_paving),
    noise_score: Number.isFinite(Number(row.noise_score)) ? Number(row.noise_score) : 0,
    crowd_density_score: Number.isFinite(Number(row.crowd_density_score)) ? Number(row.crowd_density_score) : 0,
    turn_severity: Number.isFinite(Number(row.turn_severity)) ? Number(row.turn_severity) : 0,
    confidence_score: Number.isFinite(Number(row.confidence_score)) ? Number(row.confidence_score) : sourceBaseConfidence(row.source),
    spot_check_count: Number.isFinite(Number(row.spot_check_count)) ? Number(row.spot_check_count) : 0,
    spot_check_last_at: row.spot_check_last_at || null,
    source: row.source || null,
    updated_at: row.updated_at || null,
    geometry: Array.isArray(geometry) ? geometry : [],
    slope_samples: samplesByEdge.get(String(row.id)) || [],
    surface: surfaceById.get(String(row.surface_type_id || '')) || null
  };
}

function createRoutingDataAccess(options = {}) {
  const sqliteDb = options.sqliteDb || null;
  const pgPool = options.pgPool || null;
  const adapter = pgPool ? createPostgresAdapter(pgPool) : createSqliteAdapter(sqliteDb);

  async function ensureSeedData(seedPath) {
    const seedGraph = loadSeedGraph(seedPath);
    await seedSurfaceTypes(adapter, seedGraph.surfaces.length ? seedGraph.surfaces : DEFAULT_SURFACES);
    await seedProfiles(adapter);
    await seedGraphIfEmpty(adapter, seedGraph);
  }

  async function getProfile(profileId) {
    const list = await getProfiles();
    const key = String(profileId || '').trim().toLowerCase();
    return list.find((profile) => profile.id === key) || PROFILE_CONFIGS['default-walking'];
  }

  async function getProfiles() {
    const rows = await adapter.all('SELECT id, name, description FROM profiles ORDER BY name ASC');
    if (!rows.length) return listProfiles().map((profile) => ({ ...PROFILE_CONFIGS[profile.id] }));

    const ruleRows = await adapter.all('SELECT profile_id, rule_key, rule_value_json, priority FROM profile_rules ORDER BY priority ASC');
    return rows.map((row) => {
      const rules = ruleRows.filter((rule) => rule.profile_id === row.id);
      return hydrateProfile(row, rules);
    });
  }

  async function getActiveObstacles(atTime) {
    const nowIso = atTime || new Date().toISOString();
    if (adapter.dialect === 'sqlite') {
      return adapter.all(
        `SELECT * FROM obstacles WHERE datetime(start_time) <= datetime(?)
         AND (end_time IS NULL OR datetime(end_time) >= datetime(?))`,
        [nowIso, nowIso]
      );
    }

    return adapter.all(
      `SELECT * FROM obstacles WHERE start_time <= $1
       AND (end_time IS NULL OR end_time >= $1)`,
      [nowIso]
    );
  }

  async function getGraphData() {
    const nodeRows = await adapter.all('SELECT * FROM routing_nodes');
    const edgeRows = await adapter.all('SELECT * FROM routing_edges');
    const sampleRows = await adapter.all('SELECT * FROM edge_slope_samples ORDER BY edge_id, position_m ASC');
    const surfaceRows = await adapter.all('SELECT * FROM surface_types');

    const samplesByEdge = groupSamplesByEdge(sampleRows);
    const surfaceById = new Map(surfaceRows.map((surface) => [String(surface.id), {
      id: surface.id,
      name: surface.name,
      rolling_resistance_coeff: Number(surface.rolling_resistance_coeff || 1),
      slip_risk_wet_coeff: Number(surface.slip_risk_wet_coeff || 1),
      notes: surface.notes || null
    }]));

    return {
      nodes: nodeRows.map((row) => ({
        id: row.id,
        lat: Number(row.lat),
        lon: Number(row.lon),
        elevation_m: Number.isFinite(Number(row.elevation_m)) ? Number(row.elevation_m) : null,
        source: row.source || null,
        updated_at: row.updated_at || null
      })),
      edges: edgeRows.map((row) => parseEdgeRow(row, surfaceById, samplesByEdge))
    };
  }

  async function getEdgeMetadata(edgeId, atTime) {
    const row = adapter.dialect === 'sqlite'
      ? await adapter.get('SELECT * FROM routing_edges WHERE id = ?', [edgeId])
      : await adapter.get('SELECT * FROM routing_edges WHERE id = $1', [edgeId]);
    if (!row) return null;

    const surfaceRows = await adapter.all('SELECT * FROM surface_types');
    const surfaceById = new Map(surfaceRows.map((surface) => [String(surface.id), {
      id: surface.id,
      name: surface.name,
      rolling_resistance_coeff: Number(surface.rolling_resistance_coeff || 1),
      slip_risk_wet_coeff: Number(surface.slip_risk_wet_coeff || 1),
      notes: surface.notes || null
    }]));
    const samples = adapter.dialect === 'sqlite'
      ? await adapter.all('SELECT * FROM edge_slope_samples WHERE edge_id = ? ORDER BY position_m ASC', [edgeId])
      : await adapter.all('SELECT * FROM edge_slope_samples WHERE edge_id = $1 ORDER BY position_m ASC', [edgeId]);
    const obstacles = await getActiveObstacles(atTime);
    const edgeObstacles = obstacles.filter((obs) => String(obs.edge_id || '') === String(edgeId));

    const edge = parseEdgeRow(row, surfaceById, groupSamplesByEdge(samples));
    return {
      ...edge,
      active_obstacles: edgeObstacles,
      edge_status_hint: edgeObstacles.some((obs) => String(obs.mode || 'hard_block') === 'hard_block')
        ? 'blocked_hard'
        : (edgeObstacles.length ? 'open_with_penalty' : 'open')
    };
  }

  async function logRouteRequest(log) {
    const payload = {
      profile_id: log.profile_id,
      origin_node_id: log.origin_node_id || null,
      dest_node_id: log.dest_node_id || null,
      origin_lat: Number.isFinite(Number(log.origin_lat)) ? Number(log.origin_lat) : null,
      origin_lon: Number.isFinite(Number(log.origin_lon)) ? Number(log.origin_lon) : null,
      dest_lat: Number.isFinite(Number(log.dest_lat)) ? Number(log.dest_lat) : null,
      dest_lon: Number.isFinite(Number(log.dest_lon)) ? Number(log.dest_lon) : null,
      result_status: log.result_status,
      total_cost: Number.isFinite(Number(log.total_cost)) ? Number(log.total_cost) : null,
      total_length_m: Number.isFinite(Number(log.total_length_m)) ? Number(log.total_length_m) : null,
      total_ascent_m: Number.isFinite(Number(log.total_ascent_m)) ? Number(log.total_ascent_m) : null,
      max_slope_pct: Number.isFinite(Number(log.max_slope_pct)) ? Number(log.max_slope_pct) : null,
      confidence_score: Number.isFinite(Number(log.confidence_score)) ? Number(log.confidence_score) : null,
      explanation_json: log.explanation_json ? JSON.stringify(log.explanation_json) : null
    };

    if (adapter.dialect === 'sqlite') {
      await adapter.run(
        `INSERT INTO route_request_logs(
          profile_id, origin_node_id, dest_node_id, origin_lat, origin_lon, dest_lat, dest_lon,
          requested_at, result_status, total_cost, total_length_m, total_ascent_m, max_slope_pct,
          confidence_score, explanation_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?)`,
        [
          payload.profile_id,
          payload.origin_node_id,
          payload.dest_node_id,
          payload.origin_lat,
          payload.origin_lon,
          payload.dest_lat,
          payload.dest_lon,
          payload.result_status,
          payload.total_cost,
          payload.total_length_m,
          payload.total_ascent_m,
          payload.max_slope_pct,
          payload.confidence_score,
          payload.explanation_json
        ]
      );
      return;
    }

    await adapter.run(
      `INSERT INTO route_request_logs(
        profile_id, origin_node_id, dest_node_id, origin_lat, origin_lon, dest_lat, dest_lon,
        requested_at, result_status, total_cost, total_length_m, total_ascent_m, max_slope_pct,
        confidence_score, explanation_json
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8, $9, $10, $11, $12, $13, $14::jsonb)`,
      [
        payload.profile_id,
        payload.origin_node_id,
        payload.dest_node_id,
        payload.origin_lat,
        payload.origin_lon,
        payload.dest_lat,
        payload.dest_lon,
        payload.result_status,
        payload.total_cost,
        payload.total_length_m,
        payload.total_ascent_m,
        payload.max_slope_pct,
        payload.confidence_score,
        payload.explanation_json || '{}'
      ]
    );
  }

  async function recomputeEdgeSlopeStats(edgeId) {
    const rows = adapter.dialect === 'sqlite'
      ? await adapter.all('SELECT position_m, slope_pct FROM edge_slope_samples WHERE edge_id = ? ORDER BY position_m ASC', [edgeId])
      : await adapter.all('SELECT position_m, slope_pct FROM edge_slope_samples WHERE edge_id = $1 ORDER BY position_m ASC', [edgeId]);

    if (!rows.length) return null;

    let maxAbs = 0;
    let weighted = 0;
    let totalLen = 0;
    let prev = null;

    for (const row of rows) {
      const slope = Math.abs(Number(row.slope_pct || 0));
      maxAbs = Math.max(maxAbs, slope);
      if (prev) {
        const span = Math.max(0, Number(row.position_m || 0) - Number(prev.position_m || 0));
        if (span > 0) {
          weighted += ((Math.abs(Number(prev.slope_pct || 0)) + slope) / 2) * span;
          totalLen += span;
        }
      }
      prev = row;
    }

    const avg = totalLen > 0 ? weighted / totalLen : maxAbs;
    return {
      slope_avg_pct: Number(avg.toFixed(4)),
      slope_max_pct: Number(maxAbs.toFixed(4))
    };
  }

  async function incrementEdgeSpotCheck(edgeId) {
    const row = adapter.dialect === 'sqlite'
      ? await adapter.get('SELECT confidence_score, spot_check_count FROM routing_edges WHERE id = ?', [edgeId])
      : await adapter.get('SELECT confidence_score, spot_check_count FROM routing_edges WHERE id = $1', [edgeId]);
    if (!row) return;

    const currentCount = Number(row.spot_check_count || 0);
    const currentConfidence = Number.isFinite(Number(row.confidence_score)) ? Number(row.confidence_score) : 0.5;
    const nextCount = currentCount + 1;
    const nextConfidence = edgeConfidenceFromSignals(
      { confidence_score: currentConfidence, source: 'inclinometer' },
      { inclinometerCount: nextCount }
    );

    if (adapter.dialect === 'sqlite') {
      await adapter.run(
        `UPDATE routing_edges
         SET spot_check_count = ?,
             spot_check_last_at = CURRENT_TIMESTAMP,
             confidence_score = ?
         WHERE id = ?`,
        [nextCount, nextConfidence, edgeId]
      );
      return;
    }

    await adapter.run(
      `UPDATE routing_edges
       SET spot_check_count = $1,
           spot_check_last_at = NOW(),
           confidence_score = $2
       WHERE id = $3`,
      [nextCount, nextConfidence, edgeId]
    );
  }

  async function importInclinometerSamples(rows) {
    const errors = [];
    let inserted = 0;

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const edgeId = String(row.edge_id || '').trim();
      const positionM = Number(row.position_m);
      const slopePct = Number(row.slope_pct);
      const measuredAtIso = row.measured_at_iso ? new Date(row.measured_at_iso) : null;
      const notes = String(row.notes || '').trim() || null;
      const method = String(row.method || 'inclinometer').trim().toLowerCase() || 'inclinometer';

      if (!edgeId) {
        errors.push({ row: i + 2, error: 'edge_id is required.' });
        continue;
      }
      if (!Number.isFinite(positionM) || positionM < 0) {
        errors.push({ row: i + 2, error: 'position_m must be >= 0.' });
        continue;
      }
      if (!Number.isFinite(slopePct) || slopePct < -50 || slopePct > 50) {
        errors.push({ row: i + 2, error: 'slope_pct must be between -50 and 50.' });
        continue;
      }
      if (measuredAtIso && !Number.isFinite(measuredAtIso.getTime())) {
        errors.push({ row: i + 2, error: 'measured_at_iso is invalid.' });
        continue;
      }

      const edgeExists = adapter.dialect === 'sqlite'
        ? await adapter.get('SELECT id FROM routing_edges WHERE id = ?', [edgeId])
        : await adapter.get('SELECT id FROM routing_edges WHERE id = $1', [edgeId]);
      if (!edgeExists) {
        errors.push({ row: i + 2, error: `edge_id ${edgeId} does not exist.` });
        continue;
      }

      if (adapter.dialect === 'sqlite') {
        await adapter.run(
          `INSERT INTO edge_slope_samples(edge_id, position_m, slope_pct, elevation_m, method, measured_at, source, notes)
           VALUES (?, ?, ?, NULL, ?, ?, ?, ?)`,
          [
            edgeId,
            positionM,
            slopePct,
            method,
            measuredAtIso ? measuredAtIso.toISOString() : new Date().toISOString(),
            'inclinometer',
            notes
          ]
        );
      } else {
        await adapter.run(
          `INSERT INTO edge_slope_samples(edge_id, position_m, slope_pct, elevation_m, method, measured_at, source, notes)
           VALUES ($1, $2, $3, NULL, $4, $5, $6, $7)`,
          [
            edgeId,
            positionM,
            slopePct,
            method,
            measuredAtIso ? measuredAtIso.toISOString() : new Date().toISOString(),
            'inclinometer',
            notes
          ]
        );
      }

      const stats = await recomputeEdgeSlopeStats(edgeId);
      if (stats) {
        if (adapter.dialect === 'sqlite') {
          await adapter.run(
            'UPDATE routing_edges SET slope_avg_pct = ?, slope_max_pct = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [stats.slope_avg_pct, stats.slope_max_pct, edgeId]
          );
        } else {
          await adapter.run(
            'UPDATE routing_edges SET slope_avg_pct = $1, slope_max_pct = $2, updated_at = NOW() WHERE id = $3',
            [stats.slope_avg_pct, stats.slope_max_pct, edgeId]
          );
        }
      }

      await incrementEdgeSpotCheck(edgeId);
      inserted += 1;
    }

    return {
      inserted,
      failed: errors.length,
      errors
    };
  }

  return {
    adapter,
    ensureSeedData,
    getProfile,
    getProfiles,
    getGraphData,
    getEdgeMetadata,
    getActiveObstacles,
    logRouteRequest,
    importInclinometerSamples
  };
}

module.exports = {
  createRoutingDataAccess,
  loadSeedGraph,
  computeBboxFromGeometry,
  normalizeBool
};
