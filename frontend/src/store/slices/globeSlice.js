import { createSlice } from '@reduxjs/toolkit';

const clampNoradIds = (ids = []) => {
  return ids
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id));
};

const initialState = {
  showOrbits: true,
  search: '',
  filters: {
    orbit: 'ALL',
    risk: 'ALL',
  },
  selectedSatellite: null,
  fullscreen: false,
  highlightNoradIds: [],
  blinkNoradIds: [],
  orbitEpochMs: Date.now(),
};

const globeSlice = createSlice({
  name: 'globe',
  initialState,
  reducers: {
    setShowOrbits(state, action) {
      state.showOrbits = Boolean(action.payload);
    },
    toggleShowOrbits(state) {
      state.showOrbits = !state.showOrbits;
    },
    setSearch(state, action) {
      state.search = String(action.payload ?? '');
    },
    setFilters(state, action) {
      const next = action.payload || {};
      state.filters = {
        orbit: next.orbit || state.filters.orbit,
        risk: next.risk || state.filters.risk,
      };
    },
    resetFilters(state) {
      state.filters = { orbit: 'ALL', risk: 'ALL' };
    },
    setSelectedSatellite(state, action) {
      state.selectedSatellite = action.payload || null;
    },
    clearSelectedSatellite(state) {
      state.selectedSatellite = null;
    },
    setFullscreen(state, action) {
      state.fullscreen = Boolean(action.payload);
    },
    toggleFullscreen(state) {
      state.fullscreen = !state.fullscreen;
    },
    setHighlightNoradIds(state, action) {
      state.highlightNoradIds = clampNoradIds(action.payload);
    },
    setBlinkNoradIds(state, action) {
      state.blinkNoradIds = clampNoradIds(action.payload);
    },
    setOrbitEpoch(state, action) {
      const nextEpochMs = Number(action.payload);
      state.orbitEpochMs = Number.isFinite(nextEpochMs) ? nextEpochMs : Date.now();
    },
    tickOrbitEpoch(state, action) {
      const deltaMs = Number(action.payload);
      if (Number.isFinite(deltaMs) && deltaMs > 0) {
        state.orbitEpochMs += deltaMs;
        return;
      }
      state.orbitEpochMs = Date.now();
    },
  },
});

export const {
  setShowOrbits,
  toggleShowOrbits,
  setSearch,
  setFilters,
  resetFilters,
  setSelectedSatellite,
  clearSelectedSatellite,
  setFullscreen,
  toggleFullscreen,
  setHighlightNoradIds,
  setBlinkNoradIds,
  setOrbitEpoch,
  tickOrbitEpoch,
} = globeSlice.actions;

export default globeSlice.reducer;
