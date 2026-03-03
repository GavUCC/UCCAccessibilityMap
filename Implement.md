# Implement

## 2026-03-03 Change Log

### Completed
- Added routing schema migrations for SQLite + Postgres under `db/migrations/`.
- Added modular routing engine in `routing/`:
  - `graph.js`, `obstacles.js`, `weighting.js`, `routing.js`, `confidence.js`, `service.js`, `sampling.js`, `data-access.js`, `migrations.js`, `csv.js`.
- Added required accessibility profiles and parameterized weighting (no hardcoded if-tree behavior).
- Added on-demand slope sample mode (`precomputed`, `on-demand`, `on-demand-force`).
- Added explainable route output:
  - per-edge cost reasons
  - top route-level penalty contributors
  - route confidence
  - ascent/descent/max-slope and estimated traversal time
- Added server integration for new APIs:
  - `GET /api/accessibility/profiles`
  - `GET|POST /api/accessibility/route`
  - `GET /api/accessibility/edges/:edgeId`
  - `GET /api/accessibility/edges?ids=...`
  - `POST /api/admin/inclinometer-import` (CSV)
- Added CSV parsing + validation for inclinometer samples with confidence updates.
- Added deterministic tests:
  - `tests/weighting.test.js`
  - `tests/routing.test.js`
- Updated npm test runner to `node --test`.
- Added JS-only elevation pipeline skeleton:
  - `tools/elevation/enrich_graph.js`
  - `tools/elevation/lut_sampler.js`
  - `tools/elevation/sample-grid.template.json`
  - `tools/elevation/README.md`
- Added plain-English data flow doc:
  - `docs/elevation-data-flow.md`
- Updated UI for profile-based accessibility route flow and explainability panel.

### Runtime Limitation Found
- `server.js` could not be started in this WSL session due `sqlite3` native module mismatch (`invalid ELF header`).
- Unit tests and Vite build pass; server smoke tests are pending runtime dependency rebuild.

### Next Steps
1. Reinstall dependencies in target runtime (`npm install`) so `sqlite3` native binary matches host.
2. Start server and verify new accessibility endpoints + CSV import end-to-end.
3. (Optional) add obstacle management endpoints for full temporal overlay administration.
