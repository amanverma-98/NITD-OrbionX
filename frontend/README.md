# OrbionX Frontend

Frontend for OrbionX real-time satellite tracking, collision monitoring, and orbit visualization.

## Run locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run lint
npm run build
```

## Recent UX Updates

- Collision visualization now shows a blinking closest-approach beacon at conjunction point.
- Collision and globe-focus flows both show backend-driven AI collision-avoidance plan metrics.
- Clicking a satellite in visualize mode shows its name directly on the globe.
- Visualize modals auto-select focused satellite when opened.
- Prediction timeline starts at first future point (not past), supports slider scrubbing/playback.
- Prediction dropdown is intentionally filtered to LEO satellites with valid TLE lines for reliable path rendering.

## Environment variables

Create a `.env` file in `frontend/` if needed:

```env
VITE_API_URL=http://localhost:8000

# Optional polling tuning (milliseconds)
VITE_SATELLITES_REFETCH_MS=30000
VITE_LIVE_SATELLITES_REFETCH_MS=5000
VITE_COLLISIONS_REFETCH_MS=5000
VITE_RISK_REFETCH_MS=10000
```

## Production checklist

- Confirm backend API is reachable from browser using `VITE_API_URL`.
- Run `npm run lint` and fix all errors before release.
- Run `npm run build` and verify `dist/` is generated.
- Serve `dist/` with a static host (Vercel, Netlify, Nginx, Azure Static Web Apps).
- Configure SPA fallback so non-root routes (`/visualization`, `/collisions`) resolve to `index.html`.
- Verify CORS allows deployed frontend origin on backend.
- Smoke-test critical flows:
	- Live satellite view loads
	- Collision list loads and `View on Globe` deep-link works
	- Collision visualize shows blinking conjunction point and satellite name label on click
	- Focused collision drawer shows AI collision-avoidance metrics/actions
	- Prediction visualize opens on future timestamp and renders trajectory path
	- Prediction dropdown options are LEO + TLE-valid satellites only

## Notes

- Routes are lazy-loaded to reduce initial bundle load time.
- Polling intervals are configurable and disabled in background tabs for lower churn.
