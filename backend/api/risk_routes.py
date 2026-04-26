"""
OrbionX API – Risk & Prediction Routes
Endpoints for orbit prediction and risk analysis.
"""

from fastapi import APIRouter, HTTPException, Query
from services.prediction_service import get_orbit_prediction
from ai_models.risk_predictor import predict_collision_risk
from database.db import get_db
from datetime import datetime

router = APIRouter(tags=["Risk & Prediction"])


@router.get("/orbit/{satellite_id}/predict")
async def predict_orbit(
    satellite_id: int,
    hours: float = Query(24.0, ge=1, le=168, description="Prediction horizon in hours"),
    step_minutes: float = Query(10.0, ge=1, le=60, description="Time step in minutes"),
):
    """
    Predict future orbital trajectory for a satellite.
    Returns time-series coordinates over the specified horizon.
    """
    try:
        result = await get_orbit_prediction(
            satellite_id=satellite_id,
            hours=hours,
            step_minutes=step_minutes,
        )
        if result is None:
            raise HTTPException(status_code=404, detail=f"Satellite {satellite_id} not found")

        return {
            "status": "success",
            "data": result,
            "timestamp": datetime.utcnow().isoformat(),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Prediction failed: {str(e)}")


@router.get("/risk-analysis")
async def risk_analysis():
    """
    Get comprehensive risk analysis summary.
    Returns collision statistics and risk distribution.
    """
    try:
        db = get_db()

        # Get collision counts by risk level
        pipeline = [
            {"$group": {
                "_id": "$risk_level",
                "count": {"$sum": 1},
                "avg_distance": {"$avg": "$distance_km"},
                "min_distance": {"$min": "$distance_km"},
            }},
            {"$sort": {"_id": 1}},
        ]
        risk_stats = await db.collisions.aggregate(pipeline).to_list(length=10)

        # Total satellites
        total_satellites = await db.satellites.count_documents({})

        # Total active collisions
        total_collisions = await db.collisions.count_documents({})
        high_risk = await db.collisions.count_documents({"risk_level": "HIGH"})
        medium_risk = await db.collisions.count_documents({"risk_level": "MEDIUM"})
        low_risk = await db.collisions.count_documents({"risk_level": "LOW"})

        # Recent critical collisions
        critical_cursor = db.collisions.find(
            {"risk_level": "HIGH"}
        ).sort("distance_km", 1).limit(10)
        critical = await critical_cursor.to_list(length=10)
        for c in critical:
            c["_id"] = str(c["_id"])
            if "timestamp" in c and isinstance(c["timestamp"], datetime):
                c["timestamp"] = c["timestamp"].isoformat()

        return {
            "status": "success",
            "data": {
                "total_satellites": total_satellites,
                "total_collisions": total_collisions,
                "risk_distribution": {
                    "HIGH": high_risk,
                    "MEDIUM": medium_risk,
                    "LOW": low_risk,
                },
                "risk_statistics": risk_stats,
                "critical_events": critical,
            },
            "timestamp": datetime.utcnow().isoformat(),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Risk analysis failed: {str(e)}")
