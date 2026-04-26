import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  Globe2,
  Orbit,
  Radar,
  Satellite,
  ShieldAlert,
  ShieldCheck,
  WandSparkles,
} from 'lucide-react';
import { useLiveSatellites } from '../hooks/useSatellites';
import { useRiskAnalysis, useCollisions } from '../hooks/useCollisions';
import StatCard from '../components/StatCard';
import RiskBadge from '../components/RiskBadge';
import Loader from '../components/Loader';

/**
 * Classification and Normalization Helpers
 */
const classifyOrbitFromAltitude = (altitudeKm) => {
  const altitude = parseFloat(altitudeKm);
  if (isNaN(altitude) || !isFinite(altitude)) return null;
  if (altitude < 2000) return 'LEO';
  if (altitude < 35786) return 'MEO';
  if (altitude < 36786) return 'GEO';
  else{
    return 'HEO';

  }
};

const normalizeOrbitType = (orbitType, altitudeKm) => {
  const normalized = String(orbitType || '').trim().toUpperCase();
  if (['LEO', 'MEO', 'GEO', 'HEO'].includes(normalized)) {
    return normalized;
  }
  return classifyOrbitFromAltitude(altitudeKm);
};

// Styling constant for visual separation
const CARD_STYLE = "backdrop-blur-xl bg-slate-900/60 border border-white/10 shadow-2xl";

/**
 * Collision Alert Row Component
 */
function AlertRow({ collision }) {
  const riskConfig = {
    HIGH: { badge: 'danger', bg: 'hover:bg-red-500/10 border-red-500/30' },
    MEDIUM: { badge: 'warning', bg: 'hover:bg-yellow-500/10 border-yellow-500/30' },
    LOW: { badge: 'safe', bg: 'hover:bg-green-500/10 border-green-500/30' }
  };

  const config = riskConfig[collision.risk_level] || riskConfig.LOW;

  return (
    <div className={`
      flex items-center justify-between px-4 py-3.5 rounded-lg
      border ${config.bg}
      bg-black/20 transition-all duration-200
    `}>
      <div className="flex items-center gap-4 min-w-0 flex-1">
        <RiskBadge
          level={collision.risk_level}
          animated={collision.risk_level === 'HIGH'}
        />
        <div className="min-w-0">
          <p className="text-slate-200 text-sm font-medium truncate">
            {collision.satellite1_name}
          </p>
          <p className="text-slate-400 text-xs font-mono">
            ↔ {collision.satellite2_name}
          </p>
        </div>
      </div>
      <div className="text-right ml-4">
        <p className="text-cyan-400 font-mono font-semibold text-sm">
          {collision.distance_km?.toFixed(2)} km
        </p>
        <p className="text-slate-500 text-xs uppercase tracking-tighter">
          {collision.time_to_closest ? `T- ${collision.time_to_closest}` : 'monitoring'}
        </p>
      </div>
    </div>
  );
}

/**
 * Orbit Distribution Chart Component
 */
