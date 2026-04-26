import { useQuery } from '@tanstack/react-query';
import { getLiveSatellites, getSatellites, getSatelliteById } from '../services/api';

export function useSatellites(limit = 100) {
  return useQuery({
    queryKey: ['satellites', limit],
    queryFn: () => getSatellites(limit),
  });
}

export function useLiveSatellites(limit = 1600) {
  return useQuery({
    queryKey: ['satellites-live', limit],
    queryFn: () => getLiveSatellites(limit),
  });
}

export function useSatelliteById(noradId) {
  return useQuery({
    queryKey: ['satellite', noradId],
    queryFn: () => getSatelliteById(noradId),
    enabled: !!noradId,
  });
}
