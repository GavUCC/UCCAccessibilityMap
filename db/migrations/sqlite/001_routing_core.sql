PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS data_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  licence TEXT,
  url TEXT,
  coverage_notes TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS routing_nodes (
  id TEXT PRIMARY KEY,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  elevation_m REAL,
  source TEXT,
  updated_at DATETIME NOT NULL,
  geometry_geojson TEXT,
  bbox_min_lat REAL,
  bbox_min_lon REAL,
  bbox_max_lat REAL,
  bbox_max_lon REAL
);

CREATE TABLE IF NOT EXISTS surface_types (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  rolling_resistance_coeff REAL NOT NULL,
  slip_risk_wet_coeff REAL NOT NULL,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS routing_edges (
  id TEXT PRIMARY KEY,
  from_node_id TEXT NOT NULL,
  to_node_id TEXT NOT NULL,
  length_m REAL NOT NULL CHECK(length_m > 0),
  ascent_m REAL NOT NULL DEFAULT 0,
  descent_m REAL NOT NULL DEFAULT 0,
  slope_avg_pct REAL NOT NULL DEFAULT 0,
  slope_max_pct REAL NOT NULL DEFAULT 0,
  cross_slope_pct REAL,
  surface_type_id TEXT,
  width_m REAL,
  is_step_free INTEGER NOT NULL DEFAULT 1,
  is_covered INTEGER NOT NULL DEFAULT 0,
  lighting_score REAL,
  unprotected_crossing INTEGER NOT NULL DEFAULT 0,
  tactile_paving INTEGER NOT NULL DEFAULT 0,
  noise_score REAL,
  crowd_density_score REAL,
  turn_severity REAL,
  confidence_score REAL NOT NULL DEFAULT 0.5,
  source TEXT,
  updated_at DATETIME NOT NULL,
  geometry_geojson TEXT NOT NULL,
  bbox_min_lat REAL NOT NULL,
  bbox_min_lon REAL NOT NULL,
  bbox_max_lat REAL NOT NULL,
  bbox_max_lon REAL NOT NULL,
  FOREIGN KEY(from_node_id) REFERENCES routing_nodes(id),
  FOREIGN KEY(to_node_id) REFERENCES routing_nodes(id),
  FOREIGN KEY(surface_type_id) REFERENCES surface_types(id)
);

CREATE TABLE IF NOT EXISTS edge_slope_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  edge_id TEXT NOT NULL,
  position_m REAL NOT NULL CHECK(position_m >= 0),
  slope_pct REAL NOT NULL,
  elevation_m REAL,
  method TEXT NOT NULL,
  measured_at DATETIME,
  source TEXT,
  notes TEXT,
  FOREIGN KEY(edge_id) REFERENCES routing_edges(id)
);

CREATE TABLE IF NOT EXISTS buildings (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  campus_zone TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS entrances (
  id TEXT PRIMARY KEY,
  building_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  door_width_m REAL NOT NULL,
  door_force_n REAL,
  has_auto_door INTEGER NOT NULL DEFAULT 0,
  step_free INTEGER NOT NULL DEFAULT 0,
  has_ramp INTEGER NOT NULL DEFAULT 0,
  ramp_slope_max_pct REAL,
  has_hearing_loop INTEGER NOT NULL DEFAULT 0,
  has_induction_loop INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  FOREIGN KEY(building_id) REFERENCES buildings(id),
  FOREIGN KEY(node_id) REFERENCES routing_nodes(id)
);

CREATE TABLE IF NOT EXISTS pois (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  node_id TEXT NOT NULL,
  hours_json TEXT,
  accessible_toilet INTEGER,
  changing_places INTEGER,
  notes TEXT,
  FOREIGN KEY(node_id) REFERENCES routing_nodes(id)
);

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS profile_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id TEXT NOT NULL,
  rule_key TEXT NOT NULL,
  rule_value_json TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  FOREIGN KEY(profile_id) REFERENCES profiles(id)
);

