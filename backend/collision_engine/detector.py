"""
OrbionX Collision Detection Engine
Uses KD-Tree (scipy.spatial.cKDTree) for O(n log n) spatial indexing.

Instead of checking all O(n²) satellite pairs, we:
1. Build a KD-Tree from 3D ECI positions
2. Query for all pairs within the collision threshold
3. Enrich results with AI-based risk prediction
"""

import os
import numpy as np
from datetime import datetime
from scipy.spatial import cKDTree
from database.db import get_db

# Default collision threshold in km
DEFAULT_THRESHOLD_KM = float(os.getenv("COLLISION_SCREENING_DISTANCE_KM", "8.0"))
HIGH_DISTANCE_KM = float(os.getenv("COLLISION_HIGH_DISTANCE_KM", "2.0"))
MEDIUM_DISTANCE_KM = float(os.getenv("COLLISION_MEDIUM_DISTANCE_KM", "5.0"))
HIGH_RELATIVE_VELOCITY_KM_S = float(os.getenv("COLLISION_HIGH_RELATIVE_VELOCITY_KM_S", "8.0"))


def _classify_geometric_risk(distance_km: float, relative_velocity_km_s: float, altitude_diff_km: float) -> str:
    """Classify geometric encounter risk from distance, relative speed, and orbital similarity."""
    if distance_km <= HIGH_DISTANCE_KM:
        return "HIGH"

    if distance_km <= MEDIUM_DISTANCE_KM:
        if relative_velocity_km_s >= HIGH_RELATIVE_VELOCITY_KM_S or altitude_diff_km <= 25:
            return "HIGH"
        return "MEDIUM"

    if distance_km <= DEFAULT_THRESHOLD_KM:
        return "MEDIUM"

    return "LOW"


async def detect_collisions(positions: list, threshold_km: float = DEFAULT_THRESHOLD_KM) -> list:
    """
    Detect potential collisions using KD-Tree spatial indexing.

    Algorithm:
        1. Extract 3D ECI coordinates from all satellite positions
        2. Build a cKDTree (O(n log n) construction)
        3. Query pairs within threshold distance (O(n log n) average)
        4. Generate collision records for each pair found

    Parameters:
        positions: list of dicts with x_eci, y_eci, z_eci, norad_id, name, etc.
        threshold_km: distance threshold for collision warnings (default 5 km)

    Returns:
        List of collision dicts with satellite info, distance, and metadata
    """
    if len(positions) < 2:
        return []

    # Extract ECI coordinates into numpy array
    coords = np.array([
        [p["x_eci"], p["y_eci"], p["z_eci"]]
        for p in positions
    ])

    # Build KD-Tree for efficient spatial queries
    # cKDTree is the C-optimized version for better performance
    tree = cKDTree(coords)

    # Query all pairs within threshold distance
    # Returns sets of indices for pairs within the distance
    pairs = tree.query_pairs(r=threshold_km)

    collisions = []
    timestamp = datetime.utcnow()

    for i, j in pairs:
        sat1 = positions[i]
        sat2 = positions[j]

        # Compute exact Euclidean distance
        # distance = sqrt((x2-x1)² + (y2-y1)² + (z2-z1)²)
        distance = float(np.linalg.norm(coords[i] - coords[j]))

        # Compute relative velocity magnitude
        relative_velocity = 0.0
        if all(k in sat1 for k in ["vx", "vy", "vz"]) and \
           all(k in sat2 for k in ["vx", "vy", "vz"]):
            vel_diff = np.array([
                sat2["vx"] - sat1["vx"],
                sat2["vy"] - sat1["vy"],
                sat2["vz"] - sat1["vz"]
            ])
            relative_velocity = float(np.linalg.norm(vel_diff))

        # Altitude difference
        altitude_diff = abs(sat1.get("altitude_km", 0) - sat2.get("altitude_km", 0))

        risk_level = _classify_geometric_risk(
            distance_km=distance,
            relative_velocity_km_s=relative_velocity,
            altitude_diff_km=altitude_diff,
        )

        collision = {
            "satellite1_id": sat1["norad_id"],
            "satellite1_name": sat1.get("name", "Unknown"),
            "satellite2_id": sat2["norad_id"],
            "satellite2_name": sat2.get("name", "Unknown"),
            "distance_km": round(distance, 4),
            "risk_level": risk_level,
            "relative_velocity": round(relative_velocity, 4),
            "altitude_diff": round(altitude_diff, 3),
            "timestamp": timestamp,
        }
        collisions.append(collision)

    print(f"[COLLISION] Detected {len(collisions)} potential collision pairs")
    return collisions


async def store_collisions(collisions: list) -> int:
    """
    Store collision records in MongoDB.
    Replaces previous collision data with fresh detection results.
    """
    db = get_db()
    if db is None or not collisions:
        return 0

    # Clear old collision records and insert fresh ones
    await db.collisions.delete_many({})

    if collisions:
        result = await db.collisions.insert_many(collisions)
        print(f"[COLLISION] Stored {len(result.inserted_ids)} collision records")
        return len(result.inserted_ids)

    return 0


async def run_collision_detection(positions: list, threshold_km: float = DEFAULT_THRESHOLD_KM) -> list:
    """
    Full collision detection pipeline:
    1. Detect collisions using KD-Tree
    2. Store results in MongoDB
    3. Return collision list
    """
    collisions = await detect_collisions(positions, threshold_km)
    if collisions:
        await store_collisions(collisions)
    return collisions
