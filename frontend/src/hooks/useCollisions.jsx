import { useQuery } from '@tanstack/react-query';
import { getCollisions, getRiskAnalysis } from '../services/api';

export function useCollisions(riskLevel = null) {
  return useQuery({
    queryKey: ['collisions', riskLevel],
    queryFn: () => getCollisions(riskLevel),
  });
}

export function useRiskAnalysis() {
  return useQuery({
    queryKey: ['risk-analysis'],
    queryFn: getRiskAnalysis,
  });
}
