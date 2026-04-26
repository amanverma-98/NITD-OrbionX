"""
OrbionX API – Collision Routes
Endpoints for collision detection results.
"""

from fastapi import APIRouter, HTTPException, Query
from database.db import get_db
from datetime import datetime
from services.prediction_service import get_orbit_prediction

router = APIRouter(prefix="/collisions", tags=["Collisions"])


def _normalize_risk(risk_level: str | None) -> str:
    normalized = (risk_level or "HIGH").upper()
    return normalized if normalized in {"HIGH", "MEDIUM", "LOW"} else "HIGH"


def _risk_window_hours(risk_level: str) -> tuple[float, float]:
    if risk_level == "LOW":
        return 96.0, 120.0
    if risk_level == "MEDIUM":
        return 72.0, 96.0
    return 24.0, 48.0


def _parse_iso_to_utc(raw: str | None) -> datetime | None:
    if not raw:
        return None
    try:
        normalized = raw if raw.endswith("Z") else f"{raw}Z"
        return datetime.fromisoformat(normalized.replace("Z", "+00:00"))
    except Exception:
        return None


def _compute_tca_in_window(traj_a: list[dict], traj_b: list[dict], risk_level: str) -> dict | None:
    sample_count = min(len(traj_a), len(traj_b))
    if sample_count < 2:
        return None

    start_hour, end_hour = _risk_window_hours(risk_level)
    start_time = _parse_iso_to_utc(traj_a[0].get("timestamp") if traj_a else None)
    if not start_time:
        return None

    best_distance = float("inf")
    best_idx = -1
    best_timestamp = None

    for idx in range(sample_count):
        a = traj_a[idx]
        b = traj_b[idx]

        if not all(k in a for k in ("x_eci", "y_eci", "z_eci")) or not all(k in b for k in ("x_eci", "y_eci", "z_eci")):
            continue

        timestamp = _parse_iso_to_utc(a.get("timestamp") or b.get("timestamp"))
        if not timestamp:
            continue

        hours_from_start = (timestamp - start_time).total_seconds() / 3600.0
        if hours_from_start < start_hour or hours_from_start > end_hour:
            continue

        dx = float(a.get("x_eci", 0.0)) - float(b.get("x_eci", 0.0))
        dy = float(a.get("y_eci", 0.0)) - float(b.get("y_eci", 0.0))
        dz = float(a.get("z_eci", 0.0)) - float(b.get("z_eci", 0.0))
        distance_km = (dx * dx + dy * dy + dz * dz) ** 0.5

        if distance_km < best_distance:
            best_distance = distance_km
            best_idx = idx
            best_timestamp = timestamp

    if best_idx < 0 or best_timestamp is None:
        return None

    return {
        "index": best_idx,
        "distance_km": best_distance,
        "timestamp": best_timestamp,
        "window_start_hour": start_hour,
        "window_end_hour": end_hour,
        "point_a": traj_a[best_idx],
        "point_b": traj_b[best_idx],
        "traj_a": traj_a,
        "traj_b": traj_b,
    }


def _clamp(value: float, min_value: float, max_value: float) -> float:
    return max(min_value, min(max_value, value))


def _classify_orbit_from_altitude(altitude_km: float) -> str:
    if altitude_km < 2000:
        return "LEO"
    if altitude_km < 35786:
        return "MEO"
    if altitude_km < 36786:
        return "GEO"
    return "HEO"


def _relative_vector(point_a: dict, point_b: dict) -> tuple[float, float, float]:
    return (
        float(point_a.get("x_eci", 0.0) or 0.0) - float(point_b.get("x_eci", 0.0) or 0.0),
        float(point_a.get("y_eci", 0.0) or 0.0) - float(point_b.get("y_eci", 0.0) or 0.0),
        float(point_a.get("z_eci", 0.0) or 0.0) - float(point_b.get("z_eci", 0.0) or 0.0),
    )


def _vector_norm(vx: float, vy: float, vz: float) -> float:
    return (vx * vx + vy * vy + vz * vz) ** 0.5


