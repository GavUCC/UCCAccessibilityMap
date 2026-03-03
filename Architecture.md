# Architecture

## Existing codebase notes
### Repository layout (active root)
- `server.js`: monolithic Express backend with SQLite access, security, GraphHopper proxy, OSRM fallback, barrier APIs, gradient APIs, admin APIs.
- `public/index.html`: single-page UI shell.
- `public/src/js/map.js`: client logic for routing, barrier reporting, gradient details, accessibility modes, admin panel interactions.
- `public/src/css/style.css`: responsive/mobile-first styling.
- `vite.config.ts`: Vite frontend dev server proxying to backend.
- `database.sqlite`: runtime SQLite file.
- `docs/`: documentation area.

### Frontend
- Vite serves `public/`.
- Map rendered with Leaflet.
- Current route flow calls `/api/route` and evaluates accessibility heuristics client-side.

### Backend
- Express + helmet + cors + rate limiting.
- Current routing endpoint `/api/route` proxies GraphHopper then falls back to OSRM.
- Current DB access for existing features is SQLite-centric in `server.js`.

### Database layer today
- SQLite database created at startup.
- Existing tables include barriers, feedback, route feedback, gradient profiles, spot checks.
- No dedicated graph schema yet.

### Current map data representation
- Route geometries: GeoJSON-like coordinate arrays from GraphHopper/OSRM.
- Barriers: point rows (`lat`, `lng`) with metadata.
- Gradient details: route-sampled segment analytics, not graph-edge persisted.

## Slope-aware routing domain model (ERD-style)

### CRS and Units
- Storage for node/edge lat/lon: EPSG:4326 (`lat`, `lon`) and/or GeoJSON in WGS84.
- Distance/elevation/sampling computations: metric CRS EPSG:2157 for Ireland.
- Slope primary unit: percent (`slope_pct`), optional derived degrees in APIs.
- Length unit: meters (`_m`).

### Core entities

#### `data_sources`
- `id` TEXT/UUID PRIMARY KEY
- `name` TEXT NOT NULL
- `type` TEXT NOT NULL
- `licence` TEXT
- `url` TEXT
- `coverage_notes` TEXT
- `created_at` DATETIME/TIMESTAMP NOT NULL DEFAULT now
Indexes:
- `idx_data_sources_type (type)`

#### `routing_nodes`
- `id` TEXT PRIMARY KEY
- `lat` REAL/DOUBLE NOT NULL
- `lon` REAL/DOUBLE NOT NULL
- `elevation_m` REAL NULL
- `source` TEXT NULL
- `updated_at` DATETIME/TIMESTAMP NOT NULL
- SQLite geometry fallback: `geometry_geojson` TEXT NULL
- SQLite bbox/index helpers: `bbox_min_lat`, `bbox_min_lon`, `bbox_max_lat`, `bbox_max_lon` REAL NULL
PostGIS variant:
- `geom geometry(Point, 4326)`
Indexes:
- `idx_nodes_lat_lon (lat, lon)`
- PostGIS: `GIST(geom)`

#### `surface_types`
- `id` TEXT PRIMARY KEY
- `name` TEXT NOT NULL UNIQUE
- `rolling_resistance_coeff` REAL NOT NULL
- `slip_risk_wet_coeff` REAL NOT NULL
- `notes` TEXT
Indexes:
- `idx_surface_types_name (name)`

#### `routing_edges`
- `id` TEXT PRIMARY KEY
- `from_node_id` TEXT NOT NULL REFERENCES `routing_nodes(id)`
- `to_node_id` TEXT NOT NULL REFERENCES `routing_nodes(id)`
- `length_m` REAL NOT NULL CHECK (`length_m` > 0)
- `ascent_m` REAL NOT NULL DEFAULT 0
- `descent_m` REAL NOT NULL DEFAULT 0
- `slope_avg_pct` REAL NOT NULL DEFAULT 0
- `slope_max_pct` REAL NOT NULL DEFAULT 0
- `cross_slope_pct` REAL NULL
- `surface_type_id` TEXT NULL REFERENCES `surface_types(id)`
- `width_m` REAL NULL
- `is_step_free` INTEGER/BOOLEAN NOT NULL DEFAULT 1
- `is_covered` INTEGER/BOOLEAN NOT NULL DEFAULT 0
- `lighting_score` REAL NULL
- `unprotected_crossing` INTEGER/BOOLEAN NOT NULL DEFAULT 0
- `tactile_paving` INTEGER/BOOLEAN NOT NULL DEFAULT 0
- `noise_score` REAL NULL
- `crowd_density_score` REAL NULL
- `turn_severity` REAL NULL
- `confidence_score` REAL NOT NULL DEFAULT 0.5
- `source` TEXT NULL
- `updated_at` DATETIME/TIMESTAMP NOT NULL
- SQLite geometry fallback: `geometry_geojson` TEXT NOT NULL
- SQLite bbox columns: `bbox_min_lat`, `bbox_min_lon`, `bbox_max_lat`, `bbox_max_lon` REAL NOT NULL
PostGIS variant:
- `geom geometry(LineString, 4326)`
Indexes:
- `idx_edges_from (from_node_id)`
- `idx_edges_to (to_node_id)`
- `idx_edges_surface (surface_type_id)`
- `idx_edges_updated (updated_at)`
- SQLite: `idx_edges_bbox (bbox_min_lat, bbox_max_lat, bbox_min_lon, bbox_max_lon)`
- PostGIS: `GIST(geom)`

