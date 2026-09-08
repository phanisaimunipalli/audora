-- Audora backend: organisations, properties, units, rooms, photos, floor plans, worlds, jobs,
-- stagings, publications, visitor furniture, analytics, AI cost log. See docs/BACKEND.md.
--
-- Conventions: every org-scoped row carries org_id so row-level security is one predicate;
-- JSON columns hold the same shapes the app already uses (src/state/types.ts, src/engine/types.ts);
-- worlds are content-addressed by recipe_hash so the same inputs never generate twice.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- organisations
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table public.org_members (
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

-- ---------------------------------------------------------------- inventory
create table public.properties (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  address text not null,
  lat double precision,
  lon double precision,
  -- TourSite: footprint, heading, windowWall, previewTime, windowSun, resolvedAt
  site jsonb,
  external_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index properties_org on public.properties (org_id);

create table public.unit_types (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid references public.properties(id) on delete cascade,
  name text not null,
  beds numeric(3, 1),
  baths numeric(3, 1),
  sqft integer,
  floor_plan_id uuid,
  created_at timestamptz not null default now()
);
create index unit_types_property on public.unit_types (property_id);

create table public.units (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  unit_type_id uuid references public.unit_types(id) on delete set null,
  unit_number text,
  floor_level integer,
  beds numeric(3, 1),
  baths numeric(3, 1),
  sqft integer,
  rent_cents integer,
  currency text not null default 'USD',
  available_on date,
  listing_url text,
  listing_source text,
  summary text,
  external_ref text,
  status text not null default 'draft' check (status in ('draft', 'generating', 'ready', 'published', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index units_property on public.units (org_id, property_id);

create table public.floor_plans (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  unit_id uuid references public.units(id) on delete cascade,
  unit_type_id uuid references public.unit_types(id) on delete cascade,
  storage_path text not null,
  sha256 text not null,
  file_name text,
  -- FloorPlan as services/floorplan parses it: units, floors, rooms with dims, doors, north arrow
  parsed jsonb,
  parser_model text,
  parsed_at timestamptz,
  created_at timestamptz not null default now(),
  check (unit_id is not null or unit_type_id is not null)
);
create index floor_plans_unit on public.floor_plans (unit_id);
alter table public.unit_types
  add constraint unit_types_floor_plan_fk foreign key (floor_plan_id) references public.floor_plans(id) on delete set null;

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  name text not null,
  type text not null,
  sort_order integer not null default 0,
  plan_dims jsonb,
  anchor jsonb,
  geometry jsonb,
  raw jsonb,
  floor_offset real,
  north_wall_heading real,
  status text not null default 'pending' check (status in ('pending', 'generating', 'ready', 'failed')),
  draft_world_id uuid,
  full_world_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index rooms_unit on public.rooms (unit_id, sort_order);

create table public.photos (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  room_id uuid references public.rooms(id) on delete set null,
  storage_path text not null,
  -- The canonical copy (EXIF stripped, longest side 2048, JPEG q90) is what recipes hash and what
  -- Marble receives, so two uploads of the same shot from two phones still make one world.
  canonical_path text,
  sha256 text not null,
  canonical_sha256 text,
  width integer,
  height integer,
  bytes integer,
  role text not null default 'extra' check (role in ('primary', 'extra')),
  angle text check (angle in ('left', 'centre', 'right', 'back')),
  azimuth real,
  exif jsonb,
  analysis jsonb,
  origin text not null default 'file' check (origin in ('file', 'url', 'feed')),
  source_url text,
  created_at timestamptz not null default now()
);
create index photos_room on public.photos (room_id);
create unique index photos_unit_sha on public.photos (unit_id, sha256);

-- ---------------------------------------------------------------- reconstruction
create table public.worlds (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete cascade,
  -- sha256 of the canonical recipe; the seed is derived from it (docs/BACKEND.md, "Determinism").
  recipe_hash text not null,
  recipe jsonb not null,
  seed bigint not null check (seed between 0 and 4294967295),
  pipeline_version text not null,
  provider text not null default 'marble' check (provider in ('marble', 'mock')),
  model text not null,
  tier text not null check (tier in ('draft', 'full')),
  provider_world_id text,
  provider_operation_id text,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  -- Our own copies in the worlds bucket: { spz: {"100k","500k","full_res"}, collider, pano, thumbnail }
  assets jsonb,
  -- What the provider returned (URLs expire; kept for provenance only)
  provider_assets jsonb,
  metric_scale_factor double precision,
  ground_plane_offset double precision,
  bounds jsonb,
  raw jsonb,
  caption text,
  credits integer,
  usd numeric(10, 4),
  seconds integer,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create unique index worlds_recipe on public.worlds (recipe_hash) where status <> 'failed';
create index worlds_room on public.worlds (room_id, created_at desc);
alter table public.rooms
  add constraint rooms_draft_world_fk foreign key (draft_world_id) references public.worlds(id) on delete set null,
  add constraint rooms_full_world_fk foreign key (full_world_id) references public.worlds(id) on delete set null;

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  room_id uuid references public.rooms(id) on delete cascade,
  world_id uuid references public.worlds(id) on delete set null,
  kind text not null check (kind in ('analyze', 'parse_plan', 'generate', 'copy_assets', 'stage', 'publish')),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  progress integer not null default 0 check (progress between 0 and 100),
  step text,
  detail text,
  error text,
  attempts integer not null default 0,
  run_after timestamptz not null default now(),
  locked_by text,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);
create index jobs_queue on public.jobs (status, run_after);
create index jobs_unit on public.jobs (unit_id, created_at desc);

create table public.stagings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete cascade,
  style text,
  preset text,
  -- PlacedPiece[]
  pieces jsonb not null,
  source text,
  -- sha256 of (geometry, style, model, prompt version): the same room staged the same way is one row
  input_hash text,
  created_at timestamptz not null default now()
);
create index stagings_room on public.stagings (room_id, created_at desc);

-- ---------------------------------------------------------------- publishing and renters
create table public.publications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  unit_id uuid not null unique references public.units(id) on delete cascade,
  share_id text not null unique,
  published boolean not null default false,
  published_at timestamptz,
  -- Newest world finished_at at publish time: the freshness badge on the public page
  model_date timestamptz,
  disclosures jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.visitor_stuff (
  id uuid primary key default gen_random_uuid(),
  visitor_id text not null,
  -- MyStuffItem
  item jsonb not null,
  created_at timestamptz not null default now()
);
create index visitor_stuff_visitor on public.visitor_stuff (visitor_id);

create table public.analytics_events (
  id bigserial primary key,
  unit_id uuid not null references public.units(id) on delete cascade,
  room_id uuid references public.rooms(id) on delete set null,
  type text not null check (type in ('visit', 'walk', 'test', 'fit', 'nofit', 'share', 'toggle', 'measure')),
  item text,
  visitor_id text,
  at timestamptz not null default now()
);
create index analytics_unit on public.analytics_events (unit_id, at desc);

create table public.ai_calls (
  id bigserial primary key,
  org_id uuid references public.organizations(id) on delete set null,
  unit_id uuid references public.units(id) on delete set null,
  task text not null,
  provider text,
  model text,
  prompt_tokens integer,
  completion_tokens integer,
  usd numeric(10, 6),
  ms integer,
  input_hash text,
  cached boolean not null default false,
  created_at timestamptz not null default now()
);
create index ai_calls_input on public.ai_calls (task, input_hash);

-- ---------------------------------------------------------------- updated_at
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end
$$;
create trigger properties_updated before update on public.properties for each row execute function public.set_updated_at();
create trigger units_updated before update on public.units for each row execute function public.set_updated_at();
create trigger rooms_updated before update on public.rooms for each row execute function public.set_updated_at();
create trigger jobs_updated before update on public.jobs for each row execute function public.set_updated_at();
create trigger publications_updated before update on public.publications for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- row-level security
create or replace function public.is_org_member(org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.org_members m where m.org_id = org and m.user_id = auth.uid());
$$;

create or replace function public.unit_is_published(unit uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.publications p where p.unit_id = unit and p.published);
$$;

alter table public.organizations enable row level security;
alter table public.org_members enable row level security;
alter table public.properties enable row level security;
alter table public.unit_types enable row level security;
alter table public.units enable row level security;
alter table public.floor_plans enable row level security;
alter table public.rooms enable row level security;
alter table public.photos enable row level security;
alter table public.worlds enable row level security;
alter table public.jobs enable row level security;
alter table public.stagings enable row level security;
alter table public.publications enable row level security;
alter table public.visitor_stuff enable row level security;
alter table public.analytics_events enable row level security;
alter table public.ai_calls enable row level security;

create policy "members read their org" on public.organizations for select using (public.is_org_member(id));
create policy "signed-in users create orgs" on public.organizations for insert with check (auth.uid() is not null);
create policy "members see membership" on public.org_members for select using (public.is_org_member(org_id));

create policy "org members" on public.properties for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
create policy "org members" on public.unit_types for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
create policy "org members" on public.units for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
create policy "org members" on public.floor_plans for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
create policy "org members" on public.rooms for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
create policy "org members" on public.photos for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
create policy "org members" on public.worlds for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
create policy "org members" on public.jobs for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
create policy "org members" on public.stagings for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
create policy "org members" on public.publications for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
create policy "org members read costs" on public.ai_calls for select using (public.is_org_member(org_id));

-- The public tour: anyone can read a published unit, its property (for the sun), its rooms, the
-- worlds and stagings behind them, and the publication row. Photos and floor plans stay private.
create policy "public tour" on public.publications for select using (published);
create policy "public tour" on public.units for select using (public.unit_is_published(id));
create policy "public tour" on public.properties for select using (exists (select 1 from public.units u where u.property_id = properties.id and public.unit_is_published(u.id)));
create policy "public tour" on public.rooms for select using (public.unit_is_published(unit_id));
create policy "public tour" on public.worlds for select using (status = 'done' and exists (select 1 from public.rooms r where r.id = worlds.room_id and public.unit_is_published(r.unit_id)));
create policy "public tour" on public.stagings for select using (exists (select 1 from public.rooms r where r.id = stagings.room_id and public.unit_is_published(r.unit_id)));
create policy "public tour events" on public.analytics_events for insert with check (public.unit_is_published(unit_id));
create policy "org members read events" on public.analytics_events for select using (exists (select 1 from public.units u where u.id = analytics_events.unit_id and public.is_org_member(u.org_id)));
-- visitor_stuff is only reached through the server (service role), which checks the visitor id itself.

-- ---------------------------------------------------------------- storage
insert into storage.buckets (id, name, public)
values ('photos', 'photos', false), ('plans', 'plans', false), ('worlds', 'worlds', true), ('stills', 'stills', true)
on conflict (id) do nothing;

-- Objects are keyed <org_id>/<unit_id>/... so the first folder is the org.
create policy "org members manage private files" on storage.objects for all
  using (bucket_id in ('photos', 'plans') and public.is_org_member(((storage.foldername(name))[1])::uuid))
  with check (bucket_id in ('photos', 'plans') and public.is_org_member(((storage.foldername(name))[1])::uuid));
create policy "anyone reads published worlds" on storage.objects for select using (bucket_id in ('worlds', 'stills'));

-- ---------------------------------------------------------------- realtime (job progress in the app)
alter publication supabase_realtime add table public.jobs, public.rooms;
