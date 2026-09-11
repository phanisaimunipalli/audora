// The world we generated at 20:59 UTC on 2026-09-05, marble-1.1, 1580 credits.
// Assets are served from the Marble CDN with open CORS, no auth needed.
const BASE = 'https://cdn.marble.worldlabs.ai/1580f9a1-2b19-4746-ad56-7ce3d4e5be60'

export const DEMO_WORLD = {
  worldId: '1580f9a1-2b19-4746-ad56-7ce3d4e5be60',
  marbleUrl: 'https://marble.worldlabs.ai/world/1580f9a1-2b19-4746-ad56-7ce3d4e5be60',
  model: 'marble-1.1',
  pano: `${BASE}/8c7108a9-fe54-4ad3-a61a-6d8c06fbd04c_panos/rgb_0.png`,
  collider: `${BASE}/21e5e17d.glb`,
  spz: {
    '100k': `${BASE}/9701d43b-70c2-4901-b03f-537a45f4df50_dust_100k.spz`,
    '150k': `${BASE}/527cc6e9-0464-4f1b-9d0f-a0aadd55f719_ceramic_150k.spz`,
    '500k': `${BASE}/e8599403-f224-4dd6-8c35-f7037fb3ddc6_ceramic_500k.spz`,
  },
  thumbnail: `${BASE}/b3cddc85-251a-4f57-a56a-96ca33b41cc1_sand_mpi/thumbnail.webp`,
  // Marble's own metric estimate. Audora's job is to verify this against a
  // known reference, not to trust it blindly.
  metricScaleFactor: 2.2239592,
  groundPlaneOffset: 1.3064681,
}
