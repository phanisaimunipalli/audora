import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAudora } from '@/state/store';
import { activeProvider } from '@/state/jobs';
import type { Tier } from '@/state/types';
import { TIER_INFO } from '@/services/mockWorld';
import { DRAFT_MODEL, FULL_MODEL, credits as fmtCredits } from '@/state/publish';
import { notificationPermission, requestNotifications } from '@/lib/notify';
import { eta } from '@/lib/format';
import { AnchorChip } from '@/components/AnchorChip';
import { Button, Callout, Chip, Field, Input, Toggle, cx } from '@/components/ui';
import { Icon } from '@/components/icons';
import { ROOM_TYPE_LABELS, draftGeometry, finalAnchor, isAnchored, type DraftListing, type DraftRoom } from './types';

export interface StepLaunchProps {
  listing: DraftListing;
  rooms: DraftRoom[];
  quality: Tier;
  onQuality: (q: Tier) => void;
  email: string;
  onEmail: (v: string) => void;
  launching: boolean;
  onLaunch: () => void;
}

/** Rooms that can never go to a live reconstruction: no photo, or a browser-drawn demo photo. */
export const simulatedOnly = (r: DraftRoom) => !r.photo || !!r.synthetic;

export function StepLaunch({ listing, rooms, quality, onQuality, email, onEmail, launching, onLaunch }: StepLaunchProps) {
  const providers = useAudora((s) => s.providers);
  const settings = useAudora((s) => s.settings);
  const setSettings = useAudora((s) => s.setSettings);
  const [perm, setPerm] = useState(notificationPermission());
  const provider = activeProvider();
  const info = TIER_INFO[quality];
  const liveRooms = provider === 'marble' ? rooms.filter((r) => !simulatedOnly(r)).length : 0;
  const simRooms = rooms.length - liveRooms;
  const remaining = providers.maxGenerations != null ? Math.max(0, providers.maxGenerations - (providers.liveGenerations ?? 0)) : undefined;
  const mockSeconds = quality === 'draft' ? settings.mockDraftSeconds : settings.mockFullSeconds;
  const unanchored = rooms.filter((r) => !isAnchored(r));
  const model = quality === 'draft' ? providers.models?.marbleDraft ?? 'marble-1.0-draft' : providers.models?.marbleFull ?? 'marble-1.1';

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="flex flex-col gap-6">
        <section className="flex flex-col gap-3">
          <div className="micro">Quality</div>
          <div className="grid gap-3 sm:grid-cols-2">
            {(['draft', 'full'] as Tier[]).map((t) => {
              const i = TIER_INFO[t];
              const on = quality === t;
              const tierModel = t === 'draft' ? providers.models?.marbleDraft ?? DRAFT_MODEL : providers.models?.marbleFull ?? FULL_MODEL;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => onQuality(t)}
                  className={cx('flex flex-col gap-2 rounded-2xl border p-4 text-left transition-colors', on ? 'border-accent bg-accent/5 ring-accent' : 'border-line bg-surface hover:bg-surface-2')}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-base text-ink">{i.label}</span>
                    {t === 'draft' ? <Chip tone="accent">recommended to start</Chip> : <Chip mono>what buyers walk</Chip>}
                  </div>
                  <div className="mono text-sm text-ink-2">
                    ~{t === 'draft' ? '1 minute' : '10 minutes'} · {fmtCredits(i.credits)} credits · ~${i.usd.toFixed(2)}/room
                  </div>
                  <div className="mono text-[11px] text-ink-3">{tierModel}</div>
                  <div className="text-xs text-ink-3">{i.blurb}</div>
                </button>
              );
            })}
          </div>
          {/* The tier story, said once at the point where the seller first meets it. */}
          <p className="text-xs text-ink-3">
            Start with drafts: they are quick and they are what you stage against. When the listing is ready, <strong className="font-medium text-ink-2">Publish</strong>{' '}
            offers a full <span className="mono">{FULL_MODEL}</span> reconstruction for every room (<span className="mono">{fmtCredits(TIER_INFO.full.credits)} credits ≈ $
            {TIER_INFO.full.usd.toFixed(2)}</span> each, about ten minutes) and shows the total before it spends anything. Buyers always get the best world a room has, so the
            draft stays walkable until the full one lands.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <div className="micro">Reconstruction</div>
          {provider === 'marble' ? (
            <div className="panel flex flex-col gap-3 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone="accent">
                  <span className="h-1.5 w-1.5 rounded-full bg-ink" /> Live · World Labs Marble
                </Chip>
                <Chip mono>{model}</Chip>
                <Chip mono tone="accent">
                  ~{fmtCredits(info.credits)} credits × {liveRooms} room{liveRooms === 1 ? '' : 's'} = ~{fmtCredits(info.credits * liveRooms)} credits · ~$
                  {(info.usd * liveRooms).toFixed(2)}
                </Chip>
              </div>
              <p className="text-xs text-ink-3">
                Each photo room becomes a real Gaussian-splat world. Draft rooms take {eta(info.realSeconds)}; the model returns geometry up to scale and your anchor makes it metric.
                {simRooms > 0 ? ` ${simRooms} room${simRooms === 1 ? '' : 's'} without a photo will be simulated for free.` : ''}
              </p>
              {remaining != null && liveRooms > remaining ? (
                <Callout tone="warn" title={`This dev server allows ${remaining} more live generation${remaining === 1 ? '' : 's'}`}>
                  {liveRooms} rooms would go live. Rooms beyond the cap will fail to start. Simulate instead, or raise MARBLE_MAX_GENERATIONS.
                </Callout>
              ) : null}
              <Toggle checked={settings.preferMock} onChange={(v) => setSettings({ preferMock: v })} label="Simulate instead (free) — no credits, honest timing" />
            </div>
          ) : (
            <div className="panel flex flex-col gap-3 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone="warn">
                  <span className="h-1.5 w-1.5 rounded-full bg-line-2" /> Simulated reconstruction
                </Chip>
                <Chip mono>mock-{quality} · ~{mockSeconds}s per room · free</Chip>
              </div>
              <p className="text-xs text-ink-3">
                {providers.marble
                  ? 'A Marble key is configured but "Prefer simulated reconstruction" is on. Every room becomes a deterministic mock world with the same timing, credits and steps as the real thing.'
                  : 'No World Labs key on the server, so rooms become deterministic mock worlds with honest timing and cost numbers.'}
              </p>
              {providers.marble ? <Toggle checked={settings.preferMock} onChange={(v) => setSettings({ preferMock: v })} label="Simulate instead (free)" /> : null}
              <Link to="/settings" className="text-xs text-ink-2 hover:text-ink">
                Provider settings →
              </Link>
            </div>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <div className="micro">Notifications</div>
          <div className="panel flex flex-col gap-4 p-4">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 text-ink">
                <Icon.Bell size={18} />
              </span>
              <div>
                <div className="text-sm text-ink">Generation takes minutes. You can leave.</div>
                <div className="text-xs text-ink-3">The job keeps running while you browse elsewhere or close the tab. We will ping you here, in the title bar, and as a browser notification.</div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant={perm === 'granted' ? 'secondary' : 'primary'} size="sm" disabled={perm === 'granted' || perm === 'unsupported'} onClick={async () => setPerm(await requestNotifications())}>
                {perm === 'granted' ? <Icon.Check size={14} /> : <Icon.Bell size={14} />}
                {perm === 'granted' ? 'Browser notifications on' : 'Allow browser notifications'}
              </Button>
              <span className="mono text-xs text-ink-3">status: {perm}</span>
            </div>
            <Field label="Email me when it is ready" hint="Stored on the tour. Email delivery is not wired in this build; the browser notification and the in-app badge are.">
              <Input value={email} onChange={(e) => onEmail(e.target.value)} type="email" inputMode="email" placeholder="you@agency.com" />
            </Field>
          </div>
        </section>
      </div>

      <aside className="flex flex-col gap-4 lg:sticky lg:top-20 lg:self-start">
        <div className="panel flex flex-col gap-4 p-4">
          <div>
            <div className="micro">Summary</div>
            <div className="display mt-1 text-2xl text-ink">{listing.title || listing.address || 'Untitled listing'}</div>
            {listing.title ? <div className="text-xs text-ink-3">{listing.address}</div> : null}
            <div className="mono mt-1 text-xs text-ink-2">
              {[listing.price, listing.beds && `${listing.beds} bd`, listing.baths && `${listing.baths} ba`, listing.sqft && `${listing.sqft} sqft`].filter(Boolean).join(' · ') || 'no listing facts'}
            </div>
          </div>
          <ul className="flex flex-col gap-2">
            {rooms.map((r) => {
              const g = draftGeometry(r);
              const a = finalAnchor(r);
              return (
                <li key={r.id} className="flex gap-3 rounded-xl border border-line bg-surface p-2">
                  <div className="h-12 w-16 shrink-0 overflow-hidden rounded-lg border border-line bg-surface">
                    {r.photo ? <img src={r.photo.dataUrl} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-ink-3"><Icon.Ruler size={16} /></div>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm text-ink">{r.name}</span>
                      <span className="text-[11px] text-ink-3">{ROOM_TYPE_LABELS[r.type]}</span>
                      {provider === 'marble' && simulatedOnly(r) ? <Chip mono className="!text-[10px]">simulated</Chip> : null}
                    </div>
                    <div className="mono text-xs text-ink-2">
                      {g.width.toFixed(2)} × {g.depth.toFixed(2)} × {g.height.toFixed(2)} m
                    </div>
                    <AnchorChip anchor={a} size="sm" className="mt-1 max-w-full" />
                  </div>
                </li>
              );
            })}
          </ul>
          {unanchored.length ? (
            <Callout tone="warn">
              {unanchored.length} room{unanchored.length === 1 ? ' has' : 's have'} no anchor. Their numbers will be a ±30 cm guess until you anchor them from the hub.
            </Callout>
          ) : null}
          <Button variant="primary" size="lg" loading={launching} disabled={!rooms.length || !listing.address.trim()} onClick={onLaunch} className="w-full">
            <Icon.Sparkles size={18} /> Generate {rooms.length} room{rooms.length === 1 ? '' : 's'}
          </Button>
          <div className="mono text-center text-[11px] text-ink-3">
            {provider === 'marble' ? `~${fmtCredits(info.credits * liveRooms)} credits · ${eta(info.realSeconds)} per room` : `simulated · free · ~${mockSeconds}s per room`}
          </div>
        </div>
      </aside>
    </div>
  );
}
