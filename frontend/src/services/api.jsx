/**
 * OrbionX API Service
 * Centralized Axios instance with all API functions.
 */

import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL;

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

// ─── API Functions ──────────────────────────────────────

export const getSatellites = async (limit = 100, skip = 0) => {
  const { data } = await api.get(`/satellites?limit=${limit}&skip=${skip}`);
  return data;
};

export const getSatelliteById = async (noradId) => {
  const { data } = await api.get(`/satellites/${noradId}`);
  return data;
};

export const getLiveSatellites = async (limit = 1600) => {
  const { data } = await api.get(`/satellites/live?limit=${limit}`);
  return data;
};

export const getCollisions = async (riskLevel = null, limit = 100) => {
  let url = `/collisions?limit=${limit}`;
  if (riskLevel) url += `&risk_level=${riskLevel}`;
  const { data } = await api.get(url);
  return data;
};

export const getOrbitPrediction = async (satelliteId, hours = 24, stepMinutes = 10) => {
  const normalizedId = Number(satelliteId);
  if (!Number.isFinite(normalizedId) || normalizedId <= 0) {
    throw new Error('Invalid satellite id for orbit prediction');
  }
  const { data } = await api.get(
    `/orbit/${normalizedId}/predict?hours=${hours}&step_minutes=${stepMinutes}`
  );
  return data;
};

export const getCollisionAdvisory = async (
  satellite1Id,
  satellite2Id,
  riskLevel = 'HIGH',
  stepMinutes = 10
) => {
  const sat1 = Number(satellite1Id);
  const sat2 = Number(satellite2Id);
  if (!Number.isFinite(sat1) || sat1 <= 0 || !Number.isFinite(sat2) || sat2 <= 0) {
    throw new Error('Invalid satellite ids for collision advisory');
  }
  const query = new URLSearchParams({
    satellite1_id: String(sat1),
    satellite2_id: String(sat2),
    risk_level: String(riskLevel || 'HIGH'),
    step_minutes: String(stepMinutes),
  });
  const { data } = await api.get(`/collisions/advisory?${query.toString()}`);
  return data;
};

export const getRiskAnalysis = async () => {
  const { data } = await api.get('/risk-analysis');
  return data;
};

export default api;
