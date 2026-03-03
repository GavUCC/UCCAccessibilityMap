PRAGMA foreign_keys = ON;

ALTER TABLE edge_slope_samples ADD COLUMN measurement_quality REAL;
ALTER TABLE routing_edges ADD COLUMN spot_check_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE routing_edges ADD COLUMN spot_check_last_at DATETIME;
