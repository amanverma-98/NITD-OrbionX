import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';
import { useDispatch, useSelector } from 'react-redux';
import { EarthSceneComponent } from '../threejs/EarthScene';
import SatelliteObject from '../threejs/SatelliteObject';
import OrbitRenderer from '../threejs/OrbitRenderer';
import CollisionFocusEffect from '../threejs/CollisionFocusEffect';
import { geoToScene } from '../threejs/sceneUtils';
import { setSelectedSatellite, toggleShowOrbits } from '../store/slices/globeSlice';

const toNoradId = (value) => {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
};

const hasFiniteCoordinate = (value) => Number.isFinite(Number(value));

const isRenderableSatellite = (satellite) => {
  const hasGeo = hasFiniteCoordinate(satellite?.latitude) && hasFiniteCoordinate(satellite?.longitude);
  const hasTle = Boolean(satellite?.tle_line1 && satellite?.tle_line2);
  return hasGeo || hasTle;
};

function PredictionTrajectory({ points = [] }) {
  const vectors = useMemo(() => {
    return points
      .filter((pt) => Number.isFinite(pt.latitude) && Number.isFinite(pt.longitude))
      .map((pt) => geoToScene(pt.latitude, pt.longitude, Number.isFinite(pt.altitude_km) ? pt.altitude_km : 400));
  }, [points]);

  if (vectors.length < 2) return null;

  const geometry = new THREE.BufferGeometry().setFromPoints(vectors);
  return (
    <line geometry={geometry} renderOrder={4} raycast={() => null}>
      <lineBasicMaterial color="#22c55e" transparent opacity={0.95} depthTest={false} depthWrite={false} />
    </line>
  );
}

function PredictionTrajectorySet({ trajectories = [], selectedIndex = null }) {
  return (
    <>
      {trajectories.map((trajectory, index) => {
        const vectors = trajectory.points
          .filter((pt) => Number.isFinite(pt.latitude) && Number.isFinite(pt.longitude))
          .map((pt) => geoToScene(pt.latitude, pt.longitude, Number.isFinite(pt.altitude_km) ? pt.altitude_km : 400));

        if (vectors.length < 2) return null;

        const clampedIndex = Number.isFinite(selectedIndex)
          ? Math.max(0, Math.min(Number(selectedIndex), vectors.length - 1))
          : null;

        const activeStart = clampedIndex === null ? null : Math.max(0, clampedIndex - 2);
        const activeEnd = clampedIndex === null ? null : Math.min(vectors.length - 1, clampedIndex + 2);

        const pathUntilCurrent = clampedIndex === null ? [] : vectors.slice(0, clampedIndex + 1);
        const activeSegment = activeStart === null || activeEnd === null ? [] : vectors.slice(activeStart, activeEnd + 1);

        const geometry = new THREE.BufferGeometry().setFromPoints(vectors);
        return (
          <group key={`traj-${trajectory.norad_id || trajectory.name || index}`}>
            <line geometry={geometry} renderOrder={4} raycast={() => null}>
              <lineBasicMaterial
                color={trajectory.color || '#22c55e'}
                transparent
                opacity={0.3}
                depthTest={false}
                depthWrite={false}
              />
            </line>

            {pathUntilCurrent.length > 1 && (
              <line geometry={new THREE.BufferGeometry().setFromPoints(pathUntilCurrent)} renderOrder={5} raycast={() => null}>
                <lineBasicMaterial
                  color={trajectory.color || '#22c55e'}
                  transparent
                  opacity={0.85}
                  depthTest={false}
                  depthWrite={false}
                />
              </line>
            )}

            {activeSegment.length > 1 && (
              <line geometry={new THREE.BufferGeometry().setFromPoints(activeSegment)} renderOrder={6} raycast={() => null}>
                <lineBasicMaterial
                  color={trajectory.highlightColor || '#fbbf24'}
                  transparent
                  opacity={0.98}
                  depthTest={false}
                  depthWrite={false}
                />
              </line>
            )}
          </group>
        );
      })}
    </>
  );
}

function TrajectoryMarker({ point, color = '#fbbf24' }) {
  if (!point || !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) return null;

  const position = geoToScene(
    point.latitude,
    point.longitude,
    Number.isFinite(point.altitude_km) ? point.altitude_km : 400
  );

  return (
    <mesh position={position} renderOrder={6}>
      <sphereGeometry args={[0.18, 16, 16]} />
      <meshBasicMaterial color={color} transparent opacity={0.95} depthTest={false} depthWrite={false} />
    </mesh>
  );
}

