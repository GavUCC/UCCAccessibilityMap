# Elevation Data Flow (Plain English)

This project treats campus routing as a graph of nodes and edges. Elevation enrichment adds realistic slope behavior so accessibility profiles can make better route choices.

## How data moves through the system

1. Start with base graph data
- Nodes have location (`lat`, `lon`).
- Edges connect nodes and include geometry lines.

2. Add elevation source
- Prefer Irish high-resolution data (LiDAR/DTM where available).
- Use Copernicus DEM as baseline when local LiDAR is not available.

3. Sample elevation values
- Each node gets an `elevation_m` value.
- Each edge is sampled every `1-2m` (or configured interval).

4. Compute slope statistics
- From sampled elevations, compute:
  - total ascent/descent
  - average slope percent
  - maximum slope percent
  - per-segment slope samples

5. Write enriched graph attributes
- Edge-level values go to `routing_edges`.
- Segment slope values go to `edge_slope_samples`.

6. Route with profile weights
- The routing engine applies profile thresholds and penalties.
- Hard constraints can invalidate edges (e.g., step-free or max slope).
- The result includes route cost plus an explanation of major penalties.

7. Improve confidence over time
- Spot-check CSV imports (inclinometer) add measured slope samples.
- Confidence increases when measured data coverage improves.

## Why this is robust

- DEM/LiDAR details are isolated in `tools/elevation` scripts.
- The UI and routing API only consume enriched graph attributes.
- You can swap sources later without rewriting map UI logic.