#### `edge_slope_samples`
- `id` INTEGER/BIGSERIAL PRIMARY KEY
- `edge_id` TEXT NOT NULL REFERENCES `routing_edges(id)`
- `position_m` REAL NOT NULL CHECK (`position_m` >= 0)
- `slope_pct` REAL NOT NULL
- `elevation_m` REAL NULL
- `method` TEXT NOT NULL
- `measured_at` DATETIME/TIMESTAMP NULL
- `source` TEXT NULL
- `notes` TEXT NULL
Indexes:
- `idx_slope_samples_edge_pos (edge_id, position_m)`
- `idx_slope_samples_measured_at (measured_at)`

#### `buildings`
- `id` TEXT PRIMARY KEY
- `name` TEXT NOT NULL
- `campus_zone` TEXT NULL
- `notes` TEXT NULL
Indexes:
- `idx_buildings_name (name)`

#### `entrances`
- `id` TEXT PRIMARY KEY
- `building_id` TEXT NOT NULL REFERENCES `buildings(id)`
- `node_id` TEXT NOT NULL REFERENCES `routing_nodes(id)`
- `door_width_m` REAL NOT NULL
- `door_force_n` REAL NULL
- `has_auto_door` INTEGER/BOOLEAN NOT NULL DEFAULT 0
- `step_free` INTEGER/BOOLEAN NOT NULL DEFAULT 0
- `has_ramp` INTEGER/BOOLEAN NOT NULL DEFAULT 0
- `ramp_slope_max_pct` REAL NULL
- `has_hearing_loop` INTEGER/BOOLEAN NOT NULL DEFAULT 0
- `has_induction_loop` INTEGER/BOOLEAN NOT NULL DEFAULT 0
- `notes` TEXT NULL
Indexes:
- `idx_entrances_building (building_id)`
- `idx_entrances_node (node_id)`

#### `pois`
- `id` TEXT PRIMARY KEY
- `name` TEXT NOT NULL
- `category` TEXT NOT NULL
- `node_id` TEXT NOT NULL REFERENCES `routing_nodes(id)`
- `hours_json` TEXT/JSONB NULL
- `accessible_toilet` INTEGER/BOOLEAN NULL
- `changing_places` INTEGER/BOOLEAN NULL
- `notes` TEXT NULL
Indexes:
- `idx_pois_category (category)`
- `idx_pois_node (node_id)`

#### `profiles`
- `id` TEXT PRIMARY KEY
- `name` TEXT NOT NULL UNIQUE
- `description` TEXT NOT NULL
Indexes:
- `idx_profiles_name (name)`

#### `profile_rules`
- `id` INTEGER/BIGSERIAL PRIMARY KEY
- `profile_id` TEXT NOT NULL REFERENCES `profiles(id)`
- `rule_key` TEXT NOT NULL
- `rule_value_json` TEXT/JSONB NOT NULL
- `priority` INTEGER NOT NULL DEFAULT 100
Indexes:
- `idx_profile_rules_profile_priority (profile_id, priority)`
- `idx_profile_rules_key (rule_key)`

#### `obstacles`
- `id` TEXT PRIMARY KEY
- `edge_id` TEXT NULL REFERENCES `routing_edges(id)`
- `node_id` TEXT NULL REFERENCES `routing_nodes(id)`
- `polygon_geojson` TEXT NULL
- PostGIS optional: `polygon_geom geometry(Polygon, 4326)`
- `type` TEXT NOT NULL
- `severity` TEXT NOT NULL
- `mode` TEXT NOT NULL DEFAULT 'hard_block'  -- `hard_block` or `soft_penalty`
- `penalty_multiplier` REAL NULL
- `start_time` DATETIME/TIMESTAMP NOT NULL
- `end_time` DATETIME/TIMESTAMP NULL
- `reported_by` TEXT NULL
- `verification_status` TEXT NOT NULL DEFAULT 'unverified'
- `notes` TEXT NULL
Indexes:
- `idx_obstacles_time (start_time, end_time)`
- `idx_obstacles_edge (edge_id)`
- `idx_obstacles_node (node_id)`

