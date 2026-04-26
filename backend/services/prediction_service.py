"""
OrbionX Prediction Service
Wraps the orbital propagation engine for API consumption.
"""

from database.db import get_db
from orbit_engine.propagation import predict_orbit


async def get_orbit_prediction(satellite_id: int, hours: float = 24.0, 
                                step_minutes: float = 10.0) -> dict:
    """
    Generate orbit prediction for a specific satellite.

    Parameters:
        satellite_id: NORAD ID of the satellite
        hours: prediction horizon in hours
        step_minutes: time step between prediction points

    Returns:
        dict with satellite info and trajectory time-series
    """
    db = get_db()

    # Find satellite by NORAD ID
    satellite = await db.satellites.find_one({"norad_id": satellite_id})
    if not satellite:
        return None

    # Run orbital prediction
    trajectory = predict_orbit(
        satellite["tle_line1"],
        satellite["tle_line2"],
        hours=hours,
        step_minutes=step_minutes,
    )

    return {
        "satellite_id": satellite_id,
        "satellite_name": satellite.get("name", "Unknown"),
        "hours": hours,
        "step_minutes": step_minutes,
        "points": len(trajectory),
        "trajectory": trajectory,
    }
