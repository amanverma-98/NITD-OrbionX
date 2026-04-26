/**
 * OrbionX – Three.js Earth Scene
 * Renders a textured Earth with starfield, atmosphere glow, and lighting.
 */

import { useRef, useMemo, useEffect, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { EARTH_RADIUS } from './sceneUtils';

const EARTH_DAY_TEXTURE_URL = '/textures/earth/day.jpg';
const EARTH_NORMAL_TEXTURE_URL = '/textures/earth/normal.jpg';
const EARTH_SPECULAR_TEXTURE_URL = '/textures/earth/specular.jpg';
const EARTH_NIGHT_TEXTURE_URL = '/textures/earth/night.png';
const EARTH_CLOUD_TEXTURE_URL = '/textures/earth/clouds.png';

// Earth sphere with procedural coloring and enhanced visuals
function Earth() {
  const meshRef = useRef();
  const cloudRef = useRef();
  const [earthMap, setEarthMap] = useState(null);
  const [normalMap, setNormalMap] = useState(null);
  const [specularMap, setSpecularMap] = useState(null);
  const [nightMap, setNightMap] = useState(null);
  const [cloudMap, setCloudMap] = useState(null);

  useFrame((_, delta) => {
    if (meshRef.current) {
      meshRef.current.rotation.y += delta * 0.03;
    }
    if (cloudRef.current) {
      cloudRef.current.rotation.y += delta * 0.038;
    }
  });

  useEffect(() => {
    const loader = new THREE.TextureLoader();

    const configureColorTexture = (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 8;
      return texture;
    };

    const configureLinearTexture = (texture) => {
      texture.anisotropy = 8;
      return texture;
    };

    loader.load(EARTH_DAY_TEXTURE_URL, (texture) => setEarthMap(configureColorTexture(texture)), undefined, () => setEarthMap(null));
    loader.load(EARTH_NORMAL_TEXTURE_URL, (texture) => setNormalMap(configureLinearTexture(texture)), undefined, () => setNormalMap(null));
    loader.load(EARTH_SPECULAR_TEXTURE_URL, (texture) => setSpecularMap(configureLinearTexture(texture)), undefined, () => setSpecularMap(null));
    loader.load(EARTH_NIGHT_TEXTURE_URL, (texture) => setNightMap(configureColorTexture(texture)), undefined, () => setNightMap(null));
    loader.load(EARTH_CLOUD_TEXTURE_URL, (texture) => setCloudMap(configureLinearTexture(texture)), undefined, () => setCloudMap(null));
  }, []);

  // Create a realistic Earth material with ocean and land
  const material = useMemo(() => {
    return new THREE.MeshPhongMaterial({
      color: new THREE.Color('#eef7ff'),
      map: earthMap || null,
      normalMap: normalMap || null,
      specularMap: specularMap || null,
      emissiveMap: nightMap || null,
      normalScale: new THREE.Vector2(0.7, 0.7),
      emissive: new THREE.Color('#0f172a'),
      emissiveIntensity: nightMap ? 0.22 : 0.08,
      specular: new THREE.Color('#b7d6ff'),
      shininess: 35,
      transparent: false,
    });
  }, [earthMap, normalMap, specularMap, nightMap]);

  const cloudMaterial = useMemo(() => {
    return new THREE.MeshPhongMaterial({
      map: cloudMap || null,
      alphaMap: cloudMap || null,
      color: new THREE.Color('#dbeafe'),
      transparent: true,
      opacity: cloudMap ? 0.2 : 0,
      depthWrite: false,
      side: THREE.FrontSide,
      blending: THREE.NormalBlending,
    });
  }, [cloudMap]);

  return (
    <group>
      <mesh ref={meshRef} material={material} raycast={() => null}>
        <sphereGeometry args={[EARTH_RADIUS, 128, 128]} />
      </mesh>
      <mesh ref={cloudRef} material={cloudMaterial} raycast={() => null}>
        <sphereGeometry args={[EARTH_RADIUS * 1.01, 96, 96]} />
      </mesh>
    </group>
  );
}

// Enhanced atmosphere glow ring - more vibrant like LeoLabs
function Atmosphere() {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: `
          varying vec3 vNormal;
          void main() {
            vNormal = normalize(normalMatrix * normal);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          varying vec3 vNormal;
          void main() {
            float intensity = pow(0.72 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.0);
            gl_FragColor = vec4(
              0.36 + 0.08 * intensity,
              0.56 + 0.10 * intensity,
              0.92 + 0.06 * intensity,
              0.20 * intensity
            );
          }
        `,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
        transparent: true,
      }),
    []
  );

  return (
    <mesh material={material} raycast={() => null}>
      <sphereGeometry args={[EARTH_RADIUS * 1.13, 64, 64]} />
    </mesh>
  );
}