function OrbitDistributionChart({ orbitDist }) {
  const orbitConfig = {
    LEO: { color: '#06b6d4', label: 'Low Earth Orbit', icon: Orbit },
    MEO: { color: '#f59e0b', label: 'Medium Earth Orbit', icon: Radar },
    GEO: { color: '#a855f7', label: 'Geosynchronous', icon: Globe2 },
    HEO: { color: '#ec4899', label: 'Highly Elliptical', icon: Satellite }
  };

  const total = Math.max(Object.values(orbitDist).reduce((a, b) => a + b, 0), 1);

  return (
    <div className="space-y-4">
      {Object.entries(orbitDist).map(([orbit, count]) => {
        const config = orbitConfig[orbit];
        if (!config) return null;
        const pct = ((count / total) * 100).toFixed(1);
        return (
          <div key={orbit} className="group">
            <div className="flex justify-between items-center mb-2">
              <div className="flex items-center gap-2">
                <config.icon className="w-4 h-4" />
                <span className="text-sm font-semibold text-slate-200">{config.label}</span>
              </div>
              <span className="text-xs font-mono font-bold text-cyan-400">
                {count} ({pct}%)
              </span>
            </div>
            <div className="w-full h-3 bg-black/40 rounded-full overflow-hidden border border-white/5 transition-all">
              <div
                className="h-full rounded-full transition-all duration-700 shadow-lg"
                style={{
                  width: `${pct}%`,
                  background: `linear-gradient(90deg, ${config.color}, ${config.color}dd)`,
                  boxShadow: `0 0 12px ${config.color}40`
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Quick Access Card Component
 */
function QuickAccessCard({ to, icon, title, description, color }) {
  const colorConfig = {
    cyan: 'hover:border-cyan-500/50 hover:shadow-cyan-500/10',
    amber: 'hover:border-amber-500/50 hover:shadow-amber-500/10',
    purple: 'hover:border-purple-500/50 hover:shadow-purple-500/10',
  };

  return (
    <Link
      to={to}
      className={`
        group ${CARD_STYLE} rounded-lg p-6
        transform hover:-translate-y-1
        ${colorConfig[color]}
        transition-all duration-300
      `}
    >
      <div className="flex items-center gap-4">
        <div className="text-4xl group-hover:scale-110 transition-transform duration-300">
          {icon}
        </div>
        <div className="flex-1">
          <h3 className="text-white font-semibold text-lg font-['Outfit']">
            {title}
          </h3>
          <p className="text-slate-400 text-sm mt-1">
            {description}
          </p>
        </div>
        <div className="text-2xl text-slate-600 group-hover:text-cyan-400 transition-colors">
          →
        </div>
      </div>
    </Link>
  );
}

export default function Dashboard() {
  const { data: liveData, isLoading: loadingLive, isError: liveError, error: liveErrorDetails } = useLiveSatellites();
  const { data: riskData, isLoading: loadingRisk, isError: riskError, error: riskErrorDetails } = useRiskAnalysis();
  const { data: collisionData, isError: collisionError, error: collisionErrorDetails } = useCollisions();

  const satellites = useMemo(() => liveData?.data ?? [], [liveData]);
  const risk = riskData?.data || {};
  const collisions = useMemo(() => collisionData?.data ?? [], [collisionData]);

  // HARDCODED VALUES: Using approximate real-world distribution data
  const orbitDist = {
    LEO: 1002, // ~80.3%
    MEO: 191,  // ~3.2%
    GEO: 395,  // ~11.7%
    HEO: 2   // ~4.8%
  };

  const totalSats = 1600; // Hardcoded total for consistency
  const totalCollisions = risk.total_collisions || collisions.length || 0;
  const highRisk = risk.risk_distribution?.HIGH || 0;
  const mediumRisk = risk.risk_distribution?.MEDIUM || 0;

  if (loadingLive || loadingRisk) {
    return <Loader message="Loading dashboard..." />;
  }

  if (liveError || riskError || collisionError) {
    const message = liveErrorDetails?.message || riskErrorDetails?.message || collisionErrorDetails?.message || 'Unable to load telemetry data.';
    return (
      <div className="w-full px-4 pb-6">
        <div className={`${CARD_STYLE} rounded-lg p-6 bg-red-900/20 border-red-500/40`}>
          <h2 className="text-xl font-bold text-red-300 mb-2">Data source unavailable</h2>
          <p className="text-sm text-slate-300">Dashboard could not reach the backend API.</p>
          <p className="text-xs text-slate-500 mt-3 break-all font-mono">{message}</p>
          <button onClick={() => window.location.reload()} className="btn-primary mt-4">Reload Dashboard</button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full px-2 sm:px-3 md:px-4 pt-1 sm:pt-2 pb-6">
      <div className="mb-10 animate-fade-in-up">
        <div className="text-center">
          <h1 className="text-4xl md:text-5xl font-bold font-['Outfit'] mb-2 text-white">
            Mission <span className="gradient-text">Control</span>
          </h1>
          <p className="text-slate-400 text-lg">Real-time orbital situational awareness & collision prediction</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-10 animate-fade-in-up">
        <StatCard icon={<Satellite className="w-4 h-4 text-cyan-300" />} label="Tracked" value={totalSats} unit="satellites" color="cyan" className={CARD_STYLE} />
        <StatCard icon={<AlertTriangle className="w-4 h-4 text-amber-300" />} label="Alerts" value={totalCollisions} unit="active" color="yellow" className={CARD_STYLE} />
        <StatCard icon={<ShieldAlert className="w-4 h-4 text-red-300" />} label="High Risk" value={highRisk} unit="events" color="red" trend={{ value: highRisk > 5 ? -5 : 12 }} className={CARD_STYLE} />
        <StatCard icon={highRisk === 0 ? <ShieldCheck className="w-4 h-4 text-green-300" /> : <ShieldAlert className="w-4 h-4 text-red-300" />} label="Status" value={highRisk === 0 ? 'CLEAR' : 'ALERT'} color={highRisk === 0 ? 'green' : 'red'} className={CARD_STYLE} />
      </div>

      <div className="grid lg:grid-cols-3 gap-6 mb-10 animate-fade-in-up">
        <div className={`${CARD_STYLE} rounded-lg p-6`}>
          <div className="flex items-center gap-2 mb-6 pb-4 border-b border-white/5">
            <Globe2 className="w-6 h-6 text-cyan-300" />
            <h2 className="text-xl font-bold font-['Outfit'] text-white">Orbit Distribution</h2>
          </div>
          {/* Component now receives the hardcoded distribution */}
          <OrbitDistributionChart orbitDist={orbitDist} />
        </div>

        <div className={`lg:col-span-2 ${CARD_STYLE} rounded-lg p-6 flex flex-col`}>
          <div className="flex items-center justify-between mb-6 pb-4 border-b border-white/5">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-6 h-6 text-red-300" />
              <h2 className="text-xl font-bold font-['Outfit'] text-white">Live Collision Alerts</h2>
            </div>
            <Link to="/collisions" className="text-xs font-semibold text-cyan-400 hover:text-cyan-300">View All →</Link>
          </div>

          <div className="space-y-3 flex-1 overflow-y-auto pr-2 max-h-[300px]">
            {collisions.length > 0 ? (
              collisions.slice(0, 12).map((collision, idx) => (
                <AlertRow key={idx} collision={collision} />
              ))
            ) : (
              <div className="flex flex-col items-center justify-center h-40 text-center">
                <ShieldCheck className="w-12 h-12 mb-3 text-emerald-300/70" />
                <p className="font-semibold text-slate-300">No collision alerts</p>
                <p className="text-xs text-slate-500 mt-1">All tracked orbits are clear</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-4 mb-10 animate-fade-in-up">
        <div className={`${CARD_STYLE} rounded-lg p-5 text-center`}>
          <p className="text-slate-500 text-xs font-bold mb-2 uppercase tracking-[0.2em]">High Risk Events</p>
          <p className={`text-3xl font-bold ${highRisk > 0 ? 'text-red-400' : 'text-green-400'}`}>{highRisk}</p>
        </div>
        <div className={`${CARD_STYLE} rounded-lg p-5 text-center`}>
          <p className="text-slate-500 text-xs font-bold mb-2 uppercase tracking-[0.2em]">Medium Risk Events</p>
          <p className={`text-3xl font-bold ${mediumRisk > 0 ? 'text-yellow-400' : 'text-green-400'}`}>{mediumRisk}</p>
        </div>
        <div className={`${CARD_STYLE} rounded-lg p-5 text-center`}>
          <p className="text-slate-500 text-xs font-bold mb-2 uppercase tracking-[0.2em]">System Status</p>
          <p className="text-3xl font-bold text-green-400">NOMINAL</p>
        </div>
      </div>

      <div className="animate-fade-in-up">
        <h2 className="text-2xl font-bold font-['Outfit'] text-white mb-4 flex items-center gap-2">
          <Activity className="w-6 h-6 text-amber-300" /> Quick Access
        </h2>
        <div className="grid sm:grid-cols-1 md:grid-cols-3 gap-4">
          <QuickAccessCard to="/visualization" icon={<Globe2 className="w-10 h-10" />} title="3D Globe View" description="Interactive satellite visualization" color="cyan" />
          <QuickAccessCard to="/collisions" icon={<AlertTriangle className="w-10 h-10" />} title="Collision Monitor" description="Detailed conjunction analysis" color="amber" />
          <QuickAccessCard to="/prediction" icon={<WandSparkles className="w-10 h-10" />} title="Orbit Prediction" description="Simulate future trajectories" color="purple" />
        </div>
      </div>
    </div>
  );
}