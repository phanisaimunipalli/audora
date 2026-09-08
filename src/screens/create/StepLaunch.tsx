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
import {
  DEFAULT_PUBLISH_TIER,
  FULL_PLUS_MODEL,
  PLUS_AREA_M2,
  TIER_COPY,
  blockedRooms,
  intakeSummary,
  modelForRoom,
  simulatedRoom,
  tierPlan,
  type TierModels,
} from './intake';
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

/**
 * Rooms that can never go to a live reconstruction: no photo, or a browser-drawn demo photo.
 * The rule lives in `./intake` beside the cost arithmetic that depends on it; this is the name the
 * create flow already imports.
 */
export const simulatedOnly = simulatedRoom;

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

  /* docs/ACCURACY.md 3.4 and 3.5: what the intake gate is still holding, and what each tier would
     actually cost and run *for these rooms* — the model per room included, because a large or
     open-plan room goes to `marble-1.1-plus` and the leasing team should see that before they pay. */
  const tierModels: TierModels = { marbleDraft: providers.models?.marbleDraft, marbleFull: providers.models?.marbleFull };
  const live = provider === 'marble';
  const plans: Record<Tier, ReturnType<typeof tierPlan>> = {
    draft: tierPlan(rooms, 'draft', { live, models: tierModels }),
    full: tierPlan(rooms, 'full', { live, models: tierModels }),
  };
  const plan = plans[quality];
  const intake = intakeSummary(rooms);
  const blocked = blockedRooms(rooms);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="flex flex-col gap-6">
        <section className="flex flex-col gap-3">
          <div className="micro">Quality</div>
          <div className="grid gap-3 sm:grid-cols-2">
            {(['draft', 'full'] as Tier[]).map((t) => {
              const i = TIER_INFO[t];
              const on = quality === t;
              const p = plans[t];
              const copy = TIER_COPY[t];
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => onQuality(t)}
                  className={cx('flex flex-col gap-2 rounded-2xl border p-4 text-left transition-colors', on ? 'border-accent bg-accent/5 ring-accent' : 'border-line bg-surface hover:bg-surface-2')}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-base text-ink">{i.label}</span>
                    {t === DEFAULT_PUBLISH_TIER ? <Chip tone="accent">the published model</Chip> : <Chip mono>instant preview</Chip>}
                  </div>
                  <div className="text-[13px] font-medium text-ink-2">{copy.headline}</div>
                  {/* Cost per tier, before generating: the total for THIS run, not a rate card. */}
                  <div className="mono text-sm text-ink-2">
                    ~{t === 'draft' ? '1 minute' : '10 minutes'} a room ·{' '}
                    {p.liveRooms ? (
                      <>
                        {fmtCredits(p.credits)} credits · ~${p.usd.toFixed(2)} for {p.liveRooms} room{p.liveRooms === 1 ? '' : 's'}
                      </>
                    ) : (
                      'simulated · free'
                    )}
                  </div>
                  <div className="mono text-[11px] text-ink-3">{p.models.length ? p.models.join(' · ') : t === 'draft' ? DRAFT_MODEL : FULL_MODEL}</div>
                  <div className="text-xs text-ink-3">{copy.body}</div>
                </button>
              );
            })}
          </div>
          {/* The tier story, said once at the point where the leasing team first meets it. */}
          <p className="text-xs text-ink-3">
            Only full quality returns Marble’s own <span className="mono">metric_scale_factor</span>, which is why the published model defaults to it: fusion weighs that
            estimate against the plan’s ±5 cm and your anchor, and a draft simply has nothing to weigh. Start with drafts if you want to look first —{' '}
            <strong className="font-medium text-ink-2">Publish</strong> then offers full <span className="mono">{FULL_MODEL}</span> for every room (
            <span className="mono">
              {fmtCredits(TIER_INFO.full.credits)} credits ≈ ${TIER_INFO.full.usd.toFixed(2)}
            </span>{' '}
            each) and shows the total before it spends anything. Renters always get the best world a room has.
          </p>
          {plans.full.plusRooms ? (
            <Callout tone="info" title={`${plans.full.plusRooms} room${plans.full.plusRooms === 1 ? '' : 's'} go to ${FULL_PLUS_MODEL} at full quality`}>
              A room over <span className="mono">{PLUS_AREA_M2} m²</span> of printed floor, or one the plan calls open plan, loses its far end on the standard model. The
              larger model is charged at the same full-quality rate.
            </Callout>
          ) : null}
        </section>

        {/* docs/ACCURACY.md 3.4: how each room's photographs reach Marble. */}
        <section className="flex flex-col gap-3">
          <div className="micro">Photos per room</div>
          <div className="panel flex flex-col gap-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Chip mono tone={intake.reconstruction.multiAngle ? 'ok' : 'warn'}>
                {intake.reconstruction.multiAngle} of {intake.photoRooms} photo room{intake.photoRooms === 1 ? '' : 's'} have more than one angle
              </Chip>
              {intake.reconstruction.reconstructed ? (
                <Chip mono tone="accent">
                  reconstruct_images · {intake.reconstruction.reconstructed} room{intake.reconstruction.reconstructed === 1 ? '' : 's'}
                </Chip>
              ) : null}
            </div>
            <p className="text-xs text-ink-3">{intake.reconstruction.text}</p>
            {intake.accepted.length ? (
              <div className="text-xs text-ink-2">
                <span className="text-ink">{intake.accepted.length}</span> room{intake.accepted.length === 1 ? '' : 's'} you chose to use anyway with a poor photo:{' '}
                <span className="text-ink-3">{intake.accepted.map((r) => r.name).join(', ')}</span>. Their measurements will carry it.
              </div>
            ) : null}
            {intake.unconfirmed.length ? (
              <div className="text-xs text-ink-2">
                <span className="text-ink">{intake.unconfirmed.length}</span> plan pairing{intake.unconfirmed.length === 1 ? '' : 's'} not confirmed yet:{' '}
                <span className="text-ink-3">{intake.unconfirmed.map((r) => r.roomName).join(', ')}</span>. Go back to Rooms to check them against the drawing.
              </div>
            ) : null}
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <div className="micro">Reconstruction</div>
          {provider === 'marble' ? (
            <div className="panel flex flex-col gap-3 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone="accent">
                  <span className="h-1.5 w-1.5 rounded-full bg-ink" /> Live · World Labs Marble
                </Chip>
                {plan.models.map((m) => (
                  <Chip key={m} mono>
                    {m}
                  </Chip>
                ))}
                <Chip mono tone="accent">
                  ~{fmtCredits(info.credits)} credits × {plan.liveRooms} room{plan.liveRooms === 1 ? '' : 's'} = ~{fmtCredits(plan.credits)} credits · ~$
                  {plan.usd.toFixed(2)}
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
            <Field label="Email me when it is ready" hint="Stored on the unit. Email delivery is not wired in this build; the browser notification and the in-app badge are.">
              <Input value={email} onChange={(e) => onEmail(e.target.value)} type="email" inputMode="email" placeholder="you@property.com" />
            </Field>
          </div>
        </section>
      </div>

      <aside className="flex flex-col gap-4 lg:sticky lg:top-20 lg:self-start">
        <div className="panel flex flex-col gap-4 p-4">
          <div>
            <div className="micro">Summary</div>
            <div className="display mt-1 text-2xl text-ink">{listing.title || listing.address || 'Untitled unit'}</div>
            {listing.title ? <div className="text-xs text-ink-3">{listing.address}</div> : null}
            <div className="mono mt-1 text-xs text-ink-2">
              {[listing.price, listing.beds && `${listing.beds} bd`, listing.baths && `${listing.baths} ba`, listing.sqft && `${listing.sqft} sqft`].filter(Boolean).join(' · ') || 'no unit details yet'}
            </div>
          </div>
          <ul className="flex flex-col gap-2">
            {rooms.map((r) => {
              const g = draftGeometry(r);
              const a = finalAnchor(r);
              const choice = modelForRoom(r, quality, tierModels);
              const sim = provider === 'marble' && simulatedOnly(r);
              return (
                <li key={r.id} className="flex gap-3 rounded-xl border border-line bg-surface p-2">
                  <div className="h-12 w-16 shrink-0 overflow-hidden rounded-lg border border-line bg-surface">
                    {r.photo ? <img src={r.photo.dataUrl} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-ink-3"><Icon.Ruler size={16} /></div>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm text-ink">{r.name}</span>
                      <span className="text-[11px] text-ink-3">{ROOM_TYPE_LABELS[r.type]}</span>
                      {sim ? <Chip mono className="!text-[10px]">simulated</Chip> : null}
                    </div>
                    <div className="mono text-xs text-ink-2">
                      {g.width.toFixed(2)} × {g.depth.toFixed(2)} × {g.height.toFixed(2)} m
                    </div>
                    {/* Which model this particular room goes to, and why, before a credit is spent. */}
                    {!sim ? (
                      <div className="mono text-[10.5px] text-ink-3" title={choice.text}>
                        {choice.model}
                        {choice.reason ? ` · ${choice.reason === 'open-plan' ? 'open plan' : 'large room'}` : ''}
                      </div>
                    ) : null}
                    <AnchorChip anchor={a} size="sm" className="mt-1 max-w-full" />
                  </div>
                </li>
              );
            })}
          </ul>
          {blocked.length ? (
            <Callout tone="danger" title={`${blocked.length} room${blocked.length === 1 ? '' : 's'} blocked on photo quality`}>
              {blocked.map((b) => b.name).join(', ')}. Go back to <strong className="font-medium text-ink-2">Rooms</strong> and retake the photo, or accept it there with “use
              anyway”.
            </Callout>
          ) : null}
          {unanchored.length ? (
            <Callout tone="warn">
              {unanchored.length} room{unanchored.length === 1 ? ' has' : 's have'} no anchor. Their numbers will be a ±30 cm guess until you anchor them from the hub.
            </Callout>
          ) : null}
          <Button variant="primary" size="lg" loading={launching} disabled={!rooms.length || !listing.address.trim() || blocked.length > 0} onClick={onLaunch} className="w-full">
            <Icon.Sparkles size={18} /> Generate {rooms.length} room{rooms.length === 1 ? '' : 's'}
          </Button>
          <div className="mono text-center text-[11px] text-ink-3">
            {provider === 'marble' ? `~${fmtCredits(plan.credits)} credits · ${eta(info.realSeconds)} per room` : `simulated · free · ~${mockSeconds}s per room`}
          </div>
        </div>
      </aside>
    </div>
  );
}
