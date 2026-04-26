import React, { useState, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  setFilters,
  setSearch,
  setSelectedSatellite,
  setShowOrbits,
} from '../store/slices/globeSlice';

/**
 * Helper to determine orbit if orbit_type is missing from data
 */
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

const getNormalizedOrbit = (s) => {
  const type = String(s.orbit_type || s.orbit || '').trim().toUpperCase();
  if (['LEO', 'MEO', 'GEO', 'HEO'].includes(type)) return type;

  const altitude = parseFloat(s.altitude_km || s.altitude);
  const normalizedAltitude = Number.isFinite(altitude)
    ? altitude
    : estimateAltitudeFromTle(s.tle_line2);

  if (!Number.isFinite(normalizedAltitude)) return 'UNKNOWN';
  if (normalizedAltitude < 2000) return 'LEO';
  if (normalizedAltitude < 35786) return 'MEO';
  if (normalizedAltitude < 36786) return 'GEO';
  return 'HEO';
};

const ControlPanel = React.memo(function ControlPanel({
  satellites = [],
}) {
  const dispatch = useDispatch();
  const search = useSelector((state) => state.globe.search);
  const filters = useSelector((state) => state.globe.filters);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const handleSearch = (value) => {
    dispatch(setSearch(value));
    setShowSuggestions(Boolean(value.trim()));
  };

  const handleOrbitFilter = (value) => {
    dispatch(setFilters({ orbit: value, risk: filters.risk }));
  };

  const handleRiskFilter = (value) => {
    dispatch(setFilters({ orbit: filters.orbit, risk: value }));
  };

  /**
   * FIXED STATS LOGIC
   * Maps through satellites once and categorizes them
   */
  const stats = useMemo(() => {
    const counts = { total: satellites.length, LEO: 0, MEO: 0, GEO: 0 };
    
    satellites.forEach(s => {
      const orbit = getNormalizedOrbit(s);
      if (Object.prototype.hasOwnProperty.call(counts, orbit)) {
        counts[orbit]++;
      }
    });

    return {
      total: counts.total,
      leo: counts.LEO,
      meo: counts.MEO,
      geo: counts.GEO
    };
  }, [satellites]);

  const suggestions = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return [];

    return satellites
      .filter((satellite) => {
        const name = (satellite.name || '').toLowerCase();
        const id = String(satellite.norad_id || '');
        return name.includes(query) || id.includes(query);
      })
      .slice(0, 10);
  }, [satellites, search]);

  const handleSuggestionClick = (satellite) => {
    const queryValue = satellite.name?.trim() ? satellite.name : String(satellite.norad_id);
    dispatch(setSearch(queryValue));
    dispatch(setFilters({ orbit: 'ALL', risk: 'ALL' }));
    dispatch(setSelectedSatellite(satellite));
    dispatch(setShowOrbits(true));
    setShowSuggestions(false);
  };

  return (
    <div className="space-y-5 w-full min-w-0">
      <h2 className="text-lg font-semibold text-white font-['Outfit']">Control Panel</h2>

      {/* Search */}
      <div className="relative">
        <input
          type="text"
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          onFocus={() => setShowSuggestions(Boolean(search.trim()))}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 120)}
          placeholder="Search satellites..."
          className="w-full bg-slate-800/60 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20 transition"
        />

        {showSuggestions && search.trim() && (
          <div className="absolute left-0 right-0 mt-1 z-30 rounded-lg border border-slate-700 bg-slate-900/95 backdrop-blur max-h-60 overflow-y-auto shadow-xl">
            {suggestions.length > 0 ? (
              suggestions.map((satellite) => (
                <button
                  key={satellite.norad_id}
                  type="button"
                  onMouseDown={() => handleSuggestionClick(satellite)}
                  className="w-full text-left px-3 py-2 hover:bg-slate-800/90 transition border-b border-slate-800 last:border-b-0"
                >
                  <div className="text-sm text-white font-medium truncate">{satellite.name || `NORAD ${satellite.norad_id}`}</div>
                  <div className="text-xs text-slate-400">NORAD {satellite.norad_id}</div>
                </button>
              ))
            ) : (
              <div className="px-3 py-2 text-xs text-slate-400">No matching satellites</div>
            )}
          </div>
        )}
      </div>

      {/* Orbit Type Filter */}
      <div>
        <label className="text-xs text-slate-400 uppercase tracking-wider font-medium mb-2 block">
          Orbit Type
        </label>
        <div className="grid grid-cols-4 gap-1.5">
          {['ALL', 'LEO', 'MEO', 'GEO'].map((type) => (
            <button
              key={type}
              onClick={() => handleOrbitFilter(type)}
              className={`text-xs py-2 rounded-lg font-medium transition-all
                ${filters.orbit === type
                  ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                  : 'bg-slate-800/40 text-slate-400 border border-slate-700 hover:border-slate-600'
                }`}
            >
              {type}
            </button>
          ))}
        </div>
      </div>

      {/* Risk Level Filter */}
      <div>
        <label className="text-xs text-slate-400 uppercase tracking-wider font-medium mb-2 block">
          Risk Level
        </label>
        <div className="grid grid-cols-4 gap-1.5">
          {['ALL', 'LOW', 'MEDIUM', 'HIGH'].map((level) => {
            const active = filters.risk === level;
            const activeClassMap = {
              ALL: 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30',
              LOW: 'bg-green-500/20 text-green-400 border border-green-500/30',
              MEDIUM: 'bg-amber-500/20 text-amber-400 border border-amber-500/30',
              HIGH: 'bg-red-500/20 text-red-400 border border-red-500/30',
            };
            return (
              <button
                key={level}
                onClick={() => handleRiskFilter(level)}
                className={`text-xs py-2  rounded-lg font-medium transition-all
                  ${active
                    ? activeClassMap[level]
                    : 'bg-slate-800/40  text-slate-400 border border-slate-700 hover:border-slate-600'
                  }`}
              >
                {level.slice(0,3)}
              </button>
            );
          })}
        </div>
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-700/50">
        <div className="bg-slate-800/40 rounded-lg p-3 text-center border border-white/5">
          <p className="text-2xl font-bold text-cyan-400 font-mono">{stats.total}</p>
          <p className="text-[10px] text-slate-500 uppercase tracking-wider">Total</p>
        </div>
        <div className="bg-slate-800/40 rounded-lg p-3 text-center border border-white/5">
          <p className="text-2xl font-bold text-green-400 font-mono">{stats.leo}</p>
          <p className="text-[10px] text-slate-500 uppercase tracking-wider">LEO</p>
        </div>
        <div className="bg-slate-800/40 rounded-lg p-3 text-center border border-white/5">
          <p className="text-2xl font-bold text-amber-400 font-mono">{stats.meo}</p>
          <p className="text-[10px] text-slate-500 uppercase tracking-wider">MEO</p>
        </div>
        <div className="bg-slate-800/40 rounded-lg p-3 text-center border border-white/5">
          <p className="text-2xl font-bold text-purple-400 font-mono">{stats.geo}</p>
          <p className="text-[10px] text-slate-500 uppercase tracking-wider">GEO</p>
        </div>
      </div>
    </div>
  );
});

export default ControlPanel;