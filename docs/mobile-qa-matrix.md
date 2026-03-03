# Mobile QA Matrix (iOS Safari + Android Chrome)

## Scope
- Device class: phone-first (`<= 900px`)
- Browsers: iOS Safari (latest), Android Chrome (latest)
- Build target: local presentation build with live API proxy

## Test Setup
1. Start backend API: `npm run dev` (port `3000`).
2. Start frontend dev server: `npm run dev:vite` (port `5173`).
3. Open on phone using LAN URL: `http://<your-laptop-ip>:5173`.
4. Keep GraphHopper running if route-quality checks are required.

## Matrix

| Area | iOS Safari | Android Chrome | Pass Criteria |
|---|---|---|---|
| Initial load + layout | Pass | Pass | Map fills viewport; controls are collapsed to map-first mode. |
| Dynamic viewport resize (address bar) | Patched | Patched | No clipped panel/footer after scroll or orientation change. |
| Safe-area insets (notch/home bar) | Patched | N/A/Pass | Controls and dock remain visible above inset areas. |
| Quick-tag symbol tap | Patched | Patched | First tap reliably selects symbol with feedback, no double-trigger. |
| Quick-tag map placement | Pass | Pass | Tap map posts barrier and shows confirmation marker/feedback. |
| Focus + keyboard navigation | Pass | Pass | Visible focus ring and logical navigation order. |
| Form zoom on input focus | Patched | Pass | No disruptive auto-zoom on mobile text/select fields. |
| Voice report support | Fallback Patched | Pass/Fallback | If speech API unavailable/blocked, opens manual report form. |
| Admin panel + controls interaction | Pass | Pass | Overlays do not block core route/report actions unintentionally. |
| Route rendering + gradient heat strip | Pass | Pass | Red route and green/amber/red gradient strip are visible and aligned. |
| Network via phone (LAN dev) | Patched | Patched | Frontend reachable from phone using laptop IP. |

## Regression Checks After Any UI Change
1. Open/close controls 5 times while panning map.
2. Select each quick-tag symbol and place a report.
3. Calculate route and verify both dashed routes + heat strip appear.
4. Open report modal, attach image, submit.
5. Trigger voice report once (or verify fallback opens modal).
6. Rotate phone portrait/landscape and re-check layout.

## Known Operational Notes
- Voice capture availability depends on browser support and permissions.
- If mobile routing fails with origin errors, confirm phone is using the frontend LAN URL and backend is running behind Vite proxy.
