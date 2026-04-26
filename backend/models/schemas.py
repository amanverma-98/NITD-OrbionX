"""
OrbionX Pydantic Models
Strict schemas for API request/response validation.
"""

from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime
from enum import Enum


class OrbitType(str, Enum):
    LEO = "LEO"   # Low Earth Orbit: < 2000 km
    MEO = "MEO"   # Medium Earth Orbit: 2000 - 35786 km
    GEO = "GEO"   # Geostationary Orbit: ~35786 km
    HEO = "HEO"   # High Earth Orbit: > 35786 km


class RiskLevel(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"


# ─── Satellite ─────────────────────────────────────────────
class SatelliteBase(BaseModel):
    name: str
    norad_id: int
    tle_line1: str
    tle_line2: str
    orbit_type: Optional[OrbitType] = None
    launch_date: Optional[str] = None
    country: Optional[str] = None


class SatelliteInDB(SatelliteBase):
    id: Optional[str] = Field(None, alias="_id")
    last_updated: datetime = Field(default_factory=datetime.utcnow)

    class Config:
        populate_by_name = True
        json_encoders = {datetime: lambda v: v.isoformat()}


class SatelliteResponse(BaseModel):
    name: str
    norad_id: int
    orbit_type: Optional[str] = None
    last_updated: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    altitude_km: Optional[float] = None
    velocity_km_s: Optional[float] = None


# ─── Position ──────────────────────────────────────────────
class Position(BaseModel):
    satellite_id: int
    satellite_name: Optional[str] = None
    latitude: float
    longitude: float
    altitude_km: float
    velocity_km_s: float
    x_eci: Optional[float] = None
    y_eci: Optional[float] = None
    z_eci: Optional[float] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)


# ─── Collision ─────────────────────────────────────────────
class Collision(BaseModel):
    satellite1_id: int
    satellite1_name: Optional[str] = None
    satellite2_id: int
    satellite2_name: Optional[str] = None
    distance_km: float
    risk_level: RiskLevel = RiskLevel.LOW
    relative_velocity: Optional[float] = None
    altitude_diff: Optional[float] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)


# ─── Prediction ───────────────────────────────────────────
class PredictionRequest(BaseModel):
    satellite_id: int
    hours: float = 24.0
    step_minutes: float = 10.0


class PredictionPoint(BaseModel):
    latitude: float
    longitude: float
    altitude_km: float
    velocity_km_s: float
    timestamp: str


class PredictionResponse(BaseModel):
    satellite_id: int
    satellite_name: Optional[str] = None
    hours: float
    step_minutes: float
    trajectory: List[PredictionPoint]


# ─── Risk Analysis ─────────────────────────────────────────
class RiskFeatures(BaseModel):
    relative_velocity: float
    altitude_difference: float
    inclination_difference: float
    distance_trend: float
    orbital_intersection: float


class RiskResult(BaseModel):
    risk_level: RiskLevel
    confidence: Optional[float] = None
    features: Optional[RiskFeatures] = None


# ─── API Response Wrappers ─────────────────────────────────
class APIResponse(BaseModel):
    status: str = "success"
    count: Optional[int] = None
    data: Optional[object] = None
    timestamp: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
    message: Optional[str] = None
