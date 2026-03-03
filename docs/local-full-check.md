# Local Full Check Runbook

Use this before pushing or merging.

## 1) Use one runtime consistently

Native modules (like `sqlite3`) must match your runtime.

- If you run Node in **Windows PowerShell**, run `npm install` in PowerShell.
- If you run Node in **WSL Ubuntu**, run `npm install` in WSL.

Do not mix installs across Windows and WSL.

## 2) Install dependencies

### PowerShell

```powershell
cd C:\Users\james\Downloads\UCCAccessibilityMap-main
npm install
```

### WSL

```bash
cd /mnt/c/Users/james/Downloads/UCCAccessibilityMap-main
npm install
```

## 3) Run full automated checks

```bash
npm run check:full
```

Expected result:
- tests pass
- production build succeeds
- JS syntax checks pass

## 4) Start backend and verify APIs

```bash
npm start
```

In another terminal:

```bash
curl -s http://127.0.0.1:3000/api/accessibility/profiles
curl -s -X POST http://127.0.0.1:3000/api/accessibility/route \
  -H "Content-Type: application/json" \
  -d '{"startLat":51.89308,"startLon":-8.49140,"endLat":51.89278,"endLon":-8.49088,"profileId":"default-walking"}'
curl -s http://127.0.0.1:3000/api/accessibility/edges/e1
```

Expected:
- each returns JSON (not HTML error pages)
- route endpoint returns `status: "ok"` or a clear structured route error

## 5) Frontend checks

### Vite mode

```bash
npm run dev:vite
```

Open:
- `http://localhost:5173` (desktop)
- `http://<your-lan-ip>:5173` (mobile on same Wi‑Fi)

Verify:
- profile selector loads
- route calculation works
- route details panel shows reasons
- mobile voice report: 3 seconds of silence auto-stops and saves

## 6) Branch + merge flow (manual)

```bash
git fetch gav
git switch gavin-integration-2026-03-03
git merge gav/main
```

Resolve conflicts if needed, then:

```bash
git add -A
git commit -m "Final pre-merge integration check"
git push gav gavin-integration-2026-03-03
```

Then merge to `main` manually.

