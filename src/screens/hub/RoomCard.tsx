/**
 * A room in the hub's Stage tab: a metric floor plan of the staging, the quick actions
 * (open the editor, auto-stage) and room management (rename, type, regenerate, delete).
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { RoomType } from '@/engine/types';
import { STYLE_LABELS } from '@/engine/autostage';
import { fitReport } from '@/engine/fit';
import { compassLabel, dominantWindowWall, effectiveHeading, facingToHeading, headingToFacing } from '@/engine/siteSun';
import { bestWorld, toast, useAudora } from '@/state/store';
import { activeProvider, regenerateRoom } from '@/state/jobs';
import { needsFull } from '@/state/publish';
import type { Job, Room, Tier, Tour } from '@/state/types';
import { TIER_INFO } from '@/services/mockWorld';
import { aiAutoStage } from '@/services/ai';
import { clock, usd as fmtUsd } from '@/lib/format';
import { AnchorChip } from '@/components/AnchorChip';
import { FloorOffset } from '@/components/FloorOffset';
import { Button, Callout, Chip, Field, Input, Select, StagedLabel, cx } from '@/components/ui';
import { Icon } from '@/components/icons';
import { ROOM_TYPES, ROOM_TYPE_LABELS } from '@/screens/create/types';
import { FloorPlanSvg } from './FloorPlanSvg';
import { isActiveJob, modelName, providerName } from './jobMeta';
import { ShadowedFullNote, TierChip } from './TierChip';

export function RoomCard({ tour, room, job, onView }: { tour: Tour; room: Room; job?: Job; onView: (roomId: string) => void }) {
  const updateRoom = useAudora((s) => s.updateRoom);
  const removeRoom = useAudora((s) => s.removeRoom);
  const setStaging = useAudora((s) => s.setStaging);
  const setRoomHeading = useAudora((s) => s.setRoomHeading);
  const providers = useAudora((s) => s.providers);
  const preferMock = useAudora((s) => s.settings.preferMock);
  const [staging, setStagingBusy] = useState(false);
  const [manage, setManage] = useState(false);
  const [armed, setArmed] = useState(false);
  const [name, setName] = useState(room.name);

  const g = room.geometry;
  const report = fitReport(room.staging, g);
  /* A flat's rooms do not all look the same way. The building's heading is the default; this room
     can say otherwise, and then the sun in *this* room follows it. */
  const site = tour.site;
  const heading = effectiveHeading(site?.heading, room.northWallHeading);
  const overridden = room.northWallHeading != null;
  /* The seller thinks in windows, the engine in the room's north wall; this room says which wall its
     windows are on, so the two can be the same control. */
  const windowWall = dominantWindowWall(g.windows.map((w) => w.wall));
  const facing = headingToFacing(heading, windowWall);
  const world = bestWorld(room);
  /** A real reconstruction: it has assets to place, so its floor can be nudged. */
  const real = world?.provider === 'marble' && (!!world.panoUrl || !!world.spzUrl || !!world.colliderUrl);
  const busy = !!job && isActiveJob(job);
  const provider = providers.marble && !preferMock ? 'marble' : activeProvider();
  const canUpgrade = needsFull(room, provider);
  const canLive = provider === 'marble' && !!room.photo;
  const costLabel = (tier: Tier) => (canLive ? `~${TIER_INFO[tier].credits} credits · ${fmtUsd(TIER_INFO[tier].usd)} · ${modelName('marble', tier, providers)}` : `simulated · free · ${modelName('mock', tier)}`);
  const regenBody = (tier: Tier) => (canLive ? `${providerName('marble')} · ${costLabel(tier)}` : `${providerName('mock')} · free · ${modelName('mock', tier)}`);

  const autoStage = async () => {
    setStagingBusy(true);
    try {
      const r = await aiAutoStage(room, room.stagingStyle);
      setStaging(room.id, r.pieces, room.stagingStyle);
      toast({
        kind: 'success',
        title: `${room.name} staged`,
        body: `${r.pieces.length} pieces · ${r.meta.source}${r.meta.model ? ` · ${r.meta.model}` : ''}${r.dropped.length ? ` · ${r.dropped.length} dropped by the fit engine` : ''}`,
      });
    } catch (e: any) {
      toast({ kind: 'error', title: 'Auto-stage failed', body: e?.message });
    } finally {
      setStagingBusy(false);
    }
  };
  const regen = (tier: Tier) => {
    const j = regenerateRoom(room.id, tier);
    if (j) toast({ kind: 'info', title: `${room.name}: ${tier === 'full' ? 'upgrading to full' : 'regenerating draft'}`, body: regenBody(tier), action: { label: 'Watch', to: `/tours/${tour.id}` } });
  };
  const commitName = () => {
    const n = name.trim();
    if (n && n !== room.name) updateRoom(room.id, { name: n });
    else setName(room.name);
  };
  const del = () => {
    if (!armed) {
      setArmed(true);
      window.setTimeout(() => setArmed(false), 4000);
      return;
    }
    removeRoom(room.id);
    toast({ kind: 'info', title: `${room.name} removed` });
  };

  return (
    <div className="panel flex flex-col gap-4 p-4">
      <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
        <div className="flex items-center justify-center rounded-xl border border-line bg-bg-2 p-2">
          <FloorPlanSvg geometry={g} pieces={room.staging} className="max-h-44" />
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-base text-ink">{room.name}</span>
            {room.name.trim().toLowerCase() !== ROOM_TYPE_LABELS[room.type].toLowerCase() ? <Chip className="!text-[11px]">{ROOM_TYPE_LABELS[room.type]}</Chip> : null}
            <Chip mono tone={room.status === 'ready' ? 'ok' : room.status === 'failed' ? 'danger' : room.status === 'generating' ? 'accent' : 'warn'} className="!text-[10px] uppercase">
              {room.status}
            </Chip>
            {/* The tier the buyer is actually getting: "full · marble-1.1 · 1,580 credits". */}
            <TierChip room={room} generating={busy} />
            {/* Provenance lives here, never in the room name: the name is buyer-facing copy. */}
            {room.note ? (
              <Chip mono tone="accent" className="!text-[10px]">
                {room.note}
              </Chip>
            ) : null}
          </div>
          <div className="mono text-sm text-ink-2">
            {g.width.toFixed(2)} × {g.depth.toFixed(2)} × {g.height.toFixed(2)} m · {(g.width * g.depth).toFixed(1)} m²
          </div>
          <AnchorChip anchor={room.anchor} size="sm" className="self-start" />
          <div className="mono text-xs text-ink-3">
            {room.staging.length ? `${room.staging.length} pieces · ${STYLE_LABELS[room.stagingStyle]} · ${report.floorUsedPct}% floor` : 'not staged yet'}
            {report.narrowestWalkway != null ? ` · narrowest walkway ${report.narrowestWalkway.toFixed(2)} m` : ''}
            {report.misfits.length ? ` · ${report.misfits.length} misfit` : ''}
          </div>
          {site ? (
            <div className="flex flex-col gap-1 rounded-xl border border-line bg-bg-2 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] uppercase tracking-[0.14em] text-ink-3">{g.windows.length ? `${windowWall} windows face` : 'Far wall faces'}</span>
                <span className="mono text-xs text-ink">
                  {Math.round(facing)}° · {compassLabel(facing)}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={355}
                step={5}
                value={Math.round(facing)}
                onChange={(e) => setRoomHeading(room.id, facingToHeading(Number(e.target.value), windowWall))}
                className="h-4 w-full cursor-pointer accent-accent"
                aria-label={`Direction the windows of ${room.name} face`}
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-ink-3">
                  {overridden ? 'this room only' : `from the building · ${Math.round(headingToFacing(site.heading, windowWall))}°`}
                </span>
                {overridden ? (
                  <button type="button" className="text-[10px] text-accent-2 hover:text-accent" onClick={() => setRoomHeading(room.id, undefined)}>
                    Use the building
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
          <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
            <Link to={`/tours/${tour.id}/stage/${room.id}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-[13px] font-medium text-[#1a0f0a] hover:bg-accent-2">
              <Icon.Sofa size={14} /> Open editor
            </Link>
            <Button size="sm" variant="secondary" loading={staging} onClick={autoStage}>
              <Icon.Sparkles size={14} /> Auto-stage
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onView(room.id)}>
              <Icon.Eye size={14} /> View
            </Button>
            <StagedLabel className="ml-auto" />
          </div>
        </div>
      </div>

      {job?.status === 'failed' ? (
        <Callout tone="danger" title="Last generation failed">
          <div className="flex flex-wrap items-center gap-2">
            <span>{job.error || 'The reconstruction did not come back.'}</span>
            <Button size="sm" variant="secondary" onClick={() => regen(job.tier)}>
              <Icon.Rotate size={14} /> Retry {job.tier}
            </Button>
          </div>
        </Callout>
      ) : null}
      {room.status === 'pending' && !busy ? (
        <Callout tone="warn" title="Not generated yet">
          <Button size="sm" variant="secondary" onClick={() => regen('draft')}>
            <Icon.Play size={14} /> Generate draft · {costLabel('draft')}
          </Button>
        </Callout>
      ) : null}

      <button type="button" onClick={() => setManage((v) => !v)} className="flex items-center gap-2 text-xs text-ink-3 hover:text-ink">
        <Icon.ChevronDown size={14} className={cx('transition-transform', manage && 'rotate-180')} /> Manage room
      </button>
      {manage ? (
        <div className="grid gap-3 border-t border-line pt-3 md:grid-cols-2">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} onBlur={commitName} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
          </Field>
          <Field label="Type">
            <Select value={room.type} onChange={(e) => updateRoom(room.id, { type: e.target.value as RoomType })}>
              {ROOM_TYPES.map((t) => (
                <option key={t} value={t}>
                  {ROOM_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex flex-col gap-2 md:col-span-2">
            <div className="text-xs font-medium text-ink-2">Reconstruction</div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => regen('draft')}>
                <Icon.Rotate size={14} /> Regenerate draft <span className="mono text-ink-3">· {costLabel('draft')}</span>
              </Button>
              {/* A free simulated rehearsal must not consume the room's one upgrade: with the live
                  provider selected, a room carrying a mock full can still be sent to marble-1.1. */}
              <Button size="sm" variant="secondary" disabled={busy || !canUpgrade} onClick={() => regen('full')}>
                <Icon.Zap size={14} />{' '}
                {busy && job?.tier === 'full'
                  ? 'Upgrading to full quality'
                  : canUpgrade
                    ? room.full
                      ? 'Replace the simulated full with a real one'
                      : 'Upgrade to full quality'
                    : room.full?.provider === 'mock'
                      ? 'Simulated full attached'
                      : 'Full world attached'}{' '}
                <span className="mono text-ink-3">· {costLabel('full')}</span>
              </Button>
            </div>
            <ShadowedFullNote room={room} />
            {world ? (
              <div className="mono text-[11px] text-ink-3" title={`${world.model} · ${world.worldId}`}>
                Current: {world.tier} · {world.provider === 'mock' ? 'simulated' : providerName('marble')}
                {world.seconds != null ? ` · ${clock(world.seconds)}` : ''}
                {world.provider === 'marble' && world.credits != null ? ` · ${world.credits} credits` : ' · free'}
              </div>
            ) : null}
            {real ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <Chip mono className="!text-[10px]">
                  {world?.panoUrl ? 'panorama' : 'no panorama'}
                </Chip>
                {world?.spzUrl ? <Chip mono className="!text-[10px]">splat</Chip> : null}
                {world?.colliderUrl ? <Chip mono className="!text-[10px]">collider</Chip> : null}
                <Chip mono tone={world?.metricScaleFactor ? 'ok' : 'neutral'} className="!text-[10px]">
                  {world?.metricScaleFactor ? `metric scale ${world.metricScaleFactor.toFixed(3)} m/unit` : 'no metric scale'}
                </Chip>
                {world?.groundPlaneOffset != null ? <Chip mono className="!text-[10px]">ground {world.groundPlaneOffset.toFixed(2)} m</Chip> : null}
                {world?.marbleUrl ? (
                  <a href={world.marbleUrl} target="_blank" rel="noreferrer" className="mono text-[10px] text-ink-3 underline-offset-4 hover:text-ink hover:underline">
                    open in Marble
                  </a>
                ) : null}
              </div>
            ) : null}
            {!room.photo ? <div className="text-[11px] text-ink-3">This room has no source photo, so it is always simulated.</div> : null}
          </div>
          {real ? (
            <div className="md:col-span-2">
              <FloorOffset
                roomId={room.id}
                showAnchor={false}
                hint={
                  world?.metricScaleFactor
                    ? 'The model measured itself, so this should stay near zero. Nudge it if staged furniture floats above the real floor.'
                    : 'Draft worlds carry no metric scale. Nudge until staged furniture sits on the floor you can see.'
                }
              />
            </div>
          ) : null}
          <div className="md:col-span-2">
            <Button size="sm" variant="danger" onClick={del}>
              <Icon.Trash size={14} /> {armed ? 'Click again to delete this room' : 'Delete room'}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
