-- Two corrections to the public tour's view of `worlds` (docs/BACKEND.md §4.8 and §7).
--
-- 1. A room reaches its world by TWO routes: `worlds.room_id` (the world its own generation made)
--    and `rooms.draft_world_id` / `full_world_id` (the world it was pointed at). §4.8 — "unit types
--    share worlds across identical units until a unit gets its own photos" — makes the second route
--    real: an attached world's `room_id` belongs to another room of the same organisation. The
--    original policy only followed `room_id`, so a shared world was invisible to the anon key and
--    the buyer's page would show a room marked `ready` with nothing in it. `server/pipeline.ts`
--    (`worldsOfRooms`) reads through both routes; this gives the policy the same shape.
--
-- 2. A row policy has no column list, so `select = done and ...` handed the anon key EVERY column of
--    every finished world of every published unit: the compiled prompt, the canonical photo hashes,
--    the site lat/lon, the seed, the provider's world and operation ids, every provider asset URL
--    and the cost. `publicTour` withholds exactly those ("no photos, no provider ids, no provider
--    URLs, no recipe, no cost") and the schema gave them away behind its back. Column privileges are
--    the only thing in Postgres that restricts a SELECT to some columns, so `anon` keeps select on
--    what the buyer's page reads and loses it on everything else. `authenticated` is untouched: an
--    org member still reads the whole row through the "org members" policy.
--
-- Written as its own migration rather than an edit to 0001 so a project that has already been
-- pushed picks the fix up; 0001 carries a pointer to it beside the policy it replaces.

drop policy if exists "public tour" on public.worlds;
create policy "public tour" on public.worlds for select using (
  status = 'done'
  and (
    exists (select 1 from public.rooms r where r.id = worlds.room_id and public.unit_is_published(r.unit_id))
    or exists (
      select 1 from public.rooms r
       where (r.draft_world_id = worlds.id or r.full_world_id = worlds.id)
         and public.unit_is_published(r.unit_id)
    )
  )
);

-- The pointer half of that policy, and the readers' own "worlds this unit's rooms point at" query.
create index if not exists rooms_draft_world on public.rooms (draft_world_id) where draft_world_id is not null;
create index if not exists rooms_full_world on public.rooms (full_world_id) where full_world_id is not null;

-- Everything the buyer's page reads, and nothing else. Withheld from anon on purpose: recipe,
-- recipe_hash, seed, pipeline_version, provider_world_id, provider_operation_id, provider_assets,
-- credits, usd, error and org_id.
revoke select on public.worlds from anon;
grant select (
  id,
  room_id,
  provider,
  tier,
  model,
  status,
  assets,
  metric_scale_factor,
  ground_plane_offset,
  bounds,
  raw,
  caption,
  seconds,
  created_at,
  finished_at
) on public.worlds to anon;

-- ---------------------------------------------------------------- rule 5, per organisation
-- `worlds_recipe` was unique on the recipe hash ALONE, across every tenant. Two organisations that
-- hold the same photo of the same room shape compute the same recipe (that is the point of the
-- hash), and the second one could then neither insert its own world nor use the first one's — the
-- attach is scoped to the caller's organisation now, as it must be, because a world carries an
-- org_id, a room in that org and storage objects that org paid for. So the index is scoped too:
-- "never generate twice" (docs/BACKEND.md §2 rule 5) holds inside an organisation, which is the only
-- scope in which it can hold.
drop index if exists public.worlds_recipe;
create unique index worlds_recipe on public.worlds (org_id, recipe_hash) where status <> 'failed';