#### `route_request_logs`
- `id` INTEGER/BIGSERIAL PRIMARY KEY
- `profile_id` TEXT NOT NULL REFERENCES `profiles(id)`
- `origin_node_id` TEXT NULL REFERENCES `routing_nodes(id)`
- `dest_node_id` TEXT NULL REFERENCES `routing_nodes(id)`
- `origin_lat` REAL NULL
- `origin_lon` REAL NULL
- `dest_lat` REAL NULL
- `dest_lon` REAL NULL
- `requested_at` DATETIME/TIMESTAMP NOT NULL
- `result_status` TEXT NOT NULL
- `total_cost` REAL NULL
- `total_length_m` REAL NULL
- `total_ascent_m` REAL NULL
- `max_slope_pct` REAL NULL
- `confidence_score` REAL NULL
- `explanation_json` TEXT/JSONB NULL
Indexes:
- `idx_route_logs_requested (requested_at)`
- `idx_route_logs_profile (profile_id, requested_at)`

### Derived concept: `EdgeStatus` (query-time)
Computed per edge at routing time from active obstacles + temporal context:
- `open`
- `blocked_hard`
- `open_with_penalty`
- `unknown`

## Routing engine design

### Service boundaries
- `routing/graph.js`: graph loading, adjacency building, nearest-node lookup.
- `routing/obstacles.js`: active obstacle evaluation and edge status overlay.
- `routing/weighting.js`: pure edge cost function and profile configuration.
- `routing/routing.js`: Dijkstra/A* path search with explainable accumulation.
- `routing/confidence.js`: edge and route confidence aggregation.
- `routing/data-access.js`: DB reads/writes for new schema.

### Edge cost function
`computeEdgeCost(edge, profileConfig, context) -> { cost, reasons[], hardConstraint }`

Cost =
- base distance term
- slope average penalty
- max slope penalty
- sustained slope penalty (from samples)
- cross slope penalty
- rolling resistance penalty
- wet slip risk penalty (weather context)
- width penalty
- lighting penalty (time-of-day context)
- exposure penalty
- profile hooks (crossings/tactile/noise/crowd)

Hard constraints return `Infinity` with reason `Hard constraint`:
- step-free required and edge not step-free
- edge max slope above hard threshold
- edge width below minimum threshold when required

### Default profile parameters (initial)
(Values are conservative defaults for campus-scale routing and should be field-calibrated)
- `manual-wheelchair`: tighter slope/width constraints, high slope weights.
- `powered-wheelchair`: higher hard slope tolerance, reduced sustained penalty.
- `mobility-scooter`: width and turn severity penalties emphasized.
- `crutches`: descent/uneven sensitivity increased.
- `blind-low-vision`: crossing penalties; tactile paving bonuses.
- `sensory-sensitive`: crowd/noise placeholders enabled.
- `default-walking`: distance-dominant, mild slope penalties.

Justification:
- Defaults are intentionally transparent and not overfit; each numeric term is explainable and can be tuned using route outcomes + spot-check data.

## Migration strategy (versioned)
- `v1` introduces graph + profile + obstacle + logging schema for routing.
- `v2` extends confidence and spot-check ingestion support.
- `v3` enforces `profile_rules` uniqueness (`profile_id + rule_key + priority`) for durable idempotent seeding.
- SQLite and Postgres migration files are kept separate but semantically aligned.

Migration execution
- SQLite: auto-apply pending migrations at server startup via migration runner.
- Postgres: SQL scripts provided for manual/CI execution (`psql`) with the same version markers.

## Implemented API contract (2026-03-03)

### `GET /api/accessibility/profiles`
- Returns available routing profiles for UI selector.

### `POST /api/accessibility/route`
Request fields:
- `startLat`, `startLon`, `endLat`, `endLon` (or `originNodeId`, `destNodeId`)
- `profileId`
- `context`:
  - `weather` (`dry`/`wet` etc.)
  - `timeOfDay` (`day`/`night`)
  - `atTime` (ISO)
- `slopeSampleMode` (`precomputed` | `on-demand` | `on-demand-force`)
- `slopeSampleIntervalM`

Response (on success):
- `status: \"ok\"`
- `profile`
- `request`
- `route`:
  - `nodes`, `edges`
  - `total_length_m`, `total_ascent_m`, `total_descent_m`
  - `max_slope_pct`, `total_cost`, `estimated_time_ms`
  - `confidence_score`
  - `geometry`
  - `explanation.top_reasons`
  - `explanation.edge_costs[]`

### `GET /api/accessibility/edges/:edgeId`
- Returns edge metadata including current active obstacle status hint and slope samples.

### `POST /api/admin/inclinometer-import`
- CSV upload endpoint.
- Validates required schema and slope ranges.
- Appends measured samples and refreshes edge slope stats + confidence.

## JS-only Elevation Pipeline Boundary
- `tools/elevation/enrich_graph.js` enriches graph from GeoTIFF (JS path).
- `tools/elevation/lut_sampler.js` is deterministic fallback without heavy geospatial stack.
- Routing and UI do not depend on raster internals; they consume enriched graph attributes only.
