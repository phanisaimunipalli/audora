import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Room } from '@/state/types';
import { toast, useAudora, useTourJobs, useTourRooms } from '@/state/store';
import { activeProvider, regenerateRoom, upgradeTourToFull } from '@/state/jobs';
import {
  FULL_MODEL,
  confirmLabel,
  credits as fmtCreditsNumber,
  fullIsShadowed,
  hasPendingJob,
  needsFull,
  pickWorld,
  publishLabel,
  tierCost,
  upgradeJobs,
  upgradeLine,
  upgradeTargets,
} from '@/state/publish';
import { listingCopy, type AiMeta } from '@/services/ai';
import { TIER_INFO } from '@/services/mockWorld';
import { watermark } from '@/three/stills';
import { effectiveHeading, sunState } from '@/engine/siteSun';
import { clock, timeAgo, usd } from '@/lib/format';
import { AnchorChip } from '@/components/AnchorChip';
import { Button, Callout, Card, Chip, IconButton, Input, Progress, Spinner, StagedLabel, Toggle, cx } from '@/components/ui';
import { Icon } from '@/components/icons';
import { ShadowedFullNote, TierChip } from '@/screens/hub/TierChip';
import { UpgradeBanner } from '@/screens/hub/UpgradeBanner';
import { jobElapsed, jobRemaining } from '@/screens/hub/jobMeta';
import { useNow } from '@/screens/hub/useNow';
import { StillsRenderer, type Still } from './viewer/StillsRenderer';
import { copyText, embedSnippet, publicUrl } from './viewer/share';

export interface PublishPanelProps {
  tourId: string;
  className?: string;
}

const DISCLOSURE = (anchors: string[]) =>
  `Digitally staged. The furniture in these images and in the 3D tour is virtual and shown for scale; the property is sold unfurnished unless stated otherwise. Room dimensions are derived from a declared scale reference for each room (${anchors.join('; ')}) and carry the stated ± uncertainty. Buyers should verify critical measurements in person.`;

function CopyButton({ text, label = 'Copy', size = 'sm' }: { text: string; label?: string; size?: 'sm' | 'md' }) {
  const [ok, setOk] = useState(false);
  return (
    <Button
      size={size}
      variant="secondary"
      onClick={async () => {
        const done = await copyText(text);
        setOk(done);
        if (!done) toast({ kind: 'warn', title: 'Could not copy', body: 'Select the text and copy it by hand.' });
        window.setTimeout(() => setOk(false), 1600);
      }}
    >
      {ok ? <Icon.Check size={14} /> : <Icon.Copy size={14} />} {ok ? 'Copied' : label}
    </Button>
  );
}

