-- Server-side measurement (docs/ACCURACY.md §3.2). Two columns on `rooms`, because the room is
-- where a measurement is *reported*: `worlds.bounds` and `worlds.raw` already existed and say what
-- one mesh measures in its own raw units, while these say what the room is in metres and how
-- certain that is.
--
-- Until now the worker copied a world's assets and stopped: `worlds.bounds` and `rooms.geometry`
-- stayed null on a backend-generated world and the wall-rectangle fit lived only in the browser
-- (docs/BACKEND.md §4 step 5). The worker now measures the collider it just stored, fuses the
-- room's plan dimensions, its anchor, the printed or assumed ceiling and Marble's own
-- `metric_scale_factor` into one scale (`shared/fusion.ts`), and writes the result here.
--
-- `measurement` holds the fusion: `{scale, sigma, sigmaRel, confidence, residuals[], flags[],
-- lines[], method, oneRoom, worldId, measuredAt, recipeHash, stale}` — see `RoomMeasurement` in
-- server/pipeline.ts. It is deliberately a document rather than columns: it is provenance the page
-- prints ("Plan says 3.75 m · model measures 3.41 m"), not something anything queries or joins on.
--
-- `measured_at` is a column of its own so "which rooms have never been measured" and "which were
-- measured before their plan was corrected" are one index scan rather than a jsonb extraction.
-- It mirrors `measurement->>'measuredAt'`; the worker writes both in the same update.

alter table public.rooms
  add column if not exists measurement jsonb,
  add column if not exists measured_at timestamptz;

comment on column public.rooms.measurement is
  'Metric fusion for this room: scale, sigma, confidence, per-source residuals and the flags naming any disagreement (docs/ACCURACY.md section 2).';
comment on column public.rooms.measured_at is
  'When the room was last measured from its world''s collider. Null means never.';

-- The seller's "which rooms still need a look" query: unmeasured first, then oldest.
create index if not exists rooms_measured_at on public.rooms (unit_id, measured_at);

-- The public tour serves the measurement with the room (`publicTour` in server/pipeline.ts), and a
-- buyer reads `rooms` through the anon key. Unlike `worlds` — where 0003 had to revoke the table
-- grant and name the safe columns, because a world row carries the recipe, the seed, the provider
-- ids and the cost — every column of `rooms` is already part of the public document, and a
-- table-level grant covers columns added later. Stated here so the next reader does not have to
-- diff 0003 against this file to find out whether something was forgotten:
--   `rooms` keeps its table-level select for anon, and the "public tour" row policy from 0001
--   (`unit_is_published(unit_id)`) is what keeps an unpublished unit's rooms private.
--
-- Realtime already carries `rooms` (0001), so a measurement landing mid-generation reaches an open
-- seller screen with no extra wiring.
