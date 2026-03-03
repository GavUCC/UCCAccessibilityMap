# Plans

## Phase Plan
- [x] Phase 1: Data model + migrations + minimal seeded graph support
- [x] Phase 2: Weighting engine + deterministic tests
- [x] Phase 3: Routing service + APIs (`/api/accessibility/route`, `/api/accessibility/edges/*`)
- [x] Phase 4: UI profile selector + route details explanation panel (minimal)
- [x] Phase 5: Elevation enrichment pipeline skeleton + docs
- [x] Phase 6: Spot-check CSV import + confidence update path
- [x] Phase 7: Documentation polish + handover notes

## Immediate Follow-ups
1. Rebuild `sqlite3` in the same runtime where `server.js` is executed (WSL vs Windows mismatch).
2. Run end-to-end API smoke checks after sqlite rebuild.
3. Optional: add integration tests for `/api/accessibility/route` and CSV import endpoint.
