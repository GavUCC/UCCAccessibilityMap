CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS data_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  licence TEXT,
  url TEXT,
  coverage_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS routing_nodes (
  id TEXT PRIMARY KEY,
  lat DOUBLE PRECISION NOT NULL,
  lon DOUBLE PRECISION NOT NULL,
  elevation_m DOUBLE PRECISION,
  source TEXT,
  updated_at TIMESTAMPTZ NOT NULL,
  geometry_geojson TEXT
);

CREATE TABLE IF NOT EXISTS surface_types (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  rolling_resistance_coeff DOUBLE PRECISION NOT NULL,
  slip_risk_wet_coeff DOUBLE PRECISION NOT NULL,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS routing_edges (
  id TEXT PRIMARY KEY,
  from_node_id TEXT NOT NULL REFERENCES routing_nodes(id),
  to_node_id TEXT NOT NULL REFERENCES routing_nodes(id),
  length_m DOUBLE PRECISION NOT NULL CHECK(length_m > 0),
  ascent_m DOUBLE PRECISION NOT NULL DEFAULT 0,
  descent_m DOUBLE PRECISION NOT NULL DEFAULT 0,
  slope_avg_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
  slope_max_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
  cross_slope_pct DOUBLE PRECISION,
  surface_type_id TEXT REFERENCES surface_types(id),
  width_m DOUBLE PRECISION,
  is_step_free BOOLEAN NOT NULL DEFAULT TRUE,
  is_covered BOOLEAN NOT NULL DEFAULT FALSE,
  lighting_score DOUBLE PRECISION,
  unprotected_crossing BOOLEAN NOT NULL DEFAULT FALSE,
  tactile_paving BOOLEAN NOT NULL DEFAULT FALSE,
  noise_score DOUBLE PRECISION,
  crowd_density_score DOUBLE PRECISION,
  turn_severity DOUBLE PRECISION,
  confidence_score DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  source TEXT,
  updated_at TIMESTAMPTZ NOT NULL,
  geometry_geojson TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS edge_slope_samples (
  id BIGSERIAL PRIMARY KEY,
  edge_id TEXT NOT NULL REFERENCES routing_edges(id),
  position_m DOUBLE PRECISION NOT NULL CHECK(position_m >= 0),
  slope_pct DOUBLE PRECISION NOT NULL,
  elevation_m DOUBLE PRECISION,
  method TEXT NOT NULL,
  measured_at TIMESTAMPTZ,
  source TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS buildings (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  campus_zone TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS entrances (
  id TEXT PRIMARY KEY,
  building_id TEXT NOT NULL REFERENCES buildings(id),
  node_id TEXT NOT NULL REFERENCES routing_nodes(id),
  door_width_m DOUBLE PRECISION NOT NULL,
  door_force_n DOUBLE PRECISION,
  has_auto_door BOOLEAN NOT NULL DEFAULT FALSE,
  step_free BOOLEAN NOT NULL DEFAULT FALSE,
  has_ramp BOOLEAN NOT NULL DEFAULT FALSE,
  ramp_slope_max_pct DOUBLE PRECISION,
  has_hearing_loop BOOLEAN NOT NULL DEFAULT FALSE,
  has_induction_loop BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS pois (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  node_id TEXT NOT NULL REFERENCES routing_nodes(id),
  hours_json JSONB,
  accessible_toilet BOOLEAN,
  changing_places BOOLEAN,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS profile_rules (
  id BIGSERIAL PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id),
  rule_key TEXT NOT NULL,
  rule_value_json JSONB NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100
);

CREATE TABLE IF NOT EXISTS obstacles (
  id TEXT PRIMARY KEY,
  edge_id TEXT REFERENCES routing_edges(id),
  node_id TEXT REFERENCES routing_nodes(id),
  polygon_geojson TEXT,
  type TEXT NOT NULL,
  severity TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'hard_block',
  penalty_multiplier DOUBLE PRECISION,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  reported_by TEXT,
  verification_status TEXT NOT NULL DEFAULT 'unverified',
  notes TEXT
);

CREATE TABLE IF NOT EXISTS route_request_logs (
  id BIGSERIAL PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id),
  origin_node_id TEXT REFERENCES routing_nodes(id),
  dest_node_id TEXT REFERENCES routing_nodes(id),
  origin_lat DOUBLE PRECISION,
  origin_lon DOUBLE PRECISION,
  dest_lat DOUBLE PRECISION,
  dest_lon DOUBLE PRECISION,
  requested_at TIMESTAMPTZ NOT NULL,
  result_status TEXT NOT NULL,
  total_cost DOUBLE PRECISION,
  total_length_m DOUBLE PRECISION,
  total_ascent_m DOUBLE PRECISION,
  max_slope_pct DOUBLE PRECISION,
  confidence_score DOUBLE PRECISION,
  explanation_json JSONB
);

CREATE INDEX IF NOT EXISTS idx_data_sources_type ON data_sources(type);
CREATE INDEX IF NOT EXISTS idx_nodes_lat_lon ON routing_nodes(lat, lon);
CREATE INDEX IF NOT EXISTS idx_edges_from ON routing_edges(from_node_id);
CREATE INDEX IF NOT EXISTS idx_edges_to ON routing_edges(to_node_id);
CREATE INDEX IF NOT EXISTS idx_edges_surface ON routing_edges(surface_type_id);
CREATE INDEX IF NOT EXISTS idx_edges_updated ON routing_edges(updated_at);
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

DO $$
BEGIN
  IF to_regtype('geometry') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'routing_nodes' AND column_name = 'geom'
    ) THEN
      EXECUTE 'ALTER TABLE routing_nodes ADD COLUMN geom geometry(Point, 4326)';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'routing_edges' AND column_name = 'geom'
    ) THEN
      EXECUTE 'ALTER TABLE routing_edges ADD COLUMN geom geometry(LineString, 4326)';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'obstacles' AND column_name = 'polygon_geom'
    ) THEN
      EXECUTE 'ALTER TABLE obstacles ADD COLUMN polygon_geom geometry(Polygon, 4326)';
    END IF;

    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_nodes_geom ON routing_nodes USING GIST(geom)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_edges_geom ON routing_edges USING GIST(geom)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_obstacles_geom ON obstacles USING GIST(polygon_geom)';
  END IF;
END
$$;
