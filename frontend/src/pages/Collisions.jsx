import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { useCollisions } from '../hooks/useCollisions';
import { useLiveSatellites } from '../hooks/useSatellites';
import { useSatelliteById } from '../hooks/useSatellites';
import { getCollisionAdvisory, getOrbitPrediction } from '../services/api';
import RiskBadge from '../components/RiskBadge';
import Loader from '../components/Loader';
import MiniGlobeModal from '../components/MiniGlobeModal';

const toNoradId = (value) => {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
};

const normalizeRiskLevel = (riskLevel) => {
  const normalized = String(riskLevel || '').toUpperCase();
  if (normalized === 'HIGH' || normalized === 'MEDIUM' || normalized === 'LOW') return normalized;
  return 'HIGH';
};

const getRiskTcaWindowHours = (riskLevel) => {
  const normalized = normalizeRiskLevel(riskLevel);
  if (normalized === 'LOW') return { startHour: 96, endHour: 120 };
  if (normalized === 'MEDIUM') return { startHour: 72, endHour: 96 };
  return { startHour: 24, endHour: 48 };
};

const getRiskPredictionHorizonHours = (riskLevel) => {
  const { endHour } = getRiskTcaWindowHours(riskLevel);
  return endHour;
};

const hasFiniteEci = (point) => (
  Number.isFinite(Number(point?.x_eci))
  && Number.isFinite(Number(point?.y_eci))
  && Number.isFinite(Number(point?.z_eci))
);

const computePredictedTca = (trajectoryA = [], trajectoryB = [], riskLevel = 'HIGH') => {
  const sampleCount = Math.min(trajectoryA.length, trajectoryB.length);
  if (sampleCount < 2) return null;

  const { startHour, endHour } = getRiskTcaWindowHours(riskLevel);
  const startTimestamp = parseApiTimestampUtc(trajectoryA[0]?.timestamp || trajectoryB[0]?.timestamp);
  if (!startTimestamp) return null;

  let bestDistance = Number.POSITIVE_INFINITY;
  let bestIndex = 0;

  for (let i = 0; i < sampleCount; i += 1) {
    const pointA = trajectoryA[i];
    const pointB = trajectoryB[i];
    if (!hasFiniteEci(pointA) || !hasFiniteEci(pointB)) continue;

    const pointTimestamp = parseApiTimestampUtc(pointA?.timestamp || pointB?.timestamp);
    if (!pointTimestamp) continue;

    const hoursFromStart = (pointTimestamp.getTime() - startTimestamp.getTime()) / (1000 * 60 * 60);
    if (hoursFromStart < startHour || hoursFromStart > endHour) continue;

    const dx = Number(pointA.x_eci) - Number(pointB.x_eci);
    const dy = Number(pointA.y_eci) - Number(pointB.y_eci);
    const dz = Number(pointA.z_eci) - Number(pointB.z_eci);
    const distanceKm = Math.sqrt((dx * dx) + (dy * dy) + (dz * dz));

    if (distanceKm < bestDistance) {
      bestDistance = distanceKm;
      bestIndex = i;
    }
  }

  if (!Number.isFinite(bestDistance)) return null;

  const rawTimestamp = trajectoryA[bestIndex]?.timestamp || trajectoryB[bestIndex]?.timestamp;
  const parsedTimestamp = parseApiTimestampUtc(rawTimestamp);

  return {
    index: bestIndex,
    distanceKm: bestDistance,
    timestamp: parsedTimestamp instanceof Date && !Number.isNaN(parsedTimestamp.getTime())
      ? parsedTimestamp
      : null,
  };
};