function fileName(tour: string, room: string, still: string) {
  return `${tour}-${room}-${still}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '.jpg';
}

/**
 * Publish: the full-quality upgrade, the share link, the embed, listing stills, the disclosure and
 * the listing copy.
 *
 * The tier story lives here. A draft is what the seller stages against; a full `marble-1.1` world is
 * what a buyer should walk, so publishing offers to regenerate every draft-only room — with the
 * credit total on the button, never silently.
 */
export function PublishPanel({ tourId, className }: PublishPanelProps) {
  const tour = useAudora((s) => s.tours[tourId]);
  const rooms = useTourRooms(tourId);
  const jobs = useTourJobs(tourId);
  const publishTour = useAudora((s) => s.publishTour);
  const updateTour = useAudora((s) => s.updateTour);
  // Subscribe to the two inputs of activeProvider() so the chips update when settings change.
  const marbleLive = useAudora((s) => s.providers.marble);
  const preferMock = useAudora((s) => s.settings.preferMock);
  const liveCount = useAudora((s) => s.providers.liveGenerations);
  const liveMax = useAudora((s) => s.providers.maxGenerations);
  const provider = useMemo(() => activeProvider(), [marbleLive, preferMock]); // eslint-disable-line react-hooks/exhaustive-deps

  /* stills */
  const [stills, setStills] = useState<Record<string, Still[]>>({});
  const [queue, setQueue] = useState<string[]>([]);
  const [rendering, setRendering] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  useEffect(() => {
    if (rendering || finishing || !queue.length) return;
    setRendering(queue[0]);
    setQueue((q) => q.slice(1));
  }, [queue, rendering, finishing]);
  const renderingRoom = rooms.find((r) => r.id === rendering);
  /* The listing still is taken under the light the buyer will open the tour in: the address's own
     sun at the hour the seller parked the time-of-day control on. A tour with no site simply has no
     real sun and the room keeps the studio key it always had. */
  const site = tour?.site;
  const stillSun = useMemo(
    () =>
      site && renderingRoom
        ? sunState(new Date(site.previewTime ?? Date.now()), site.lat, site.lon, effectiveHeading(site.heading, renderingRoom.northWallHeading))
        : null,
    [site, renderingRoom],
  );
  const onStills = useCallback(
    async (raw: Still[]) => {
      const room = renderingRoom;
      setRendering(null);
      if (!room) return;
      setFinishing(true);
      try {
        const lines = ['Digitally staged · Audora', `anchor: ${room.anchor.label}`];
        const marked = await Promise.all(raw.map(async (s) => ({ name: s.name, dataUrl: await watermark(s.dataUrl, lines) })));
        setStills((m) => ({ ...m, [room.id]: marked }));
      } catch (e: any) {
        toast({ kind: 'error', title: `Could not watermark ${room.name}`, body: e?.message });
      } finally {
        setFinishing(false);
      }
    },
    [renderingRoom],
  );
  const onStillsError = useCallback((e: unknown) => {
    setRendering(null);
    toast({ kind: 'error', title: 'Rendering failed', body: (e as Error)?.message });
  }, []);
  /* A room with a real capture whose photograph did not arrive comes back as a render of the
     measured room. That is a usable fallback, but it is NOT the flat, and a seller about to put
     four images on a listing has to be told which they are looking at. */
  const onStillsFallback = useCallback(
    (reason: string) => {
      const name = renderingRoom?.name ?? 'This room';
      toast({
        kind: 'warn',
        title: `${name}: these stills are the measured room`,
        body: `The reconstruction could not be composited — ${reason}. The images below are Audora's own drawing of the room, not the photograph. Render again when the connection is better.`,
      });
    },
    [renderingRoom],
  );
  const renderRoom = (id: string) => setQueue((q) => (q.includes(id) || rendering === id ? q : [...q, id]));
  const renderAll = () => rooms.filter((r) => r.status === 'ready').forEach((r) => renderRoom(r.id));

  /* listing copy */
  const [copy, setCopy] = useState(tour?.copy ?? '');
  const [copyMeta, setCopyMeta] = useState<AiMeta | null>(null);
  const [writing, setWriting] = useState(false);
  const wroteOnce = useRef(false);
  const generate = useCallback(async () => {
    if (!tour) return;
    setWriting(true);
    try {
      const r = await listingCopy(tour, rooms);
      setCopy(r.text);
      setCopyMeta(r.meta);
      updateTour(tour.id, { copy: r.text });
    } finally {
      setWriting(false);
    }
  }, [tour, rooms, updateTour]);
  useEffect(() => {
    if (!tour || wroteOnce.current) return;
    wroteOnce.current = true;
    if (!tour.copy && rooms.length) void generate();
  }, [tour, rooms.length, generate]);

  /* upgrades */
  const [armedRoom, setArmedRoom] = useState<string | null>(null);
  const [armedPublish, setArmedPublish] = useState(false);
  /** null = follow the default; the seller's own choice wins once they touch the toggle. */
  const [wantFull, setWantFull] = useState<boolean | null>(null);
  const running = useMemo(() => upgradeJobs(rooms, jobs), [rooms, jobs]);
  const now = useNow(running.length > 0);

  const targets = useMemo(() => upgradeTargets(rooms, jobs, provider), [rooms, jobs, provider]);
  const simulated = provider === 'mock';
  const liveLeft = liveMax != null ? Math.max(0, liveMax - (liveCount ?? 0)) : undefined;
  const guardAllows = liveLeft == null || liveLeft >= targets.length;
  /** Live Marble, the server's credit guard has room, and there is something to upgrade. */
  const canUpgrade = !simulated && guardAllows && targets.length > 0;
  const upgradeOn = simulated ? false : (wantFull ?? canUpgrade);
  const queueing = upgradeOn ? targets.length : 0;
  const cost = tierCost(queueing, 'full', provider);
  const label = tour ? publishLabel({ published: tour.published, rooms: queueing, provider, cost }) : 'Publish';
  const spends = queueing > 0 && provider === 'marble';

  if (!tour) return <div className={cx('p-6 text-sm text-ink-3', className)}>Tour not found.</div>;

  const link = publicUrl(tour.shareId);
  const embed = embedSnippet(tour.shareId, tour.title);
  const disclosure = DISCLOSURE(rooms.map((r) => `${r.name}: ${r.anchor.label}`));
  const readyRooms = rooms.filter((r) => r.status === 'ready');
  /* Counted by what the buyer is shown, not by what is attached, and every room accounted for
     exactly once: a simulated full that never displaces a real capture is not a full-quality room,
     and "6 full · 0 draft-only" one screen above a row reading "draft · simulated full attached"
     was the panel arguing with itself. */
  const shown = rooms.map((r) => pickWorld(r.draft, r.full));
  const fullRooms = shown.filter((w) => w?.tier === 'full' && w.provider === 'marble').length;
  const simulatedFullRooms = shown.filter((w) => w?.tier === 'full' && w.provider === 'mock').length;
  const draftRooms = rooms.length - fullRooms - simulatedFullRooms;
  const jobFor = (roomId: string) => jobs.filter((j) => j.roomId === roomId && (j.status === 'queued' || j.status === 'running')).pop();

  const queueUpgrades = (announce = true) => {
    const r = upgradeTourToFull(tour.id);
    if (!r.jobs.length) {
      if (announce) toast({ kind: 'info', title: 'Nothing to upgrade', body: r.skipped.length ? 'Those rooms are already on their way to full quality.' : 'Every room already has a full-quality world.' });
      return r;
    }
    /* `Tour.quality` is the *generation intent* — the tier a future "generate everything" would
       ask for — not a claim about what is on the tour today. What the tour is shipping is read off
       its rooms wherever it is shown (`tourQuality`), so this no longer flips the hub's label to
       "full quality" the moment the jobs are queued. */
    if (tour.quality !== 'full') updateTour(tour.id, { quality: 'full' });
    toast({
      kind: 'success',
      title: `Full quality queued · ${r.jobs.length} room${r.jobs.length === 1 ? '' : 's'}`,
      body:
        r.provider === 'marble'
          ? `${fmtCreditsNumber(r.cost.credits)} credits (${usd(r.cost.usd)}) · ${FULL_MODEL} · about ten minutes per room. You can leave this page; we will notify you when full quality is ready.`
          : 'Simulated reconstruction · no credits spent. The draft stays walkable until the full world lands.',
    });
    return r;
  };

  const onPublish = () => {
    if (spends && !armedPublish) {
      setArmedPublish(true);
      return;
    }
    setArmedPublish(false);
    if (!tour.published) publishTour(tour.id, true);
    if (upgradeOn && targets.length) queueUpgrades();
  };

  return (
    <div className={cx('flex flex-col gap-5', className)}>
      {renderingRoom ? (
        <StillsRenderer key={renderingRoom.id} room={renderingRoom} sun={stillSun} onDone={onStills} onError={onStillsError} onFallback={onStillsFallback} />
      ) : null}

      {/* publish + full quality */}
      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="micro">Publish</div>
            <div className="display mt-1 text-2xl text-ink">{tour.published ? 'Live for buyers' : 'Ready to publish'}</div>
            <div className="mt-1 max-w-xl text-sm text-ink-3">
              {tour.published && tour.publishedAt ? `Published ${timeAgo(tour.publishedAt)}. ` : 'Buyers land standing in the first room at eye height. '}
              A buyer should walk the best world the room has — that is a full <span className="mono">{FULL_MODEL}</span> reconstruction, not the draft you staged against.
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Chip tone={provider === 'marble' ? 'warn' : 'neutral'} mono>
              {provider === 'marble' ? 'World Labs Marble · live · spends credits' : 'simulated · no credits'}
            </Chip>
            <span className="mono text-[11px] text-ink-3">
              {rooms.length} room{rooms.length === 1 ? '' : 's'} · {fullRooms} full
              {simulatedFullRooms ? ` · ${simulatedFullRooms} simulated full` : ''} · {draftRooms} draft-only
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-3.5">
          {/* Disabled rather than hidden: the seller should see the offer and why it is off today. */}
          <div className={cx(simulated && 'pointer-events-none opacity-55')} aria-disabled={simulated || undefined}>
            <Toggle
              checked={upgradeOn}
              onChange={(v) => setWantFull(simulated ? false : v)}
              label={
                <span className={cx('text-sm', simulated ? 'text-ink-3' : 'text-ink')}>
                  Also generate full quality{' '}
                  <span className="mono text-xs text-ink-3">
                    · {fmtCreditsNumber(TIER_INFO.full.credits)} credits ({usd(TIER_INFO.full.usd)}) per room · {FULL_MODEL} · ~10 min
                  </span>
                </span>
              }
            />
          </div>
          {simulated ? (
            <div className="text-xs text-ink-3">
              "Prefer simulated reconstruction" is on, so a full-quality pass would be a mock world rather than a Marble one — and a simulated world never
              replaces a real capture. Turn it off in{' '}
              <Link to="/settings" className="text-ink-2 hover:text-ink">
                Settings
              </Link>{' '}
              to queue the real thing. Publishing works either way.
            </div>
          ) : !guardAllows ? (
            <div className="text-xs text-warn">
              This dev server allows {liveLeft} more live generation{liveLeft === 1 ? '' : 's'} and {targets.length} room{targets.length === 1 ? '' : 's'} need one. Raise
              MARBLE_MAX_GENERATIONS in .env, or upgrade the rooms one at a time below.
            </div>
          ) : targets.length === 0 ? (
            <div className="text-xs text-ink-3">
              {running.length ? `${running.length} room${running.length === 1 ? ' is' : 's are'} already upgrading.` : 'Every room already has a full-quality world.'}
            </div>
          ) : (
            <div className="text-xs text-ink-3">
              {targets.length} room{targets.length === 1 ? '' : 's'} would be regenerated at full quality ={' '}
              <span className="mono text-ink-2">{fmtCreditsNumber(tierCost(targets.length).credits)} credits</span> ({usd(tierCost(targets.length).usd)}). The draft stays
              walkable the whole time, and buyers see the full world the moment it lands.
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" size="lg" onClick={onPublish} disabled={tour.published && queueing === 0} /* Armed to spend real, non-refundable credits: the one moment a black pill is not enough. */
              className={cx(spends && armedPublish && '!bg-danger !text-white hover:!bg-danger')}>
              <Icon.Share size={16} /> {armedPublish ? confirmLabel(cost) : label}
            </Button>
            {armedPublish ? (
              <IconButton label="Cancel" className="h-9 w-9" onClick={() => setArmedPublish(false)}>
                <Icon.X size={15} />
              </IconButton>
            ) : null}
            {tour.published ? (
              <Button variant="ghost" size="sm" onClick={() => publishTour(tour.id, false)}>
                <Icon.EyeOff size={14} /> Unpublish
              </Button>
            ) : null}
            {simulated && targets.length > 0 ? (
              <Button variant="secondary" size="sm" onClick={() => queueUpgrades()}>
                <Icon.Zap size={14} /> Rehearse: queue simulated full quality · {targets.length} room{targets.length === 1 ? '' : 's'} · free
              </Button>
            ) : null}
          </div>
          {armedPublish ? (
            <div className="text-xs text-warn">
              This spends {fmtCreditsNumber(cost.credits)} real World Labs credits ({usd(cost.usd)}) the moment you confirm, across {cost.rooms} room
              {cost.rooms === 1 ? '' : 's'}. It cannot be refunded.
            </div>
          ) : null}
        </div>

        {running.length ? <UpgradeBanner jobs={running} rooms={rooms} /> : null}
        <StagedLabel className="self-start" />
      </Card>

      {/* share */}
      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-ink">Share link</div>
            <div className="text-xs text-ink-3">Every screen shows the scale anchor and the staged label.</div>
          </div>
          <Toggle checked={tour.published} onChange={(v) => publishTour(tour.id, v)} label={tour.published ? 'Published' : 'Unpublished'} />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="mono" aria-label="Share link" />
          <div className="flex shrink-0 gap-2">
            <CopyButton text={link} label="Copy link" size="md" />
            <Link
              to={`/t/${tour.shareId}`}
              target="_blank"
              rel="noreferrer"
              className="ease-audora inline-flex h-10 items-center gap-2 rounded-full border border-line-2 bg-bg px-4 text-[13.5px] font-semibold text-ink transition-colors duration-200 hover:border-ink-2"
            >
              <Icon.Eye size={16} /> Open
            </Link>
          </div>
        </div>
        {!tour.published ? <Callout tone="info">The link opens as a preview right now. Flip the toggle when the staging is final; the buyer view is identical either way.</Callout> : null}
      </Card>

      {/* per-room quality and links */}
      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-ink">Rooms, quality and links</div>
            <div className="text-xs text-ink-3">
              Drafts are ready in about a minute. A full reconstruction takes around ten and looks like a photograph — it is what the buyer walks.
            </div>
          </div>
        </div>
        {provider === 'marble' ? (
          <Callout tone="warn" title="Upgrades run on the real World Labs API">
            Each full-quality room spends about {fmtCreditsNumber(TIER_INFO.full.credits)} credits (≈ {usd(TIER_INFO.full.usd)})
            {liveLeft != null ? `; this server allows ${liveLeft} more live generation${liveLeft === 1 ? '' : 's'}` : ''}. Turn on "Prefer simulated reconstruction" in
            Settings to rehearse for free.
          </Callout>
        ) : null}
        <ul className="flex flex-col gap-2">
          {rooms.map((room) => {
            const job = jobFor(room.id);
            const upgrading = Boolean(job && job.tier === 'full');
            // A free simulated rehearsal does not spend the room's upgrade: with the live provider
            // selected, a room carrying a mock full still offers the real marble-1.1 pass.
            const full = !needsFull(room, provider);
            const shadowed = fullIsShadowed(room);
            const needsPhoto = provider === 'marble' && !room.photo;
            const isArmed = armedRoom === room.id;
            const roomLink = publicUrl(tour.shareId, room.id);
            return (
              <li key={room.id} className="flex flex-col gap-2 rounded-xl border border-line bg-surface-2/50 px-3.5 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="w-full min-w-0 sm:w-auto sm:flex-1">
                    <div className="text-sm text-ink">{room.name}</div>
                    <div className="mono text-[11px] text-ink-3">
                      {room.geometry.width.toFixed(2)} × {room.geometry.depth.toFixed(2)} m
                      {room.full && room.draft ? ' · draft kept for staging' : ''}
                    </div>
                  </div>
                  <AnchorChip anchor={room.anchor} size="sm" />
                  <TierChip room={room} generating={Boolean(job)} />
                  {upgrading && job ? (
                    <Chip tone="accent" mono>
                      <Spinner size={11} /> full · {job.status === 'queued' ? 'queued' : `${job.progress}%`}
                    </Chip>
                  ) : job ? (
                    <Chip tone="accent" mono>
                      <Spinner size={11} /> {job.tier} · {job.progress}%
                    </Chip>
                  ) : full ? (
                    // Green "Full quality" is a claim about the photograph the buyer walks, so a
                    // simulated world never earns it — attached or shadowed.
                    shadowed ? (
                      <Chip mono>simulated full attached</Chip>
                    ) : room.full?.provider === 'mock' ? (
                      <Chip mono>simulated full</Chip>
                    ) : (
                      <Chip tone="accent">Full quality</Chip>
                    )
                  ) : (
                    <Button
                      size="sm"
                      variant={isArmed ? 'danger' : 'secondary'}
                      disabled={needsPhoto || room.status === 'pending' || hasPendingJob(jobs, room.id, 'full')}
                      title={needsPhoto ? 'A live upgrade needs the room photo.' : undefined}
                      onClick={() => {
                        if (provider === 'marble' && !isArmed) {
                          setArmedRoom(room.id);
                          return;
                        }
                        setArmedRoom(null);
                        const j = regenerateRoom(room.id, 'full');
                        if (j)
                          toast({
                            kind: 'info',
                            title: `${room.name}: full quality queued`,
                            body:
                              provider === 'marble'
                                ? `${fmtCreditsNumber(TIER_INFO.full.credits)} credits, roughly ten minutes. You can leave this page; we will tell you when it lands.`
                                : 'Simulated. No credits spent.',
                          });
                      }}
                    >
                      {isArmed
                        ? `Yes, spend ${fmtCreditsNumber(TIER_INFO.full.credits)} credits`
                        : room.full
                          ? 'Upgrade to a real full world'
                          : 'Upgrade to full quality'}
                    </Button>
                  )}
                  {isArmed ? (
                    <IconButton label="Cancel" className="h-8 w-8" onClick={() => setArmedRoom(null)}>
                      <Icon.X size={14} />
                    </IconButton>
                  ) : null}
                </div>
                {job ? <Progress value={job.progress} /> : null}
                {job && upgrading ? (
                  <div className="mono text-[11px] text-dim">{upgradeLine(jobElapsed(job, now), jobRemaining(job, now), job.status === 'queued')}</div>
                ) : null}
                <ShadowedFullNote room={room} />
                {isArmed ? (
                  <div className="text-xs text-warn">This spends real World Labs credits (≈ {usd(TIER_INFO.full.usd)}) the moment you confirm. It cannot be refunded.</div>
                ) : needsPhoto ? (
                  <div className="text-xs text-ink-3">This room has no photo on file, so a live reconstruction cannot start. Simulated upgrades still work from Settings.</div>
                ) : null}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="mono min-w-0 flex-1 truncate text-[11px] text-ink-3" title={roomLink}>
                    {roomLink}
                  </span>
                  <CopyButton text={roomLink} label="Copy room link" />
                  <Link
                    to={`/t/${tour.shareId}/${room.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="ease-audora inline-flex h-8 items-center gap-1.5 rounded-full border border-line-2 bg-bg px-3 text-[12.5px] font-semibold text-ink transition-colors duration-200 hover:border-ink-2"
                  >
                    <Icon.Eye size={14} /> Open
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      {/* embed */}
      <Card className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-ink">Embed on the listing page</div>
            <div className="text-xs text-ink-3">An iframe plus the disclosure line. Works on any site that allows iframes.</div>
          </div>
          <CopyButton text={embed} label="Copy snippet" />
        </div>
        <pre className="mono max-h-40 overflow-auto rounded-xl border border-line bg-surface p-3 text-[11px] leading-relaxed text-ink-2 whitespace-pre-wrap break-all">{embed}</pre>
      </Card>

      {/* stills */}
      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-ink">Listing stills</div>
            <div className="text-xs text-ink-3">Four angles per room at 1600 × 1000, watermarked "Digitally staged · Audora" with the room's anchor.</div>
          </div>
          <Button variant="primary" onClick={renderAll} disabled={!readyRooms.length || Boolean(rendering) || queue.length > 0} loading={Boolean(rendering) || finishing}>
            <Icon.Camera size={16} /> Render every room
          </Button>
        </div>
        {readyRooms.length === 0 ? <div className="text-sm text-ink-3">Stills become available once a room has finished generating.</div> : null}
        <div className="flex flex-col gap-5">
          {readyRooms.map((room) => (
            <RoomStills
              key={room.id}
              tour={tour.title}
              room={room}
              stills={stills[room.id]}
              busy={rendering === room.id || queue.includes(room.id) || (finishing && renderingRoom?.id === room.id)}
              onRender={() => renderRoom(room.id)}
            />
          ))}
        </div>
      </Card>

      {/* disclosure */}
      <Card className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-medium text-ink">Disclosure</div>
          <CopyButton text={disclosure} />
        </div>
        <p className="text-sm leading-relaxed text-ink-2">{disclosure}</p>
      </Card>

      {/* listing copy */}
      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="text-sm font-medium text-ink">Listing copy</div>
            {copyMeta ? (
              <Chip tone={copyMeta.source === 'nebius' ? 'accent' : 'neutral'} mono>
                {copyMeta.source === 'nebius' ? `nebius · ${copyMeta.model ?? 'text'}` : 'rule-based'} · {copyMeta.ms}ms{copyMeta.usd != null ? ` · ${usd(copyMeta.usd)}` : ''}
              </Chip>
            ) : tour.copy ? (
              <Chip mono>saved</Chip>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={generate} loading={writing} disabled={!rooms.length}>
              <Icon.Sparkles size={14} /> {copy ? 'Regenerate' : 'Write it'}
            </Button>
            <CopyButton text={copy} />
          </div>
        </div>
        <textarea
          value={copy}
          onChange={(e) => setCopy(e.target.value)}
          onBlur={() => updateTour(tour.id, { copy })}
          rows={6}
          placeholder={writing ? 'Writing…' : 'Real dimensions, no superlatives, and a sentence that says it is digitally staged.'}
          className="w-full resize-y rounded-[10px] border border-line-2 bg-bg px-3 py-2.5 text-sm leading-relaxed text-ink outline-none placeholder:text-faint focus:border-ink"
        />
      </Card>
    </div>
  );
}

function RoomStills({ tour, room, stills, busy, onRender }: { tour: string; room: Room; stills?: Still[]; busy: boolean; onRender: () => void }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-full min-w-0 sm:w-auto sm:flex-1">
          <div className="text-sm text-ink">{room.name}</div>
          <div className="mono text-[11px] text-ink-3">
            {room.geometry.width.toFixed(2)} × {room.geometry.depth.toFixed(2)} m · {room.staging.length} staged pieces
            {room.full?.seconds ? ` · full in ${clock(room.full.seconds)}` : ''}
          </div>
        </div>
        <AnchorChip anchor={room.anchor} size="sm" />
        <TierChip room={room} />
        <Button size="sm" variant="secondary" onClick={onRender} loading={busy}>
          <Icon.Camera size={14} /> {stills ? 'Re-render' : 'Render 4 angles'}
        </Button>
      </div>
      {stills ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {stills.map((s) => (
            <figure key={s.name} className="group flex flex-col gap-1.5 animate-fade">
              <div className="relative overflow-hidden rounded-xl border border-line bg-surface">
                <img src={s.dataUrl} alt={`${room.name}, ${s.name}`} className="aspect-[16/10] w-full object-cover" />
                <span className="absolute left-2 top-2">
                  <StagedLabel className="!bg-glass backdrop-blur-[10px]" />
                </span>
              </div>
              <figcaption className="flex items-center justify-between gap-2 text-xs text-ink-3">
                <span className="truncate">{s.name}</span>
                <a href={s.dataUrl} download={fileName(tour, room.name, s.name)} className="inline-flex shrink-0 items-center gap-1 text-ink-2 hover:text-ink">
                  <Icon.Download size={13} /> JPG
                </a>
              </figcaption>
            </figure>
          ))}
        </div>
      ) : busy ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton aspect-[16/10] rounded-xl" />
          ))}
        </div>
      ) : null}
    </div>
  );
}
