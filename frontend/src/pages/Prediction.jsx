import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart3,
  CalendarDays,
  Clock3,
  Globe2,
  MapPin,
  Radar,
  Repeat,
  Satellite,
  TriangleAlert,
  WandSparkles,
} from 'lucide-react';
import { useLiveSatellites } from '../hooks/useSatellites';
import { getOrbitPrediction, getSatellites } from '../services/api';
import GradientButton from '../components/GradientButton';
import Loader from '../components/Loader';
import MiniGlobeModal from '../components/MiniGlobeModal';
import TrajectoryTimeline from '../components/TrajectoryTimeline';
import { enrichTrajectory, identifyTrajectoryMilestones } from '../services/trajectoryAnalysis';

const parseApiTimestampUtc = (value) => {
  if (!value || typeof value !== 'string') return null;
  const hasTimezone = /([zZ]|[+-]\d{2}:\d{2})$/.test(value);
  const normalized = hasTimezone ? value : `${value}Z`;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const getFirstFuturePointIndex = (trajectory = []) => {
  if (!Array.isArray(trajectory) || !trajectory.length) return 0;
  const nowMs = Date.now();
  const index = trajectory.findIndex((pt) => {
    const parsed = parseApiTimestampUtc(pt?.timestamp);
    return parsed && parsed.getTime() >= nowMs;
  });
  return index === -1 ? Math.max(trajectory.length - 1, 0) : index;
};

const isValidNoradId = (value) => {
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized > 0;
};

const estimateAltitudeFromTle = (tleLine2) => {
  if (typeof tleLine2 !== 'string' || !tleLine2.trim()) return null;

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

const isLeoSatellite = (satellite) => {
  const orbitType = String(satellite?.orbit_type || satellite?.orbit || '').trim().toUpperCase();
  if (orbitType === 'LEO') return true;

  const altitudeKm = Number(satellite?.altitude_km);
  if (Number.isFinite(altitudeKm)) return altitudeKm < 2000;

  const estimatedAltitudeKm = estimateAltitudeFromTle(satellite?.tle_line2);
  if (Number.isFinite(estimatedAltitudeKm)) return estimatedAltitudeKm < 2000;

  return false;
};

/**
 * Information Card Component
 */
function InfoCard({ label, value, icon, color = 'cyan' }) {
  const colorConfig = {
    cyan: 'text-cyan-400',
    blue: 'text-blue-400',
    green: 'text-green-400',
    yellow: 'text-amber-400'
  };

  return (
    <div className="backdrop-blur-2xl rounded-lg p-4 text-center card-hover-lift border border-slate-700/50 hover:border-cyan-500/50">
      <div className="text-sm text-slate-500 uppercase tracking-wider font-semibold mb-2">
        {label}
      </div>
      <div className="flex items-center justify-center gap-2">
        <span className="text-2xl">{icon}</span>
        <p className={`text-2xl font-bold font-mono ${colorConfig[color]}`}>
          {value}
        </p>
      </div>
    </div>
  );
}

export default function Prediction() {
  const { data: liveData, isLoading: liveLoading } = useLiveSatellites(1600);
  const { data: catalogSatellites, isLoading: catalogLoading } = useQuery({
    queryKey: ['satellites-catalog-dropdown'],
    queryFn: async () => {
      const pageSize = 1000;
      const maxPages = 20;
      const all = [];

      for (let page = 0; page < maxPages; page += 1) {
        const skip = page * pageSize;
        const result = await getSatellites(pageSize, skip);
        const chunk = result?.data || [];
        if (!chunk.length) break;

        all.push(...chunk);
        if (chunk.length < pageSize) break;
      }

      return all;
    },
    staleTime: 10 * 60 * 1000,
  });

  const satellitesLoading = liveLoading || catalogLoading;
  const satellites = useMemo(() => {
    const byId = new Map();

    (catalogSatellites || []).forEach((sat) => {
      const noradId = Number(sat?.norad_id);
      if (!isValidNoradId(noradId)) return;
      byId.set(noradId, {
        ...sat,
        norad_id: noradId,
        name: sat?.name || `SAT-${noradId}`,
      });
    });

    (liveData?.data || []).forEach((sat) => {
      const noradId = Number(sat?.norad_id);
      if (!isValidNoradId(noradId)) return;
      byId.set(noradId, {
        ...(byId.get(noradId) || {}),
        ...sat,
        norad_id: noradId,
      });
    });

    return Array.from(byId.values())
      .filter(isLeoSatellite)
      .sort((a, b) => {
      const aName = String(a?.name || `SAT-${a?.norad_id || ''}`).toLowerCase();
      const bName = String(b?.name || `SAT-${b?.norad_id || ''}`).toLowerCase();
      if (aName < bName) return -1;
      if (aName > bName) return 1;
      return Number(a?.norad_id || 0) - Number(b?.norad_id || 0);
      });
  }, [catalogSatellites, liveData]);
  const hasLeoSatellites = satellites.length > 0;
  const [selectedId, setSelectedId] = useState(null);
  const [hours, setHours] = useState(24);
  const [prediction, setPrediction] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showVisualize, setShowVisualize] = useState(false);
  const [timelineIndex, setTimelineIndex] = useState(0);

  useEffect(() => {
    if (selectedId === null) return;
    const stillAvailable = satellites.some((sat) => Number(sat.norad_id) === Number(selectedId));
    if (!stillAvailable) {
      setSelectedId(null);
    }
  }, [satellites, selectedId]);

  const handlePredict = async () => {
    if (!isValidNoradId(selectedId)) {
      setError('Please select a valid satellite.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await getOrbitPrediction(selectedId, hours, 10);
      setPrediction(result.data);
      setTimelineIndex(getFirstFuturePointIndex(result?.data?.trajectory || []));
    } catch {
      setError('Failed to generate prediction. Ensure the backend is running.');
    } finally {
      setLoading(false);
    }
  };

  const focusedNoradId = prediction?.satellite_id ? Number(prediction.satellite_id) : null;
  const predictionStepMinutes = Number(prediction?.step_minutes) || 10;
  const enrichedPrimaryTrajectory = useMemo(
    () => enrichTrajectory(prediction?.trajectory || [], predictionStepMinutes),
    [prediction?.trajectory, predictionStepMinutes]
  );
  const primaryMilestones = useMemo(
    () => identifyTrajectoryMilestones(enrichedPrimaryTrajectory),
    [enrichedPrimaryTrajectory]
  );
  const milestoneByIndex = useMemo(() => {
    const byIndex = new Map();
    primaryMilestones.forEach((item) => byIndex.set(item.index, item));
    return byIndex;
  }, [primaryMilestones]);

  useEffect(() => {
    if (timelineIndex < enrichedPrimaryTrajectory.length) return;
    setTimelineIndex(Math.max(0, enrichedPrimaryTrajectory.length - 1));
  }, [timelineIndex, enrichedPrimaryTrajectory.length]);

  useEffect(() => {
    if (!showVisualize || !enrichedPrimaryTrajectory.length) return;
    const futureIndex = getFirstFuturePointIndex(enrichedPrimaryTrajectory);
    setTimelineIndex(futureIndex);
  }, [showVisualize, prediction?.satellite_id, prediction?.hours, enrichedPrimaryTrajectory]);

  const trajectoryPoints = useMemo(() => {
    if (!enrichedPrimaryTrajectory.length) return [];
    return enrichedPrimaryTrajectory.map((pt) => ({
      latitude: pt.latitude,
      longitude: pt.longitude,
      altitude_km: pt.altitude_km,
    }));
  }, [enrichedPrimaryTrajectory]);

  const predictionOnlySatellite = useMemo(() => {
    if (!enrichedPrimaryTrajectory.length || !focusedNoradId) return [];

    const sourceSatellite = satellites.find((sat) => Number(sat?.norad_id) === focusedNoradId);
    const firstPt = enrichedPrimaryTrajectory[0];

    return [{
      ...(sourceSatellite || {}),
      norad_id: focusedNoradId,
      name: sourceSatellite?.name || prediction.satellite_name,
      latitude: firstPt.latitude,
      longitude: firstPt.longitude,
      altitude_km: firstPt.altitude_km,
    }];
  }, [enrichedPrimaryTrajectory, prediction, focusedNoradId, satellites]);

  const predictionSatellites = useMemo(() => {
    if (predictionOnlySatellite.length) return predictionOnlySatellite;

    if (!Number.isFinite(focusedNoradId)) return [];
    const sourceSatellite = satellites.find((sat) => Number(sat?.norad_id) === focusedNoradId);
    if (!sourceSatellite) return [];

    return [{
      ...sourceSatellite,
      norad_id: focusedNoradId,
      name: sourceSatellite?.name || prediction?.satellite_name || `SAT-${focusedNoradId}`,
    }];
  }, [predictionOnlySatellite, focusedNoradId, satellites, prediction?.satellite_name]);

  const trajectorySets = useMemo(() => {
    const sets = [];
    if (trajectoryPoints.length > 1) {
      sets.push({
        norad_id: focusedNoradId,
        name: prediction?.satellite_name,
        color: '#22c55e',
        highlightColor: '#fbbf24',
        points: trajectoryPoints,
      });
    }
    return sets;
  }, [trajectoryPoints, focusedNoradId, prediction?.satellite_name]);

  const selectedPrimaryPoint = useMemo(() => {
    if (!enrichedPrimaryTrajectory.length) return null;
    const index = Math.min(timelineIndex, enrichedPrimaryTrajectory.length - 1);
    return enrichedPrimaryTrajectory[index];
  }, [enrichedPrimaryTrajectory, timelineIndex]);

  return (
    <div className="w-full px-2 sm:px-3 md:px-4 pt-1 sm:pt-2 pb-6">
      {/* Header */}
      <div className="mb-10 animate-fade-in-up">
        <div className="gradient-line-top text-center hero-copy-shell">
          <h1 className="text-4xl md:text-5xl font-bold font-['Outfit'] mb-2">
            Orbit <span className="gradient-text">Prediction</span>
          </h1>
          {prediction && (
            <p className="hero-subtitle text-slate-400 text-lg">
              Choose a satellite and set your prediction horizon to simulate its future trajectory across the planet.
            </p>
          )}
        </div>
      </div>

      {/* Control Panel */}
      <div className="backdrop-blur-2xl rounded-lg p-8 mb-10 animate-fade-in-up card-hover-lift border border-slate-700/50">
        <h2 className="text-xl font-bold font-['Outfit'] text-white mb-6">Configure Prediction</h2>

        <div className="grid md:grid-cols-3 gap-6">
          {/* Satellite Selection */}
          <div className="md:col-span-1">
            <label className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-3 block">
              <span className="inline-flex items-center gap-2">
                <Radar className="w-4 h-4" />
                Select Satellite
              </span>
            </label>
            <select
              value={selectedId || ''}
              onChange={(e) => setSelectedId(e.target.value ? Number(e.target.value) : null)}
              disabled={!hasLeoSatellites}
              className="w-full bg-slate-800/60 border border-slate-700 hover:border-cyan-500/50 rounded-lg px-4 py-3 text-sm text-white focus:outline-none focus:border-cyan-500 transition"
            >
              <option value="">
                {hasLeoSatellites ? 'Choose a LEO satellite...' : 'No LEO satellites available'}
              </option>
              {satellites.map((s) => (
                <option key={s.norad_id} value={s.norad_id} className="bg-slate-800">
                  {s.name} (NORAD {s.norad_id})
                </option>
              ))}
            </select>
          </div>

          {/* Horizon Slider */}
          <div className="md:col-span-1">
            <label className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-3 block">
              <span className="inline-flex items-center gap-2">
                <Clock3 className="w-4 h-4" />
                Prediction Horizon ({hours}h)
              </span>
            </label>
            <input
              type="range"
              min="1"
              max="168"
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
              className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-500 hover:accent-purple-500"
            />
            <div className="text-xs text-slate-500 mt-2 flex justify-between">
              <span>1 hour</span>
              <span className="font-semibold text-cyan-400">{hours} hours ({(hours / 24).toFixed(1)} days)</span>
              <span>7 days</span>
            </div>
          </div>

          {/* Predict Button */}
          <div className="md:col-span-1 flex flex-col justify-end">
            <GradientButton
              variant="primary"
              size="lg"
              icon={<WandSparkles className="w-4 h-4" />}
              onClick={handlePredict}
              disabled={!selectedId || loading}
              loading={loading}
              className="w-full"
            >
              {loading ? 'Computing...' : 'Predict Orbit'}
            </GradientButton>
          </div>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="backdrop-blur-2xl rounded-lg px-6 py-4 mb-8 border border-red-500/30 bg-red-500/5 text-red-400 text-sm animate-fade-in">
          <div className="flex items-start gap-3">
            <TriangleAlert className="w-5 h-5 mt-0.5" />
            <p>{error}</p>
          </div>
        </div>
      )}

      {loading && <Loader message="Propagating orbital trajectory with SGP4..." />}

      {/* Prediction Results */}
      {prediction && !loading && (
        <div className="space-y-10 animate-fade-in-up">
          {/* Summary Section */}
          <div className="backdrop-blur-2xl rounded-lg p-8 card-hover-lift border border-slate-700/50">
            <div className="flex items-start gap-4 mb-6">
              <Satellite className="w-8 h-8 text-cyan-300" />
              <div>
                <h2 className="text-2xl font-bold font-['Outfit'] text-white">
                  {prediction.satellite_name}
                </h2>
                <p className="text-slate-400 text-sm mt-1">
                  NORAD ID: <span className="text-cyan-400 font-mono">{prediction.satellite_id}</span>
                </p>
              </div>
            </div>

            <div className="mb-6">
              <GradientButton
                variant="secondary"
                size="md"
                icon={<Globe2 className="w-4 h-4" />}
                onClick={() => setShowVisualize(true)}
              >
                Visualize
              </GradientButton>
            </div>

            {/* Quick Stats */}
            <div className="grid md:grid-cols-4 gap-4">
              <InfoCard
                label="Prediction Hours"
                value={`${prediction.hours}h`}
                icon={<Clock3 className="w-5 h-5" />}
                color="cyan"
              />
              <InfoCard
                label="Data Points"
                value={prediction.points}
                icon={<BarChart3 className="w-5 h-5" />}
                color="green"
              />
              <InfoCard
                label="Step Interval"
                value={`${prediction.step_minutes}m`}
                icon={<Repeat className="w-5 h-5" />}
                color="blue"
              />
              <InfoCard
                label="Duration"
                value={`${(prediction.hours / 24).toFixed(1)}d`}
                icon={<CalendarDays className="w-5 h-5" />}
                color="yellow"
              />
            </div>
          </div>

          {/* Trajectory Table */}
          <div className="backdrop-blur-2xl rounded-lg overflow-hidden card-hover-lift">
            <div className="px-6 py-4 border-b border-slate-700/50 bg-slate-800/30">
              <h3 className="text-lg font-bold font-['Outfit'] text-white flex items-center gap-2">
                <MapPin className="w-5 h-5 text-cyan-300" />
                Trajectory Points ({prediction.trajectory.length} total)
              </h3>
            </div>

            <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-[var(--space-navy)] border-b border-slate-700/50">
                  <tr>
                    <th className="text-left px-5 py-3 text-xs text-slate-400 uppercase font-semibold tracking-wider">#</th>
                    <th className="text-left px-5 py-3 text-xs text-slate-400 uppercase font-semibold tracking-wider">Time (UTC)</th>
                    <th className="text-right px-5 py-3 text-xs text-slate-400 uppercase font-semibold tracking-wider">Latitude</th>
                    <th className="text-right px-5 py-3 text-xs text-slate-400 uppercase font-semibold tracking-wider">Longitude</th>
                    <th className="text-right px-5 py-3 text-xs text-slate-400 uppercase font-semibold tracking-wider">Altitude</th>
                    <th className="text-right px-5 py-3 text-xs text-slate-400 uppercase font-semibold tracking-wider">Velocity</th>
                    <th className="text-right px-5 py-3 text-xs text-slate-400 uppercase font-semibold tracking-wider">ΔAlt</th>
                    <th className="text-right px-5 py-3 text-xs text-slate-400 uppercase font-semibold tracking-wider">Trend</th>
                    <th className="text-right px-5 py-3 text-xs text-slate-400 uppercase font-semibold tracking-wider">Milestone</th>
                  </tr>
                </thead>
                <tbody>
                  {enrichedPrimaryTrajectory.map((pt, i) => (
                    <tr
                      key={i}
                      onClick={() => setTimelineIndex(i)}
                      className={`border-b border-slate-800/30 hover:bg-slate-800/40 transition-colors cursor-pointer ${i === timelineIndex ? 'bg-cyan-500/10' : ''}`}
                    >
                      <td className="px-5 py-3 text-slate-500 font-mono text-xs">
                        {(i + 1).toString().padStart(3, '0')}
                      </td>
                      <td className="px-5 py-3 text-slate-300 font-mono text-xs whitespace-nowrap">
                        {pt.timestamp
                          ? new Date(pt.timestamp).toUTCString().slice(5, 22)
                          : '—'
                        }
                      </td>
                      <td className="px-5 py-3 text-right text-cyan-400 font-mono font-semibold">
                        {pt.latitude?.toFixed(4)}°
                      </td>
                      <td className="px-5 py-3 text-right text-purple-400 font-mono font-semibold">
                        {pt.longitude?.toFixed(4)}°
                      </td>
                      <td className="px-5 py-3 text-right text-green-400 font-mono font-semibold">
                        {pt.altitude_km?.toFixed(2)} km
                      </td>
                      <td className="px-5 py-3 text-right text-yellow-400 font-mono font-semibold">
                        {pt.velocity_km_s?.toFixed(4)} km/s
                      </td>
                      <td className="px-5 py-3 text-right text-emerald-300 font-mono text-xs">
                        {pt.altitudeDeltaKm == null ? '—' : `${pt.altitudeDeltaKm >= 0 ? '+' : ''}${pt.altitudeDeltaKm.toFixed(3)} km`}
                      </td>
                      <td className="px-5 py-3 text-right text-xs">
                        <span className={`${pt.altitudeTrend === 'FALLING' ? 'text-red-300' : pt.altitudeTrend === 'RISING' ? 'text-emerald-300' : 'text-slate-400'}`}>
                          {pt.altitudeTrend}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right text-[11px] text-cyan-300">
                        {milestoneByIndex.get(i)?.type || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {!prediction && !loading && !satellitesLoading && (
        <div className="backdrop-blur-2xl rounded-lg p-16 animate-fade-in-up card-hover-lift border border-slate-700/50 flex justify-center">
          <div
            className="flex w-full flex-col items-center text-center"
            style={{ maxWidth: '680px' }}
          >
            <WandSparkles className="w-14 h-14 mb-6 text-violet-300" />
            <h3 className="text-2xl font-bold font-['Outfit'] text-white mb-2">
              Select a Satellite
            </h3>
            <p
              className="text-slate-400 text-lg leading-relaxed text-center"
              style={{ maxWidth: '620px', margin: '0 auto' }}
            >
              Choose a satellite and set your prediction horizon to simulate its future trajectory across the planet.
            </p>
          </div>
        </div>
      )}

      {satellitesLoading && (
        <Loader message="Loading satellite list..." />
      )}

      <MiniGlobeModal
        isOpen={showVisualize && !!prediction}
        onClose={() => setShowVisualize(false)}
        title="Prediction Visualization"
        allSatellites={predictionSatellites}
        focusNoradIds={focusedNoradId ? [focusedNoradId] : []}
        trajectoryPoints={[]}
        trajectorySets={trajectorySets}
        selectedTrajectoryIndex={timelineIndex}
        selectedTrajectoryPoint={selectedPrimaryPoint}
        lockFocusedSatellites
        infoBlock={prediction ? (
          <div className="space-y-2">
            <p className="text-white font-semibold">{prediction.satellite_name}</p>
            <p className="text-xs text-slate-400">NORAD: <span className="text-cyan-300 font-semibold">{prediction.satellite_id}</span></p>
            <p className="text-xs text-slate-400">Horizon: <span className="text-emerald-300 font-semibold">{prediction.hours}h</span></p>
            <p className="text-xs text-slate-400">Points: <span className="text-yellow-300 font-semibold">{prediction.points}</span></p>

            <TrajectoryTimeline
              points={enrichedPrimaryTrajectory}
              selectedIndex={timelineIndex}
              onChangeIndex={setTimelineIndex}
            />

            <div className="rounded-lg border border-slate-700/60 bg-slate-900/60 p-2 text-xs space-y-1">
              <p className="text-slate-400 uppercase">Selected Point Insight</p>
              <p className="text-slate-200">Alt: <span className="text-emerald-300 font-mono">{selectedPrimaryPoint?.altitude_km?.toFixed(2) ?? '—'} km</span></p>
              <p className="text-slate-200">Vel: <span className="text-yellow-300 font-mono">{selectedPrimaryPoint?.velocity_km_s?.toFixed(4) ?? '—'} km/s</span></p>
              <p className="text-slate-200">Trend: <span className="text-cyan-300 font-mono">{selectedPrimaryPoint?.altitudeTrend || '—'}</span></p>
              <p className="text-slate-200">Milestone: <span className="text-purple-300 font-mono">{milestoneByIndex.get(Math.min(timelineIndex, enrichedPrimaryTrajectory.length - 1))?.label || '—'}</span></p>
            </div>
          </div>
        ) : null}
      />
    </div>
  );
}
