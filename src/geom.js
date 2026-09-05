// Footprint + fit maths. Everything in metres.

export function footprint(item) {
  const turned = item.rot % 2 === 1
  const w = turned ? item.d : item.w
  const d = turned ? item.w : item.d
  return {
    w, d,
    minX: item.x - w / 2, maxX: item.x + w / 2,
    minZ: item.z - d / 2, maxZ: item.z + d / 2,
  }
}

// 'ok' | 'out' (past a wall) | 'clash' (overlaps another piece)
export function fitStatus(item, items, room) {
  const f = footprint(item)
  const eps = 1e-4
  if (f.minX < -room.w / 2 - eps || f.maxX > room.w / 2 + eps ||
      f.minZ < -room.d / 2 - eps || f.maxZ > room.d / 2 + eps) return 'out'
  if (item.h > room.h) return 'out'
  for (const o of items) {
    if (o.uid === item.uid) continue
    if (o.id === 'rug' || item.id === 'rug') continue // rugs sit under things
    const g = footprint(o)
    if (f.minX < g.maxX - eps && f.maxX > g.minX + eps &&
        f.minZ < g.maxZ - eps && f.maxZ > g.minZ + eps) return 'clash'
  }
  return 'ok'
}

export function clampToRoom(item, room) {
  const turned = item.rot % 2 === 1
  const w = turned ? item.d : item.w
  const d = turned ? item.w : item.d
  const hx = Math.max(0, room.w / 2 - w / 2)
  const hz = Math.max(0, room.d / 2 - d / 2)
  return {
    x: Math.min(hx, Math.max(-hx, item.x)),
    z: Math.min(hz, Math.max(-hz, item.z)),
  }
}

export function floorReport(items, room) {
  const area = room.w * room.d
  let used = 0
  for (const it of items) {
    if (it.id === 'rug') continue
    const f = footprint(it)
    used += f.w * f.d
  }
  return {
    area,
    used,
    pct: area > 0 ? Math.round((used / area) * 100) : 0,
  }
}