// Clear geodesic overlays for equator, parallels, and meridians.
function GeoGrid() {
  const { latitudeRings, longitudeArcs, equator, primeMeridian } = useMemo(() => {
    const r = EARTH_RADIUS + 0.055;
    const segments = 240;

    const createLatitudeGeometry = (lat) => {
      const points = [];
      const phi = (90 - lat) * (Math.PI / 180);
      for (let lon = 0; lon < 360; lon += 360 / segments) {
        const theta = lon * (Math.PI / 180);
        points.push(
          new THREE.Vector3(
            -(r * Math.sin(phi) * Math.cos(theta)),
            r * Math.cos(phi),
            r * Math.sin(phi) * Math.sin(theta)
          )
        );
      }
      return new THREE.BufferGeometry().setFromPoints(points);
    };

    const createLongitudeGeometry = (lon) => {
      const points = [];
      const theta = lon * (Math.PI / 180);
      for (let lat = -90; lat <= 90; lat += 180 / segments) {
        const phi = (90 - lat) * (Math.PI / 180);
        points.push(
          new THREE.Vector3(
            -(r * Math.sin(phi) * Math.cos(theta)),
            r * Math.cos(phi),
            r * Math.sin(phi) * Math.sin(theta)
          )
        );
      }
      return new THREE.BufferGeometry().setFromPoints(points);
    };

    return {
      latitudeRings: [-60, -30, 30, 60].map((lat) => createLatitudeGeometry(lat)),
      longitudeArcs: [30, 60, 90, 120, 150, 210, 240, 270, 300, 330].map((lon) => createLongitudeGeometry(lon)),
      equator: createLatitudeGeometry(0),
      primeMeridian: createLongitudeGeometry(0),
    };
  }, []);

  useEffect(() => {
    return () => {
      latitudeRings.forEach((g) => g.dispose());
      longitudeArcs.forEach((g) => g.dispose());
      equator.dispose();
      primeMeridian.dispose();
    };
  }, [latitudeRings, longitudeArcs, equator, primeMeridian]);

  return (
    <group raycast={() => null}>
      {latitudeRings.map((geometry, idx) => (
        <lineLoop key={`lat-${idx}`} geometry={geometry} raycast={() => null}>
          <lineBasicMaterial color="#7fb4ff" transparent opacity={0.24} />
        </lineLoop>
      ))}
      {longitudeArcs.map((geometry, idx) => (
        <line key={`lon-${idx}`} geometry={geometry} raycast={() => null}>
          <lineBasicMaterial color="#7fb4ff" transparent opacity={0.2} />
        </line>
      ))}
      <lineLoop geometry={equator} raycast={() => null}>
        <lineBasicMaterial color="#60a5fa" transparent opacity={0.75} />
      </lineLoop>
      <line geometry={primeMeridian} raycast={() => null}>
        <lineBasicMaterial color="#93c5fd" transparent opacity={0.6} />
      </line>
    </group>
  );
}

export function EarthSceneComponent() {
  return (
    <>
      {/* Enhanced Lighting for Better Visuals */}
      <ambientLight intensity={0.5} color="#f5f9ff" />
      <hemisphereLight skyColor="#dbeafe" groundColor="#0f172a" intensity={0.72} />
      <directionalLight position={[12, 8, 8]} intensity={1.55} color="#fff6d6" />
      <directionalLight position={[-10, -2, -6]} intensity={0.5} color="#9ec5ff" />
      <pointLight position={[0, 0, 10]} intensity={0.35} color="#93c5fd" />

      {/* Earth */}
      <Earth />
      <Atmosphere />
      <GeoGrid />
    </>
  );
}

export default EarthSceneComponent;
