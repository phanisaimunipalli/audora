# Audora product brief: an AI-generated Matterport for rentals

Direction set on 2026-09-08. This is the target the codebase moves toward; `ARCHITECTURE.md`
describes what exists today and `docs/CORE-MODEL.md` the model strategy.

## Thesis

Every rental unit should have a fresh, walkable, measured 3D model, generated from the photos the
leasing team already takes, at a cost that makes sense per unit per turnover. Matterport needs a
capture visit, a device and a scan that goes stale the day the unit turns over. Audora needs the
make-ready photos.

- **Market:** rentals first (units turn over every 12 to 24 months, so freshness is a recurring need
  and a recurring bill).
- **Demand side:** renters, who need to know whether the unit fits their life and their furniture
  before they spend an afternoon on a showing.
- **Paying customers:** leasing teams and property managers, who pay per unit for fewer wasted
  showings, faster lease-up and listings that stand out on the marketplaces.
- **Distribution:** the Zillow-like marketplaces (Zillow Rentals, Apartments.com, Zumper,
  Redfin/Realtor rentals), reached through the "virtual tour URL" that property-management feeds
  already syndicate.
- **Sequence:** the bare unit model first, furniture second.

## Why rentals, and why this wedge

1. **Turnover makes freshness a product, not a feature.** A scan of a unit is worth less every month;
   a model regenerated from this turnover's photos is worth the most exactly when the listing goes
   live. Every re-list is a reason to bill again.
2. **Empty units are the ideal input.** Units are photographed empty at make-ready, and an empty
   room is what the reconstruction model handles best. The furniture that helps a buyer imagine the
   home is the same furniture that hides a renter's real question: will my bed fit.
3. **The long tail has nothing.** Most rental listings have photos and a floor plan, no 3D. Those
   units are the first target: no incumbent to displace, only a URL to add to the feed.
4. **Matterport-ified units come later, on freshness.** A scan from a previous tenant's tenure loses
   to a model generated last week from the current finishes, with the renter's own furniture in it.

## What renters get

- Walk the unit at eye height, in the real capture, with measurements that show their uncertainty.
- Ask "sectional, 220 by 95" and get "fits" or "does not fit here" against the door swing and walls.
- Keep their furniture across units (the existing My Stuff), and compare units against it.
- A model date on every unit, so a stale listing is visible as stale.
- A permanent "AI-generated from photos" label, and the anchor and its ± on screen, always.

## What leasing teams get

- Their whole vacant inventory modelled in a week from the photos they already have.
- One hosted URL per unit for the marketplace feed, an embed for their own site, a QR for signage.
- Regeneration at turnover from the make-ready photos; staging as a second step for units that
  need it.
- Leasing metrics instead of vanity metrics: walks, fit tests, saved furniture, lead quality, days on
  market with and without a model.

## What changes in the product we have

| Today (hackathon build) | Rental product |
|---|---|
| Vocabulary: seller, buyer, tour, listing, price | Leasing team, renter, unit model, unit, rent |
| One tour = one listing with rooms | Organisation → property → unit type (floor plan) → unit → model versions → rooms |
| Rooms photographed one at a time in a wizard | Bulk ingestion: PMS or ILS feed, CSV, or a folder of photos per unit; the wizard stays for single units |
| Generation runs in the browser session | Server-side job queue; the deep-research feel stays (start, leave, get notified) |
| Publish = share link | Hosted URL per unit, embed, feed field, freshness badge, disclosures |
| Insights per tour | Leasing KPIs per property and per unit, exportable |
| Staging is the centrepiece | Bare unit first; staging is an upsell per unit |

Unit types are the cost lever nobody else has: a 200-unit building has perhaps eight floor plans.
Generate the type once from the best unit, then override per unit only where finishes or
orientation differ, and regenerate the specific unit when it turns over.

## Architecture gaps between here and launch

What exists: the metric engine, the Marble pipeline (draft and full tiers), progressive splats,
the anchor and fit system, staging, jobs that survive reloads, insights, and since PR #3 a
production server that keeps keys server-side.

What a paying customer needs that the hackathon build does not have:

1. **Persistence and identity.** State lives in the browser (`localStorage` with cross-tab merge).
   Launch needs a database (Postgres), organisations and users, and unit records that many people
   edit.
2. **Server-side jobs and asset ownership.** Generation must run and be polled from the server, and
   every Marble artefact (splats, collider, panorama) must be copied into our own object storage
   behind a CDN, so unit models outlive provider URLs and load fast on the marketplaces.
3. **Ingestion.** Unit and photo import from the property-management systems (AppFolio, Buildium,
   Yardi, RealPage, Entrata) and their ILS feeds, and write-back of the tour URL.
4. **Billing.** Per active unit per month, metered on generations; Stripe.
5. **Freshness machinery.** Model versions, a model date on every public page, regeneration
   triggered by a new photo set or by a re-list.

Cost of goods today: a draft room is about $0.18 and a full-quality room about $1.26 in Marble
credits; AI calls are under a cent per unit. A two-bedroom unit is roughly five rooms, so about $1
per unit at draft quality and about $6 at full quality, before unit-type reuse cuts it further.

## Go-to-market

- **Pilot (first 4 to 8 weeks):** two or three mid-size property managers in the Bay Area with 50 to
  500 units. Model all vacant units in a week, put the URLs in their feeds, and measure days on
  market, showings per lease and lead quality against their untouched units.
- **Direct first, marketplaces second.** Sell directly to leasing directors while the pilots produce
  numbers; then list in the PMS marketplaces, which is where mid-size managers buy add-ons.
- **Pricing sketch:** per active unit per month, with a free tier for small landlords, and staging
  as a per-unit add-on. Anchor the price against the cost of one wasted showing, not against
  Matterport.

## Risks and things to verify

- **Marketplace policy on tour URLs.** Confirm which marketplaces accept any hosted URL in the
  virtual-tour field and which require an approved provider. This decides whether distribution is a
  feed field or a partnership.
- **Fidelity and liability.** A generated model is a reconstruction, not a survey. Measurements carry
  their uncertainty on screen, the label is permanent, and the terms say to verify before buying
  furniture. Never let the model be used as a substitute for disclosed square footage.
- **Fair-housing and advertising rules.** Staging must never imply who lives there; keep staging
  neutral and always labelled as digital.
- **Provider terms.** Confirm commercial use and asset retention terms for World Labs Marble and
  Nebius Token Factory before the first paying customer.
- **Model risk.** Draft tier is fast and cheap but returns no metric scale; the anchor system covers
  it, but the accuracy work in `docs/CORE-MODEL.md` (floor plans, multiple photos, fine-tuned
  readers) is what makes the model trustworthy at scale.

## Sequenced roadmap

1. **Hackathon demo (by 2026-09-12).** Tell the rental story with the build we have: a leasing team
   uploads make-ready photos, the unit is walkable in a minute, a renter tests their sofa. Change
   copy and vocabulary, not architecture.
2. **Weeks 1 to 4.** Database, organisations, server-side jobs, asset storage, hosted unit URLs with
   a model date, CSV bulk import. Sign the pilot customers.
3. **Weeks 5 to 12.** PMS and ILS integrations, unit types with per-unit overrides, regeneration at
   turnover, leasing KPIs, billing. Staging as an add-on.
4. **After.** Atlas or the next reconstruction model behind the same interface, Matterport-ified
   units on freshness, marketplace partnerships.
