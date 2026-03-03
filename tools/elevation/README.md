# Elevation Enrichment Pipeline

This folder enriches a campus routing graph with slope attributes from elevation rasters.

## Scope

- Storage CRS for routing DB: `EPSG:4326` (lat/lon, GeoJSON)
- Metric computations for sampling/length/slope: `EPSG:2157` (Irish Transverse Mercator)
- Primary slope unit: percent (`slope_pct`)

## Pipeline Stages

- Stage A: Acquire raster tiles (`GeoTIFF`) for the campus + buffer.
- Stage B: Reproject to a consistent analysis CRS for distance-safe sampling (`EPSG:2157`), then keep output geometry in `EPSG:4326`.
- Stage C: Sample node elevations from raster.
- Stage D: Sample each edge along its geometry every `1-2m` (or configured interval).
- Stage E: Compute edge stats:
  - `ascent_m`
  - `descent_m`
  - `slope_avg_pct`
  - `slope_max_pct`
  - segment-level `slope_samples`
- Stage F: Write enriched graph JSON (or import rows into DB tables).
- Stage G: Assign `confidence_score` from source resolution + sample density + spot-check presence.

## Scripts

- `enrich_graph.js`
  - JavaScript GeoTIFF path for DEM/LiDAR enrichment.
  - Input: graph JSON + DEM/LiDAR GeoTIFF
  - Output: enriched graph JSON

- `lut_sampler.js`
  - Lightweight fallback when GeoTIFF parsing dependencies are unavailable.
  - Uses a precomputed elevation grid JSON + bilinear interpolation.

## Input Graph Contract

Expected top-level JSON shape:

```json
{
  "nodes": [{ "id": "n1", "lat": 51.89, "lon": -8.49 }],
  "edges": [{
    "id": "e1",
    "from_node_id": "n1",
    "to_node_id": "n2",
    "length_m": 21.4,
    "geometry": [[-8.49, 51.89], [-8.48, 51.90]]
  }]
}
```

## Irish Elevation Data: What to Download

Do not auto-download in code. Download manually, then pass local files to scripts.

### A) Free baseline (coarser): Copernicus DEM COG

Source catalog and naming (official):
- `https://copernicus-dem-30m.s3.amazonaws.com/readme.html`

For UCC (`~51.89N, -8.49W`) download:
- `Copernicus_DSM_COG_10_N51_00_W009_00_DEM/Copernicus_DSM_COG_10_N51_00_W009_00_DEM.tif`

If your buffer crosses degree boundaries, also fetch neighboring tiles from the same naming scheme.

### B) Irish high-resolution source (preferred): Tailte Éireann Height Data

Official product page:
- `https://www.tailte.ie/en/surveying/data-products/height-data/`

Request/download the campus AOI package including:
- DTM (Series 2 where available)
- DSM (Series 2 where available)
- LiDAR point-cloud derivative package for your AOI (if licensed/available)

Use the delivered `GeoTIFF`/grid products (or convert supplied formats to GeoTIFF) as `--raster` input.

## GeoTIFF Usage (JavaScript)

`enrich_graph.js` expects a raster already aligned to WGS84 coordinates (`EPSG:4326`) for direct sampling.
If source data is delivered in another CRS, reproject before running this script.
Install parser dependency first if needed:

```bash
npm install geotiff
```

```bash
node tools/elevation/enrich_graph.js \
  --graph-in fixtures/seed-routing-graph.json \
  --graph-out /tmp/seed-routing-graph.enriched.json \
  --raster /data/Copernicus_DSM_COG_10_N51_00_W009_00_DEM.tif \
  --sample-interval-m 2 \
  --source-name "Copernicus DEM 30m"
```

## Node LUT Fallback Usage

```bash
node tools/elevation/lut_sampler.js \
  --graph-in fixtures/seed-routing-graph.json \
  --grid-in tools/elevation/sample-grid.template.json \
  --graph-out /tmp/seed-routing-graph.lut.json \
  --sample-interval-m 2 \
  --source-name "LUT fallback"
```

## Tradeoffs

- GeoTIFF JS path (`enrich_graph.js`): best JS-only option for real DEM/LiDAR sampling.
- LUT path (`lut_sampler.js`): lightweight and deterministic, but only as good as input grid granularity.

## Next Integration Step

After enrichment, import values into:
- `routing_nodes.elevation_m`
- `routing_edges.{ascent_m,descent_m,slope_avg_pct,slope_max_pct,confidence_score}`
- `edge_slope_samples`

Keep `source` and timestamp fields updated for traceability.
