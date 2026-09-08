# Copy brief: what every page says now

Set on 2026-09-08 from `docs/PRODUCT.md` and `docs/ACCURACY.md`. Every page, label and sentence
follows this; the design language stays `docs/DESIGN.md`.

## Positioning (one breath)

Audora turns the photos a leasing team already has, plus the floor plan, into an accurate,
walkable 3D model of the unit. Renters walk it before they visit. Leasing teams and property
managers put the link on the listing. It is regenerated from fresh photos at every turnover, it
is measured against the floor plan, every number carries its uncertainty, and it is always
labelled as AI-generated from photos.

## Who is speaking to whom

- **Customer:** leasing teams and property managers (they upload, confirm, publish, pay).
- **User:** renters (they walk, measure, decide whether to visit).
- **Distribution:** the tour link on Zillow, Apartments.com and the other marketplaces, through
  the feed the property already syndicates.

## Vocabulary

| Say | Not |
|---|---|
| leasing team, property manager | seller, agent, listing agent |
| renter | buyer |
| unit (apartment, house) | listing (except "the listing page" on a marketplace) |
| 3D model of the unit, walkable model | tour (URLs keep `/tours`, `/t/`) |
| rent per month, available date | price, asking |
| floor plan with dimensions, layout | plan only when the context is clear |
| photos of the unit (the ones you already take) | one photo |
| plan says / model measures | estimated |
| AI-generated from photos | digitally staged (that label returns with staging) |
| model date, fresh at turnover | |

## What is in and what is deferred

- **In:** accurate model from real photos and the floor plan with dimensions, measurements with
  their uncertainty, the unit walked room to room, the model date, the link for the listing,
  what a renter learns before visiting.
- **Deferred (do not headline, do not demo):** digital staging, auto-staging, the furniture fit
  test, pricing. No dollar figures anywhere on the landing page.

## Landing page, section by section

1. **Hero.** Eyebrow "FOR RENTAL UNITS, FROM THE PHOTOS YOU ALREADY HAVE". Headline "Your photos
   and floor plan. A unit you can walk." Sub: "Audora turns a unit's real photos and its floor plan
   into an accurate 3D model a renter can walk, measure and trust before they visit." Dropzone:
   "Add photos of the unit" with "Two to four angles of each room work best", and a second line
   "Add the floor plan, with dimensions if it has them". Keep "Draft first, always. Full quality
   only when you say so." and the Draft / Full quality stats. The live room under the hero shows
   the bare room with its measurements and anchor chip, no furniture.
2. **How it works.** Three steps: upload the unit's photos and floor plan; confirm the scale
   anchor and the plan's dimensions; walk it, measure it, put the link on the listing.
3. **Measured, honestly** (was the anchor moment). The anchor and its ±, "plan says / model
   measures", the model date.
4. **Layout with dimensions** (was the room plan). The floor plan is the source of truth for
   dimensions and orientation; the model is checked against it.
5. **Fresh at every turnover.** Why a scan goes stale and a model made from this turnover's photos
   does not.
6. **For leasing teams.** Fewer wasted showings, the link in the feed, every vacant unit modelled
   in a week, regenerate when the unit turns.
7. **What it is not.** A reconstruction, not a survey; draft has no metric scale until anchored;
   verify before relying on a measurement; always labelled.
8. **Call to action.** "Model your vacant units this week" and "Walk the demo".

Removed for now: the pricing section ("Priced like software, not like a stylist"), the furniture
playground, any cost-to-make figure, any comparison row that quotes dollars.

## App pages

- Tours list: "Your units". Cards show rent per month, available date, model date, rooms, and
  whether the link is published.
- Hub: unit header (address, unit number, rent, beds, baths, sqft, marketplace link), rooms with
  plan dims and measured dims, the site and sun card, the accuracy card, publish.
- Wizard: photos of the unit (angles), floor plan with dimensions, anchor, site, launch with the
  tier choice. No staging step.
- Viewer: walk, photo, dollhouse, measure, layers; measured panel with plan says / model measures;
  "AI-generated from photos" label; model date. Furniture test hidden while deferred.
- Insights: renter activity (walks, measurements, time in each room), not buyer activity.
- Demo unit: a rental (rent per month, available date), not a sale listing.
