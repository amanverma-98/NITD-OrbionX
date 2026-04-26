import { useMemo, Suspense, memo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Compass, Gauge, MapPin, Orbit, Satellite, Zap } from 'lucide-react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';
import { useDispatch, useSelector } from 'react-redux';
import { EarthSceneComponent } from '../threejs/EarthScene';
import SatelliteObject from '../threejs/SatelliteObject';
import OrbitRenderer from '../threejs/OrbitRenderer';
import CollisionRenderer from '../threejs/CollisionRenderer';
import CollisionFocusEffect from '../threejs/CollisionFocusEffect';
import { useLiveSatellites } from '../hooks/useSatellites';
import { useCollisions } from '../hooks/useCollisions';
import { useSatelliteById } from '../hooks/useSatellites';
import { getCollisionAdvisory, getOrbitPrediction } from '../services/api';
import ControlPanel from '../components/ControlPanel';
import Loader from '../components/Loader';
import {
  clearSelectedSatellite,
  setBlinkNoradIds,
  setHighlightNoradIds,
  setOrbitEpoch,
  setSelectedSatellite,
  tickOrbitEpoch,
  toggleShowOrbits,
} from '../store/slices/globeSlice';

const toNoradId = (value) => {
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized > 0 ? normalized : null;
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

const hasFiniteCoordinate = (value) => Number.isFinite(Number(value));

const classifyOrbitFromAltitude = (altitudeKm) => {
  const alt = Number(altitudeKm);
  if (!Number.isFinite(alt)) return null;
  if (alt < 2000) return 'LEO';
  if (alt < 35786) return 'MEO';
  if (alt < 36786) return 'GEO';
  return 'HEO';
};

const estimateAltitudeFromTle = (tleLine2) => {
  if (typeof tleLine2 !== 'string' || !tleLine2.trim()) return null;

  // TLE line 2 mean motion is traditionally in columns 53-63.
  const mmFromColumns = Number.parseFloat(tleLine2.slice(52, 63).trim());
  const mmFromTokens = Number.parseFloat((tleLine2.trim().split(/\s+/)[7] || '').trim());
  const meanMotionRevPerDay = Number.isFinite(mmFromColumns)
    ? mmFromColumns
    : (Number.isFinite(mmFromTokens) ? mmFromTokens : null);

  if (!Number.isFinite(meanMotionRevPerDay) || meanMotionRevPerDay <= 0) return null;

  const muEarthKm3S2 = 398600.4418;
  const earthRadiusKm = 6378.137;
  const nRadPerSec = meanMotionRevPerDay * ((2 * Math.PI) / 86400);
  if (!Number.isFinite(nRadPerSec) || nRadPerSec <= 0) return null;

  const semiMajorAxisKm = Math.cbrt(muEarthKm3S2 / (nRadPerSec * nRadPerSec));
  if (!Number.isFinite(semiMajorAxisKm)) return null;

  const altitudeKm = semiMajorAxisKm - earthRadiusKm;
  return Number.isFinite(altitudeKm) ? altitudeKm : null;
};

const normalizeOrbitType = (orbitType, altitudeKm, tleLine2) => {
  const normalized = String(orbitType || '').trim().toUpperCase();
  if (normalized === 'LEO' || normalized === 'MEO' || normalized === 'GEO' || normalized === 'HEO') {
    return normalized;
  }

  const altitudeOrbit = classifyOrbitFromAltitude(altitudeKm);
  if (altitudeOrbit) return altitudeOrbit;

  const estimatedAltitudeKm = estimateAltitudeFromTle(tleLine2);
  return classifyOrbitFromAltitude(estimatedAltitudeKm);
};

const isRenderableSatellite = (satellite) => {
  const hasGeo = hasFiniteCoordinate(satellite?.latitude) && hasFiniteCoordinate(satellite?.longitude);
  const hasTle = Boolean(satellite?.tle_line1 && satellite?.tle_line2);
  return hasGeo || hasTle;
};

const hasFiniteEci = (point) => (
  Number.isFinite(Number(point?.x_eci))
  && Number.isFinite(Number(point?.y_eci))
  && Number.isFinite(Number(point?.z_eci))
);

const buildTrajectorySamples = (points = []) => {
  if (!Array.isArray(points)) return [];

  return points
    .map((point) => {
      const latitude = Number(point?.latitude);
      const longitude = Number(point?.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

      const timestamp = parseApiTimestampUtc(point?.timestamp);
      const timestampMs = timestamp?.getTime();
      if (!Number.isFinite(timestampMs)) return null;

      const altitudeKm = Number(point?.altitude_km);

      return {
        timestampMs,
        latitude,
        longitude,
        altitude_km: Number.isFinite(altitudeKm) ? altitudeKm : 400,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.timestampMs - b.timestampMs);
};

const sampleTrajectoryAtTime = (samples = [], targetTimeMs = 0) => {
  if (!samples.length) return null;
  if (samples.length === 1) return samples[0];

  const first = samples[0];
  const last = samples[samples.length - 1];

  if (targetTimeMs <= first.timestampMs) return first;
  if (targetTimeMs >= last.timestampMs) return last;

  let low = 0;
  let high = samples.length - 1;

  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (samples[mid].timestampMs <= targetTimeMs) {
      low = mid;
    } else {
      high = mid;
    }
  }

  const from = samples[low];
  const to = samples[high];
  const spanMs = to.timestampMs - from.timestampMs;
  const t = spanMs > 0 ? (targetTimeMs - from.timestampMs) / spanMs : 0;

  const lerp = (a, b) => a + ((b - a) * t);

  return {
    latitude: lerp(from.latitude, to.latitude),
    longitude: lerp(from.longitude, to.longitude),
    altitude_km: lerp(from.altitude_km, to.altitude_km),
  };
};

const computeSharedTrajectoryWindow = (sampleSets = []) => {
  const validSets = sampleSets.filter((samples) => Array.isArray(samples) && samples.length > 0);
  if (!validSets.length) return null;

  const startMs = Math.max(...validSets.map((samples) => samples[0].timestampMs));
  const endMs = Math.min(...validSets.map((samples) => samples[samples.length - 1].timestampMs));

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
  return { startMs, endMs };
};

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

/**
 * Satellite Info Panel Component
 * Shows detailed information about selected satellite
 */
function SatelliteInfoPanel({ satellite, onClose, effectiveRiskLevel = null }) {
  if (!satellite) return null;

  const riskLevel = effectiveRiskLevel || satellite.collision_risk_level || 'LOW';
  const riskColor = {
    HIGH: 'text-red-400 badge-danger',
    MEDIUM: 'text-yellow-400 badge-warning',
    LOW: 'text-green-400 badge-safe'
  }[riskLevel] || 'text-cyan-400';

  return (
    <div className="w-full backdrop-blur-2xl card-hover-lift animate-slide-in-right">
      <div className="flex items-start justify-between mb-4 pb-4 border-b border-[var(--glass-border)]">
        <div className="flex-1">
          <h3 className="text-white font-semibold text-lg">{satellite.name || `SAT-${satellite.norad_id}`}</h3>
          <p className="text-slate-500 text-xs font-mono">NORAD {satellite.norad_id}</p>
        </div>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-cyan-400 text-lg transition-colors ml-2"
        >
          ✕
        </button>
      </div>

      {/* Risk Badge */}
      <div className="mb-4">
        <span className={`badge ${riskColor}`}>
          {riskLevel} RISK
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        {[
          { label: 'Altitude', value: satellite.altitude_km ? `${satellite.altitude_km.toFixed(1)} km` : '—', Icon: Satellite },
          { label: 'Velocity', value: satellite.velocity_km_s ? `${satellite.velocity_km_s.toFixed(3)} km/s` : '—', Icon: Zap },
          { label: 'Latitude', value: satellite.latitude != null ? `${satellite.latitude.toFixed(4)}°` : '—', Icon: MapPin },
          { label: 'Longitude', value: satellite.longitude != null ? `${satellite.longitude.toFixed(4)}°` : '—', Icon: Compass },
          { label: 'Orbit Type', value: satellite.orbit_type || '—', Icon: Orbit },
          { label: 'Inclination', value: satellite.inclination ? `${satellite.inclination.toFixed(2)}°` : '—', Icon: Gauge },
        ].map((item, i) => (
          <div key={i} className="backdrop-blur-2xl-dark rounded-lg px-3 py-2.5 hover:border-cyan-500/50 transition-all">
            <div className="flex items-center gap-1 mb-1">
              <item.Icon className="w-4 h-4 text-cyan-300" />
              <span className="text-slate-500 text-xs font-medium">{item.label}</span>
            </div>
            <span className="text-cyan-300 font-mono font-semibold text-xs">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Canvas Scene Component
 * Wraps the 3D scene rendering
 */
const Scene3D = memo(function Scene3D({
  displayedSats,
  collisions,
  satellites,
  satelliteRiskMap,
  focusedCollision,
  referenceTime,
  predictedTrajectories,
}) {
  const dispatch = useDispatch();
  const showOrbits = useSelector((state) => state.globe.showOrbits);
  const highlightNoradIds = useSelector((state) => state.globe.highlightNoradIds);
  const blinkNoradIds = useSelector((state) => state.globe.blinkNoradIds);
  const selectedNoradId = useSelector((state) => {
    const normalized = Number(state.globe.selectedSatellite?.norad_id);
    return Number.isFinite(normalized) && normalized > 0 ? normalized : null;
  });
  const isCollisionFocusMode = Boolean(focusedCollision && predictedTrajectories?.length >= 2);
  const effectiveShowOrbits = focusedCollision ? true : showOrbits;

  return (
    <>
      <PerspectiveCamera makeDefault position={[0, 0, 18]} fov={45} near={0.1} far={1000} />
      <Suspense fallback={null}>
        <EarthScene />
        <SatelliteObject
          satellites={displayedSats}
          onSelect={(satellite) => dispatch(setSelectedSatellite(satellite))}
          highlightNoradIds={highlightNoradIds}
          blinkNoradIds={blinkNoradIds}
          satelliteRiskMap={satelliteRiskMap}
          selectedNoradId={selectedNoradId}
          referenceTime={referenceTime}
          disableSelectionFade={isCollisionFocusMode}
        />
        {isCollisionFocusMode ? (
          <CollisionFocusEffect trajectories={predictedTrajectories} />
        ) : (
          <>
            <OrbitRenderer
              satellites={displayedSats}
              showOrbits={effectiveShowOrbits}
              highlightNoradIds={highlightNoradIds}
              satelliteRiskMap={satelliteRiskMap}
              selectedNoradId={selectedNoradId}
              referenceTime={referenceTime}
            />
            <CollisionRenderer
              collisions={collisions}
              satellites={satellites}
              focusPair={focusedCollision}
            />
          </>
        )}
      </Suspense>
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.085}
        minDistance={5.6}
        maxDistance={120}
        enablePan
        enableRotate
        enableZoom
        rotateSpeed={0.7}
        zoomSpeed={0.95}
        panSpeed={0.9}
        target={[0, 0, 0]}
        autoRotate={false}
        touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
        mouseButtons={{
          LEFT: THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: THREE.MOUSE.PAN,
        }}
      />
    </>
  );
});

const EarthScene = EarthSceneComponent;

/**
 * HUD Stats Component
 */
function HUDStats({ filteredSats, collisions, isOrbitToggleLocked }) {
  const dispatch = useDispatch();
  const showOrbits = useSelector((state) => state.globe.showOrbits);
  const showOrbitsUi = isOrbitToggleLocked ? true : showOrbits;
  const highRiskCount = collisions.filter(c => c.risk_level === 'HIGH').length;
  const totalCount = filteredSats.length;
  const highRiskBorder = highRiskCount > 0 ? 'hover:border-red-500/50' : 'hover:border-green-500/50';

  return (
    <div className="space-y-3 w-full">
      {/* Orbit Toggle */}
      <div className="backdrop-blur-2xl rounded-lg p-4 flex items-center justify-between group hover:border-cyan-500/50 transition-all">
        <div className="flex items-center gap-3">
          <Orbit className="w-5 h-5 text-cyan-300" />
          <span className="text-sm font-semibold text-slate-300">Orbital Paths</span>
        </div>
        <button
          onClick={() => {
            if (isOrbitToggleLocked) return;
            dispatch(toggleShowOrbits());
          }}
          className={`relative w-11 h-6 rounded-full transition-all ${showOrbitsUi
              ? 'bg-gradient-to-r from-cyan-500 to-purple-500'
              : 'bg-slate-700'
            }`}
          disabled={isOrbitToggleLocked}
        >
          <div
            className={`absolute w-5 h-5 rounded-full bg-white shadow-lg transition-all duration-300 top-0.5 ${showOrbitsUi ? 'right-0.5' : 'left-0.5'
              }`}
          />
        </button>
      </div>

      {/* Statistics Grid */}
      <div className="grid grid-cols-2 gap-3">
        <div className="backdrop-blur-2xl rounded-lg p-3 text-center group hover:border-cyan-500/50 transition-all">
          <div className="text-2xl font-bold gradient-text">{totalCount}</div>
          <div className="text-xs text-slate-400 font-semibold">Satellites</div>
        </div>

        <div className={`backdrop-blur-2xl rounded-lg p-3 text-center group ${highRiskBorder} transition-all`}>
          <div className={`text-2xl font-bold ${highRiskCount > 0 ? 'text-red-400' : 'text-green-400'}`}>
            {highRiskCount}
          </div>
          <div className="text-xs text-slate-400 font-semibold">High Risk</div>
        </div>
      </div>

      {/* Info Card */}
      <div className="backdrop-blur-2xl rounded-lg p-3 text-xs space-y-2">
        <div className="flex justify-between items-center">
          <span className="text-slate-500">Collision Events:</span>
          <span className="text-red-400 font-mono font-semibold">{collisions.length}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-slate-500">Update Rate:</span>
          <span className="text-cyan-400 font-mono font-semibold">Real-time</span>
        </div>
      </div>
    </div>
  );
}

function FocusedCollisionDrawer({ collision, onClear, predictedTca, advisory }) {
  if (!collision) return null;

  const riskLevel = normalizeRiskLevel(collision.risk_level);
  const tcaWindow = getRiskTcaWindowHours(riskLevel);
  const aiManeuverPlan = advisory?.maneuver_plan || null;

  return (
    <div className="w-full">
      <div className="backdrop-blur-2xl rounded-lg p-4 border border-red-500/40 bg-red-500/10 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wider text-red-300 font-semibold">Focused Collision</p>
            <p className="text-sm text-white font-semibold">
              {collision.satellite1_name || `NORAD ${collision.satellite1_id}`} ↔ {collision.satellite2_name || `NORAD ${collision.satellite2_id}`}
            </p>
          </div>
          <button
            onClick={onClear}
            className="px-2 py-1 text-xs rounded border border-slate-600 text-slate-300 hover:border-cyan-400 hover:text-cyan-300 transition"
          >
            Clear
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-slate-900/40 rounded p-2">
            <p className="text-slate-400">Risk</p>
            <p className="text-red-300 font-semibold">{collision.risk_level || 'UNKNOWN'}</p>
          </div>
          <div className="bg-slate-900/40 rounded p-2">
            <p className="text-slate-400">Miss Distance</p>
            <p className="text-cyan-300 font-semibold">{advisory?.tca?.distance_km?.toFixed(3) ?? predictedTca?.distanceKm?.toFixed(3) ?? collision.distance_km?.toFixed(3) ?? '—'} km</p>
          </div>
          <div className="bg-slate-900/40 rounded p-2">
            <p className="text-slate-400">Relative Velocity</p>
            <p className="text-yellow-300 font-semibold">{aiManeuverPlan?.metrics?.relativeVelocityKmS?.toFixed(5) ?? collision.relative_velocity?.toFixed(3) ?? '—'} km/s</p>
          </div>
          <div className="bg-slate-900/40 rounded p-2">
            <p className="text-slate-400">Predicted TCA</p>
            <p className="text-slate-200 font-semibold text-[11px]">
              {parseApiTimestampUtc(advisory?.tca?.timestamp)?.toLocaleString() || (predictedTca?.timestamp ? predictedTca.timestamp.toLocaleString() : 'No predicted TCA in risk window')}
            </p>
            <p className="text-slate-500 text-[10px] mt-1">
              Day {Math.round(tcaWindow.startHour / 24)} to Day {Math.round(tcaWindow.endHour / 24)} window
            </p>
          </div>
        </div>

        <div>
          <p className="text-xs uppercase tracking-wider text-emerald-300 font-semibold mb-1.5">AI Collision-Avoidance Plan</p>
          <p className="text-xs text-slate-200 bg-slate-900/30 rounded px-2 py-2 mb-2">
            {aiManeuverPlan?.summary || 'Awaiting advisory model output for this collision pair.'}
          </p>
          <div className="grid grid-cols-2 gap-2 text-xs mb-2">
            <div className="bg-slate-900/40 rounded p-2 col-span-2"><p className="text-slate-400">Strategy</p><p className="text-emerald-300 font-semibold">{aiManeuverPlan?.metrics?.strategyText || '—'}</p></div>
            <div className="bg-slate-900/40 rounded p-2 col-span-2"><p className="text-slate-400">Primary Maneuver Satellite</p><p className="text-emerald-300 font-semibold">{aiManeuverPlan?.metrics?.primarySatellite || '—'}</p></div>
            <div className="bg-slate-900/40 rounded p-2 col-span-2"><p className="text-slate-400">Primary Satellite Orbit</p><p className="text-emerald-300 font-semibold">{aiManeuverPlan?.metrics?.primarySatelliteOrbit || '—'}</p></div>
            <div className="bg-slate-900/40 rounded p-2"><p className="text-slate-400">Sat-1 dV</p><p className="text-emerald-300 font-semibold">{aiManeuverPlan?.metrics?.sat1DeltaVms?.toFixed(2) ?? '—'} m/s</p></div>
            <div className="bg-slate-900/40 rounded p-2"><p className="text-slate-400">Sat-2 dV</p><p className="text-emerald-300 font-semibold">{aiManeuverPlan?.metrics?.sat2DeltaVms?.toFixed(2) ?? '—'} m/s</p></div>
            <div className="bg-slate-900/40 rounded p-2"><p className="text-slate-400">Sat-1 Altitude Trim</p><p className="text-emerald-300 font-semibold">{aiManeuverPlan?.metrics?.sat1AltChangeKm >= 0 ? '+' : ''}{aiManeuverPlan?.metrics?.sat1AltChangeKm?.toFixed(2) ?? '—'} km</p></div>
            <div className="bg-slate-900/40 rounded p-2"><p className="text-slate-400">Sat-2 Altitude Trim</p><p className="text-emerald-300 font-semibold">{aiManeuverPlan?.metrics?.sat2AltChangeKm >= 0 ? '+' : ''}{aiManeuverPlan?.metrics?.sat2AltChangeKm?.toFixed(2) ?? '—'} km</p></div>
            <div className="bg-slate-900/40 rounded p-2"><p className="text-slate-400">Projected Miss</p><p className="text-emerald-300 font-semibold">{aiManeuverPlan?.metrics?.projectedMissKm?.toFixed(2) ?? '—'} km</p></div>
            <div className="bg-slate-900/40 rounded p-2"><p className="text-slate-400">Lead Time</p><p className="text-emerald-300 font-semibold">{aiManeuverPlan?.metrics?.leadTimeText ?? '—'}</p></div>
            <div className="bg-slate-900/40 rounded p-2"><p className="text-slate-400">Confidence</p><p className="text-emerald-300 font-semibold">{aiManeuverPlan?.metrics?.confidencePercent ?? '—'}%</p></div>
            <div className="bg-slate-900/40 rounded p-2"><p className="text-slate-400">Current Rel Velocity</p><p className="text-emerald-300 font-semibold">{aiManeuverPlan?.metrics?.relativeVelocityKmS?.toFixed(5) ?? '—'} km/s</p></div>
            <div className="bg-slate-900/40 rounded p-2"><p className="text-slate-400">Target Rel Velocity</p><p className="text-emerald-300 font-semibold">{aiManeuverPlan?.metrics?.targetRelativeVelocityKmS?.toFixed(5) ?? '—'} km/s</p></div>
            <div className="bg-slate-900/40 rounded p-2"><p className="text-slate-400">Required ΔRel-V</p><p className="text-emerald-300 font-semibold">{aiManeuverPlan?.metrics?.requiredRelVelocityChangeMs?.toFixed(3) ?? '—'} m/s</p></div>
            <div className="bg-slate-900/40 rounded p-2"><p className="text-slate-400">Closing Rate</p><p className="text-emerald-300 font-semibold">{aiManeuverPlan?.metrics?.closingRateKmS?.toFixed(5) ?? '—'} km/s</p></div>
          </div>
          <div className="space-y-1.5">
            {(aiManeuverPlan?.actions?.length
              ? aiManeuverPlan.actions
              : (collision.mitigation_actions?.length ? collision.mitigation_actions : ['Increase tracking cadence and run conjunction assessment with latest ephemeris.'])
            ).map((action, index) => (
              <div key={index} className="text-xs text-slate-200 bg-slate-900/30 rounded px-2 py-1.5">
                {index + 1}. {action}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Visualization() {
  const dispatch = useDispatch();
  const search = useSelector((state) => state.globe.search);
  const filters = useSelector((state) => state.globe.filters);
  const selected = useSelector((state) => state.globe.selectedSatellite);
  const orbitEpochMs = useSelector((state) => state.globe.orbitEpochMs);
  const [searchParams, setSearchParams] = useSearchParams();
  const rawFocusSat1 = searchParams.get('focusSat1');
  const rawFocusSat2 = searchParams.get('focusSat2');
  const focusSat1 = toNoradId(searchParams.get('focusSat1'));
  const focusSat2 = toNoradId(searchParams.get('focusSat2'));
  const isFocusedCollisionMode = focusSat1 !== null && focusSat2 !== null;
  const focusRiskLevel = normalizeRiskLevel(searchParams.get('focusRisk'));
  const focusPredictionHorizonHours = getRiskPredictionHorizonHours(focusRiskLevel);

  useEffect(() => {
    const hasInvalidFocusSat1 = rawFocusSat1 !== null && focusSat1 === null;
    const hasInvalidFocusSat2 = rawFocusSat2 !== null && focusSat2 === null;
    if (!hasInvalidFocusSat1 && !hasInvalidFocusSat2) return;

    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('focusSat1');
    nextParams.delete('focusSat2');
    nextParams.delete('focusRisk');
    setSearchParams(nextParams, { replace: true });
  }, [rawFocusSat1, rawFocusSat2, focusSat1, focusSat2, searchParams, setSearchParams]);

  const {
    data: liveData,
    isLoading: loadingSats,
    isError: liveError,
    error: liveErrorDetails,
  } = useLiveSatellites();
  const {
    data: collisionData,
    isError: collisionError,
    error: collisionErrorDetails,
  } = useCollisions();
  const { data: focusSat1Data } = useSatelliteById(focusSat1);
  const { data: focusSat2Data } = useSatelliteById(focusSat2);
  const { data: focusSat1Trajectory } = useQuery({
    queryKey: ['visualization-trajectory', focusSat1, focusPredictionHorizonHours],
    queryFn: async () => {
      const result = await getOrbitPrediction(focusSat1, focusPredictionHorizonHours, 10);
      return result?.data ?? null;
    },
    enabled: focusSat1 !== null && focusSat1 > 0,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  const { data: focusSat2Trajectory } = useQuery({
    queryKey: ['visualization-trajectory', focusSat2, focusPredictionHorizonHours],
    queryFn: async () => {
      const result = await getOrbitPrediction(focusSat2, focusPredictionHorizonHours, 10);
      return result?.data ?? null;
    },
    enabled: focusSat2 !== null && focusSat2 > 0,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  const { data: focusAdvisoryData } = useQuery({
    queryKey: ['visualization-advisory', focusSat1, focusSat2, focusRiskLevel],
    queryFn: async () => {
      const result = await getCollisionAdvisory(focusSat1, focusSat2, focusRiskLevel, 10);
      return result?.data ?? null;
    },
    enabled: focusSat1 !== null && focusSat2 !== null && focusSat1 > 0 && focusSat2 > 0,
    retry: false,
    staleTime: 2 * 60 * 1000,
  });

  useEffect(() => {
    if (!isFocusedCollisionMode) {
      dispatch(setOrbitEpoch(Date.now()));
      return;
    }

    const sampleSets = [focusSat1Trajectory?.trajectory, focusSat2Trajectory?.trajectory]
      .map((points) => buildTrajectorySamples(points || []))
      .filter((samples) => samples.length > 1);

    const sharedWindow = computeSharedTrajectoryWindow(sampleSets);
    if (sharedWindow) {
      dispatch(setOrbitEpoch(sharedWindow.startMs));
    }
  }, [dispatch, isFocusedCollisionMode, focusSat1Trajectory?.trajectory, focusSat2Trajectory?.trajectory]);

  useEffect(() => {
    // Keep focused playback readable: fewer updates and no fast-forward jumps.
    const tickIntervalMs = isFocusedCollisionMode ? 5000 : 30000;
    const playbackStepMs = isFocusedCollisionMode ? 5000 : 30000;

    const timer = setInterval(() => {
      dispatch(tickOrbitEpoch(playbackStepMs));
    }, tickIntervalMs);

    return () => clearInterval(timer);
  }, [dispatch, isFocusedCollisionMode]);

  const focusedCollision = useMemo(
    () => (focusSat1 && focusSat2 ? { sat1: focusSat1, sat2: focusSat2 } : null),
    [focusSat1, focusSat2]
  );

  const satellites = useMemo(() => {
    const base = liveData?.data ?? [];
    const byId = new Map(
      base
        .map((sat) => [toNoradId(sat.norad_id), sat])
        .filter(([noradId]) => noradId !== null)
    );

    const focused = [focusSat1Data?.data, focusSat2Data?.data].filter(Boolean);
    focused.forEach((sat) => {
      const noradId = toNoradId(sat.norad_id);
      if (noradId === null) return;

      byId.set(noradId, {
        ...(byId.get(noradId) || {}),
        ...sat,
        norad_id: noradId,
      });
    });

    const predictedSatellites = [focusSat1Trajectory, focusSat2Trajectory]
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

    return Array.from(byId.values()).map((sat) => ({
      ...sat,
      orbit_type: normalizeOrbitType(sat.orbit_type || sat.orbit, sat.altitude_km, sat.tle_line2) || null,
    }));
  }, [liveData, focusSat1Data, focusSat2Data, focusSat1Trajectory, focusSat2Trajectory]);
  const collisions = useMemo(() => collisionData?.data ?? [], [collisionData]);

  const satelliteRiskMap = useMemo(() => {
    const riskPriority = { LOW: 1, MEDIUM: 2, HIGH: 3 };
    const riskBySatellite = {};

    collisions.forEach((collision) => {
      const ids = [toNoradId(collision.satellite1_id), toNoradId(collision.satellite2_id)].filter((id) => id !== null);
      ids.forEach((id) => {
        const current = riskBySatellite[id] || 'LOW';
        if (riskPriority[collision.risk_level] > riskPriority[current]) {
          riskBySatellite[id] = collision.risk_level;
        }
      });
    });

    return riskBySatellite;
  }, [collisions]);

  const highlightNoradIds = useMemo(() => {
    if (!focusedCollision) return [];
    return [focusedCollision.sat1, focusedCollision.sat2];
  }, [focusedCollision]);

  useEffect(() => {
    dispatch(setHighlightNoradIds(highlightNoradIds));
    dispatch(setBlinkNoradIds(highlightNoradIds));
  }, [dispatch, highlightNoradIds]);

  const predictedTrajectories = useMemo(() => {
    if (!focusedCollision) return [];

    return [
      {
        norad_id: focusSat1,
        color: '#ef4444',
        points: focusSat1Trajectory?.trajectory || [],
      },
      {
        norad_id: focusSat2,
        color: '#22d3ee',
        points: focusSat2Trajectory?.trajectory || [],
      },
    ].filter((item) => item.norad_id !== null && item.points.length > 1);
  }, [focusedCollision, focusSat1, focusSat2, focusSat1Trajectory, focusSat2Trajectory]);

  const focusedCollisionEvent = useMemo(() => {
    if (!focusedCollision) return null;

    return collisions.find((collision) => {
      const sat1 = toNoradId(collision.satellite1_id);
      const sat2 = toNoradId(collision.satellite2_id);
      const directMatch = sat1 === focusedCollision.sat1 && sat2 === focusedCollision.sat2;
      const reverseMatch = sat1 === focusedCollision.sat2 && sat2 === focusedCollision.sat1;
      return directMatch || reverseMatch;
    }) || null;
  }, [collisions, focusedCollision]);

  const focusedCollisionPredictedTca = useMemo(() => {
    const effectiveRisk = normalizeRiskLevel(focusedCollisionEvent?.risk_level || focusRiskLevel);
    return computePredictedTca(
      focusSat1Trajectory?.trajectory || [],
      focusSat2Trajectory?.trajectory || [],
      effectiveRisk
    );
  }, [focusSat1Trajectory, focusSat2Trajectory, focusedCollisionEvent?.risk_level, focusRiskLevel]);

  const panelFilteredSats = useMemo(() => {
    let filtered = satellites;
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(
        s => (s.name?.toLowerCase().includes(q)) || String(s.norad_id).includes(q)
      );
    }
    if (filters.orbit !== 'ALL') {
      const selectedOrbit = String(filters.orbit || '').trim().toUpperCase();
      filtered = filtered.filter((satellite) => {
        const orbitType = normalizeOrbitType(
          satellite.orbit_type || satellite.orbit,
          satellite.altitude_km,
          satellite.tle_line2
        );
        return orbitType === selectedOrbit;
      });
    }
    if (filters.risk !== 'ALL') {
      filtered = filtered.filter((satellite) => {
        const satelliteRisk = satelliteRiskMap[satellite.norad_id]
          || satellite.collision_risk_level
          || satellite.risk_level
          || 'LOW';
        return satelliteRisk === filters.risk;
      });
    }

    return filtered;
  }, [satellites, search, filters, satelliteRiskMap]);

  const globeFilteredSats = useMemo(
    () => panelFilteredSats.filter((sat) => isRenderableSatellite(sat)),
    [panelFilteredSats]
  );

  const focusedAnimatedSats = useMemo(() => {
    if (highlightNoradIds.length !== 2 || predictedTrajectories.length < 2) return [];

    const trajectorySamplesByNorad = new Map(
      predictedTrajectories
        .map((track) => [toNoradId(track?.norad_id), buildTrajectorySamples(track?.points || [])])
        .filter(([noradId, samples]) => noradId !== null && samples.length > 1)
    );

    const sharedWindow = computeSharedTrajectoryWindow(Array.from(trajectorySamplesByNorad.values()));
    if (!sharedWindow) return [];

    const { startMs, endMs } = sharedWindow;
    const rangeMs = endMs - startMs;
    const pingPongRangeMs = rangeMs * 2;
    const normalizedOffsetMs = ((orbitEpochMs - startMs) % pingPongRangeMs + pingPongRangeMs) % pingPongRangeMs;
    const playbackTimeMs = normalizedOffsetMs <= rangeMs
      ? (startMs + normalizedOffsetMs)
      : (endMs - (normalizedOffsetMs - rangeMs));

    return highlightNoradIds
      .map((noradId) => {
        const normalizedNoradId = toNoradId(noradId);
        if (normalizedNoradId === null) return null;

        const baseSatellite = satellites.find((sat) => toNoradId(sat?.norad_id) === normalizedNoradId)
          || globeFilteredSats.find((sat) => toNoradId(sat?.norad_id) === normalizedNoradId)
          || {};

        const samples = trajectorySamplesByNorad.get(normalizedNoradId) || [];
        const sampled = sampleTrajectoryAtTime(samples, playbackTimeMs);

        return {
          ...baseSatellite,
          norad_id: normalizedNoradId,
          name: baseSatellite?.name || `SAT-${normalizedNoradId}`,
          tle_line1: '',
          tle_line2: '',
          latitude: sampled?.latitude ?? baseSatellite?.latitude,
          longitude: sampled?.longitude ?? baseSatellite?.longitude,
          altitude_km: sampled?.altitude_km ?? baseSatellite?.altitude_km,
        };
      })
      .filter((sat) => sat && isRenderableSatellite(sat));
  }, [highlightNoradIds, predictedTrajectories, orbitEpochMs, satellites, globeFilteredSats]);

  const displayedSats = useMemo(() => {
    if (highlightNoradIds.length === 2) {
      if (focusedAnimatedSats.length) return focusedAnimatedSats;

      const highlightSet = new Set(highlightNoradIds);
      return satellites.filter((satellite) => highlightSet.has(toNoradId(satellite.norad_id)));
    }
    return globeFilteredSats;
  }, [globeFilteredSats, highlightNoradIds, focusedAnimatedSats, satellites]);

  const clearFocusedCollision = () => {
    setSearchParams({});
  };

  const selectedNoradId = toNoradId(selected?.norad_id);
  const selectedRiskLevel = selectedNoradId !== null
    ? (satelliteRiskMap[selectedNoradId] || selected?.collision_risk_level || 'LOW')
    : null;
  const referenceTime = useMemo(() => new Date(orbitEpochMs), [orbitEpochMs]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl border border-slate-700/40 shadow-2xl">
      <div className="h-full w-full p-4 sm:p-6 pb-6 mx-auto overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-[330px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)_auto] lg:grid-rows-none gap-4 sm:gap-6 h-full min-h-0 items-stretch">
          <aside className="order-2 lg:order-1 space-y-3 sm:space-y-4 min-h-0 max-h-[34vh] lg:max-h-none overflow-y-auto pr-1">
            {focusedCollision && (
              <div className="backdrop-blur-2xl rounded-lg px-3 py-3 border border-red-500/40 bg-red-500/10">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-red-300 text-xs sm:text-sm font-semibold min-w-0 break-words">
                    Focused: NORAD {focusedCollision.sat1} ↔ {focusedCollision.sat2}
                  </span>
                  <button
                    onClick={clearFocusedCollision}
                    className="px-2 py-1 text-xs rounded border border-slate-600 text-slate-300 hover:border-cyan-400 hover:text-cyan-300 transition"
                  >
                    Show all
                  </button>
                </div>
              </div>
            )}

            <div className="rounded-lg p-3 md:p-5 card-hover-lift border border-slate-700/50">
              <ControlPanel satellites={satellites} />
            </div>

            <HUDStats
              filteredSats={panelFilteredSats}
              collisions={collisions}
              isOrbitToggleLocked={Boolean(focusedCollision)}
            />

          </aside>

          <section className="order-1 lg:order-2 h-full min-h-0 flex flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-3 xl:gap-4">
            <div className="relative w-full flex-1 min-h-[220px] lg:min-h-0 rounded-xl overflow-hidden border border-slate-700/60 bg-[radial-gradient(circle_at_50%_40%,rgba(8,47,73,0.45),rgba(2,6,23,0.95))]">
              <Canvas
                camera={{ position: [0, 0, 18], fov: 45, near: 0.1, far: 1000 }}
                gl={{
                  antialias: true,
                  alpha: false,
                  powerPreference: 'high-performance',
                  precision: 'highp'
                }}
                onCreated={({ gl }) => {
                  gl.outputColorSpace = THREE.SRGBColorSpace;
                  gl.toneMapping = THREE.ACESFilmicToneMapping;
                  gl.toneMappingExposure = 1.18;
                }}
                style={{ position: 'absolute', inset: 0, touchAction: 'none' }}
                dpr={typeof window !== 'undefined' ? Math.min(window.devicePixelRatio, 1.25) : 1}
              >
                <Scene3D
                  displayedSats={displayedSats}
                  collisions={collisions}
                  satellites={satellites}
                  satelliteRiskMap={satelliteRiskMap}
                  focusedCollision={focusedCollision}
                  referenceTime={referenceTime}
                  predictedTrajectories={predictedTrajectories}
                />
              </Canvas>

              {(liveError || collisionError) && (
                <div className="absolute left-3 right-3 top-3 z-20 backdrop-blur-2xl rounded-lg border border-red-500/30 bg-red-500/10 p-3">
                  <p className="text-sm text-red-200 font-semibold">Unable to fetch telemetry data</p>
                  <p className="text-xs text-slate-300 mt-1 break-all">
                    {liveErrorDetails?.message || collisionErrorDetails?.message || 'Backend is not reachable.'}
                  </p>
                  <button onClick={() => window.location.reload()} className="btn-primary mt-3 text-xs">
                    Reload Data
                  </button>
                </div>
              )}

              {loadingSats && (
                <div className="absolute inset-0 z-30 flex items-center justify-center bg-[var(--space-black)]/90 backdrop-blur-sm pointer-events-auto">
                  <Loader message="Loading satellite constellation..." />
                </div>
              )}
            </div>

            <div className="mt-3 lg:mt-0 h-[32vh] max-h-[260px] lg:h-full lg:max-h-none min-h-[170px] lg:min-h-0 overflow-hidden flex-shrink-0">
              <div className="h-full backdrop-blur-2xl rounded-xl p-3 sm:p-4 border border-slate-700/50 space-y-3 overflow-y-auto">
                {selected ? (
                  <SatelliteInfoPanel
                    satellite={selected}
                    effectiveRiskLevel={selectedRiskLevel}
                    onClose={() => dispatch(clearSelectedSatellite())}
                  />
                ) : (
                  <div className="backdrop-blur-2xl rounded-lg p-4 text-sm text-slate-400">
                    Tap or click a satellite on the globe to view telemetry, fade other dots, and highlight its orbit path.
                  </div>
                )}

                <FocusedCollisionDrawer
                  collision={focusedCollisionEvent}
                  onClear={clearFocusedCollision}
                  predictedTca={focusedCollisionPredictedTca}
                  advisory={focusAdvisoryData}
                />

                <div className="backdrop-blur-2xl rounded-lg p-3 text-xs space-y-1">
                  <div className="text-slate-400 font-semibold mb-1">Controls</div>
                  <div><span className="text-cyan-400">Drag</span> - Rotate</div>
                  <div><span className="text-cyan-400">Scroll/Pinch</span> - Zoom</div>
                  <div><span className="text-cyan-400">Right Drag/2 Finger</span> - Pan</div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
