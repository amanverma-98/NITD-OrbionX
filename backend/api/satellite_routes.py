"""
OrbionX API – Satellite Routes
Endpoints for satellite data retrieval and live tracking.
"""

from fastapi import APIRouter, HTTPException, Query
from services.satellite_service import (
    get_all_satellites,
    get_satellite_by_id,
    get_live_satellites,
)
from datetime import datetime

router = APIRouter(prefix="/satellites", tags=["Satellites"])


@router.get("")
async def list_satellites(
    limit: int = Query(100, ge=1, le=1000),
    skip: int = Query(0, ge=0),
):
    """
    Get all tracked satellites with basic info.
    Supports pagination via limit/skip.
    """
    try:
        satellites = await get_all_satellites(limit=limit, skip=skip)
        return {
            "status": "success",
            "count": len(satellites),
            "data": satellites,
            "timestamp": datetime.utcnow().isoformat(),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch satellites: {str(e)}")


@router.get("/live")
async def live_satellites(limit: int = Query(1600, ge=1, le=5000)):
    """
    Get real-time satellite positions.
    Returns latest computed positions from the cache.
    """
    try:
        satellites = await get_live_satellites(limit=limit)
        return {
            "status": "success",
            "count": len(satellites),
            "data": satellites,
            "timestamp": datetime.utcnow().isoformat(),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch live data: {str(e)}")


@router.get("/{norad_id}")
async def get_satellite(norad_id: int):
    """
    Get detailed information for a specific satellite by NORAD ID.
    """
    try:
        satellite = await get_satellite_by_id(norad_id)
        if not satellite:
            raise HTTPException(status_code=404, detail=f"Satellite {norad_id} not found")
        return {
            "status": "success",
            "data": satellite,
            "timestamp": datetime.utcnow().isoformat(),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch satellite: {str(e)}")