CREATE TABLE IF NOT EXISTS obstacles (
  id TEXT PRIMARY KEY,
  edge_id TEXT,
  node_id TEXT,
  polygon_geojson TEXT,
  type TEXT NOT NULL,
  severity TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'hard_block',
  penalty_multiplier REAL,
  start_time DATETIME NOT NULL,
  end_time DATETIME,
  reported_by TEXT,
  verification_status TEXT NOT NULL DEFAULT 'unverified',
  notes TEXT,
  FOREIGN KEY(edge_id) REFERENCES routing_edges(id),
  FOREIGN KEY(node_id) REFERENCES routing_nodes(id)
);

CREATE TABLE IF NOT EXISTS route_request_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id TEXT NOT NULL,
  origin_node_id TEXT,
  dest_node_id TEXT,
  origin_lat REAL,
  origin_lon REAL,
  dest_lat REAL,
  dest_lon REAL,
  requested_at DATETIME NOT NULL,
  result_status TEXT NOT NULL,
  total_cost REAL,
  total_length_m REAL,
  total_ascent_m REAL,
  max_slope_pct REAL,
  confidence_score REAL,
  explanation_json TEXT,
  FOREIGN KEY(profile_id) REFERENCES profiles(id),
  FOREIGN KEY(origin_node_id) REFERENCES routing_nodes(id),
  FOREIGN KEY(dest_node_id) REFERENCES routing_nodes(id)
);

CREATE INDEX IF NOT EXISTS idx_data_sources_type ON data_sources(type);
CREATE INDEX IF NOT EXISTS idx_nodes_lat_lon ON routing_nodes(lat, lon);
CREATE INDEX IF NOT EXISTS idx_edges_from ON routing_edges(from_node_id);
CREATE INDEX IF NOT EXISTS idx_edges_to ON routing_edges(to_node_id);
CREATE INDEX IF NOT EXISTS idx_edges_surface ON routing_edges(surface_type_id);
CREATE INDEX IF NOT EXISTS idx_edges_updated ON routing_edges(updated_at);
CREATE INDEX IF NOT EXISTS idx_edges_bbox ON routing_edges(bbox_min_lat, bbox_max_lat, bbox_min_lon, bbox_max_lon);
CREATE INDEX IF NOT EXISTS idx_slope_samples_edge_pos ON edge_slope_samples(edge_id, position_m);
CREATE INDEX IF NOT EXISTS idx_slope_samples_measured_at ON edge_slope_samples(measured_at);
CREATE INDEX IF NOT EXISTS idx_buildings_name ON buildings(name);
CREATE INDEX IF NOT EXISTS idx_entrances_building ON entrances(building_id);
CREATE INDEX IF NOT EXISTS idx_entrances_node ON entrances(node_id);
CREATE INDEX IF NOT EXISTS idx_pois_category ON pois(category);
CREATE INDEX IF NOT EXISTS idx_pois_node ON pois(node_id);
CREATE INDEX IF NOT EXISTS idx_profiles_name ON profiles(name);
CREATE INDEX IF NOT EXISTS idx_profile_rules_profile_priority ON profile_rules(profile_id, priority);
CREATE INDEX IF NOT EXISTS idx_profile_rules_key ON profile_rules(rule_key);
CREATE UNIQUE INDEX IF NOT EXISTS uq_profile_rules_profile_key_priority ON profile_rules(profile_id, rule_key, priority);
CREATE INDEX IF NOT EXISTS idx_obstacles_time ON obstacles(start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_obstacles_edge ON obstacles(edge_id);
CREATE INDEX IF NOT EXISTS idx_obstacles_node ON obstacles(node_id);
CREATE INDEX IF NOT EXISTS idx_route_logs_requested ON route_request_logs(requested_at);
CREATE INDEX IF NOT EXISTS idx_route_logs_profile ON route_request_logs(profile_id, requested_at);
