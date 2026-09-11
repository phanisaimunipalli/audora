import { useEffect, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, PointerLockControls } from '@react-three/drei'
import * as THREE from 'three'
import { fitStatus } from './geom.js'

function usePhotoTexture(dataUrl) {
  const [tex, setTex] = useState(null)
  useEffect(() => {
    if (!dataUrl) { setTex(null); return }
    new THREE.TextureLoader().load(dataUrl, (t) => {
      t.colorSpace = THREE.SRGBColorSpace
      setTex(t)
    })
  }, [dataUrl])
  return tex
}

function Room({ room, photo }) {
  const tex = usePhotoTexture(photo)
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[room.w, room.d]} />
        <meshStandardMaterial color="#3a3a46" roughness={0.95} />
      </mesh>
      {/* Inverted box: near walls cull away so you can see in from outside. */}
      <mesh position={[0, room.h / 2, 0]}>
        <boxGeometry args={[room.w, room.h, room.d]} />
        <meshStandardMaterial color="#efece6" side={THREE.BackSide} roughness={1} />
      </mesh>
      {tex && (
        <mesh position={[0, room.h / 2, -room.d / 2 + 0.012]}>
          <planeGeometry args={[room.w * 0.985, room.h * 0.985]} />
          <meshBasicMaterial map={tex} toneMapped={false} />
        </mesh>
      )}
    </group>
  )
}

function Item({ item, selected, status, onSelect, onDragStart }) {
  const yRot = item.rot % 2 === 1 ? Math.PI / 2 : 0
  const bad = status !== 'ok'
  return (
    <mesh
      position={[item.x, item.h / 2, item.z]}
      rotation={[0, yRot, 0]}
      castShadow
      onPointerDown={(e) => { e.stopPropagation(); onSelect(item.uid); onDragStart(item.uid) }}
    >
      <boxGeometry args={[item.w, item.h, item.d]} />
      <meshStandardMaterial
        color={bad ? '#e0533f' : item.color}
        roughness={0.55}
        emissive={selected ? '#ffffff' : '#000000'}
        emissiveIntensity={selected ? 0.22 : 0}
      />
    </mesh>
  )
}

function DragPlane({ room, dragging, onMove, onDrop }) {
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, 0.002, 0]}
      onPointerMove={(e) => { if (!dragging) return; e.stopPropagation(); onMove(e.point.x, e.point.z) }}
      onPointerUp={onDrop}
    >
      <planeGeometry args={[room.w * 4, room.d * 4]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  )
}

// First person at real eye height. Reinforces that the scene is metric.
function Walk({ room }) {
  const { camera } = useThree()
  const keys = useRef({})
  useEffect(() => {
    const d = (e) => { keys.current[e.code] = true }
    const u = (e) => { keys.current[e.code] = false }
    window.addEventListener('keydown', d)
    window.addEventListener('keyup', u)
    return () => { window.removeEventListener('keydown', d); window.removeEventListener('keyup', u) }
  }, [])
  useFrame((_, dt) => {
    const step = 2.4 * Math.min(dt, 0.05)
    const fwd = new THREE.Vector3()
    camera.getWorldDirection(fwd)
    fwd.y = 0
    if (fwd.lengthSq() < 1e-6) return
    fwd.normalize()
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize()
    const dir = new THREE.Vector3()
    if (keys.current['KeyW'] || keys.current['ArrowUp']) dir.add(fwd)
    if (keys.current['KeyS'] || keys.current['ArrowDown']) dir.sub(fwd)
    if (keys.current['KeyD'] || keys.current['ArrowRight']) dir.add(right)
    if (keys.current['KeyA'] || keys.current['ArrowLeft']) dir.sub(right)
    if (dir.lengthSq() > 0) camera.position.add(dir.normalize().multiplyScalar(step))
    camera.position.y = 1.6
    const m = 0.3
    camera.position.x = THREE.MathUtils.clamp(camera.position.x, -room.w / 2 + m, room.w / 2 - m)
    camera.position.z = THREE.MathUtils.clamp(camera.position.z, -room.d / 2 + m, room.d / 2 - m)
  })
  return <PointerLockControls />
}

export default function Scene({ room, photo, items, selected, setSelected, moveItem, mode }) {
  const [dragging, setDragging] = useState(null)
  const orbit = { position: [room.w * 0.95, room.h * 1.5, room.d * 1.3], fov: 55 }
  const walkCam = { position: [0, 1.6, room.d / 2 - 0.6], fov: 72 }
  return (
    <Canvas
      key={mode}
      shadows
      dpr={[1, 2]}
      camera={mode === 'walk' ? walkCam : orbit}
      onPointerMissed={() => setSelected(null)}
    >
      <color attach="background" args={['#0a0a12']} />
      <hemisphereLight intensity={0.55} groundColor="#20202a" />
      <directionalLight position={[3, 6, 4]} intensity={1.5} castShadow />
      <directionalLight position={[-4, 3, -2]} intensity={0.4} />
      <Room room={room} photo={photo} />
      <DragPlane
        room={room}
        dragging={dragging}
        onMove={(x, z) => dragging && moveItem(dragging, x, z)}
        onDrop={() => setDragging(null)}
      />
      {items.map((it) => (
        <Item
          key={it.uid}
          item={it}
          selected={selected === it.uid}
          status={fitStatus(it, items, room)}
          onSelect={setSelected}
          onDragStart={(uid) => mode === 'orbit' && setDragging(uid)}
        />
      ))}
      {mode === 'walk'
        ? <Walk room={room} />
        : <OrbitControls enabled={!dragging} target={[0, room.h * 0.35, 0]} maxPolarAngle={Math.PI / 2.05} />}
    </Canvas>
  )
}
