# Documentation

## Why Slope-Aware Routing Matters
Distance-only routing can select paths that are technically short but inaccessible for many users. This project adds profile-specific constraints and explainable penalties for slope, sustained grade, cross-slope, surface, width, lighting, crossings, and environmental context.

## What Was Added

### New API Endpoints
- `GET /api/accessibility/profiles`
- `GET|POST /api/accessibility/route`
- `GET /api/accessibility/edges/:edgeId`
- `GET /api/accessibility/edges?ids=e1,e2`
- `POST /api/admin/inclinometer-import` (CSV upload)

### New Routing Output Fields
- `nodes`, `edges`
- `total_length_m`, `total_ascent_m`, `total_descent_m`
- `max_slope_pct`, `total_cost`, `estimated_time_ms`
- `confidence_score`
- `explanation.top_reasons`
- `explanation.edge_costs[]` (per-edge term contributions)

## Data Sources and Licensing Notes

### Preferred Irish high-resolution source
- Tailte Éireann Height Data products (DTM/DSM/LiDAR where available):
  - https://www.tailte.ie/en/surveying/data-products/height-data/

### Free baseline (coarser)
- Copernicus DEM COG catalog/naming:
  - https://copernicus-dem-30m.s3.amazonaws.com/readme.html

For UCC (`~51.89N, -8.49W`), baseline tile to download:
- `Copernicus_DSM_COG_10_N51_00_W009_00_DEM/Copernicus_DSM_COG_10_N51_00_W009_00_DEM.tif`

Do not auto-download in code.

## Elevation Ingestion (JS-only)

### Main scripts
- `tools/elevation/enrich_graph.js` (GeoTIFF sampling path)
- `tools/elevation/lut_sampler.js` (fallback grid interpolation)

### Command examples

```bash
node tools/elevation/enrich_graph.js \
  --graph-in fixtures/seed-routing-graph.json \
  --graph-out /tmp/seed-routing-graph.enriched.json \
  --raster /data/Copernicus_DSM_COG_10_N51_00_W009_00_DEM.tif \
  --sample-interval-m 2 \
  --source-name "Copernicus DEM 30m"
```

```bash
node tools/elevation/lut_sampler.js \
  --graph-in fixtures/seed-routing-graph.json \
  --grid-in tools/elevation/sample-grid.template.json \
  --graph-out /tmp/seed-routing-graph.lut.json \
  --sample-interval-m 2
```

## Spot Check Verification

### CSV format
`edge_id,position_m,slope_pct,measured_at_iso,method,notes`

Validation rules:
- `edge_id` required
- `position_m >= 0`
- `slope_pct` must be numeric in `[-50, 50]`
- `measured_at_iso` optional but must be valid ISO if present

Imported inclinometer samples:
- append to `edge_slope_samples`
- recompute `slope_avg_pct` and `slope_max_pct`
- increment edge spot-check count and confidence

## Confidence Score Interpretation
- `0.0-0.49`: low trust, sparse/low-quality source coverage
- `0.50-0.74`: moderate trust, usable but still calibrating
- `0.75-0.89`: strong trust, good source/supporting samples
- `0.90+`: very strong trust, often boosted by validated spot checks

Confidence measures reliability of edge attributes, not guaranteed obstacle absence.

## Add a New Profile
1. Add profile config in `routing/profiles.js`.
2. Ensure weights/thresholds are numeric and explainable.
3. Seed profile via startup (`ensureSeedData`).
4. Validate behavior with deterministic tests in `tests/`.

## Runtime Note (Current Environment)
If `server.js` fails with `sqlite3 ... invalid ELF header`, reinstall dependencies in the runtime where Node executes so native modules are rebuilt for that host.