def _relative_velocity_metrics(traj_a: list[dict], traj_b: list[dict], index: int) -> tuple[float, float]:
    """
    Estimate relative velocity and closing rate at a trajectory index.

    Returns:
        (relative_speed_km_s, closing_rate_km_s)
    """
    sample_count = min(len(traj_a), len(traj_b))
    if sample_count < 2:
        return 0.0, 0.0

    left = max(0, index - 1)
    right = min(sample_count - 1, index + 1)
    if left == right:
        return 0.0, 0.0

    t_left = _parse_iso_to_utc(traj_a[left].get("timestamp") or traj_b[left].get("timestamp"))
    t_right = _parse_iso_to_utc(traj_a[right].get("timestamp") or traj_b[right].get("timestamp"))
    if not t_left or not t_right:
        return 0.0, 0.0

    delta_t = (t_right - t_left).total_seconds()
    if delta_t <= 0:
        return 0.0, 0.0

    rel_left = _relative_vector(traj_a[left], traj_b[left])
    rel_right = _relative_vector(traj_a[right], traj_b[right])
    rel_now = _relative_vector(traj_a[index], traj_b[index])

    rel_vel = (
        (rel_right[0] - rel_left[0]) / delta_t,
        (rel_right[1] - rel_left[1]) / delta_t,
        (rel_right[2] - rel_left[2]) / delta_t,
    )
    rel_speed = _vector_norm(rel_vel[0], rel_vel[1], rel_vel[2])

    rel_now_norm = _vector_norm(rel_now[0], rel_now[1], rel_now[2])
    if rel_now_norm <= 1e-9:
        return rel_speed, 0.0

    radial_hat = (rel_now[0] / rel_now_norm, rel_now[1] / rel_now_norm, rel_now[2] / rel_now_norm)
    radial_component = rel_vel[0] * radial_hat[0] + rel_vel[1] * radial_hat[1] + rel_vel[2] * radial_hat[2]
    closing_rate = max(0.0, -radial_component)
    return rel_speed, closing_rate


