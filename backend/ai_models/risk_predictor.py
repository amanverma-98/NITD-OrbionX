"""
OrbionX AI Risk Predictor
Loads trained RandomForest model and provides collision risk inference.
"""

import os
import numpy as np
import joblib

MODEL_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "models_store")
MODEL_PATH = os.path.join(MODEL_DIR, "collision_model.pkl")

_model = None
_model_load_attempted = False
RISK_ORDER = {"LOW": 0, "MEDIUM": 1, "HIGH": 2}


def _max_risk(*levels: str) -> str:
    normalized = [lvl if lvl in RISK_ORDER else "LOW" for lvl in levels]
    return max(normalized, key=lambda lvl: RISK_ORDER[lvl])


def _collision_severity_score(collision: dict, geometric_risk: str, ml_risk: str) -> float:
    distance_km = float(collision.get("distance_km", 10) or 10)
    relative_velocity = float(collision.get("relative_velocity", 0) or 0)
    altitude_diff = float(collision.get("altitude_diff", 1000) or 1000)

    distance_score = max(0.0, min(1.0, (8.0 - distance_km) / 8.0)) * 55.0
    velocity_score = max(0.0, min(1.0, relative_velocity / 12.0)) * 20.0
    altitude_score = max(0.0, min(1.0, (60.0 - altitude_diff) / 60.0)) * 15.0
    model_bonus = 10.0 if ml_risk == "HIGH" else (4.0 if ml_risk == "MEDIUM" else 0.0)
    geometric_bonus = 8.0 if geometric_risk == "HIGH" else (3.0 if geometric_risk == "MEDIUM" else 0.0)

    return distance_score + velocity_score + altitude_score + model_bonus + geometric_bonus


def _percentile(sorted_values: list[float], p: float) -> float:
    if not sorted_values:
        return 0.0
    if len(sorted_values) == 1:
        return sorted_values[0]

    idx = (len(sorted_values) - 1) * p
    lower = int(idx)
    upper = min(lower + 1, len(sorted_values) - 1)
    fraction = idx - lower
    return sorted_values[lower] * (1 - fraction) + sorted_values[upper] * fraction


def _mitigation_recommendations(risk_level: str) -> list[str]:
    if risk_level == "HIGH":
        return [
            "Trigger immediate conjunction assessment with latest TLE and covariance.",
            "Coordinate an avoidance maneuver window with both operators if feasible.",
            "Increase tracking refresh cadence and re-screen every 5-15 minutes.",
        ]

    if risk_level == "MEDIUM":
        return [
            "Run higher-fidelity propagation with uncertainty bounds over the next 24-72 hours.",
            "Increase monitoring frequency and alert operations team for readiness.",
            "Prepare provisional maneuver plan if miss distance continues to shrink.",
        ]

    return [
        "Keep the object pair in routine conjunction monitoring.",
        "Re-evaluate if updated ephemeris reduces miss distance.",
    ]


def load_model():
    """Load the trained model from disk."""
    global _model, _model_load_attempted
    _model_load_attempted = True
    if os.path.exists(MODEL_PATH):
        _model = joblib.load(MODEL_PATH)
        print(f"[ML] Model loaded from {MODEL_PATH}")
        return True
    else:
        print(f"[ML] No model found at {MODEL_PATH}. Run train_model.py first.")
        return False


def predict_collision_risk(features: dict) -> dict:
    """
    Predict collision risk level from orbital encounter features.

    Parameters:
        features: dict with keys:
            - relative_velocity (km/s)
            - distance_km (km)
            - altitude_difference (km)
            - inclination_difference (degrees)
            - distance_trend (km/min, negative = approaching)
            - orbital_intersection (0-1 probability)

    Returns:
        dict with risk_level (LOW/MEDIUM/HIGH) and confidence score
    """
    global _model, _model_load_attempted

    if _model is None:
        if not _model_load_attempted and not load_model():
            return _rule_based_risk(features)
        if _model is None:
            # Fallback: rule-based classification
            return _rule_based_risk(features)

    try:
        feature_array = np.array([[
            features.get("relative_velocity", 0),
            features.get("altitude_difference", 1000),
            features.get("inclination_difference", 90),
            features.get("distance_trend", 5),
            features.get("orbital_intersection", 0),
        ]])

        prediction = _model.predict(feature_array)[0]
        probabilities = _model.predict_proba(feature_array)[0]
        confidence = float(max(probabilities))

        return {
            "risk_level": prediction,
            "confidence": round(confidence, 4),
            "probabilities": {
                cls: round(float(prob), 4)
                for cls, prob in zip(_model.classes_, probabilities)
            },
        }

    except Exception as e:
        print(f"[ML] Prediction error: {e}")
        return _rule_based_risk(features)


