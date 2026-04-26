/**
 * OrbionX – Orbit Path Renderer
 * Renders curved orbit lines using BufferGeometry with fading trail effect.
 */

import { useMemo } from 'react';
import * as THREE from 'three';
import { generateOrbitSegments } from './sceneUtils';

const MAX_ORBITS_RENDERED = 140;

const toNoradId = (value) => {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
};

export default function OrbitRenderer({
  satellites = [],
  showOrbits = true,
  highlightNoradIds = [],
  satelliteRiskMap = {},
  selectedNoradId = null,
  referenceTime,
}) {
  const highlightSet = useMemo(
    () => new Set(highlightNoradIds.map((id) => toNoradId(id)).filter((id) => id !== null)),
    [highlightNoradIds]
  );

  const orbitLines = useMemo(() => {
    if (!showOrbits || satellites.length === 0) return [];

    let subset = satellites;
    if (satellites.length > MAX_ORBITS_RENDERED) {
      const prioritized = satellites.filter((sat) => {
        const noradId = toNoradId(sat?.norad_id);
        if (noradId === null) return false;
        return noradId === selectedNoradId || highlightSet.has(noradId);
      });

      subset = prioritized.length
        ? prioritized
        : satellites.slice(0, MAX_ORBITS_RENDERED);
    }

    const lines = [];

    subset.forEach((sat) => {
      const segments = generateOrbitSegments(sat.tle_line1, sat.tle_line2, referenceTime);
      if (!segments.length) {
        return;
      }

      lines.push({
        segments: segments.filter((segment) => segment.length >= 2),
        noradId: toNoradId(sat.norad_id),
        risk: satelliteRiskMap[sat.norad_id] || sat.risk_level || 'LOW',
      });
    });

    return lines;
  }, [satellites, showOrbits, satelliteRiskMap, referenceTime, selectedNoradId, highlightSet]);

  if (!showOrbits) return null;

  const riskLineColors = {
    LOW: '#06b6d4',
    MEDIUM: '#f59e0b',
    HIGH: '#ef4444',
  };

  return (
    <group renderOrder={3}>
      {orbitLines.flatMap((orbit, orbitIndex) => {
        const isFocused = highlightSet.has(orbit.noradId);
        const hasSelection = Number.isInteger(selectedNoradId);
        const isSelected = hasSelection && orbit.noradId === selectedNoradId;
        const color = isSelected
          ? '#22c55e'
          : (isFocused ? '#ef4444' : (riskLineColors[orbit.risk] || '#06b6d4'));
        const opacity = isSelected
          ? 0.98
          : (hasSelection
            ? (isFocused ? 0.75 : 0.18)
            : (isFocused ? 0.85 : 0.26));

        return orbit.segments
          .map((segment, segmentIndex) => {
            const geometry = new THREE.BufferGeometry().setFromPoints(segment);

            return (
              <line
                key={`${orbit.noradId ?? 'orbit'}-${orbitIndex}-${segmentIndex}`}
                geometry={geometry}
                renderOrder={3}
                raycast={() => null}
              >
                <lineBasicMaterial
                  color={color}
                  transparent
                  opacity={opacity}
                  depthTest={false}
                  depthWrite={false}
                  linewidth={1}
                />
              </line>
            );
          })
          .filter(Boolean);
      })}
    </group>
  );
}
