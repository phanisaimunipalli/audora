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

function Collider({ url, scale, offset, visible }) {
  const { scene } = useGLTF(url)
  useEffect(() => {
    scene.traverse((o) => {
      if (!o.isMesh) return
      o.material = new THREE.MeshBasicMaterial({
        color: '#7c6cf0', wireframe: true, transparent: true, opacity: 0.35,
      })
    })
  }, [scene])
  if (!visible) return null
  return <primitive object={scene} scale={scale} position={[0, -offset, 0]} />
}

function Loading({ label }) {
  return <Html center><div className="loading">{label}</div></Html>
}

// Slow drift so the world reads as 3D even before the user touches it.
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

export default function WorldView({ world, showMesh, metric }) {
  const [touched, setTouched] = useState(false)
  return (
    <Canvas
      camera={{ position: [0, 0, 0.01], fov: 78 }}
      dpr={[1, 2]}
      onPointerDown={() => setTouched(true)}
    >
      <color attach="background" args={['#07070d']} />
      <ambientLight intensity={1} />
      <Suspense fallback={<Loading label="Loading world…" />}>
        <Pano url={world.pano} />
        {showMesh && (
          <Suspense fallback={null}>
            <Collider
              url={world.collider}
              scale={metric ? world.metricScaleFactor : 1}
              offset={metric ? world.groundPlaneOffset : 0}
              visible
            />
          </Suspense>
        )}
      </Suspense>
      <Drift on={!touched} />
      <OrbitControls
        enablePan={false}
        enableZoom={false}
        rotateSpeed={-0.32}
        target={[0, 0, 0]}
      />
    </Canvas>
  )
}
