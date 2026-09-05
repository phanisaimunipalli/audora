# Audora

**Live it before buying or selling.**

Audora turns an empty room into a walkable, true to scale 3D space and stages it
with furniture that actually fits. Built for sellers and listing agents who need
a listing to show what a space can become, not just what it currently is.

Built at the Burning Token hackathon, September 2026.

## The problem

Empty rooms do not sell. Virtual staging exists, but it produces flat images
with no spatial truth behind them. A buyer cannot tell whether their sofa fits,
and a seller cannot tell whether the staging is honest.

## What it does today

1. You set the room from real measurements and declare a **scale anchor**, the
   known real world dimension that makes every other number meaningful.
2. Audora builds a metrically correct 3D room you can orbit or walk through at a
   real 1.60m eye height.
3. You stage it from a furniture catalog where every piece carries its real
   dimensions in centimetres.
4. Audora continuously reports what fits, what crosses a wall, what overlaps,
   and how much floor you have consumed.

## Why the scale anchor matters

Photogrammetry and generative reconstruction both recover geometry only up to an
unknown scale factor. Without an anchor, "will this couch fit" is unanswerable.
Most staging tools quietly skip this. Audora makes you declare the anchor and
shows it in the interface, because it is the difference between a picture and an
answer.

## Honest scope

This is a hackathon build and the boundaries are stated plainly:

* The room is constructed from measurements you enter. Photo to geometry
  reconstruction is **not** wired up yet.
* An uploaded photo is displayed as a reference backdrop only. It does not
  drive geometry.
* Catalog dimensions are reference figures for common furniture classes. They
  are **not** verified retail SKUs and no price is quoted. "Find this piece"
  opens a shopping search.
* Nothing is scraped from any listing site.

## Roadmap

* **Reconstruction via World Labs Marble.** Marble accepts a single image and
  returns a navigable 3D world in roughly 20 seconds, which removes the
  multi view capture requirement that makes classical photogrammetry fail on
  texture poor empty rooms. Audora's scale anchor still supplies the metric
  scale that generative reconstruction cannot.
* **Verified catalog.** Replace reference dimensions with per SKU dimensions
  checked against retailer sources, with live purchase links.
* **Realtime co staging.** Two people staging the same room at once.

## Stack

React 18, Vite, three.js via @react-three/fiber and @react-three/drei.
No external 3D assets. The room and every furniture piece are generated
procedurally in metres, which is what makes the scale claim verifiable.

## Run it

```
npm install
npm run dev
```

## AI used to build this

Claude Opus 5 in Claude Code wrote the application. Research on reconstruction
options was done with web search through the same session.
