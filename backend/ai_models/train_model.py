"""
OrbionX AI Collision Risk Model – Training Pipeline

Generates synthetic collision feature data and trains a
RandomForestClassifier to predict collision risk levels (LOW/MEDIUM/HIGH).

Features:
    - relative_velocity: speed difference between satellites (km/s)
    - altitude_difference: altitude gap (km)
    - inclination_difference: orbital plane angle difference (degrees)
    - distance_trend: negative = approaching, positive = separating (km/min)
    - orbital_intersection: probability of orbital plane intersection (0-1)
"""

import os
import numpy as np
import pandas as pd
import joblib
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, accuracy_score


MODEL_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "models_store")
MODEL_PATH = os.path.join(MODEL_DIR, "collision_model.pkl")


def generate_synthetic_dataset(n_samples: int = 10000) -> pd.DataFrame:
    """
    Generate synthetic collision risk dataset with realistic distributions.

    The dataset simulates various orbital encounter scenarios:
    - HIGH risk: close proximity, high relative velocity, converging trend
    - MEDIUM risk: moderate proximity with some concerning factors
    - LOW risk: distant, low relative velocity, diverging
    """
    np.random.seed(42)

    data = []
    for _ in range(n_samples):
        # Generate samples across all risk levels
        risk = np.random.choice(["LOW", "MEDIUM", "HIGH"], p=[0.6, 0.25, 0.15])

        if risk == "HIGH":
            relative_velocity = np.random.uniform(5.0, 15.0)
            altitude_difference = np.random.uniform(0, 50)
            inclination_difference = np.random.uniform(0, 10)
            distance_trend = np.random.uniform(-5.0, -0.5)
            orbital_intersection = np.random.uniform(0.7, 1.0)
        elif risk == "MEDIUM":
            relative_velocity = np.random.uniform(2.0, 8.0)
            altitude_difference = np.random.uniform(20, 200)
            inclination_difference = np.random.uniform(5, 30)
            distance_trend = np.random.uniform(-3.0, 1.0)
            orbital_intersection = np.random.uniform(0.3, 0.7)
        else:  # LOW
            relative_velocity = np.random.uniform(0.1, 4.0)
            altitude_difference = np.random.uniform(100, 1000)
            inclination_difference = np.random.uniform(15, 90)
            distance_trend = np.random.uniform(0.0, 5.0)
            orbital_intersection = np.random.uniform(0.0, 0.3)

        data.append({
            "relative_velocity": relative_velocity,
            "altitude_difference": altitude_difference,
            "inclination_difference": inclination_difference,
            "distance_trend": distance_trend,
            "orbital_intersection": orbital_intersection,
            "risk_level": risk,
        })

    df = pd.DataFrame(data)
    print(f"[ML] Generated {len(df)} synthetic samples")
    print(f"[ML] Risk distribution:\n{df['risk_level'].value_counts()}")
    return df


def train_model(df: pd.DataFrame = None) -> dict:
    """
    Train RandomForestClassifier for collision risk prediction.

    Pipeline:
        1. Generate/use provided dataset
        2. Split into train/test (80/20)
        3. Train RandomForest (100 estimators, balanced class weights)
        4. Evaluate with classification report
        5. Save model to models_store/collision_model.pkl

    Returns:
        dict with accuracy, classification report, and model path
    """
    if df is None:
        df = generate_synthetic_dataset()

    # Feature columns
    feature_cols = [
        "relative_velocity",
        "altitude_difference",
        "inclination_difference",
        "distance_trend",
        "orbital_intersection",
    ]

    X = df[feature_cols].values
    y = df["risk_level"].values

    # Split dataset
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    # Train RandomForestClassifier
    model = RandomForestClassifier(
        n_estimators=100,
        max_depth=15,
        min_samples_split=5,
        min_samples_leaf=2,
        class_weight="balanced",
        random_state=42,
        n_jobs=-1,
    )
    model.fit(X_train, y_train)

    # Evaluate
    y_pred = model.predict(X_test)
    accuracy = accuracy_score(y_test, y_pred)
    report = classification_report(y_test, y_pred)

    print(f"\n[ML] Model Accuracy: {accuracy:.4f}")
    print(f"[ML] Classification Report:\n{report}")

    # Feature importance
    importances = dict(zip(feature_cols, model.feature_importances_))
    print(f"[ML] Feature Importance: {importances}")

    # Save model
    os.makedirs(MODEL_DIR, exist_ok=True)
    joblib.dump(model, MODEL_PATH)
    print(f"[ML] Model saved to {MODEL_PATH}")

    return {
        "accuracy": accuracy,
        "report": report,
        "model_path": MODEL_PATH,
        "feature_importances": importances,
    }


if __name__ == "__main__":
    print("=" * 60)
    print("OrbionX – Collision Risk Model Training")
    print("=" * 60)
    result = train_model()
    print(f"\nTraining complete. Accuracy: {result['accuracy']:.4f}")
