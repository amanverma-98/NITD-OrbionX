/**
 * OrbionX – Collision Renderer
 * Draws red lines between satellites at collision risk with blinking animation.
 */

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { geoToScene } from './sceneUtils';

export default function CollisionRenderer({ collisions = [], satellites = [], focusPair = null }) {
  const groupRef = useRef();

  // Build a lookup map of satellite positions by norad_id
  const satMap = useMemo(() => {
    const map = {};
    satellites.forEach((s) => {
      if (s.latitude != null && s.longitude != null) {
        map[s.norad_id] = s;
      }
    });
    return map;
  }, [satellites]);

  // Generate collision lines
  const lines = useMemo(() => {
    const focusSet = focusPair ? new Set([focusPair.sat1, focusPair.sat2]) : null;

    return collisions
      .filter((c) => c.risk_level === 'HIGH' || c.risk_level === 'MEDIUM')
      .filter((c) => {
        if (!focusSet) return true;
        return focusSet.has(c.satellite1_id) && focusSet.has(c.satellite2_id);
      })
      .slice(0, 50)
      .map((c) => {
        const sat1 = satMap[c.satellite1_id];
        const sat2 = satMap[c.satellite2_id];
        if (!sat1 || !sat2) return null;

        const pos1 = geoToScene(sat1.latitude, sat1.longitude, sat1.altitude_km || 400);
        const pos2 = geoToScene(sat2.latitude, sat2.longitude, sat2.altitude_km || 400);

        return {
          points: [pos1, pos2],
          risk: c.risk_level,
          distance: c.distance_km,
          focused: !!focusSet,
        };
      })
      .filter(Boolean);
  }, [collisions, satMap, focusPair]);

  // Blinking animation for collision lines
  useFrame(({ clock }) => {
    if (groupRef.current) {
      const blink = Math.sin(clock.elapsedTime * 3) * 0.4 + 0.6;
      groupRef.current.children.forEach((child) => {
        if (child.material) {
          child.material.opacity = blink;
        }
      });
    }
  });

  return (
    <group ref={groupRef} raycast={() => null}>
      {lines.map((line, i) => {
        const geometry = new THREE.BufferGeometry().setFromPoints(line.points);
        return (
          <line key={i} geometry={geometry} raycast={() => null}>
            <lineBasicMaterial
              color={line.focused ? '#ef4444' : (line.risk === 'HIGH' ? '#ef4444' : '#f59e0b')}
              transparent
              opacity={line.focused ? 1 : 0.8}
              linewidth={2}
            />
          </line>
        );
      })}
    </group>
  );
}