def _build_advisory_plan(
    risk_level: str,
    sat1_name: str,
    sat2_name: str,
    sat1_orbit: str,
    sat2_orbit: str,
    current_miss_km: float,
    lead_hours: float,
    rel_velocity_km_s: float,
    closing_rate_km_s: float,
    sat1_alt_km: float,
    sat2_alt_km: float,
) -> dict:
    config = {
        "HIGH": {"target_miss": 10.0, "base_dv": 1.6, "base_alt": 2.4},
        "MEDIUM": {"target_miss": 7.0, "base_dv": 1.15, "base_alt": 1.6},
        "LOW": {"target_miss": 5.0, "base_dv": 0.8, "base_alt": 1.0},
    }[risk_level]

    orbit_scale = {"LEO": 1.0, "MEO": 1.12, "GEO": 1.28, "HEO": 1.18}
    sat1_scale = orbit_scale.get((sat1_orbit or "").upper(), 1.0)
    sat2_scale = orbit_scale.get((sat2_orbit or "").upper(), 1.0)

    miss_gap = max(0.0, config["target_miss"] - current_miss_km)
    urgency = 1.45 if lead_hours <= 24 else (1.25 if lead_hours <= 48 else 1.0)
    velocity_factor = _clamp(1 + ((rel_velocity_km_s - 1.5) / 12.0), 0.9, 1.35)
    orbit_factor = (sat1_scale + sat2_scale) / 2.0

    lead_seconds = max(lead_hours * 3600.0, 600.0)
    required_delta_rel_velocity_km_s = _clamp((miss_gap / lead_seconds) * 1.25, 0.00002, 0.03)
    required_delta_rel_velocity_m_s = required_delta_rel_velocity_km_s * 1000.0
    target_relative_velocity_km_s = max(0.0, rel_velocity_km_s - required_delta_rel_velocity_km_s)

    recommended_dv = _clamp(
        config["base_dv"] * urgency * velocity_factor * orbit_factor * (1 + (miss_gap / max(config["target_miss"], 1))),
        0.3,
        4.2,
    )

    sat1_primary = sat1_scale <= sat2_scale
    split_a, split_b = (0.68, 0.32) if sat1_primary else (0.32, 0.68)
    if lead_hours > 30:
        split_a, split_b = (0.6, 0.4) if sat1_primary else (0.4, 0.6)

    sat1_dv = max(recommended_dv * split_a, required_delta_rel_velocity_m_s * split_a)
    sat2_dv = max(recommended_dv * split_b, required_delta_rel_velocity_m_s * split_b)

    sat1_higher = sat1_alt_km >= sat2_alt_km
    maneuver_mode = "vertical-separation" if abs(sat1_alt_km - sat2_alt_km) < 20 else "along-track-phasing"
    sat1_alt_change = (config["base_alt"] * 0.55 if sat1_higher else -config["base_alt"] * 0.55) if maneuver_mode == "vertical-separation" else (config["base_alt"] * 0.35 if sat1_higher else -config["base_alt"] * 0.35)
    sat2_alt_change = -sat1_alt_change

    projected_miss = current_miss_km + (recommended_dv * 1.2) + (abs(sat1_alt_change) * 0.42)
    confidence = int(round(_clamp(54 + ((projected_miss - current_miss_km) * 8), 55, 91)))

    strategy_text = "Vertical separation strategy" if maneuver_mode == "vertical-separation" else "Along-track phasing strategy"
    primary_sat = sat1_name if sat1_primary else sat2_name
    primary_orbit = sat1_orbit if sat1_primary else sat2_orbit

    return {
        "summary": (
            f"{strategy_text}: prioritize {primary_sat} ({primary_orbit or 'Unknown orbit'}) maneuver authority, "
            f"reduce relative velocity by ~{required_delta_rel_velocity_m_s:.2f} m/s, and push miss distance above {config['target_miss']:.1f} km."
        ),
        "actions": [
            f"{sat1_name}: apply {sat1_dv:.2f} m/s tangential burn with altitude trim {sat1_alt_change:+.2f} km.",
            f"{sat2_name}: apply {sat2_dv:.2f} m/s complementary burn with altitude trim {sat2_alt_change:+.2f} km.",
            f"Target relative velocity {target_relative_velocity_km_s:.5f} km/s (from {rel_velocity_km_s:.5f} km/s), then re-screen; expected miss distance {projected_miss:.2f} km.",
        ],
        "metrics": {
            "strategyText": strategy_text,
            "primarySatellite": primary_sat,
            "primarySatelliteOrbit": primary_orbit,
            "sat1DeltaVms": sat1_dv,
            "sat2DeltaVms": sat2_dv,
            "sat1AltChangeKm": sat1_alt_change,
            "sat2AltChangeKm": sat2_alt_change,
            "altitudeBiasKm": abs(sat1_alt_change) + abs(sat2_alt_change),
            "projectedMissKm": projected_miss,
            "leadHours": max(0.0, lead_hours),
            "leadTimeText": "Within 1h" if lead_hours < 1 else f"T-{max(0.0, lead_hours):.1f}h",
            "confidencePercent": confidence,
            "targetMissKm": config["target_miss"],
            "relativeVelocityKmS": rel_velocity_km_s,
            "closingRateKmS": closing_rate_km_s,
            "requiredRelVelocityChangeKmS": required_delta_rel_velocity_km_s,
            "requiredRelVelocityChangeMs": required_delta_rel_velocity_m_s,
            "targetRelativeVelocityKmS": target_relative_velocity_km_s,
        },
    }