def _rule_based_risk(features: dict) -> dict:
    """Fallback rule-based risk classification when ML model is unavailable."""
    distance_km = features.get("distance_km", 10)
    distance_trend = features.get("distance_trend", 5)
    relative_velocity = features.get("relative_velocity", 0)
    orbital_intersection = features.get("orbital_intersection", 0)
    altitude_difference = features.get("altitude_difference", 1000)

    if distance_km <= 2.0:
        return {
            "risk_level": "HIGH",
            "confidence": 0.8,
            "probabilities": {"LOW": 0.05, "MEDIUM": 0.15, "HIGH": 0.8},
        }

    score = 0
    if distance_trend < -2:
        score += 3
    elif distance_trend < 0:
        score += 1

    if relative_velocity > 8:
        score += 3
    elif relative_velocity > 4:
        score += 1

    if orbital_intersection > 0.7:
        score += 3
    elif orbital_intersection > 0.3:
        score += 1

    if distance_km <= 5:
        score += 2

    if altitude_difference <= 25:
        score += 2

    if score >= 6:
        risk = "HIGH"
    elif score >= 3:
        risk = "MEDIUM"
    else:
        risk = "LOW"

    return {
        "risk_level": risk,
        "confidence": 0.5,
        "probabilities": {"LOW": 0.33, "MEDIUM": 0.34, "HIGH": 0.33},
    }


def enrich_collisions_with_risk(collisions: list) -> list:
    """
    Enrich collision records with ML-based risk predictions.
    Called from the collision detection pipeline.
    """
    if not collisions:
        return collisions

    for collision in collisions:
        geometric_risk = collision.get("risk_level", "LOW")
        features = {
            "distance_km": collision.get("distance_km", 10),
            "relative_velocity": collision.get("relative_velocity", 0),
            "altitude_difference": collision.get("altitude_diff", 0),
            "inclination_difference": np.random.uniform(0, 45),  # estimated
            "distance_trend": -collision.get("distance_km", 5),
            "orbital_intersection": max(0, 1 - collision.get("distance_km", 5) / 10),
        }
        risk_result = predict_collision_risk(features)
        ml_risk = risk_result["risk_level"]
        collision["geometric_risk_level"] = geometric_risk
        collision["ml_risk_level"] = ml_risk
        collision["risk_level"] = _max_risk(geometric_risk, ml_risk)
        collision["risk_confidence"] = risk_result["confidence"]
        collision["_severity_score"] = _collision_severity_score(collision, geometric_risk, ml_risk)

    hard_high_indexes = {
        idx for idx, collision in enumerate(collisions)
        if float(collision.get("distance_km", 10) or 10) <= 1.5
    }

    ranked_indexes = [
        idx for idx, _ in sorted(
            enumerate(collisions),
            key=lambda pair: float(pair[1].get("_severity_score", 0.0)),
            reverse=True,
        )
        if idx not in hard_high_indexes
    ]

    ranked_count = len(ranked_indexes)
    dynamic_high_count = max(1, int(ranked_count * 0.25)) if ranked_count >= 4 else 0
    dynamic_medium_count = max(1, int(ranked_count * 0.45)) if ranked_count >= 3 else max(0, ranked_count - dynamic_high_count)

    high_indexes = set(hard_high_indexes) | set(ranked_indexes[:dynamic_high_count])
    medium_slice_end = dynamic_high_count + dynamic_medium_count
    medium_indexes = set(ranked_indexes[dynamic_high_count:medium_slice_end])

    for idx, collision in enumerate(collisions):
        if idx in high_indexes:
            final_risk = "HIGH"
        elif idx in medium_indexes:
            final_risk = "MEDIUM"
        else:
            final_risk = "LOW"

        collision["risk_level"] = final_risk
        collision["mitigation_actions"] = _mitigation_recommendations(final_risk)
        collision.pop("_severity_score", None)

    return collisions