const parseApiTimestampUtc = (value) => {
  if (!value || typeof value !== 'string') return null;

  const hasTimezone = /([zZ]|[+-]\d{2}:\d{2})$/.test(value);
  const normalized = hasTimezone ? value : `${value}Z`;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const buildAiManeuverSuggestion = ({ collision, predictedTca, sat1, sat2, riskLevel }) => {
  const normalizedRisk = normalizeRiskLevel(riskLevel);
  const sat1Name = sat1?.name || collision?.satellite1_name || `SAT-${collision?.satellite1_id || '1'}`;
  const sat2Name = sat2?.name || collision?.satellite2_name || `SAT-${collision?.satellite2_id || '2'}`;
  const sat1Orbit = (sat1?.orbit_type || '').toUpperCase();
  const sat2Orbit = (sat2?.orbit_type || '').toUpperCase();
  const sat1Alt = Number(sat1?.altitude_km);
  const sat2Alt = Number(sat2?.altitude_km);
  const sat1Vel = Number(sat1?.velocity_km_s);
  const sat2Vel = Number(sat2?.velocity_km_s);
  const relVelocityKmS = Number(collision?.relative_velocity);

  const riskConfig = {
    HIGH: { targetMissKm: 10, baseDeltaVms: 1.6, altitudeBiasKm: 2.4 },
    MEDIUM: { targetMissKm: 7, baseDeltaVms: 1.15, altitudeBiasKm: 1.6 },
    LOW: { targetMissKm: 5, baseDeltaVms: 0.8, altitudeBiasKm: 1.0 },
  };
  const orbitScale = {
    LEO: 1.0,
    MEO: 1.12,
    GEO: 1.28,
    HEO: 1.18,
  };

  const selected = riskConfig[normalizedRisk] || riskConfig.HIGH;
  const currentMissKmRaw = Number(predictedTca?.distanceKm ?? collision?.distance_km);
  const currentMissKm = Number.isFinite(currentMissKmRaw) ? currentMissKmRaw : selected.targetMissKm;
  const leadHours = predictedTca?.timestamp instanceof Date
    ? (predictedTca.timestamp.getTime() - Date.now()) / (1000 * 60 * 60)
    : Number.POSITIVE_INFINITY;

  const missGapKm = Math.max(0, selected.targetMissKm - currentMissKm);
  const urgency = leadHours <= 24 ? 1.45 : leadHours <= 48 ? 1.25 : 1.0;
  const velocityFactor = Number.isFinite(relVelocityKmS)
    ? clamp(1 + ((relVelocityKmS - 1.5) / 12), 0.9, 1.35)
    : 1.0;
  const sat1OrbitFactor = orbitScale[sat1Orbit] || 1.0;
  const sat2OrbitFactor = orbitScale[sat2Orbit] || 1.0;
  const combinedOrbitFactor = (sat1OrbitFactor + sat2OrbitFactor) / 2;

  const altitudeDiff = (Number.isFinite(sat1Alt) && Number.isFinite(sat2Alt))
    ? Math.abs(sat1Alt - sat2Alt)
    : null;
  const maneuverMode = altitudeDiff !== null && altitudeDiff < 20
    ? 'vertical-separation'
    : 'along-track-phasing';

  const recommendedDeltaVms = clamp(
    selected.baseDeltaVms
      * urgency
      * velocityFactor
      * combinedOrbitFactor
      * (1 + (missGapKm / Math.max(selected.targetMissKm, 1))),
    0.3,
    4.2
  );

  const sat1MobilityScore = (Number.isFinite(sat1Vel) ? sat1Vel : 7.5) / sat1OrbitFactor;
  const sat2MobilityScore = (Number.isFinite(sat2Vel) ? sat2Vel : 7.5) / sat2OrbitFactor;
  const primaryIsSat1 = sat1MobilityScore >= sat2MobilityScore;
  const burnSplit = leadHours <= 30
    ? (primaryIsSat1 ? [0.72, 0.28] : [0.28, 0.72])
    : (primaryIsSat1 ? [0.62, 0.38] : [0.38, 0.62]);

  const sat1DeltaVms = recommendedDeltaVms * burnSplit[0];
  const sat2DeltaVms = recommendedDeltaVms * burnSplit[1];

  const sat1Higher = Number.isFinite(sat1Alt) && Number.isFinite(sat2Alt)
    ? sat1Alt >= sat2Alt
    : true;
  const sat1AltChangeKm = maneuverMode === 'vertical-separation'
    ? (sat1Higher ? selected.altitudeBiasKm * 0.55 : -selected.altitudeBiasKm * 0.55)
    : (sat1Higher ? selected.altitudeBiasKm * 0.35 : -selected.altitudeBiasKm * 0.35);
  const sat2AltChangeKm = -sat1AltChangeKm;

  const projectedMissKm = currentMissKm
    + (recommendedDeltaVms * 1.2)
    + (Math.abs(sat1AltChangeKm) * 0.42);
  const confidencePercent = clamp(
    54 + Math.round((projectedMissKm - currentMissKm) * 8),
    55,
    91
  );

  const leadTimeHours = Number.isFinite(leadHours) ? Math.max(0, leadHours) : null;
  const leadTimeText = leadTimeHours === null
    ? 'Outside computed TCA window'
    : (leadTimeHours < 1 ? 'Within 1h' : `T-${leadTimeHours.toFixed(1)}h`);

  const strategyText = maneuverMode === 'vertical-separation'
    ? 'Vertical separation strategy'
    : 'Along-track phasing strategy';
  const primarySatellite = primaryIsSat1 ? sat1Name : sat2Name;

  return {
    summary: `${strategyText}: prioritize ${primarySatellite} maneuver authority to raise miss distance above ${selected.targetMissKm.toFixed(1)} km before TCA.`,
    actions: [
      `${sat1Name}: apply ${sat1DeltaVms.toFixed(2)} m/s tangential burn with altitude trim ${sat1AltChangeKm >= 0 ? '+' : ''}${sat1AltChangeKm.toFixed(2)} km.`,
      `${sat2Name}: apply ${sat2DeltaVms.toFixed(2)} m/s complementary burn with altitude trim ${sat2AltChangeKm >= 0 ? '+' : ''}${sat2AltChangeKm.toFixed(2)} km.`,
      `Re-screen conjunction after first burn pair; expected miss distance ${projectedMissKm.toFixed(2)} km (confidence ${Math.round(confidencePercent)}%).`,
    ],
    metrics: {
      sat1DeltaVms,
      sat2DeltaVms,
      sat1AltChangeKm,
      sat2AltChangeKm,
      altitudeBiasKm: Math.abs(sat1AltChangeKm) + Math.abs(sat2AltChangeKm),
      projectedMissKm,
      leadHours: leadTimeHours,
      leadTimeText,
      confidencePercent,
      strategyText,
      primarySatellite,
    },
  };
};

/**
 * Risk Filter Button Component
 */
function RiskFilterButton({ label, count, riskLevel, isActive, onClick }) {
  const colorConfig = {
    HIGH: 'border-red-500/50 hover:border-red-500 hover:shadow-red-500/20',
    MEDIUM: 'border-yellow-500/50 hover:border-yellow-500 hover:shadow-yellow-500/20',
    LOW: 'border-green-500/50 hover:border-green-500 hover:shadow-green-500/20',
    null: 'border-cyan-500/50 hover:border-cyan-500 hover:shadow-cyan-500/20'
  };

  const textConfig = {
    HIGH: isActive ? 'text-red-400' : 'text-slate-400',
    MEDIUM: isActive ? 'text-yellow-400' : 'text-slate-400',
    LOW: isActive ? 'text-green-400' : 'text-slate-400',
    null: isActive ? 'text-cyan-400' : 'text-slate-400'
  };

  return (
    <button
      onClick={onClick}
      className={`
        backdrop-blur-2xl rounded-lg px-6 py-4 transition-all duration-300 group
        border-2 ${colorConfig[riskLevel]}
        ${isActive ? 'shadow-lg' : ''}
      `}
    >
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
        {label}
      </p>
      <p className={`text-3xl font-bold font-mono ${textConfig[riskLevel]}`}>
        {count}
      </p>
    </button>
  );
}

/**
 * Collision Row Component
 */
function CollisionRow({ collision, onViewOnGlobe, onVisualize }) {
  return (
    <tr
      className={`
        border-b border-slate-700/50 hover:bg-slate-800/30
        transition-all duration-200
        ${collision.risk_level === 'HIGH' ? 'animate-blink-red' : ''}
      `}
    >
      <td className="px-6 py-4">
        <RiskBadge
          level={collision.risk_level}
          animated={collision.risk_level === 'HIGH'}
        />
      </td>
      <td className="px-6 py-4">
        <div>
          <p className="text-slate-200 font-semibold">
            {collision.satellite1_name || `SAT-${collision.satellite1_id}`}
          </p>
          <p className="text-xs text-slate-500 font-mono">
            NORAD {collision.satellite1_id}
          </p>
        </div>
      </td>
      <td className="px-6 py-4">
        <div className="flex items-center justify-center">
          <span className="text-lg opacity-50">↔</span>
        </div>
      </td>
      <td className="px-6 py-4">
        <div>
          <p className="text-slate-200 font-semibold">
            {collision.satellite2_name || `SAT-${collision.satellite2_id}`}
          </p>
          <p className="text-xs text-slate-500 font-mono">
            NORAD {collision.satellite2_id}
          </p>
        </div>
      </td>
      <td className="px-6 py-4 text-right">
        <p className="text-cyan-400 font-mono font-bold text-sm">
          {collision.distance_km?.toFixed(2)} km
        </p>
        <p className="text-xs text-slate-500">
          {collision.time_to_closest ? `T- ${collision.time_to_closest}` : 'monitoring'}
        </p>
      </td>
      <td className="px-6 py-4 text-right">
        <p className="text-purple-400 font-mono font-semibold text-sm">
          {collision.relative_velocity?.toFixed(3) || '—'} km/s
        </p>
      </td>
      <td className="px-6 py-4 text-right">
        <div className="flex justify-end gap-2">
          <button
            onClick={() => onVisualize(collision)}
            className="px-3 py-1.5 text-xs rounded-lg bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 hover:bg-cyan-500/30 transition"
          >
            Visualize
          </button>
          <button
            onClick={() => onViewOnGlobe(collision)}
            className="px-3 py-1.5 text-xs rounded-lg bg-red-500/20 text-red-300 border border-red-500/40 hover:bg-red-500/30 transition"
          >
            View on Globe
          </button>
        </div>
      </td>
    </tr>
  );
}

export default function Collisions() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState(null);
  const [visualizedCollision, setVisualizedCollision] = useState(null);
  const { data, isLoading } = useCollisions(filter);
  const { data: liveData } = useLiveSatellites();
  const focusSat1Id = toNoradId(visualizedCollision?.satellite1_id);
  const focusSat2Id = toNoradId(visualizedCollision?.satellite2_id);
  const visualizedRiskLevel = normalizeRiskLevel(visualizedCollision?.risk_level);
  const predictionHorizonHours = getRiskPredictionHorizonHours(visualizedRiskLevel);
  const tcaWindow = getRiskTcaWindowHours(visualizedRiskLevel);
  const { data: focusSat1Data } = useSatelliteById(focusSat1Id);
  const { data: focusSat2Data } = useSatelliteById(focusSat2Id);
  const { data: sat1TrajectoryData } = useQuery({
    queryKey: ['collision-trajectory', focusSat1Id, predictionHorizonHours],
    queryFn: async () => {
      const result = await getOrbitPrediction(focusSat1Id, predictionHorizonHours, 10);
      return result?.data ?? null;
    },
    enabled: focusSat1Id !== null,
    staleTime: 5 * 60 * 1000,
  });
  const { data: sat2TrajectoryData } = useQuery({
    queryKey: ['collision-trajectory', focusSat2Id, predictionHorizonHours],
    queryFn: async () => {
      const result = await getOrbitPrediction(focusSat2Id, predictionHorizonHours, 10);
      return result?.data ?? null;
    },
    enabled: focusSat2Id !== null,
    staleTime: 5 * 60 * 1000,
  });
  const { data: advisoryData } = useQuery({
    queryKey: ['collision-advisory', focusSat1Id, focusSat2Id, visualizedRiskLevel],
    queryFn: async () => {
      const result = await getCollisionAdvisory(
        focusSat1Id,
        focusSat2Id,
        visualizedRiskLevel,
        10
      );
      return result?.data ?? null;
    },
    enabled: focusSat1Id !== null && focusSat2Id !== null,
    staleTime: 2 * 60 * 1000,
  });
  const collisions = useMemo(() => data?.data || [], [data]);
  const liveSatellites = useMemo(() => liveData?.data || [], [liveData]);

  const sortedCollisions = useMemo(() => {
    const riskPriority = { HIGH: 3, MEDIUM: 2, LOW: 1 };
    return [...collisions].sort((a, b) => {
      const byRisk = (riskPriority[b.risk_level] || 0) - (riskPriority[a.risk_level] || 0);
      if (byRisk !== 0) return byRisk;

      const aDistance = Number(a.distance_km ?? Number.POSITIVE_INFINITY);
      const bDistance = Number(b.distance_km ?? Number.POSITIVE_INFINITY);
      return aDistance - bDistance;
    });
  }, [collisions]);

  const handleViewOnGlobe = (collision) => {
    navigate(
      `/visualization?focusSat1=${collision.satellite1_id}&focusSat2=${collision.satellite2_id}&focusRisk=${collision.risk_level}`
    );
  };

  const modalSatellites = useMemo(() => {
    const byId = new Map(
      liveSatellites
        .map((sat) => [toNoradId(sat.norad_id), sat])
        .filter(([noradId]) => noradId !== null)
    );

    [focusSat1Data?.data, focusSat2Data?.data].filter(Boolean).forEach((sat) => {
      const noradId = toNoradId(sat.norad_id);
      if (noradId === null) return;

      byId.set(noradId, {
        ...(byId.get(noradId) || {}),
        ...sat,
        norad_id: noradId,
      });
    });

    const predictedSatellites = [sat1TrajectoryData, sat2TrajectoryData]
      .filter(Boolean)
      .map((prediction) => {
        const noradId = toNoradId(prediction?.satellite_id);
        const trajectory = prediction?.trajectory || [];
        const latestPoint = trajectory[trajectory.length - 1];
        if (noradId === null || !latestPoint) return null;

        return {
          norad_id: noradId,
          name: prediction?.satellite_name,
          latitude: latestPoint.latitude,
          longitude: latestPoint.longitude,
          altitude_km: latestPoint.altitude_km,
        };
      })
      .filter(Boolean);

    predictedSatellites.forEach((sat) => {
      const noradId = toNoradId(sat.norad_id);
      if (noradId === null) return;
      byId.set(noradId, {
        ...(byId.get(noradId) || {}),
        ...sat,
      });
    });

    return Array.from(byId.values());
  }, [liveSatellites, focusSat1Data, focusSat2Data, sat1TrajectoryData, sat2TrajectoryData]);

  const collisionTrajectorySets = useMemo(() => {
    if (!visualizedCollision) return [];

    return [
      {
        norad_id: focusSat1Id,
        name: visualizedCollision.satellite1_name,
        color: '#ef4444',
        points: sat1TrajectoryData?.trajectory || [],
      },
      {
        norad_id: focusSat2Id,
        name: visualizedCollision.satellite2_name,
        color: '#22d3ee',
        points: sat2TrajectoryData?.trajectory || [],
      },
    ].filter((item) => item.norad_id !== null && item.points.length > 1);
  }, [visualizedCollision, focusSat1Id, focusSat2Id, sat1TrajectoryData, sat2TrajectoryData]);

  const collisionPredictedTca = useMemo(() => {
    return computePredictedTca(
      sat1TrajectoryData?.trajectory || [],
      sat2TrajectoryData?.trajectory || [],
      visualizedRiskLevel
    );
  }, [sat1TrajectoryData, sat2TrajectoryData, visualizedRiskLevel]);

  const advisoryMissDistanceKm = useMemo(() => {
    const raw = Number(advisoryData?.tca?.distance_km ?? collisionPredictedTca?.distanceKm ?? visualizedCollision?.distance_km);
    return Number.isFinite(raw) ? raw : null;
  }, [advisoryData, collisionPredictedTca, visualizedCollision]);

  const aiManeuverPlan = useMemo(() => {
    if (advisoryData?.maneuver_plan) {
      return advisoryData.maneuver_plan;
    }
    if (!visualizedCollision) return null;
    return buildAiManeuverSuggestion({
      collision: visualizedCollision,
      predictedTca: collisionPredictedTca,
      sat1: focusSat1Data?.data,
      sat2: focusSat2Data?.data,
      riskLevel: visualizedRiskLevel,
    });
  }, [advisoryData, visualizedCollision, collisionPredictedTca, focusSat1Data, focusSat2Data, visualizedRiskLevel]);

  const highCount = sortedCollisions.filter(c => c.risk_level === 'HIGH').length;
  const mediumCount = sortedCollisions.filter(c => c.risk_level === 'MEDIUM').length;
  const lowCount = sortedCollisions.filter(c => c.risk_level === 'LOW').length;
  const totalCount = sortedCollisions.length;

  return (
    <div className="w-full px-2 sm:px-3 md:px-4 pt-1 sm:pt-2 pb-6">
      {/* Header */}
      <div className="mb-10 animate-fade-in-up">
        <div className="gradient-line-top text-center hero-copy-shell">
          <h1 className="text-4xl md:text-5xl font-bold font-['Outfit'] mb-2">
            Collision <span className="gradient-text">Monitor</span>
          </h1>
          <p className="hero-subtitle text-slate-400 text-lg">
            Real-time conjunction assessment and proximity alerts
          </p>
        </div>
      </div>

      {/* Risk Filter Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10 animate-fade-in-up">
        <RiskFilterButton
          label="Total Events"
          count={totalCount}
          riskLevel={null}
          isActive={filter === null}
          onClick={() => setFilter(null)}
        />
        <RiskFilterButton
          label="High Risk"
          count={highCount}
          riskLevel="HIGH"
          isActive={filter === 'HIGH'}
          onClick={() => setFilter('HIGH')}
        />
        <RiskFilterButton
          label="Medium Risk"
          count={mediumCount}
          riskLevel="MEDIUM"
          isActive={filter === 'MEDIUM'}
          onClick={() => setFilter('MEDIUM')}
        />
        <RiskFilterButton
          label="Low Risk"
          count={lowCount}
          riskLevel="LOW"
          isActive={filter === 'LOW'}
          onClick={() => setFilter('LOW')}
        />
      </div>

      {/* Collision Table or Empty State */}
      {isLoading ? (
        <Loader message="Scanning for orbital conjunctions..." />
      ) : sortedCollisions.length === 0 ? (
        <div className="backdrop-blur-2xl rounded-lg p-16 text-center animate-fade-in-up card-hover-lift">
          <div className="flex justify-center mb-4">
            <ShieldCheck className="w-14 h-14 text-emerald-300" />
          </div>
          <h3 className="text-2xl font-bold font-['Outfit'] text-white mb-2">All Clear</h3>
          <p className="text-slate-400 text-lg">
            No collision alerts detected {filter ? `at ${filter} risk level` : 'at the current threshold'}.
          </p>
          <button
            onClick={() => setFilter(null)}
            className="mt-6 px-6 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-purple-500 text-white font-semibold hover:scale-105 transition-transform"
          >
            View All Events
          </button>
        </div>
      ) : (
        <div className="backdrop-blur-2xl rounded-lg overflow-hidden animate-fade-in-up">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700/50 bg-slate-800/30">
                  <th className="text-left px-6 py-4 text-xs text-slate-400 uppercase tracking-wider font-semibold">
                    Risk
                  </th>
                  <th className="text-left px-6 py-4 text-xs text-slate-400 uppercase tracking-wider font-semibold">
                    Satellite 1
                  </th>
                  <th className="text-center px-6 py-4 text-xs text-slate-400 uppercase tracking-wider font-semibold">
                    —
                  </th>
                  <th className="text-left px-6 py-4 text-xs text-slate-400 uppercase tracking-wider font-semibold">
                    Satellite 2
                  </th>
                  <th className="text-right px-6 py-4 text-xs text-slate-400 uppercase tracking-wider font-semibold">
                    Distance
                  </th>
                  <th className="text-right px-6 py-4 text-xs text-slate-400 uppercase tracking-wider font-semibold">
                    Rel. Velocity
                  </th>
                  <th className="text-right px-6 py-4 text-xs text-slate-400 uppercase tracking-wider font-semibold">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedCollisions.map((collision, idx) => (
                  <CollisionRow
                    key={idx}
                    collision={collision}
                    onViewOnGlobe={handleViewOnGlobe}
                    onVisualize={setVisualizedCollision}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* Table Footer */}
          <div className="px-6 py-4 bg-slate-800/20 border-t border-slate-700/50 text-xs text-slate-500">
            Showing {sortedCollisions.length} collision events
            {filter && ` (${filter} risk level)`}
          </div>
        </div>
      )}

      <MiniGlobeModal
        isOpen={!!visualizedCollision}
        onClose={() => setVisualizedCollision(null)}
        title="Collision Visualization"
        allSatellites={modalSatellites}
        focusNoradIds={visualizedCollision ? [visualizedCollision.satellite1_id, visualizedCollision.satellite2_id] : []}
        trajectorySets={collisionTrajectorySets}
        infoBlock={visualizedCollision ? (
          <div className="space-y-3 text-xs">
            <div className="rounded-xl border border-slate-700/60 bg-slate-900/70 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-white font-semibold text-sm leading-tight">
                    {(visualizedCollision.satellite1_name || `SAT-${visualizedCollision.satellite1_id}`)}
                    <span className="mx-1 text-slate-500">vs</span>
                    {(visualizedCollision.satellite2_name || `SAT-${visualizedCollision.satellite2_id}`)}
                  </p>
                  <p className="text-slate-400 mt-1">Collision pair overview</p>
                </div>
                <RiskBadge level={visualizedCollision.risk_level} animated={visualizedCollision.risk_level === 'HIGH'} />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="rounded-lg border border-slate-700/70 bg-slate-900/60 p-2">
                <div className="text-slate-500 uppercase text-[10px]">Miss Distance</div>
                <div className="text-cyan-300 font-mono font-semibold">
                  {advisoryMissDistanceKm !== null ? `${advisoryMissDistanceKm.toFixed(3)} km` : '—'}
                </div>
              </div>
              <div className="rounded-lg border border-slate-700/70 bg-slate-900/60 p-2">
                <div className="text-slate-500 uppercase text-[10px]">Rel Velocity</div>
                <div className="text-purple-300 font-mono font-semibold">
                  {aiManeuverPlan?.metrics?.relativeVelocityKmS?.toFixed(5)
                    ? `${aiManeuverPlan.metrics.relativeVelocityKmS.toFixed(5)} km/s`
                    : (visualizedCollision.relative_velocity?.toFixed(5) ? `${visualizedCollision.relative_velocity.toFixed(5)} km/s` : '—')}
                </div>
              </div>
              <div className="rounded-lg border border-slate-700/70 bg-slate-900/60 p-2">
                <div className="text-slate-500 uppercase text-[10px]">Predicted TCA</div>
                <div className="text-white font-mono font-semibold">
                  {parseApiTimestampUtc(advisoryData?.tca?.timestamp)?.toLocaleString(undefined, {
                    weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit'
                  }) || (collisionPredictedTca?.timestamp
                    ? collisionPredictedTca.timestamp.toLocaleString(undefined, {
                      weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit'
                    })
                    : 'No TCA in window')}
                </div>
              </div>
              <div className="rounded-lg border border-slate-700/70 bg-slate-900/60 p-2">
                <div className="text-slate-500 uppercase text-[10px]">Risk Window</div>
                <div className="text-slate-200 font-mono font-semibold">
                  Day {Math.round(tcaWindow.startHour / 24)} to Day {Math.round(tcaWindow.endHour / 24)}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-2.5">
                <p className="text-red-300 font-semibold mb-1">
                  {visualizedCollision.satellite1_name || `SAT-${visualizedCollision.satellite1_id}`}
                </p>
                <div className="space-y-1 font-mono">
                  <div className="flex justify-between"><span className="text-slate-400">Alt</span><span className="text-red-200">{focusSat1Data?.data?.altitude_km?.toFixed(1) ?? '—'} km</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Vel</span><span className="text-red-200">{focusSat1Data?.data?.velocity_km_s?.toFixed(2) ?? '—'} km/s</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Orbit</span><span className="text-red-200">{focusSat1Data?.data?.orbit_type ?? '—'}</span></div>
                </div>
              </div>
              <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-2.5">
                <p className="text-cyan-300 font-semibold mb-1">
                  {visualizedCollision.satellite2_name || `SAT-${visualizedCollision.satellite2_id}`}
                </p>
                <div className="space-y-1 font-mono">
                  <div className="flex justify-between"><span className="text-slate-400">Alt</span><span className="text-cyan-200">{focusSat2Data?.data?.altitude_km?.toFixed(1) ?? '—'} km</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Vel</span><span className="text-cyan-200">{focusSat2Data?.data?.velocity_km_s?.toFixed(2) ?? '—'} km/s</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Orbit</span><span className="text-cyan-200">{focusSat2Data?.data?.orbit_type ?? '—'}</span></div>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-emerald-500/35 bg-emerald-500/5 p-3">
              <p className="text-emerald-300 font-semibold text-sm mb-1">AI Collision-Avoidance Plan</p>
              <p className="text-slate-300 mb-2">
                {aiManeuverPlan?.summary || 'Awaiting enough trajectory detail to generate a maneuver recommendation.'}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
                <div className="rounded bg-slate-900/60 p-2 col-span-2">
                  <span className="text-slate-500 block text-[10px] uppercase">Strategy</span>
                  <span className="text-emerald-200 font-mono">{aiManeuverPlan?.metrics?.strategyText ?? '—'}</span>
                </div>
                <div className="rounded bg-slate-900/60 p-2 col-span-2">
                  <span className="text-slate-500 block text-[10px] uppercase">Primary Maneuver Satellite</span>
                  <span className="text-emerald-200 font-mono">{aiManeuverPlan?.metrics?.primarySatellite ?? '—'}</span>
                </div>
                <div className="rounded bg-slate-900/60 p-2 col-span-2">
                  <span className="text-slate-500 block text-[10px] uppercase">Primary Satellite Orbit</span>
                  <span className="text-emerald-200 font-mono">{aiManeuverPlan?.metrics?.primarySatelliteOrbit ?? '—'}</span>
                </div>
                <div className="rounded bg-slate-900/60 p-2"><span className="text-slate-500 block text-[10px] uppercase">Sat-1 dV</span><span className="text-emerald-200 font-mono">{aiManeuverPlan?.metrics?.sat1DeltaVms?.toFixed(2) ?? '—'} m/s</span></div>
                <div className="rounded bg-slate-900/60 p-2"><span className="text-slate-500 block text-[10px] uppercase">Sat-2 dV</span><span className="text-emerald-200 font-mono">{aiManeuverPlan?.metrics?.sat2DeltaVms?.toFixed(2) ?? '—'} m/s</span></div>
                <div className="rounded bg-slate-900/60 p-2"><span className="text-slate-500 block text-[10px] uppercase">Sat-1 Altitude Trim</span><span className="text-emerald-200 font-mono">{aiManeuverPlan?.metrics?.sat1AltChangeKm >= 0 ? '+' : ''}{aiManeuverPlan?.metrics?.sat1AltChangeKm?.toFixed(2) ?? '—'} km</span></div>
                <div className="rounded bg-slate-900/60 p-2"><span className="text-slate-500 block text-[10px] uppercase">Sat-2 Altitude Trim</span><span className="text-emerald-200 font-mono">{aiManeuverPlan?.metrics?.sat2AltChangeKm >= 0 ? '+' : ''}{aiManeuverPlan?.metrics?.sat2AltChangeKm?.toFixed(2) ?? '—'} km</span></div>
                <div className="rounded bg-slate-900/60 p-2"><span className="text-slate-500 block text-[10px] uppercase">Projected Miss</span><span className="text-emerald-200 font-mono">{aiManeuverPlan?.metrics?.projectedMissKm?.toFixed(2) ?? '—'} km</span></div>
                <div className="rounded bg-slate-900/60 p-2"><span className="text-slate-500 block text-[10px] uppercase">Lead Time</span><span className="text-emerald-200 font-mono">{aiManeuverPlan?.metrics?.leadTimeText ?? '—'}</span></div>
                <div className="rounded bg-slate-900/60 p-2"><span className="text-slate-500 block text-[10px] uppercase">Confidence</span><span className="text-emerald-200 font-mono">{aiManeuverPlan?.metrics?.confidencePercent ?? '—'}%</span></div>
                <div className="rounded bg-slate-900/60 p-2"><span className="text-slate-500 block text-[10px] uppercase">Current Rel Velocity</span><span className="text-emerald-200 font-mono">{aiManeuverPlan?.metrics?.relativeVelocityKmS?.toFixed(5) ?? '—'} km/s</span></div>
                <div className="rounded bg-slate-900/60 p-2"><span className="text-slate-500 block text-[10px] uppercase">Target Rel Velocity</span><span className="text-emerald-200 font-mono">{aiManeuverPlan?.metrics?.targetRelativeVelocityKmS?.toFixed(5) ?? '—'} km/s</span></div>
                <div className="rounded bg-slate-900/60 p-2"><span className="text-slate-500 block text-[10px] uppercase">Required ΔRel-V</span><span className="text-emerald-200 font-mono">{aiManeuverPlan?.metrics?.requiredRelVelocityChangeMs?.toFixed(3) ?? '—'} m/s</span></div>
                <div className="rounded bg-slate-900/60 p-2"><span className="text-slate-500 block text-[10px] uppercase">Closing Rate</span><span className="text-emerald-200 font-mono">{aiManeuverPlan?.metrics?.closingRateKmS?.toFixed(5) ?? '—'} km/s</span></div>
              </div>
              <ul className="list-disc pl-4 space-y-1 text-slate-300">
                {(aiManeuverPlan?.actions || []).map((action, i) => (
                  <li key={i}>{action}</li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
      />
    </div>
  );
}
