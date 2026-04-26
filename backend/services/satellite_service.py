"""
OrbionX Satellite Service
Manages satellite position computation, caching, and DB operations.
"""

from datetime import datetime
from database.db import get_db
from orbit_engine.propagation import get_satellite_position, compute_eci_positions_batch
from collision_engine.detector import run_collision_detection
from ai_models.risk_predictor import enrich_collisions_with_risk

# In-memory cache for latest positions
_position_cache = {}


def classify_orbit(altitude_km: float) -> str:
    """Classify orbit type based on altitude."""
    if altitude_km < 2000:
        return "LEO"
    elif altitude_km < 35786:
        return "MEO"
    elif altitude_km < 36786:
        return "GEO"
    else:
        return "HEO"


async def get_all_satellites(limit: int = 100, skip: int = 0):
    """Get all satellites from database with pagination."""
    db = get_db()
    cursor = db.satellites.find({}).skip(skip).limit(limit)
    satellites = await cursor.to_list(length=limit)

    # Enrich with cached positions and orbit type
    for sat in satellites:
        sat["_id"] = str(sat["_id"])
        norad_id = sat.get("norad_id")
        if norad_id in _position_cache:
            cached = _position_cache[norad_id]
            sat["latitude"] = cached.get("latitude")
            sat["longitude"] = cached.get("longitude")
            sat["altitude_km"] = cached.get("altitude_km")
            sat["velocity_km_s"] = cached.get("velocity_km_s")
            sat["orbit_type"] = classify_orbit(cached.get("altitude_km", 0))

    return satellites


async def get_satellite_by_id(norad_id: int):
    """Get a specific satellite by NORAD ID."""
    db = get_db()
    sat = await db.satellites.find_one({"norad_id": norad_id})
    if sat:
        sat["_id"] = str(sat["_id"])
        if norad_id in _position_cache:
            cached = _position_cache[norad_id]
            sat.update({
                "latitude": cached.get("latitude"),
                "longitude": cached.get("longitude"),
                "altitude_km": cached.get("altitude_km"),
                "velocity_km_s": cached.get("velocity_km_s"),
                "orbit_type": classify_orbit(cached.get("altitude_km", 0)),
            })
    return sat


async def get_live_satellites(limit: int = 800):
    """Get live satellite positions from cache."""
    db = get_db()
    satellites = []

    # Get satellites from DB
    cursor = db.satellites.find({}).limit(limit)
    sat_list = await cursor.to_list(length=limit)

    for sat in sat_list:
        norad_id = sat.get("norad_id")
        entry = {
            "norad_id": norad_id,
            "name": sat.get("name", "Unknown"),
            "tle_line1": sat.get("tle_line1", ""),
            "tle_line2": sat.get("tle_line2", ""),
        }

        if norad_id in _position_cache:
            cached = _position_cache[norad_id]
            entry.update({
                "latitude": cached.get("latitude"),
                "longitude": cached.get("longitude"),
                "altitude_km": cached.get("altitude_km"),
                "velocity_km_s": cached.get("velocity_km_s"),
                "orbit_type": classify_orbit(cached.get("altitude_km", 0)),
                "x_eci": cached.get("x_eci"),
                "y_eci": cached.get("y_eci"),
                "z_eci": cached.get("z_eci"),
            })

        satellites.append(entry)

    return satellites


async def update_all_positions():
    """
    Compute and cache positions for all satellites.
    This runs as a background task every ~60 seconds.
    """
    global _position_cache
    db = get_db()
    if db is None:
        return

    # Fetch all satellites
    cursor = db.satellites.find({})
    sat_list = await cursor.to_list(length=10000)

    if not sat_list:
        print("[SAT] No satellites in database")
        return

    # Batch compute positions
    positions = compute_eci_positions_batch(sat_list)

    # Update cache and store in DB
    position_docs = []
    for pos in positions:
        _position_cache[pos["norad_id"]] = pos

        position_docs.append({
            "satellite_id": pos["norad_id"],
            "satellite_name": pos["name"],
            "latitude": pos["latitude"],
            "longitude": pos["longitude"],
            "altitude_km": pos["altitude_km"],
            "velocity_km_s": pos["velocity_km_s"],
            "x_eci": pos["x_eci"],
            "y_eci": pos["y_eci"],
            "z_eci": pos["z_eci"],
            "timestamp": datetime.utcnow(),
        })

    # Batch insert positions
    if position_docs:
        # Only keep latest positions, remove old ones to save space
        await db.positions.delete_many({})
        await db.positions.insert_many(position_docs)
        print(f"[SAT] Updated {len(position_docs)} satellite positions")

    return positions


async def run_collision_check(positions: list = None):
    """
    Run collision detection on current satellite positions.
    Uses cached positions if none provided.
    """
    if positions is None:
        positions = list(_position_cache.values())

    if not positions:
        print("[SAT] No positions available for collision check")
        return []

    # Detect collisions using KD-Tree
    collisions = await run_collision_detection(positions)

    # Enrich with ML risk predictions
    if collisions:
        collisions = enrich_collisions_with_risk(collisions)

        # Update risk levels in DB
        db = get_db()
        await db.collisions.delete_many({})
        await db.collisions.insert_many(collisions)
        print(f"[SAT] Stored {len(collisions)} collision records with AI risk")

    return collisions
