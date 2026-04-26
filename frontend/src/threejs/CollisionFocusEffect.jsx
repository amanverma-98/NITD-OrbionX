import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { geoToScene } from './sceneUtils';

const DEFAULT_MARKER_TRAVEL_SPEED = 0.06;

const toScenePoint = (point) => {
  const latitude = Number(point?.latitude);
  const longitude = Number(point?.longitude);
  const altitude = Number(point?.altitude_km);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return geoToScene(latitude, longitude, Number.isFinite(altitude) ? altitude : 400);
};

const normalizeTrajectories = (trajectories = []) => {
  return trajectories
    .map((trajectory, index) => {
      const points = (trajectory?.points || [])
        .map((point) => toScenePoint(point))
        .filter(Boolean);

      if (points.length < 2) return null;

      return {
        key: trajectory?.norad_id || `traj-${index}`,
        color: trajectory?.color || '#ef4444',
        points,
      };
    })
    .filter(Boolean);
};

const computeClosestApproach = (trajectories) => {
  if (trajectories.length < 2) {
    return null;
  }

  const first = trajectories[0].points;
  const second = trajectories[1].points;
  const maxSamples = Math.min(first.length, second.length);

  if (maxSamples < 2) {
    return null;
  }

  let best = {
    distance: Number.POSITIVE_INFINITY,
    indexA: 0,
    indexB: 0,
    midpoint: first[0].clone(),
  };

  for (let i = 0; i < maxSamples; i += 1) {
    const a = first[i];
    const b = second[i];
    const distance = a.distanceTo(b);

    if (distance < best.distance) {
      best = {
        distance,
        indexA: i,
        indexB: i,
        midpoint: a.clone().add(b).multiplyScalar(0.5),
      };
    }
  }

  return best;
};

export default function CollisionFocusEffect({
  trajectories = [],
  markerTravelSpeed = DEFAULT_MARKER_TRAVEL_SPEED,
}) {
  const lineMaterialRefs = useRef([]);
  const movingMarkerRefs = useRef([]);
  const collisionPointRef = useRef(null);
  const collisionPulseOuterRef = useRef(null);
  const collisionPulseInnerRef = useRef(null);

  const prepared = useMemo(() => normalizeTrajectories(trajectories), [trajectories]);

  const closestApproach = useMemo(() => computeClosestApproach(prepared), [prepared]);

  const animatedTracks = useMemo(() => {
    return prepared.map((track, index) => {
      const fallbackIndex = track.points.length - 1;
      const targetIndex = index === 0
        ? (closestApproach?.indexA ?? fallbackIndex)
        : (closestApproach?.indexB ?? fallbackIndex);

      return {
        ...track,
        targetIndex: Math.max(1, Math.min(targetIndex, fallbackIndex)),
      };
    });
  }, [prepared, closestApproach]);

  useFrame(({ clock }) => {
    const elapsed = clock.elapsedTime;
    const pulse = Math.sin(elapsed * 6.2) * 0.25 + 0.75;

    lineMaterialRefs.current.forEach((material) => {
      if (!material) return;
      material.opacity = 0.28 + pulse * 0.56;
      material.emissiveIntensity = 0.5 + pulse * 1.8;
    });

    animatedTracks.forEach((track, index) => {
      const marker = movingMarkerRefs.current[index];
      if (!marker) return;

      const phase = (elapsed * markerTravelSpeed + index * 0.17) % 1;
      const travelProgress = phase * phase;
      const pointIndex = Math.min(
        track.targetIndex,
        Math.max(0, Math.floor(travelProgress * track.targetIndex))
      );

      marker.position.copy(track.points[pointIndex]);
      const markerScale = 1.0 + pulse * 0.65;
      marker.scale.setScalar(markerScale);
    });

    if (collisionPointRef.current) {
      const collisionPulse = Math.sin(elapsed * 9.5) * 0.35 + 0.95;
      collisionPointRef.current.scale.setScalar(1.3 + collisionPulse * 0.95);
      const material = collisionPointRef.current.material;
      if (material) {
        material.opacity = 0.45 + collisionPulse * 0.45;
        material.emissiveIntensity = 1.8 + collisionPulse * 3.2;
      }
    }

    if (collisionPulseOuterRef.current) {
      const outerPulse = (elapsed * 1.2) % 1;
      collisionPulseOuterRef.current.scale.setScalar(1.0 + outerPulse * 4.2);
      const outerMat = collisionPulseOuterRef.current.material;
      if (outerMat) {
        outerMat.opacity = 0.35 * (1 - outerPulse);
      }
    }

    if (collisionPulseInnerRef.current) {
      const innerPulse = ((elapsed * 1.2) + 0.5) % 1;
      collisionPulseInnerRef.current.scale.setScalar(1.0 + innerPulse * 3.0);
      const innerMat = collisionPulseInnerRef.current.material;
      if (innerMat) {
        innerMat.opacity = 0.28 * (1 - innerPulse);
      }
    }
  });

  if (animatedTracks.length === 0) {
    return null;
  }

  return (
    <group renderOrder={5} raycast={() => null}>
      {animatedTracks.map((track, index) => {
        const lineGeometry = new THREE.BufferGeometry().setFromPoints(track.points);
        return (
          <group key={track.key}>
            <line geometry={lineGeometry} raycast={() => null}>
              <lineBasicMaterial
                ref={(ref) => {
                  lineMaterialRefs.current[index] = ref;
                }}
                color={track.color}
                transparent
                opacity={0.9}
                depthTest={false}
                depthWrite={false}
              />
            </line>

            <mesh
              ref={(ref) => {
                movingMarkerRefs.current[index] = ref;
              }}
              position={track.points[0]}
              raycast={() => null}
            >
              <sphereGeometry args={[0.16, 18, 18]} />
              <meshStandardMaterial
                color={track.color}
                emissive={track.color}
                emissiveIntensity={3.2}
                transparent
                opacity={0.92}
                depthWrite={false}
              />
            </mesh>
          </group>
        );
      })}

      {closestApproach?.midpoint && (
        <group position={closestApproach.midpoint}>
          <mesh ref={collisionPointRef} raycast={() => null}>
            <sphereGeometry args={[0.24, 20, 20]} />
            <meshStandardMaterial
              color="#ef4444"
              emissive="#ef4444"
              emissiveIntensity={3.6}
              transparent
              opacity={0.9}
              depthTest={false}
              depthWrite={false}
            />
          </mesh>

          <mesh ref={collisionPulseOuterRef} raycast={() => null}>
            <sphereGeometry args={[0.36, 20, 20]} />
            <meshBasicMaterial
              color="#fb7185"
              transparent
              opacity={0.28}
              depthTest={false}
              depthWrite={false}
            />
          </mesh>

          <mesh ref={collisionPulseInnerRef} raycast={() => null}>
            <sphereGeometry args={[0.30, 20, 20]} />
            <meshBasicMaterial
              color="#fda4af"
              transparent
              opacity={0.22}
              depthTest={false}
              depthWrite={false}
            />
          </mesh>
        </group>
      )}
    </group>
  );
}
