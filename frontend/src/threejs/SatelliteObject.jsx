/**
 * OrbionX – Satellite Object Renderer
 * Uses Three.js InstancedMesh for efficient rendering of 1000+ satellites.
 * Color-coded by risk level: green=safe, yellow=medium, red=high.
 */

import { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { eciKmToSceneVector, geoToScene, propagateSatellite } from './sceneUtils';

const MAX_INSTANCES = 15000;
const warnedInvalidNoradIds = new Set();

const riskColors = {
  LOW: new THREE.Color('#10b981'),
  MEDIUM: new THREE.Color('#f59e0b'),
  HIGH: new THREE.Color('#ef4444'),
  DEFAULT: new THREE.Color('#06b6d4'),
};

const toFiniteNumber = (value) => {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
};

const pickFinite = (...values) => {
  for (const value of values) {
    const normalized = toFiniteNumber(value);
    if (normalized !== null) {
      return normalized;
    }
  }
  return null;
};

const toNoradId = (value) => {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
};

export default function SatelliteObject({
  satellites = [],
  onSelect,
  highlightNoradIds = [],
  blinkNoradIds = [],
  satelliteRiskMap = {},
  selectedNoradId = null,
  referenceTime,
  disableSelectionFade = false,
}) {
  const meshRef = useRef();
  const hitMeshRef = useRef();
  const selectedMarkerRef = useRef();
  const selectedMarkerMaterialRef = useRef();
  const blinkMarkerGroupRef = useRef();
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const renderedSatellites = useMemo(() => {
    return satellites
      .map((satellite) => {
        const propagated = propagateSatellite(satellite.tle_line1, satellite.tle_line2, referenceTime);
        const latitude = pickFinite(propagated?.latitude, satellite.latitude);
        const longitude = pickFinite(propagated?.longitude, satellite.longitude);
        const altitude = pickFinite(propagated?.altitude_km, satellite.altitude_km);
        const noradId = toNoradId(satellite.norad_id);

        if (![latitude, longitude].every((value) => value !== null)) {
          if (noradId !== null && !warnedInvalidNoradIds.has(noradId)) {
            warnedInvalidNoradIds.add(noradId);
            console.warn(`[Orbit] Skipping NORAD ${noradId}: invalid propagated coordinates.`);
          }
          return null;
        }

        return {
          raw: satellite,
          norad_id: noradId,
          latitude,
          longitude,
          altitude_km: altitude ?? 400,
          positionEci: eciKmToSceneVector(propagated?.x_eci, propagated?.y_eci, propagated?.z_eci),
          risk_level: satellite.risk_level,
          collision_risk_level: satellite.collision_risk_level,
        };
      })
      .filter(Boolean);
  }, [satellites, referenceTime]);

  const selectedMarkerPosition = useMemo(() => {
    if (!Number.isInteger(selectedNoradId)) return null;
    const selectedSat = renderedSatellites.find((sat) => sat.norad_id === selectedNoradId);
    if (!selectedSat) return null;
    if (selectedSat.positionEci) return selectedSat.positionEci.clone();
    return geoToScene(selectedSat.latitude, selectedSat.longitude, selectedSat.altitude_km || 400);
  }, [renderedSatellites, selectedNoradId]);

  const selectedSatelliteLabel = useMemo(() => {
    if (!Number.isInteger(selectedNoradId)) return null;
    const selectedSat = renderedSatellites.find((sat) => sat.norad_id === selectedNoradId);
    if (!selectedSat) return null;
    return selectedSat.raw?.name || `NORAD ${selectedSat.norad_id}`;
  }, [renderedSatellites, selectedNoradId]);

  const selectedLabelPosition = useMemo(() => {
    if (!selectedMarkerPosition) return null;
    const offsetDirection = selectedMarkerPosition.clone().normalize();
    return selectedMarkerPosition.clone().add(offsetDirection.multiplyScalar(0.34));
  }, [selectedMarkerPosition]);

  const blinkMarkerPositions = useMemo(() => {
    if (!blinkNoradIds.length) return [];

    const focusSet = new Set(blinkNoradIds.filter((id) => Number.isInteger(id)));
    if (!focusSet.size) return [];

    return renderedSatellites
      .filter((sat) => focusSet.has(sat.norad_id))
      .map((sat) => sat.positionEci ? sat.positionEci.clone() : geoToScene(sat.latitude, sat.longitude, sat.altitude_km || 400));
  }, [renderedSatellites, blinkNoradIds]);

  // Update instance positions and colors
  useEffect(() => {
    if (!meshRef.current) return;

    const count = Math.min(renderedSatellites.length, MAX_INSTANCES);
    const colorArray = new Float32Array(count * 3);
    const hasSelection = Number.isInteger(selectedNoradId);
    meshRef.current.count = count;
    if (hitMeshRef.current) {
      hitMeshRef.current.count = count;
    }

    for (let i = 0; i < count; i++) {
      const sat = renderedSatellites[i];

      const pos = sat.positionEci ? sat.positionEci.clone() : geoToScene(sat.latitude, sat.longitude, sat.altitude_km || 400);
      dummy.position.copy(pos);
      const isSelected = hasSelection && sat.norad_id === selectedNoradId;
      const fadeOthers = !disableSelectionFade && hasSelection && !isSelected;
      const scale = isSelected ? 1.8 : (fadeOthers ? 0.65 : 1.0);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
      if (hitMeshRef.current) {
        hitMeshRef.current.setMatrixAt(i, dummy.matrix);
      }

      const isFocused = highlightNoradIds.includes(sat.norad_id);
      const risk = satelliteRiskMap[sat.norad_id] || sat.collision_risk_level || sat.risk_level;
      let color = isFocused ? riskColors.HIGH : (riskColors[risk] || riskColors.DEFAULT);

      if (isSelected) {
        color = new THREE.Color('#22c55e');
      } else if (fadeOthers) {
        color = color.clone().lerp(new THREE.Color('#0f172a'), 0.78);
      }

      colorArray[i * 3] = color.r;
      colorArray[i * 3 + 1] = color.g;
      colorArray[i * 3 + 2] = color.b;
    }

    meshRef.current.instanceMatrix.needsUpdate = true;
    if (hitMeshRef.current) {
      hitMeshRef.current.instanceMatrix.needsUpdate = true;
    }
    meshRef.current.geometry.setAttribute(
      'color',
      new THREE.InstancedBufferAttribute(colorArray, 3)
    );
  }, [renderedSatellites, dummy, highlightNoradIds, satelliteRiskMap, selectedNoradId, disableSelectionFade]);

  // Subtle pulse animation
  useFrame(({ clock }) => {
    if (meshRef.current && meshRef.current.material) {
      const pulse = Math.sin(clock.elapsedTime * 2) * 0.15 + 0.85;
      meshRef.current.material.emissiveIntensity = pulse;
    }

    if (selectedMarkerRef.current && selectedMarkerMaterialRef.current) {
      if (!selectedMarkerPosition) {
        selectedMarkerRef.current.visible = false;
        return;
      }

      selectedMarkerRef.current.visible = true;
      selectedMarkerRef.current.position.copy(selectedMarkerPosition);

      const blink = Math.sin(clock.elapsedTime * 10);
      const strength = blink > 0 ? 1 : 0.2;
      const scale = 1.4 + (strength * 0.55);

      selectedMarkerRef.current.scale.setScalar(scale);
      selectedMarkerMaterialRef.current.opacity = 0.3 + (strength * 0.7);
      selectedMarkerMaterialRef.current.emissiveIntensity = 1.2 + (strength * 2.8);
    }

    if (blinkMarkerGroupRef.current) {
      const blink = Math.sin(clock.elapsedTime * 10);
      const strength = blink > 0 ? 1 : 0.2;
      const scale = 1.25 + (strength * 0.5);

      blinkMarkerGroupRef.current.children.forEach((child) => {
        child.visible = true;
        child.scale.setScalar(scale);
        if (child.material) {
          child.material.opacity = 0.25 + (strength * 0.7);
          child.material.emissiveIntensity = 1.1 + (strength * 2.2);
        }
      });
    }
  });

  const handleSelect = (e) => {
    e.stopPropagation();
    const instanceId = e.instanceId;
    if (instanceId != null && renderedSatellites[instanceId]) {
      const sat = renderedSatellites[instanceId];
      onSelect?.({
        ...sat.raw,
        latitude: sat.latitude,
        longitude: sat.longitude,
        altitude_km: sat.altitude_km,
      });
    }
  };

  const handlePointerOver = (e) => {
    e.stopPropagation();
    if (typeof document !== 'undefined') {
      document.body.style.cursor = 'pointer';
    }
  };

  const handlePointerOut = () => {
    if (typeof document !== 'undefined') {
      document.body.style.cursor = 'default';
    }
  };

  return (
    <>
      <instancedMesh
        ref={meshRef}
        args={[null, null, MAX_INSTANCES]}
      >
        <sphereGeometry args={[0.09, 12, 12]} />
        <meshStandardMaterial
          vertexColors
          emissive="#ffffff"
          emissiveIntensity={1.0}
          transparent
          opacity={0.96}
        />
      </instancedMesh>

      {/* Larger invisible hit targets make satellite selection reliable. */}
      <instancedMesh
        ref={hitMeshRef}
        args={[null, null, MAX_INSTANCES]}
        onPointerDown={handleSelect}
        onClick={handleSelect}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
      >
        <sphereGeometry args={[0.95, 8, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </instancedMesh>

      <mesh ref={selectedMarkerRef} visible={false} raycast={() => null}>
        <sphereGeometry args={[0.14, 18, 18]} />
        <meshStandardMaterial
          ref={selectedMarkerMaterialRef}
          color="#22c55e"
          emissive="#16a34a"
          emissiveIntensity={2.0}
          transparent
          opacity={0.85}
          depthWrite={false}
        />
      </mesh>

      <group ref={blinkMarkerGroupRef} raycast={() => null}>
        {blinkMarkerPositions.map((position, index) => (
          <mesh key={`blink-${index}`} position={position} raycast={() => null}>
            <sphereGeometry args={[0.13, 18, 18]} />
            <meshStandardMaterial
              color="#ef4444"
              emissive="#ef4444"
              emissiveIntensity={2.0}
              transparent
              opacity={0.8}
              depthWrite={false}
            />
          </mesh>
        ))}
      </group>

      {selectedLabelPosition && selectedSatelliteLabel && (
        <Html position={selectedLabelPosition} center distanceFactor={9} occlude={false}>
          <div
            style={{
              padding: '3px 8px',
              borderRadius: '999px',
              border: '1px solid rgba(34,197,94,0.7)',
              background: 'rgba(2, 6, 23, 0.88)',
              color: '#86efac',
              fontSize: '11px',
              fontWeight: 700,
              whiteSpace: 'nowrap',
              boxShadow: '0 0 12px rgba(34,197,94,0.35)',
            }}
          >
            {selectedSatelliteLabel}
          </div>
        </Html>
      )}
    </>
  );
}