@router.get("")
async def list_collisions(
    risk_level: str = Query(None, description="Filter by risk level: LOW, MEDIUM, HIGH"),
    limit: int = Query(100, ge=1, le=1000),
):
    """
    Get detected collision events.
    Optionally filter by risk level.
    """
    try:
        db = get_db()
        query = {}
        if risk_level:
            risk_level = risk_level.upper()
            if risk_level not in ["LOW", "MEDIUM", "HIGH"]:
                raise HTTPException(status_code=400, detail="Invalid risk level. Use LOW, MEDIUM, or HIGH")
            query["risk_level"] = risk_level

        pipeline = [
            {"$match": query},
            {
                "$addFields": {
                    "risk_priority": {
                        "$switch": {
                            "branches": [
                                {"case": {"$eq": ["$risk_level", "HIGH"]}, "then": 0},
                                {"case": {"$eq": ["$risk_level", "MEDIUM"]}, "then": 1},
                                {"case": {"$eq": ["$risk_level", "LOW"]}, "then": 2},
                            ],
                            "default": 3,
                        }
                    }
                }
            },
            {"$sort": {"risk_priority": 1, "distance_km": 1}},
            {"$limit": limit},
        ]
        collisions = await db.collisions.aggregate(pipeline).to_list(length=limit)

        # Convert ObjectId to string
        for c in collisions:
            c["_id"] = str(c["_id"])
            if "timestamp" in c and isinstance(c["timestamp"], datetime):
                c["timestamp"] = c["timestamp"].isoformat()

        return {
            "status": "success",
            "count": len(collisions),
            "data": collisions,
            "timestamp": datetime.utcnow().isoformat(),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch collisions: {str(e)}")


@router.get("/advisory")
async def collision_advisory(
    satellite1_id: int = Query(..., description="First satellite NORAD ID"),
    satellite2_id: int = Query(..., description="Second satellite NORAD ID"),
    risk_level: str = Query("HIGH", description="Risk level context"),
    step_minutes: float = Query(10.0, ge=1, le=60, description="Prediction step size in minutes"),
):
    try:
        normalized_risk = _normalize_risk(risk_level)
        _, end_hour = _risk_window_hours(normalized_risk)

        sat1_prediction = await get_orbit_prediction(satellite1_id, end_hour, step_minutes)
        sat2_prediction = await get_orbit_prediction(satellite2_id, end_hour, step_minutes)

        if sat1_prediction is None or sat2_prediction is None:
            raise HTTPException(status_code=404, detail="One or both satellites are not available for advisory generation")

        traj1 = sat1_prediction.get("trajectory", [])
        traj2 = sat2_prediction.get("trajectory", [])
        tca = _compute_tca_in_window(traj1, traj2, normalized_risk)

        if tca is None:
            return {
                "status": "success",
                "data": {
                    "risk_level": normalized_risk,
                    "window": {
                        "start_hour": _risk_window_hours(normalized_risk)[0],
                        "end_hour": _risk_window_hours(normalized_risk)[1],
                    },
                    "tca": None,
                    "maneuver_plan": None,
                    "message": "No predicted TCA found inside configured risk window.",
                },
                "timestamp": datetime.utcnow().isoformat(),
            }

        point_a = tca["point_a"]
        point_b = tca["point_b"]
        rel_velocity, closing_rate = _relative_velocity_metrics(tca["traj_a"], tca["traj_b"], int(tca["index"]))
        lead_hours = max(0.0, (tca["timestamp"] - datetime.now(tca["timestamp"].tzinfo)).total_seconds() / 3600.0)

        plan = _build_advisory_plan(
            risk_level=normalized_risk,
            sat1_name=sat1_prediction.get("satellite_name", f"SAT-{satellite1_id}"),
            sat2_name=sat2_prediction.get("satellite_name", f"SAT-{satellite2_id}"),
            sat1_orbit=str(point_a.get("orbit_type") or _classify_orbit_from_altitude(float(point_a.get("altitude_km", 0.0) or 0.0))),
            sat2_orbit=str(point_b.get("orbit_type") or _classify_orbit_from_altitude(float(point_b.get("altitude_km", 0.0) or 0.0))),
            current_miss_km=float(tca["distance_km"]),
            lead_hours=lead_hours,
            rel_velocity_km_s=rel_velocity,
            closing_rate_km_s=closing_rate,
            sat1_alt_km=float(point_a.get("altitude_km", 0.0) or 0.0),
            sat2_alt_km=float(point_b.get("altitude_km", 0.0) or 0.0),
        )

        return {
            "status": "success",
            "data": {
                "risk_level": normalized_risk,
                "window": {
                    "start_hour": tca["window_start_hour"],
                    "end_hour": tca["window_end_hour"],
                },
                "tca": {
                    "timestamp": tca["timestamp"].isoformat(),
                    "distance_km": float(tca["distance_km"]),
                    "index": tca["index"],
                },
                "maneuver_plan": plan,
                "inputs": {
                    "satellite1_id": satellite1_id,
                    "satellite2_id": satellite2_id,
                    "step_minutes": step_minutes,
                    "prediction_horizon_hours": end_hour,
                },
            },
            "timestamp": datetime.utcnow().isoformat(),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate advisory: {str(e)}")
