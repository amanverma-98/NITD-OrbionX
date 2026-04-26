"""
OrbionX Database Layer
Async MongoDB connection via Motor with index management.
"""

import os
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv()

MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
DATABASE_NAME = os.getenv("DATABASE_NAME", "orbionx")

client: AsyncIOMotorClient = None
db = None


async def connect_db():
    """Initialize MongoDB connection and create indexes."""
    global client, db
    client = AsyncIOMotorClient(MONGODB_URI)
    db = client[DATABASE_NAME]

    # Create indexes for optimized queries
    await db.satellites.create_index("name")
    await db.satellites.create_index("norad_id", unique=True)
    await db.positions.create_index("satellite_id")
    await db.positions.create_index("timestamp")
    await db.positions.create_index([("satellite_id", 1), ("timestamp", -1)])
    await db.collisions.create_index("timestamp")
    await db.collisions.create_index("risk_level")

    print(f"[DB] Connected to MongoDB: {DATABASE_NAME}")
    return db


async def close_db():
    """Close MongoDB connection."""
    global client
    if client:
        client.close()
        print("[DB] MongoDB connection closed")


def get_db():
    """Get database instance."""
    return db
