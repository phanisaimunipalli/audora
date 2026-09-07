# Audora

**Live it before buying or selling.**

Upload a photo of a room. Get back a 3D world you can walk through and stage
with furniture at true dimensions.

[audora-workflow.onrender.com](https://audora-workflow.onrender.com)

Third place, SF round, Burning Token hackathon, September 2026.

## How it works

One photo goes to World Labs Marble, which returns a navigable 3D world:
an equirectangular panorama, a collider mesh, and Gaussian splats at four
levels of detail. Audora renders it in three.js and puts furniture in it at
real centimetre dimensions.

A draft costs 150 credits and lands in about 30 seconds. Full quality costs
1,500 and takes around 11 minutes, and it only runs if you ask for it after
seeing the draft.

## About scale

Marble reports a metric scale factor and a ground plane offset. Audora shows
both, and says so plainly when they are missing, which is always the case for
drafts. Every furniture piece carries its real dimensions, so a sofa that looks
like it fits is measured against numbers you can see rather than an impression.

Catalog dimensions are reference figures for common furniture classes. They are
not verified retail SKUs.

## Stack

React 18, Vite, three.js through @react-three/fiber and @react-three/drei.
The API key stays server side: `vite.config.js` proxies Marble in development
and `server/index.js` does the same in production. Deployed on Render, with a
mounted disk holding the view counter.

No 3D assets are shipped. Furniture is generated in metres, which is what makes
the scale claim checkable.

## AI used to build this

Claude Opus 5 in Claude Code.
