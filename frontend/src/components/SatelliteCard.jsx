import React from 'react';

const riskColors = {
  LOW: { bg: 'rgba(16,185,129,0.12)', text: '#10b981', border: 'rgba(16,185,129,0.3)' },
  MEDIUM: { bg: 'rgba(245,158,11,0.12)', text: '#f59e0b', border: 'rgba(245,158,11,0.3)' },
  HIGH: { bg: 'rgba(239,68,68,0.12)', text: '#ef4444', border: 'rgba(239,68,68,0.3)' },
};

const SatelliteCard = React.memo(function SatelliteCard({ satellite, onClick }) {
  const risk = satellite.risk_level || 'LOW';
  const colors = riskColors[risk] || riskColors.LOW;
  const orbitType = satellite.orbit_type || '—';

  return (
    <div
      onClick={() => onClick?.(satellite)}
      className="glass-panel p-4 cursor-pointer hover:scale-[1.02] transition-all duration-200"
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-white font-semibold text-sm truncate max-w-[180px]">
            {satellite.name || `SAT-${satellite.norad_id}`}
          </h3>
          <p className="text-slate-500 text-xs mt-0.5">NORAD {satellite.norad_id}</p>
        </div>
        <span
          className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider"
          style={{ background: colors.bg, color: colors.text, border: `1px solid ${colors.border}` }}
        >
          {risk}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-slate-800/50 rounded-lg px-3 py-2">
          <span className="text-slate-500 block">Altitude</span>
          <span className="text-cyan-400 font-mono font-medium">
            {satellite.altitude_km ? `${satellite.altitude_km.toFixed(0)} km` : '—'}
          </span>
        </div>
        <div className="bg-slate-800/50 rounded-lg px-3 py-2">
          <span className="text-slate-500 block">Velocity</span>
          <span className="text-blue-400 font-mono font-medium">
            {satellite.velocity_km_s ? `${satellite.velocity_km_s.toFixed(2)} km/s` : '—'}
          </span>
        </div>
        <div className="bg-slate-800/50 rounded-lg px-3 py-2">
          <span className="text-slate-500 block">Orbit</span>
          <span className="text-amber-400 font-medium">{orbitType}</span>
        </div>
        <div className="bg-slate-800/50 rounded-lg px-3 py-2">
          <span className="text-slate-500 block">Lat/Lon</span>
          <span className="text-slate-300 font-mono text-[10px]">
            {satellite.latitude != null ? `${satellite.latitude.toFixed(1)}°` : '—'}
          </span>
        </div>
      </div>
    </div>
  );
});

export default SatelliteCard;