export default function MiniGlobeModal({
  isOpen,
  onClose,
  title = 'Visualize',
  allSatellites = [],
  focusNoradIds = [],
  lockFocusedSatellites = false,
  trajectoryPoints = [],
  trajectorySets = [],
  selectedTrajectoryIndex = null,
  selectedTrajectoryPoint = null,
  compareTrajectoryPoint = null,
  infoBlock = null,
  onSatelliteSelect,
}) {
  const dispatch = useDispatch();
  const autoSelectedOnOpenRef = useRef(false);
  const showOrbits = useSelector((state) => state.globe.showOrbits);
  const selectedSatellite = useSelector((state) => state.globe.selectedSatellite);
  const [hideOthersOverride, setHideOthersOverride] = useState(null);
  const focusIds = useMemo(
    () => focusNoradIds.map((id) => toNoradId(id)).filter((id) => id !== null),
    [focusNoradIds]
  );
  const focusSet = useMemo(() => new Set(focusIds), [focusIds]);
  const isCollisionFocusMode = focusIds.length === 2 && trajectorySets.length >= 2;
  const defaultHideOthers = lockFocusedSatellites ? true : focusIds.length >= 2;
  const hideOthers = (isCollisionFocusMode || lockFocusedSatellites)
    ? true
    : (hideOthersOverride ?? defaultHideOthers);

  const validSatellites = useMemo(
    () => allSatellites.filter((sat) => isRenderableSatellite(sat)),
    [allSatellites]
  );

  const satellitesToRender = useMemo(() => {
    if (!hideOthers || focusSet.size === 0) return validSatellites;
    return validSatellites.filter((sat) => focusSet.has(toNoradId(sat.norad_id)));
  }, [hideOthers, focusSet, validSatellites]);

  const selectedNoradId = Number(selectedSatellite?.norad_id);
  const referenceTime = new Date();

  useEffect(() => {
    if (!isOpen) {
      autoSelectedOnOpenRef.current = false;
      return;
    }

    if (autoSelectedOnOpenRef.current) return;

    const preferredFocusId = focusIds.length ? focusIds[0] : null;
    const preferredFocusedSatellite = preferredFocusId === null
      ? null
      : validSatellites.find((sat) => toNoradId(sat.norad_id) === preferredFocusId);

    const fallbackSatellite = satellitesToRender[0] || validSatellites[0] || null;
    const initialSatellite = preferredFocusedSatellite || fallbackSatellite;

    if (!initialSatellite) return;

    dispatch(setSelectedSatellite(initialSatellite));
    if (typeof onSatelliteSelect === 'function') {
      onSatelliteSelect(initialSatellite);
    }
    autoSelectedOnOpenRef.current = true;
  }, [isOpen, focusIds, validSatellites, satellitesToRender, dispatch, onSatelliteSelect]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-6xl max-h-[90vh] overflow-hidden glass-panel rounded-xl border border-slate-700/70">
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-slate-700/60">
          <h3 className="text-white text-lg font-semibold font-['Outfit']">{title}</h3>
          <button onClick={onClose} className="text-slate-300 hover:text-white text-lg px-3 py-1 rounded-lg border border-slate-600 hover:border-cyan-400 transition">
            X
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-3 p-3 sm:p-4 max-h-[calc(90vh-56px)] overflow-hidden">
          <div className="relative h-[52vh] sm:h-[58vh] rounded-xl overflow-hidden border border-slate-700/60 bg-[radial-gradient(circle_at_50%_40%,rgba(8,47,73,0.35),rgba(2,6,23,0.95))]">
            <Canvas
              camera={{ position: [0, 0, 18], fov: 45, near: 0.1, far: 1000 }}
              gl={{ antialias: true, alpha: false, powerPreference: 'high-performance', precision: 'highp' }}
              onCreated={({ gl }) => {
                gl.outputColorSpace = THREE.SRGBColorSpace;
                gl.toneMapping = THREE.ACESFilmicToneMapping;
                gl.toneMappingExposure = 1.15;
              }}
              style={{ position: 'absolute', inset: 0, touchAction: 'none' }}
              dpr={typeof window !== 'undefined' ? Math.min(window.devicePixelRatio, 2) : 1}
            >
              <PerspectiveCamera makeDefault position={[0, 0, 18]} fov={45} near={0.1} far={1000} />
              <Suspense fallback={null}>
                <EarthSceneComponent />
                <SatelliteObject
                  satellites={satellitesToRender}
                  onSelect={(satellite) => {
                    dispatch(setSelectedSatellite(satellite));
                    if (typeof onSatelliteSelect === 'function') {
                      onSatelliteSelect(satellite);
                    }
                  }}
                  highlightNoradIds={focusIds}
                  blinkNoradIds={focusIds}
                  satelliteRiskMap={{}}
                  selectedNoradId={selectedNoradId}
                  referenceTime={referenceTime}
                />
                {!isCollisionFocusMode && (
                  <OrbitRenderer
                    satellites={satellitesToRender}
                    showOrbits={showOrbits}
                    highlightNoradIds={focusIds}
                    satelliteRiskMap={{}}
                    selectedNoradId={selectedNoradId}
                    referenceTime={referenceTime}
                  />
                )}
                {isCollisionFocusMode && <CollisionFocusEffect trajectories={trajectorySets} />}
                <PredictionTrajectory points={trajectoryPoints} />
                {!isCollisionFocusMode && <PredictionTrajectorySet trajectories={trajectorySets} selectedIndex={selectedTrajectoryIndex} />}
                <TrajectoryMarker point={selectedTrajectoryPoint} color="#fbbf24" />
                <TrajectoryMarker point={compareTrajectoryPoint} color="#c084fc" />
              </Suspense>
              <OrbitControls
                makeDefault
                enableDamping
                dampingFactor={0.08}
                minDistance={5.6}
                maxDistance={110}
                enablePan
                enableRotate
                enableZoom
                rotateSpeed={0.7}
                zoomSpeed={0.9}
                panSpeed={0.8}
                touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
                mouseButtons={{
                  LEFT: THREE.MOUSE.ROTATE,
                  MIDDLE: THREE.MOUSE.DOLLY,
                  RIGHT: THREE.MOUSE.PAN,
                }}
              />
            </Canvas>
          </div>

          <div className="space-y-2 overflow-y-auto max-h-[calc(90vh-140px)] pr-1">
            <div className="glass-panel rounded-lg p-2.5 border border-slate-700/60">
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-slate-300 text-xs font-semibold uppercase tracking-wide">Display Controls</p>
                <p className="text-[11px] text-slate-500">Focused: {focusIds.length || 0}</p>
              </div>
              {isCollisionFocusMode ? (
                <div className="w-full text-xs font-semibold px-2.5 py-1.5 rounded-lg border bg-red-500/15 text-red-300 border-red-500/40 leading-snug">
                  Collision Focus Active: only colliding orbits shown
                </div>
              ) : (
                <div className="space-y-1.5">
                  <button
                    onClick={() => dispatch(toggleShowOrbits())}
                    className={`w-full text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition ${showOrbits ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40' : 'bg-slate-800/60 text-slate-300 border-slate-600'}`}
                  >
                    {showOrbits ? 'Hide Orbit Paths' : 'Show Orbit Paths'}
                  </button>
                  {!lockFocusedSatellites && (
                    <button
                      onClick={() => setHideOthersOverride((prev) => (prev ?? defaultHideOthers ? false : true))}
                      className={`w-full text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition ${hideOthers ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40' : 'bg-slate-800/60 text-slate-300 border-slate-600'}`}
                    >
                      {hideOthers ? 'Show Other Satellites' : 'Hide Other Satellites'}
                    </button>
                  )}
                  {lockFocusedSatellites && (
                    <div className="w-full text-xs font-semibold px-2.5 py-1.5 rounded-lg border bg-cyan-500/10 text-cyan-300 border-cyan-500/30 leading-snug">
                      Focus Mode Active: showing selected satellite only
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="glass-panel rounded-lg p-3 border border-slate-700/60 text-sm text-slate-300">
              <div className="space-y-2">
                {infoBlock || <p>No additional details available.</p>}
                {selectedSatellite && (
                  <div className="pt-2 border-t border-slate-700/70 text-xs">
                    <p className="text-slate-400">Selected Satellite</p>
                    <p className="text-cyan-300 font-semibold">
                      {selectedSatellite.name || `NORAD ${selectedSatellite.norad_id}`}
                    </p>
                    <p className="text-slate-500 font-mono">NORAD {selectedSatellite.norad_id}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
