# OrbionX

OrbionX is an AI-powered space situational awareness platform for tracking active satellites, predicting orbital trajectories, and detecting potential conjunction events.

It combines:
- A Python FastAPI backend for telemetry ingestion, orbital propagation, collision screening, and risk scoring
- A React + Three.js frontend for 3D visualization and mission-control dashboards
- MongoDB for persistence of satellite snapshots, position updates, and collision events

## Table of Contents
- [Overview](#overview)
- [Core Features](#core-features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [System Architecture](#system-architecture)
- [Data Flow](#data-flow)
- [AI Prediction and Collision-Avoidance Workflow](#ai-prediction-and-collision-avoidance-workflow)
- [API Endpoints](#api-endpoints)
- [Getting Started](#getting-started)
- [Configuration](#configuration)
- [Docker Usage](#docker-usage)
- [Frontend Notes](#frontend-notes)
- [Troubleshooting](#troubleshooting)
- [Future Enhancements](#future-enhancements)
- [Star the Repo](#star-the-repo)
- [Team](#team)
- [License](#license)

## Overview
OrbionX continuously ingests Two-Line Element (TLE) data from Celestrak, propagates orbits using SGP4/Skyfield, identifies close satellite pairs with KD-Tree nearest-neighbor queries, and enriches events with ML-assisted risk categorization.

The UI surfaces:
- Live satellite telemetry
- Risk-ranked collision events
- Interactive globe-based orbit rendering
- Per-satellite future trajectory predictions

## Core Features
- Real-time TLE ingestion pipeline with retry handling
- Background position propagation and collision checks
- KD-Tree based collision screening for scalable pair search
- RandomForest collision risk inference + mitigation suggestions
- Orbit prediction API for up to 168-hour horizons
- Rich Three.js mission visualization with focus modes
- Collision advisory endpoint with maneuver metrics (strategy, dV, altitude trim, projected miss)
- Collision visualize mode with blinking closest-approach beacon on globe
- On-globe selected satellite name tag for faster target identification
- Prediction timeline with future-aligned start point and time scrubbing
- Prediction dropdown scoped to visualizable LEO satellites with valid TLE
- Supabase Google authentication for protected routes

## Tech Stack

### Backend
- Python 3.11
- FastAPI + Uvicorn
- MongoDB + Motor (async)
- Skyfield, SGP4, NumPy, SciPy
- scikit-learn + joblib

### Frontend
- React 18 + Vite
- React Router
- TanStack Query
- Three.js + @react-three/fiber + drei
- Axios
- TailwindCSS
- Supabase Auth

### Infra
- Docker + Docker Compose
- MongoDB 7 container

## Project Structure
```text
GFG-OrbionX/
  backend/
    main.py                    # FastAPI app + startup lifecycle
    api/                       # REST route modules
    data_sources/              # TLE ingestion pipeline
    orbit_engine/              # SGP4/Skyfield propagation
    collision_engine/          # KD-Tree conjunction detection
    ai_models/                 # ML model load/train/predict
    services/                  # Domain orchestration services
    database/                  # MongoDB connection/index bootstrap
  frontend/
    src/pages/                 # Landing, Dashboard, Visualization, etc.
    src/threejs/               # 3D globe scene + renderers
    src/hooks/                 # React Query data hooks
    src/services/              # API and Supabase clients
  docker-compose.yml           # Backend + MongoDB services
```

## System Architecture
1. Backend starts and connects to MongoDB.
2. Collision risk model is loaded from `backend/models_store/collision_model.pkl`.
3. Three long-running async loops start:
   - TLE ingestion loop
   - Position update loop
   - Collision detection loop
4. Frontend calls REST endpoints for telemetry and analytics.
5. Three.js scenes render satellites, orbits, and collision overlays.

## Data Flow
1. Fetch TLE text from Celestrak.
2. Parse into satellite records and upsert by `norad_id`.
3. Compute geodetic and ECI state vectors.
4. Cache/store latest positions.
5. Run KD-Tree conjunction detection within configurable threshold.
6. Enrich results with ML + geometric scoring.
7. Persist collision events and expose via API.
8. Frontend polls endpoints and updates dashboards and visuals.

## AI Prediction and Collision-Avoidance Workflow

OrbionX uses AI to generate collision-prevention suggestions from predicted trajectories.
The system predicts future satellite positions, detects close approaches, and returns advisory guidance through `GET /collisions/advisory`.
In the UI, both Collision Visualize and View on Globe show these AI suggestions with maneuver metrics (strategy, dV, altitude trim, projected miss).
This helps operators quickly decide which satellite should maneuver and how to reduce collision risk.

## API Endpoints
Base URL: `http://localhost:8000`

Note: Routes are mounted both without prefix and with optional `API_PREFIX` (default `/api/v1`), so both styles can exist depending on client configuration.

### Satellite
- `GET /satellites?limit=100&skip=0`
- `GET /satellites/live?limit=500`
- `GET /satellites/{norad_id}`

### Collision
- `GET /collisions?risk_level=HIGH|MEDIUM|LOW&limit=100`
- `GET /collisions/advisory?satellite1_id=...&satellite2_id=...&risk_level=HIGH&step_minutes=10`

### Prediction and Risk
- `GET /orbit/{satellite_id}/predict?hours=24&step_minutes=10`
- `GET /risk-analysis`

### Docs
- `GET /docs` (Swagger UI)

## Getting Started

### Prerequisites
- Python 3.11+
- Node.js 18+
- MongoDB 7+ (if not using Docker)
- npm

### 1) Backend setup
From project root:

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python ai_models/train_model.py
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Backend should be available at:
- API root: `http://localhost:8000/`
- Swagger docs: `http://localhost:8000/docs`

### 2) Frontend setup
In a new terminal:

```bash
cd frontend
npm install
npm run dev
```

Frontend dev server defaults to:
- `http://localhost:5173`

## Configuration

### Backend environment variables
Create `backend/.env` if needed:

```env
MONGODB_URI=mongodb://localhost:27017
DATABASE_NAME=orbionx
CELESTRAK_URL=https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle

TLE_FETCH_INTERVAL=60
POSITION_UPDATE_INTERVAL=60
COLLISION_CHECK_INTERVAL=120

COLLISION_SCREENING_DISTANCE_KM=8.0
COLLISION_HIGH_DISTANCE_KM=2.0
COLLISION_MEDIUM_DISTANCE_KM=5.0
COLLISION_HIGH_RELATIVE_VELOCITY_KM_S=8.0

API_PREFIX=/api/v1
```

### Frontend environment variables
Create `frontend/.env`:

```env
VITE_API_URL=http://localhost:8000
VITE_SUPABASE_URL=your-supabase-project-url
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
```

If Supabase keys are not provided, authenticated routes (`/dashboard`, `/collisions`, `/prediction`) require additional handling and sign-in calls will fail gracefully.

## Docker Usage
From project root:

```bash
docker compose up --build
```

This starts:
- `mongodb` on `27017`
- `backend` on `8000`

Important:
- Current compose file does not run the frontend container.
- Run frontend separately with `npm run dev`, or add a frontend service if needed.

## Frontend Notes
- Visualization route can be accessed without auth.
- Dashboard, collisions, and prediction routes are session-protected.
- Vercel SPA rewrite is configured in `frontend/vercel.json`.
- React Query is configured with aggressive caching defaults for telemetry stability.
- Collision `Visualize` and `View on Globe` now both surface AI collision-avoidance plan details.
- Collision visualize auto-focuses selected pair and renders a blinking conjunction point beacon.
- Clicking a satellite on the globe shows its name label directly in-scene.
- Prediction visualize auto-selects focused satellite and opens at the first future trajectory timestamp.
- Prediction page intentionally limits dropdown options to LEO satellites that have valid TLE data.

## Troubleshooting
- No satellites shown:
  - Verify backend is running.
  - Confirm MongoDB is reachable.
  - Check TLE source availability.
- Prediction request fails:
  - Ensure `ai_models/train_model.py` has produced `models_store/collision_model.pkl`.
- Frontend cannot reach backend:
  - Verify `VITE_API_URL` and CORS/network settings.
- Empty collision list:
  - Wait for background loops to run at least one full cycle.
  - Tune collision thresholds in backend env vars.
- Few/no satellites in prediction dropdown:
  - Only LEO satellites with valid `tle_line1` + `tle_line2` are listed by design.
  - Confirm TLE ingestion is healthy and live records include orbit metadata.

## Future Enhancements
- Launch a Satellite feature with a guided mission planner (orbit class, inclination, launch window, payload profile)
- Mission sandbox to simulate launch insertion errors and immediate post-launch collision risk
- What-if maneuver planner with fuel-budget impact and projected orbit lifetime changes
- Historical replay mode to scrub orbital states backward/forward in time for incident analysis
- Ground-station visibility and pass prediction for selected satellites
- Debris cloud and fragmentation scenario simulation for contingency drills
- Real-time alerting via WebSocket/SSE for high-risk conjunction thresholds
- Team collaboration features: shared watchlists, comments, and mission handoff notes
- Role-based access control, audit logs, and operator activity timeline
- CI/CD hardening with automated tests, lint gates, and deployment health checks

## Star the Repo
If OrbionX helps you or your team, please consider giving this repository a star on GitHub. It helps the project reach more developers and supports future improvements.

## Team
- **Aman Verma** - **ML Developer and Team Lead**
- **Somu Sharma** - **Handles Frontend and UI/UX**
- **Adeed Khan** - **Full Stack Developer**


## License
No license file is currently defined in this repository. Add a `LICENSE` file before public distribution.
