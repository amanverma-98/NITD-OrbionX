"""
OrbionX TLE Data Fetcher
Async pipeline to ingest TLE data from Celestrak.
Idempotent, fault-tolerant with retry logic.
"""

import os
import asyncio
import httpx
from datetime import datetime
from dotenv import load_dotenv
from database.db import get_db

load_dotenv()

CELESTRAK_URL = os.getenv(
    "CELESTRAK_URL",
    "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle"
)


def classify_orbit(altitude_km: float) -> str:
    """Classify orbit type based on altitude."""
    if altitude_km < 2000:
        return "LEO"
    elif altitude_km < 35786:
        return "MEO"
    elif altitude_km < 36786:
        return "GEO"
    else:
        return "HEO"


async def fetch_tle_data() -> str:
    """
    Fetch raw TLE data from Celestrak.
    Returns the raw text content of the TLE file.
    Implements retry logic for fault tolerance.
    """
    max_retries = 3
    for attempt in range(max_retries):
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(CELESTRAK_URL)
                response.raise_for_status()
                print(f"[TLE] Fetched {len(response.text)} bytes from Celestrak")
                return response.text
        except httpx.HTTPError as e:
            print(f"[TLE] Fetch attempt {attempt + 1}/{max_retries} failed: {e}")
            if attempt < max_retries - 1:
                await asyncio.sleep(5 * (attempt + 1))
            else:
                print("[TLE] All fetch attempts failed")
                raise
    return ""


def parse_tle_dataset(raw_data: str) -> list:
    """
    Parse raw TLE text into structured satellite records.

    TLE format (3-line):
        Line 0: Satellite Name
        Line 1: 1 NNNNNC ... (TLE line 1)
        Line 2: 2 NNNNN  ... (TLE line 2)
    """
    lines = [line.strip() for line in raw_data.strip().split("\n") if line.strip()]
    satellites = []

    i = 0
    while i < len(lines) - 2:
        # Identify TLE blocks: name line followed by lines starting with '1' and '2'
        name_line = lines[i]
        line1 = lines[i + 1]
        line2 = lines[i + 2]

        if line1.startswith("1 ") and line2.startswith("2 "):
            try:
                norad_id = int(line1[2:7].strip())
                satellites.append({
                    "name": name_line.strip(),
                    "norad_id": norad_id,
                    "tle_line1": line1,
                    "tle_line2": line2,
                    "last_updated": datetime.utcnow(),
                })
            except (ValueError, IndexError) as e:
                print(f"[TLE] Parse error at line {i}: {e}")
            i += 3
        else:
            i += 1

    print(f"[TLE] Parsed {len(satellites)} satellites")
    return satellites


async def upsert_satellites(satellites: list) -> int:
    """
    Upsert satellite records into MongoDB.
    Idempotent: uses norad_id as unique key.
    Returns number of modified records.
    """
    db = get_db()
    if db is None:
        print("[TLE] Database not connected")
        return 0

    modified = 0
    for sat in satellites:
        result = await db.satellites.update_one(
            {"norad_id": sat["norad_id"]},
            {"$set": sat},
            upsert=True
        )
        if result.modified_count > 0 or result.upserted_id:
            modified += 1

    print(f"[TLE] Upserted {modified} satellite records")
    return modified


async def run_ingestion_pipeline():
    """
    Full ingestion pipeline:
    1. Fetch TLE data from Celestrak
    2. Parse into structured records
    3. Upsert into MongoDB
    """
    try:
        print("[TLE] Starting ingestion pipeline...")
        raw_data = await fetch_tle_data()
        if not raw_data:
            print("[TLE] No data received, skipping")
            return 0

        satellites = parse_tle_dataset(raw_data)
        if not satellites:
            print("[TLE] No satellites parsed, skipping")
            return 0

        count = await upsert_satellites(satellites)
        print(f"[TLE] Pipeline complete: {count} satellites processed")
        return count

    except Exception as e:
        print(f"[TLE] Pipeline error: {e}")
        return 0
