# Prompt

## Current User Request (2026-03-03)
Implement production-grade slope-aware routing for UCC campus using a graph model with edge attributes, disability profile weighting, confidence scoring, explainability, and future Irish DEM/LiDAR integration.

## Additional Constraint (Latest)
- Implementation artifacts should be HTML + JavaScript compatible. Avoid introducing non-JS runtime dependencies in core workflow.

## Goals
- Maintain durable project memory files for handover.
- Keep routing explainable and profile-driven.
- Preserve existing app behavior while adding `/api/accessibility/*` routing APIs.
- Support both precomputed slope samples and on-demand slope sampling mode.
- Support incremental confidence improvement via inclinometer spot checks.
- Keep data source boundaries explicit so Irish LiDAR can be plugged in later.

## Non-Goals
- No automatic download of Irish datasets.
- No heavy admin UI build for imports (API-only import is sufficient).
