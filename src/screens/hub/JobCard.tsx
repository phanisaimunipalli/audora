/**
 * One room's generation, deep-research style: the pipeline steps with ticks, a live elapsed
 * timer, the ETA, the provider/model/tier and what it costs. Finished rooms can be walked at once.
 */
import { JOB_STEPS } from '@/state/jobs';
import { bestWorld, useAudora } from '@/state/store';
import type { Job, Room, Tier } from '@/state/types';
import { clock, eta, usd as fmtUsd } from '@/lib/format';
import { AnchorChip } from '@/components/AnchorChip';
import { Button, Callout, Chip, Progress, Spinner, cx } from '@/components/ui';
import { Icon } from '@/components/icons';
import { FloorPlanSvg } from './FloorPlanSvg';
import { jobCost, jobElapsed, jobRemaining, modelName, providerName, stepDetail } from './jobMeta';
import { TierChip } from './TierChip';

export function JobCard({ room, job, now, onPeek, onGenerate }: { room: Room; job?: Job; now: number; onPeek?: (roomId: string) => void; onGenerate?: (room: Room, tier: Tier) => void }) {
  const providers = useAudora((s) => s.providers);
  const world = bestWorld(room);
  const status = job?.status ?? (room.status === 'ready' ? 'done' : room.status === 'failed' ? 'failed' : 'none');
  const progress = status === 'done' ? 100 : job?.progress ?? 0;
  const running = status === 'running';
  const elapsed = job ? jobElapsed(job, now) : world?.seconds ?? 0;
  const remaining = job ? jobRemaining(job, now) : 0;
  const cost = job ? jobCost(job, world) : world ? { credits: world.credits ?? 0, usd: world.usd ?? 0, estimate: false, free: world.provider === 'mock' } : undefined;
  const provider = job?.provider ?? world?.provider ?? 'mock';
  const tier = job?.tier ?? world?.tier ?? 'draft';
  const model = world && world.tier === tier && world.provider === provider ? world.model : modelName(provider, tier, providers);
  const currentIdx = JOB_STEPS.reduce((acc, s, i) => (progress >= s.at ? i : acc), 0);
  /** This job is making an existing room better, not building its first world. */
  const upgrade = Boolean(job && (job.status === 'queued' || job.status === 'running') && job.tier === 'full' && (job.upgrade || room.draft));

  return (
    <div className={cx('panel animate-rise flex flex-col gap-4 p-4', running && 'ring-accent')}>
      <div className="flex items-start gap-3">
        <div className="h-16 w-20 shrink-0 overflow-hidden rounded-xl border border-line bg-bg-2">
          {room.photo ? <img src={room.photo.dataUrl} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center p-1"><FloorPlanSvg geometry={room.geometry} showDims={false} className="max-h-full" /></div>}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-base text-ink">{room.name}</span>
            <Chip mono className="!text-[10px] uppercase">{tier}</Chip>
            <TierChip room={room} generating={status === 'queued' || status === 'running'} />
            <Chip mono tone={provider === 'marble' ? 'ok' : 'neutral'} className="!text-[10px]">
              {providerName(provider)} · {model}
            </Chip>
          </div>
          <div className="mt-1 text-xs text-ink-3">
            {status === 'queued' ? 'Queued · starts in a moment' : status === 'running' ? `${job?.step} · ${remaining > 0 ? `${eta(remaining)} left` : 'any moment now'}` : status === 'done' ? `Ready in ${clock(elapsed)}` : status === 'failed' ? 'Failed' : 'Not generated yet'}
          </div>
          {upgrade ? (
            <div className="mt-1 text-xs text-accent-2">Upgrading to full quality · buyers keep walking the draft until it lands.</div>
          ) : null}
        </div>
        <div className="shrink-0 text-right">
          <div className={cx('mono text-2xl leading-none', running ? 'text-ink' : 'text-ink-3')}>{clock(elapsed)}</div>
          <div className="mono mt-1 text-[11px] text-ink-3">{status === 'running' || status === 'queued' ? `eta ${clock(job?.etaSeconds ?? 0)}` : 'elapsed'}</div>
        </div>
      </div>

      <Progress value={progress} tone={status === 'done' ? 'ok' : 'accent'} />

      {status !== 'none' ? (
        <ol className="flex flex-col gap-1.5">
          {JOB_STEPS.map((s, i) => {
            const done = status === 'done' || i < currentIdx;
            const current = status === 'running' && i === currentIdx;
            const detail = stepDetail(s.label, room);
            return (
              <li key={s.label} className={cx('flex items-center gap-2.5 text-sm', done ? 'text-ink-2' : current ? 'text-ink' : 'text-ink-3/70')}>
                <span className={cx('flex h-5 w-5 shrink-0 items-center justify-center rounded-full border', done ? 'border-ok/50 bg-ok/15 text-ok' : current ? 'border-accent/60 text-accent-2' : 'border-line-2')}>
                  {done ? <Icon.Check size={12} /> : current ? <Spinner size={11} /> : <span className="h-1 w-1 rounded-full bg-line-2" />}
                </span>
                <span>{s.label}</span>
                {detail && (done || current) ? <span className="mono truncate text-xs text-ink-3">· {detail}</span> : null}
              </li>
            );
          })}
        </ol>
      ) : null}

      {status === 'failed' ? (
        <Callout tone="danger" title="Generation failed">
          {job?.error || 'The reconstruction did not come back.'}
        </Callout>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
        <div className="mono text-xs text-ink-3">
          {cost ? (cost.free ? `simulated · free (would be ~${cost.credits} credits)` : `${cost.estimate ? '~' : ''}${cost.credits} credits · ${fmtUsd(cost.usd)}`) : 'no cost yet'}
        </div>
        <div className="flex items-center gap-2">
          {status === 'done' && onPeek ? (
            <Button size="sm" variant="primary" onClick={() => onPeek(room.id)}>
              <Icon.Walk size={14} /> Walk it now
            </Button>
          ) : null}
          {(status === 'failed' || status === 'none') && onGenerate ? (
            <Button size="sm" variant="secondary" onClick={() => onGenerate(room, tier)}>
              <Icon.Rotate size={14} /> {status === 'failed' ? 'Retry' : 'Generate'}
            </Button>
          ) : null}
        </div>
      </div>
      <div className="-mt-2">
        <AnchorChip anchor={room.anchor} size="sm" />
      </div>
    </div>
  );
}
