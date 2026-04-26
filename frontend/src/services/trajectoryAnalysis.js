function normalizeApiTimestampUtc(value) {
  if (!value || typeof value !== 'string') return null;
  const hasTimezone = /([zZ]|[+-]\d{2}:\d{2})$/.test(value);
  const normalized = hasTimezone ? value : `${value}Z`;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function enrichTrajectory(points = [], stepMinutes = 10) {
  if (!Array.isArray(points) || points.length === 0) return [];

  return points.map((point, index) => {
    const parsedTimestamp = normalizeApiTimestampUtc(point?.timestamp);
    const prev = index > 0 ? points[index - 1] : null;
    const altitudeKm = Number(point?.altitude_km);
    const velocityKmS = Number(point?.velocity_km_s);
    const altitudeDeltaKm = prev ? altitudeKm - Number(prev?.altitude_km) : null;
    const velocityDeltaKmS = prev ? velocityKmS - Number(prev?.velocity_km_s) : null;

    const altitudeTrend = altitudeDeltaKm === null
      ? 'STABLE'
      : (Math.abs(altitudeDeltaKm) < 0.02 ? 'STABLE' : (altitudeDeltaKm > 0 ? 'RISING' : 'FALLING'));
    const velocityTrend = velocityDeltaKmS === null
      ? 'STABLE'
      : (Math.abs(velocityDeltaKmS) < 0.0005 ? 'STABLE' : (velocityDeltaKmS > 0 ? 'ACCELERATING' : 'DECELERATING'));

    return {
      ...point,
      timestamp: parsedTimestamp ? parsedTimestamp.toISOString() : point?.timestamp,
      timestamp_epoch_ms: parsedTimestamp ? parsedTimestamp.getTime() : null,
      time_offset_minutes: index * stepMinutes,
      altitudeDeltaKm,
      velocityDeltaKmS,
      altitudeTrend,
      velocityTrend,
    };
  });
}

export function identifyTrajectoryMilestones(points = []) {
  if (!Array.isArray(points) || points.length === 0) return [];

  let perigeeIndex = 0;
  let apogeeIndex = 0;
  let maxVelocityIndex = 0;

  for (let i = 1; i < points.length; i += 1) {
    if (Number(points[i].altitude_km) < Number(points[perigeeIndex].altitude_km)) perigeeIndex = i;
    if (Number(points[i].altitude_km) > Number(points[apogeeIndex].altitude_km)) apogeeIndex = i;
    if (Number(points[i].velocity_km_s) > Number(points[maxVelocityIndex].velocity_km_s)) maxVelocityIndex = i;
  }

  return [
    {
      type: 'PERIGEE',
      index: perigeeIndex,
      label: `Perigee ${Number(points[perigeeIndex].altitude_km).toFixed(1)} km`,
    },
    {
      type: 'APOGEE',
      index: apogeeIndex,
      label: `Apogee ${Number(points[apogeeIndex].altitude_km).toFixed(1)} km`,
    },
    {
      type: 'MAX_VELOCITY',
      index: maxVelocityIndex,
      label: `Max speed ${Number(points[maxVelocityIndex].velocity_km_s).toFixed(3)} km/s`,
    },
  ];
}
