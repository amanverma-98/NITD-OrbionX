"""
OrbionX – AI Space Intelligence Platform
Main FastAPI Application

Initializes the application with:
- CORS middleware for frontend communication
- Background tasks for TLE ingestion, position tracking, collision detection
- Lifespan management for DB connections
"""

import os
import asyncio
from contextlib import asynccontextmanager
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database.db import connect_db, close_db
from data_sources.tle_fetcher import run_ingestion_pipeline
from services.satellite_service import update_all_positions, run_collision_check
from ai_models.risk_predictor import load_model

from api.satellite_routes import router as satellite_router
from api.collision_routes import router as collision_router
from api.risk_routes import router as risk_router

load_dotenv()

# Configuration
TLE_FETCH_INTERVAL = int(os.getenv("TLE_FETCH_INTERVAL", 60))
POSITION_UPDATE_INTERVAL = int(os.getenv("POSITION_UPDATE_INTERVAL", 60))
COLLISION_CHECK_INTERVAL = int(os.getenv("COLLISION_CHECK_INTERVAL", 120))
API_PREFIX = os.getenv("API_PREFIX", "/api/v1").strip()

# Background task references
_background_tasks = []


async def tle_ingestion_loop():
    """Background loop: fetch TLE data from Celestrak every 60 seconds."""
    while True:
        try:
            await run_ingestion_pipeline()
        except Exception as e:
            print(f"[BG] TLE ingestion error: {e}")
        await asyncio.sleep(TLE_FETCH_INTERVAL)


async def position_update_loop():
    """Background loop: update satellite positions every 60 seconds."""
    # Wait for initial TLE data to be available
    await asyncio.sleep(10)
    while True:
        try:
            await update_all_positions()
        except Exception as e:
            print(f"[BG] Position update error: {e}")
        await asyncio.sleep(POSITION_UPDATE_INTERVAL)


async def collision_detection_loop():
    """Background loop: run collision detection every 120 seconds."""
    # Wait for positions to be computed first
    await asyncio.sleep(30)
    while True:
        try:
            await run_collision_check()
        except Exception as e:
            print(f"[BG] Collision detection error: {e}")
        await asyncio.sleep(COLLISION_CHECK_INTERVAL)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application lifespan handler.
    Startup: Connect DB, load ML model, start background tasks.
    Shutdown: Cancel background tasks, close DB.
    """
    print("=" * 60)
    print("  OrbionX – AI Space Intelligence Platform")
    print("  Starting up...")
    print("=" * 60)

    # Connect to MongoDB
    await connect_db()

    # Load ML model
    load_model()

    # Start background tasks
    tasks = [
        asyncio.create_task(tle_ingestion_loop()),
        asyncio.create_task(position_update_loop()),
        asyncio.create_task(collision_detection_loop()),
    ]
    _background_tasks.extend(tasks)

    print("[STARTUP] Background tasks started")
    print("[STARTUP] Ready to accept requests")

    yield

    # Shutdown
    print("[SHUTDOWN] Cancelling background tasks...")
    for task in _background_tasks:
        task.cancel()

    await close_db()
    print("[SHUTDOWN] OrbionX stopped")


# ─── Create FastAPI App ────────────────────────────────────
app = FastAPI(
    title="OrbionX – AI Space Intelligence Platform",
    description=(
        "Real-time satellite tracking, orbital propagation, "
        "collision detection, and AI-based risk prediction API."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

# ─── CORS Middleware ───────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Register Routers ─────────────────────────────────────
app.include_router(satellite_router)
app.include_router(collision_router)
app.include_router(risk_router)

if API_PREFIX and API_PREFIX != "/":
    normalized_prefix = API_PREFIX if API_PREFIX.startswith("/") else f"/{API_PREFIX}"
    app.include_router(satellite_router, prefix=normalized_prefix)
    app.include_router(collision_router, prefix=normalized_prefix)
    app.include_router(risk_router, prefix=normalized_prefix)


# ─── Root Endpoint ─────────────────────────────────────────
@app.get("/", tags=["Health"])
async def root():
    """Health check / welcome endpoint."""
    prefix = API_PREFIX if API_PREFIX.startswith("/") else f"/{API_PREFIX}" if API_PREFIX else ""
    base = prefix.rstrip("/")
    return {
        "name": "OrbionX",
        "version": "1.0.0",
        "status": "operational",
        "description": "AI Space Intelligence Platform",
        "api_prefix": base or "(none)",
        "endpoints": {
            "satellites": f"{base}/satellites" if base else "/satellites",
            "live_tracking": f"{base}/satellites/live" if base else "/satellites/live",
            "collisions": f"{base}/collisions" if base else "/collisions",
            "risk_analysis": f"{base}/risk-analysis" if base else "/risk-analysis",
            "orbit_prediction": f"{base}/orbit/{{satellite_id}}/predict" if base else "/orbit/{satellite_id}/predict",
            "docs": "/docs",
        },
    }
