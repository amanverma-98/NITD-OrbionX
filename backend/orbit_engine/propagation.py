"""
OrbionX Orbital Mechanics Engine
SGP4 + Skyfield propagation with ECI-to-geodetic conversion.

ORBITAL MECHANICS NOTES:
─────────────────────────
SGP4 (Simplified General Perturbations Model 4):
    The SGP4 model is the standard algorithm used by NORAD and NASA for predicting
    satellite positions. It accounts for:
    - Earth's oblateness (J2 perturbation)
    - Atmospheric drag (for LEO satellites)
    - Solar/lunar gravitational perturbations
    - Earth's gravitational harmonics

ECI (Earth-Centered Inertial) Frame:
    The coordinate system where the origin is at Earth's center, the X-axis points
    toward the vernal equinox, Z-axis toward the North Pole, and Y-axis completes
    the right-handed system. Satellite positions from SGP4 are in the TEME
    (True Equator Mean Equinox) variant of ECI.

Geodetic Conversion:
    Converting ECI coordinates to latitude, longitude, and altitude requires
    accounting for Earth's rotation (sidereal time) and the WGS84 ellipsoid model.
    Skyfield handles this conversion via its Geocentric -> Geographic subpoint method.
"""

import numpy as np
from datetime import datetime, timedelta
from sgp4.api import Satrec, WGS72
from sgp4.api import jday
from skyfield.api import load, EarthSatellite
from skyfield.timelib import Time


# Load Skyfield timescale (cached)
_ts = load.timescale()


def get_satellite_position(tle_line1: str, tle_line2: str, 
                            at_time: datetime = None) -> dict:
    """
    Compute satellite position using SGP4 propagation.

    Parameters:
        tle_line1: TLE line 1 string
        tle_line2: TLE line 2 string
        at_time: datetime for position computation (default: now)

    Returns:
        dict with latitude, longitude, altitude_km, velocity_km_s,
        x/y/z ECI coordinates, and timestamp.

    Process:
        1. Initialize SGP4 satellite record from TLE
        2. Propagate to requested time → ECI position & velocity (km, km/s)
        3. Convert ECI position to geodetic (lat/lon/alt) via Skyfield
    """
    if at_time is None:
        at_time = datetime.utcnow()

    try:
        # Create Skyfield EarthSatellite from TLE lines
        satellite = EarthSatellite(tle_line1, tle_line2, ts=_ts)

        # Convert datetime to Skyfield Time object
        t = _ts.utc(at_time.year, at_time.month, at_time.day,
                     at_time.hour, at_time.minute, at_time.second)

        # Propagate: get geocentric position
        geocentric = satellite.at(t)

        # ECI position (km) and velocity (km/s) - TEME frame
        position_km = geocentric.position.km
        velocity_km_s = geocentric.velocity.km_per_s

        # Convert to geodetic coordinates (lat, lon, alt)
        # Uses WGS84 ellipsoid via Skyfield's subpoint method
        subpoint = geocentric.subpoint()
        latitude = subpoint.latitude.degrees
        longitude = subpoint.longitude.degrees
        altitude_km = subpoint.elevation.km

        # Compute velocity magnitude
        velocity_magnitude = float(np.linalg.norm(velocity_km_s))

        return {
            "latitude": round(latitude, 6),
            "longitude": round(longitude, 6),
            "altitude_km": round(altitude_km, 3),
            "velocity_km_s": round(velocity_magnitude, 4),
            "x_eci": round(float(position_km[0]), 3),
            "y_eci": round(float(position_km[1]), 3),
            "z_eci": round(float(position_km[2]), 3),
            "timestamp": at_time.isoformat(),
        }

    except Exception as e:
        print(f"[ORBIT] Propagation error: {e}")
        return None


def predict_orbit(tle_line1: str, tle_line2: str,
                  hours: float = 24.0, step_minutes: float = 10.0) -> list:
    """
    Predict future orbital trajectory as a time-series.

    Parameters:
        tle_line1: TLE line 1 string
        tle_line2: TLE line 2 string
        hours: prediction horizon in hours
        step_minutes: time step between prediction points

    Returns:
        List of position dicts over the time horizon.

    This simulates the satellite's future path by propagating the SGP4
    model forward in discrete time steps from the current time.
    """
    trajectory = []
    start_time = datetime.utcnow()
    total_steps = int((hours * 60) / step_minutes)

    for step in range(total_steps + 1):
        future_time = start_time + timedelta(minutes=step * step_minutes)
        position = get_satellite_position(tle_line1, tle_line2, at_time=future_time)
        if position:
            trajectory.append(position)

    return trajectory


def compute_eci_positions_batch(satellites: list, at_time: datetime = None) -> list:
    """
    Batch compute ECI positions for multiple satellites.
    Optimized for collision detection where we need all positions at the same epoch.

    Parameters:
        satellites: list of dicts with tle_line1, tle_line2, norad_id, name
        at_time: epoch for computation

    Returns:
        List of dicts with norad_id, name, x/y/z ECI, altitude, velocity
    """
    if at_time is None:
        at_time = datetime.utcnow()

    t = _ts.utc(at_time.year, at_time.month, at_time.day,
                 at_time.hour, at_time.minute, at_time.second)

    results = []
    for sat in satellites:
        try:
            satellite = EarthSatellite(sat["tle_line1"], sat["tle_line2"], ts=_ts)
            geocentric = satellite.at(t)

            position_km = geocentric.position.km
            velocity_km_s = geocentric.velocity.km_per_s
            subpoint = geocentric.subpoint()

            results.append({
                "norad_id": sat["norad_id"],
                "name": sat.get("name", "Unknown"),
                "x_eci": float(position_km[0]),
                "y_eci": float(position_km[1]),
                "z_eci": float(position_km[2]),
                "latitude": subpoint.latitude.degrees,
                "longitude": subpoint.longitude.degrees,
                "altitude_km": subpoint.elevation.km,
                "velocity_km_s": float(np.linalg.norm(velocity_km_s)),
                "vx": float(velocity_km_s[0]),
                "vy": float(velocity_km_s[1]),
                "vz": float(velocity_km_s[2]),
            })
        except Exception as e:
            # Skip satellites with invalid TLEs
            continue

    return results
