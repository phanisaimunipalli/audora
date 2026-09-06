import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Room } from '@/state/types';
import { toast, useAudora, useTourJobs, useTourRooms } from '@/state/store';
import { activeProvider, regenerateRoom } from '@/state/jobs';
import { listingCopy, type AiMeta } from '@/services/ai';
import { TIER_INFO } from '@/services/mockWorld';
import { watermark } from '@/three/stills';
import { timeAgo, usd } from '@/lib/format';
import { AnchorChip } from '@/components/AnchorChip';
import { Button, Callout, Card, Chip, IconButton, Input, Progress, Spinner, StagedLabel, Toggle, cx } from '@/components/ui';
import { Icon } from '@/components/icons';
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

/** Share link, embed, listing stills, disclosure, listing copy, publish toggle, and per-room quality upgrades. */
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
  const onStillsError = useCallback(
    (e: unknown) => {
      setRendering(null);
      toast({ kind: 'error', title: 'Rendering failed', body: (e as Error)?.message });
    },
    [],
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
  const [armed, setArmed] = useState<string | null>(null);

  if (!tour) return <div className={cx('p-6 text-sm text-ink-3', className)}>Tour not found.</div>;

  const link = publicUrl(tour.shareId);
  const embed = embedSnippet(tour.shareId, tour.title);
  const disclosure = DISCLOSURE(rooms.map((r) => `${r.name}: ${r.anchor.label}`));
  const readyRooms = rooms.filter((r) => r.status === 'ready');
  const jobFor = (roomId: string) => jobs.filter((j) => j.roomId === roomId && (j.status === 'queued' || j.status === 'running')).pop();

  return (
    <div className={cx('flex flex-col gap-5', className)}>
      {renderingRoom ? <StillsRenderer key={renderingRoom.id} room={renderingRoom} onDone={onStills} onError={onStillsError} /> : null}

      {/* share */}
      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.14em] text-accent-2">Share</div>
            <div className="display mt-1 text-2xl text-ink">{tour.published ? 'Live for buyers' : 'Ready to publish'}</div>
            <div className="mt-1 text-sm text-ink-3">
              {tour.published && tour.publishedAt ? `Published ${timeAgo(tour.publishedAt)}. ` : 'Buyers land standing in the first room at eye height. '}
              Every screen shows the scale anchor and the staged label.
            </div>
          </div>
          <div className="flex items-center gap-3">
            <StagedLabel />
            <Toggle checked={tour.published} onChange={(v) => publishTour(tour.id, v)} label={tour.published ? 'Published' : 'Unpublished'} />
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="mono" aria-label="Share link" />
          <div className="flex shrink-0 gap-2">
            <CopyButton text={link} label="Copy link" size="md" />
            <Link to={`/t/${tour.shareId}`} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-xl border border-line-2 bg-surface-2 px-4 text-sm text-ink hover:bg-surface-3">
              <Icon.Eye size={16} /> Open
            </Link>
          </div>
        </div>
        {!tour.published ? <Callout tone="info">The link opens as a preview right now. Flip the toggle when the staging is final; the buyer view is identical either way.</Callout> : null}
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
        <pre className="mono max-h-40 overflow-auto rounded-xl border border-line bg-bg-2 p-3 text-[11px] leading-relaxed text-ink-2 whitespace-pre-wrap break-all">{embed}</pre>
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
            <RoomStills key={room.id} tour={tour.title} room={room} stills={stills[room.id]} busy={rendering === room.id || queue.includes(room.id) || (finishing && renderingRoom?.id === room.id)} onRender={() => renderRoom(room.id)} />
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
          className="w-full resize-y rounded-xl border border-line-2 bg-bg-2 px-3 py-2.5 text-sm leading-relaxed text-ink outline-none placeholder:text-ink-3 focus:border-accent/60"
        />
      </Card>

      {/* quality */}
      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-ink">Reconstruction quality</div>
            <div className="text-xs text-ink-3">Drafts are ready in about a minute. A full reconstruction takes around ten and looks like a photograph.</div>
          </div>
          <Chip tone={provider === 'marble' ? 'warn' : 'neutral'} mono>
            {provider === 'marble' ? 'World Labs Marble · live · spends credits' : 'simulated · no credits'}
          </Chip>
        </div>
        {provider === 'marble' ? (
          <Callout tone="warn" title="Upgrades run on the real World Labs API">
            Each full-quality room spends about {TIER_INFO.full.credits.toLocaleString()} credits (≈ {usd(TIER_INFO.full.usd)}) of real credits
            {liveMax != null ? `; this server allows ${liveMax - (liveCount ?? 0)} more live generation${liveMax - (liveCount ?? 0) === 1 ? '' : 's'}` : ''}. Turn on "Prefer simulated reconstruction" in Settings to rehearse for free.
          </Callout>
        ) : null}
        <ul className="flex flex-col gap-2">
          {rooms.map((room) => {
            const job = jobFor(room.id);
            const full = Boolean(room.full);
            const needsPhoto = provider === 'marble' && !room.photo;
            const isArmed = armed === room.id;
            return (
              <li key={room.id} className="flex flex-col gap-2 rounded-xl border border-line bg-surface-2/50 px-3.5 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="w-full min-w-0 sm:w-auto sm:flex-1">
                    <div className="text-sm text-ink">{room.name}</div>
                    <div className="mono text-[11px] text-ink-3">
                      {room.geometry.width.toFixed(2)} × {room.geometry.depth.toFixed(2)} m · {full ? 'full' : room.draft ? 'draft' : room.status}
                      {(() => {
                        const w = room.full ?? room.draft;
                        if (!w) return '';
                        return w.provider === 'marble' ? ` · ${w.credits ?? 0} credits` : ' · simulated';
                      })()}
                    </div>
                  </div>
                  <AnchorChip anchor={room.anchor} size="sm" />
                  {full ? (
                    <Chip tone="ok">Full quality</Chip>
                  ) : job ? (
                    <Chip tone="accent" mono>
                      <Spinner size={11} /> {job.tier} · {job.progress}%
                    </Chip>
                  ) : (
                    <Button
                      size="sm"
                      variant={isArmed ? 'danger' : 'secondary'}
                      disabled={needsPhoto || room.status === 'pending'}
                      title={needsPhoto ? 'A live upgrade needs the room photo.' : undefined}
                      onClick={() => {
                        if (provider === 'marble' && !isArmed) {
                          setArmed(room.id);
                          return;
                        }
                        setArmed(null);
                        const j = regenerateRoom(room.id, 'full');
                        if (j) toast({ kind: 'info', title: `${room.name}: full quality queued`, body: provider === 'marble' ? `About ${TIER_INFO.full.credits} credits, roughly ten minutes. We will tell you when it lands.` : 'Simulated. No credits spent.' });
                      }}
                    >
                      {isArmed ? `Yes, spend ~${TIER_INFO.full.credits} credits` : 'Upgrade to full quality'}
                    </Button>
                  )}
                  {isArmed ? (
                    <IconButton label="Cancel" className="h-8 w-8" onClick={() => setArmed(null)}>
                      <Icon.X size={14} />
                    </IconButton>
                  ) : null}
                </div>
                {job ? <Progress value={job.progress} /> : null}
                {isArmed ? (
                  <div className="text-xs text-warn">This spends real World Labs credits (≈ {usd(TIER_INFO.full.usd)}) the moment you confirm. It cannot be refunded.</div>
                ) : needsPhoto ? (
                  <div className="text-xs text-ink-3">This room has no photo on file, so a live reconstruction cannot start. Simulated upgrades still work from Settings.</div>
                ) : null}
              </li>
            );
          })}
        </ul>
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
          </div>
        </div>
        <AnchorChip anchor={room.anchor} size="sm" />
        <Button size="sm" variant="secondary" onClick={onRender} loading={busy}>
          <Icon.Camera size={14} /> {stills ? 'Re-render' : 'Render 4 angles'}
        </Button>
      </div>
      {stills ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {stills.map((s) => (
            <figure key={s.name} className="group flex flex-col gap-1.5 animate-fade">
              <div className="relative overflow-hidden rounded-xl border border-line bg-bg-2">
                <img src={s.dataUrl} alt={`${room.name}, ${s.name}`} className="aspect-[16/10] w-full object-cover" />
                <span className="absolute left-2 top-2"><StagedLabel className="!bg-bg/70 backdrop-blur" /></span>
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
