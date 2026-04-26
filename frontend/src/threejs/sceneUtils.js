import * as THREE from 'three';
import * as satellite from 'satellite.js';

export const EARTH_RADIUS = 5;
export const KM_TO_SCENE = EARTH_RADIUS / 6371;

const warnCache = new Set();

function warnOnce(key, message) {
  if (warnCache.has(key)) return;
  warnCache.add(key);
  console.warn(message);
}

function parseMeanMotionRevPerDay(tle2) {
  if (!tle2 || tle2.length < 63) return null;
  const raw = tle2.slice(52, 63).trim();
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function getOrbitalPeriodMinutes(tle2, satrec) {
  const meanMotionRevPerDay = parseMeanMotionRevPerDay(tle2);
  if (meanMotionRevPerDay) {
    return 1440 / meanMotionRevPerDay;
  }

  if (Number.isFinite(satrec?.no_kozai) && satrec.no_kozai > 0) {
    // satrec.no_kozai is radians per minute.
    return (2 * Math.PI) / satrec.no_kozai;
  }

  return 90;
}

function createSatrec(tle1, tle2) {
  if (!tle1 || !tle2) return null;

  try {
    return satellite.twoline2satrec(tle1, tle2);
  } catch (error) {
    warnOnce(`tle-parse-${tle1?.slice(0, 16)}-${tle2?.slice(0, 16)}`, `[Orbit] Invalid TLE parse: ${error?.message || error}`);
    return null;
  }
}

function propagateSatrecToGeodetic(satrec, time) {
  const propagation = satellite.propagate(satrec, time);
  if (!propagation?.position) return null;

  const gmst = satellite.gstime(time);
  const geodetic = satellite.eciToGeodetic(propagation.position, gmst);

  const latitude = satellite.degreesLat(geodetic.latitude);
  const longitude = satellite.degreesLong(geodetic.longitude);
  const altitude_km = geodetic.height;

  if (![latitude, longitude, altitude_km].every(Number.isFinite)) {
    return null;
  }

  return {
    latitude,
    longitude,
    altitude_km,
    x_eci: propagation.position.x,
    y_eci: propagation.position.y,
    z_eci: propagation.position.z,
  };
}

export function eciKmToSceneVector(xEciKm, yEciKm, zEciKm) {
  if (![xEciKm, yEciKm, zEciKm].every(Number.isFinite)) return null;

  // ECI z-axis points to north pole. Map it to scene +Y to match globe orientation.
  return new THREE.Vector3(
    xEciKm * KM_TO_SCENE,
    zEciKm * KM_TO_SCENE,
    -yEciKm * KM_TO_SCENE
  );
}

export function latLonToCartesian(lat, lon, radius) {
  const latRad = (lat * Math.PI) / 180;
  const lonRad = (lon * Math.PI) / 180;

  const cosLat = Math.cos(latRad);
  const sinLat = Math.sin(latRad);
  const cosLon = Math.cos(lonRad);
  const sinLon = Math.sin(lonRad);

  return new THREE.Vector3(
    radius * cosLat * cosLon,
    radius * sinLat,
    -radius * cosLat * sinLon
  );
}

export function propagateSatellite(tle1, tle2, time = new Date()) {
  const satrec = createSatrec(tle1, tle2);
  if (!satrec) return null;

  const result = propagateSatrecToGeodetic(satrec, time);
  if (!result) {
    warnOnce(`tle-propagate-${tle1?.slice(0, 24)}`, '[Orbit] SGP4 propagation returned invalid position.');
    return null;
  }

  return result;
}

export function generateOrbitPath(tle1, tle2, referenceTime = new Date()) {
  const segments = generateOrbitSegments(tle1, tle2, referenceTime);
  if (!segments.length) return [];

  // Preserve backward compatibility for callers expecting a single array of points.
  const longestSegment = segments.reduce((longest, segment) => (
    segment.length > longest.length ? segment : longest
  ), []);

  return longestSegment;
}

export function generateOrbitSegments(tle1, tle2, referenceTime = new Date()) {
  const satrec = createSatrec(tle1, tle2);
  if (!satrec) return [];

  const rawPoints = [];
  const orbitalPeriodMinutes = getOrbitalPeriodMinutes(tle2, satrec);
  const dynamicSamples = Math.min(Math.max(Math.round(orbitalPeriodMinutes * 3.5), 420), 1600);
  const sampleCount = dynamicSamples % 2 === 0 ? dynamicSamples + 1 : dynamicSamples;
  const fullPeriodSeconds = orbitalPeriodMinutes * 60;
  const stepSeconds = Math.max(fullPeriodSeconds / Math.max(sampleCount - 1, 1), 4);
  const minRadius = EARTH_RADIUS + 0.02;
  const maxRadius = EARTH_RADIUS + 220;
  const baseTime = referenceTime instanceof Date ? referenceTime : new Date(referenceTime ?? Date.now());
  const startOffsetSeconds = -fullPeriodSeconds / 2;

  for (let i = 0; i < sampleCount; i++) {
    const t = new Date(baseTime.getTime() + (startOffsetSeconds + i * stepSeconds) * 1000);
    const sample = propagateSatrecToGeodetic(satrec, t);
    if (!sample) {
      continue;
    }

    const point = eciKmToSceneVector(sample.x_eci, sample.y_eci, sample.z_eci);
    if (!point) {
      continue;
    }

    const radius = point.length();
    if (!Number.isFinite(radius) || radius < minRadius || radius > maxRadius) {
      continue;
    }

    rawPoints.push(point);
  }

  const points = rawPoints.filter((pt, index) => {
    if (index === 0) return true;
    const prev = rawPoints[index - 1];
    const distance = prev.distanceTo(pt);
    return Number.isFinite(distance) && distance > 1e-5;
  });

  if (points.length < 60) {
    warnOnce(`tle-orbit-empty-${tle1?.slice(0, 24)}`, '[Orbit] Orbit path generation produced insufficient stable points.');
    return [];
  }

  const distances = [];
  for (let i = 1; i < points.length; i++) {
    const d = points[i - 1].distanceTo(points[i]);
    if (Number.isFinite(d) && d > 0) {
      distances.push(d);
    }
  }

  const medianStep = median(distances);
  if (!Number.isFinite(medianStep) || medianStep <= 0) {
    warnOnce(`tle-orbit-spacing-${tle1?.slice(0, 24)}`, '[Orbit] Orbit path spacing statistics are invalid.');
    return [];
  }

  const jumpThreshold = Math.max(medianStep * 6, 0.18);
  const minSegmentPoints = 24;

  const segments = [];
  let currentSegment = [points[0]];

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const jump = prev.distanceTo(curr);

    if (jump > jumpThreshold) {
      if (currentSegment.length >= minSegmentPoints) {
        segments.push(currentSegment);
      }
      currentSegment = [curr];
      continue;
    }

    currentSegment.push(curr);
  }

  if (currentSegment.length >= minSegmentPoints) {
    segments.push(currentSegment);
  }

  if (!segments.length) {
    warnOnce(`tle-orbit-segment-${tle1?.slice(0, 24)}`, '[Orbit] Orbit path segmentation removed discontinuous points.');
    return [];
  }

  // Close only when seam distance is physically consistent with local spacing.
  const validatedSegments = segments
    .map((segment) => {
      if (segment.length < minSegmentPoints) return null;

      const segDistances = [];
      for (let i = 1; i < segment.length; i++) {
        const d = segment[i - 1].distanceTo(segment[i]);
        if (Number.isFinite(d) && d > 0) {
          segDistances.push(d);
        }
      }

      const segMedianStep = median(segDistances) || medianStep;
      const seamDistance = segment[0].distanceTo(segment[segment.length - 1]);
      const canClose = (
        segment.length >= Math.floor(sampleCount * 0.45)
        && seamDistance <= Math.max(segMedianStep * 3, 0.12)
      );

      if (canClose && seamDistance > 1e-6) {
        return [...segment, segment[0].clone()];
      }

      return segment;
    })
    .filter(Boolean);

  if (!validatedSegments.length) {
    warnOnce(`tle-orbit-validated-${tle1?.slice(0, 24)}`, '[Orbit] Orbit validation removed non-physical segments.');
    return [];
  }

  return validatedSegments;
}

export function geoToScene(lat, lon, altKm) {
  const r = EARTH_RADIUS + altKm * KM_TO_SCENE;
  return latLonToCartesian(lat, lon, r);
}
