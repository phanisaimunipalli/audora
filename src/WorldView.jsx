import { Suspense, useEffect, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, useTexture, useGLTF, Html } from '@react-three/drei'
import * as THREE from 'three'

function Pano({ url }) {
  const tex = useTexture(url)
  useEffect(() => {
    tex.colorSpace = THREE.SRGBColorSpace
    tex.minFilter = THREE.LinearFilter
    tex.generateMipmaps = false
  }, [tex])
  return (
    <mesh scale={[-1, 1, 1]}>
      <sphereGeometry args={[60, 96, 64]} />
      <meshBasicMaterial map={tex} side={THREE.BackSide} toneMapped={false} />
    </mesh>
  )
}

function Collider({ url, scale, offset }) {
  const { scene } = useGLTF(url)
  useEffect(() => {
    scene.traverse((o) => {
      if (!o.isMesh) return
      o.material = new THREE.MeshBasicMaterial({
        color: '#7c6cf0', wireframe: true, transparent: true, opacity: 0.3,
      })
    })
  }, [scene])
  return <primitive object={scene} scale={scale} position={[0, -offset, 0]} />
}

function Piece({ item, floorY, selected, onSelect, onGrab }) {
  const yRot = (item.rot || 0) * Math.PI / 2
  return (
    <group position={[item.x, floorY, item.z]} rotation={[0, yRot, 0]}>
      <mesh
        position={[0, item.h / 2, 0]}
        onPointerDown={(e) => { e.stopPropagation(); onSelect(item.uid); onGrab(item.uid) }}
      >
        <boxGeometry args={[item.w, item.h, item.d]} />
        <meshStandardMaterial
          color={item.color}
          roughness={0.5}
          metalness={0.05}
          emissive={selected ? '#ffffff' : '#000000'}
          emissiveIntensity={selected ? 0.25 : 0}
        />
      </mesh>
      {/* contact shadow so the piece reads as sitting on the floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0]}>
        <planeGeometry args={[item.w * 1.16, item.d * 1.16]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.3} depthWrite={false} />
      </mesh>
    </group>
  )
}

function FloorDrag({ floorY, grabbed, onMove, onRelease }) {
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, floorY, 0]}
      onPointerMove={(e) => { if (grabbed) { e.stopPropagation(); onMove(e.point.x, e.point.z) } }}
      onPointerUp={onRelease}
    >
      <planeGeometry args={[80, 80]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  )
}

function FloorGrid({ floorY, on }) {
  if (!on) return null
  return (
    <gridHelper
      args={[12, 24, '#7c6cf0', '#3a3a5c']}
      position={[0, floorY + 0.005, 0]}
      material-transparent
      material-opacity={0.25}
    />
  )
}

function Drift({ on }) {
  const { camera } = useThree()
  const t = useRef(0)
  useFrame((_, dt) => {
    if (!on) return
    t.current += dt * 0.06
    camera.lookAt(Math.sin(t.current) * 10, 0, Math.cos(t.current) * 10)
  })
  return null
}

export default function WorldView({
  world, showMesh, metric,
  items = [], floorY = -1.3, selected, onSelect, onMove, staging,
}) {
  const [touched, setTouched] = useState(false)
  const [grabbed, setGrabbed] = useState(null)
  return (
    <Canvas
      camera={{ position: [0, 0, 0.01], fov: 78 }}
      dpr={[1, 2]}
      onPointerDown={() => setTouched(true)}
      onPointerMissed={() => onSelect?.(null)}
    >
      <color attach="background" args={['#07070d']} />
      <ambientLight intensity={0.85} />
      <directionalLight position={[3, 8, 4]} intensity={1.1} />
      <directionalLight position={[-4, 4, -3]} intensity={0.35} />
      <Suspense fallback={<Html center><div className="loading">Loading world…</div></Html>}>
        <Pano url={world.pano} />
        {showMesh && world.collider && (
          <Suspense fallback={null}>
            <Collider
              url={world.collider}
              scale={metric ? (world.metricScaleFactor || 1) : 1}
              offset={metric ? (world.groundPlaneOffset || 0) : 0}
            />
          </Suspense>
        )}
      </Suspense>

      {staging && (
        <>
          <FloorGrid floorY={floorY} on />
          <FloorDrag
            floorY={floorY}
            grabbed={grabbed}
            onMove={(x, z) => grabbed && onMove?.(grabbed, x, z)}
            onRelease={() => setGrabbed(null)}
          />
          {items.map((it) => (
            <Piece
              key={it.uid} item={it} floorY={floorY}
              selected={selected === it.uid}
              onSelect={onSelect} onGrab={setGrabbed}
            />
          ))}
        </>
      )}

      <Drift on={!touched && !staging} />
      <OrbitControls
        enabled={!grabbed}
        enablePan={false}
        enableZoom={false}
        rotateSpeed={-0.32}
        target={[0, 0, 0]}
      />
    </Canvas>
  )
}
