import { useRef } from 'react';
import { Icon } from '@/components/icons';
import { RailArrow, useRail } from '@/components/Rail';
import { cx } from '@/components/ui';

export const WIZARD_STEPS = [
  { key: 'listing', label: 'Listing', blurb: 'Where is it' },
  { key: 'site', label: 'Site', blurb: 'Sun and compass' },
  { key: 'plan', label: 'Floor plan', blurb: 'Rooms and metres' },
  { key: 'rooms', label: 'Rooms', blurb: 'Photos per room' },
  { key: 'anchor', label: 'Anchor', blurb: 'One real measurement' },
  { key: 'launch', label: 'Launch', blurb: 'Generate' },
] as const;

export function Stepper({ step, done, furthest = step, onJump }: { step: number; done: boolean[]; furthest?: number; onJump: (i: number) => void }) {
  // Six steps do not fit a 390 px phone at full size: the row scrolls, fades at the live edge and
  // carries an arrow, rather than clipping "Rooms" mid-word with nothing to say there is more.
  const railRef = useRef<HTMLOListElement>(null);
  const rail = useRail(railRef);
  return (
    <div className="relative">
      <RailArrow dir={-1} show={rail.canLeft} onClick={() => rail.nudge(-1)} label="Earlier steps" className="-left-1" />
      <RailArrow dir={1} show={rail.canRight} onClick={() => rail.nudge(1)} label="Later steps" className="-right-1" />
      <ol
        ref={railRef}
        className={cx(
          'no-scrollbar -mx-1 flex w-full items-center gap-0.5 overflow-x-auto px-1 sm:gap-1',
          rail.canRight && '[mask-image:linear-gradient(to_right,black_calc(100%-28px),transparent)]',
        )}
      >
      {WIZARD_STEPS.map((s, i) => {
        const active = i === step;
        const complete = done[i] && i < step;
        /* A step you have already been through stays reachable, whether or not you answered it —
           two of the six are optional and say so, and gating on `done` alone left "Skip the site"
           disabling Anchor and Launch for the rest of the flow. `done` still drives the tick. */
        const reachable = i <= Math.max(step, furthest) || done.slice(0, i).every(Boolean);
        return (
          <li key={s.key} className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              disabled={!reachable}
              onClick={() => reachable && onJump(i)}
              className={cx(
                'flex items-center gap-2 rounded-xl px-2 py-2 text-left transition-colors disabled:cursor-not-allowed sm:gap-2.5 sm:px-3',
                /* `--faint` is for "not reported" and fine print, never for the only map of a
                   six-step flow: an un-reached step name measured 2.52:1 and read as invisible. */
                active ? 'bg-surface text-ink' : reachable ? 'text-ink-2 hover:bg-surface hover:text-ink' : 'text-dim',
              )}
            >
              <span
                className={cx(
                  'mono flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px]',
                  /* Wizard progress is not a fit verdict, so it is ink, not `--ok` green. */
                  active ? 'border-accent bg-accent text-white' : complete ? 'border-ink/25 bg-surface text-ink' : 'border-line-2 text-dim',
                )}
              >
                {complete ? <Icon.Check size={13} /> : i + 1}
              </span>
              <span className="flex flex-col leading-tight">
                <span className="text-[13px] font-medium whitespace-nowrap sm:text-sm">{s.label}</span>
                <span className="hidden text-[11px] text-dim sm:block">{s.blurb}</span>
              </span>
            </button>
            {i < WIZARD_STEPS.length - 1 ? <span className="mx-1 hidden h-px w-6 bg-line-2 md:block" /> : null}
          </li>
        );
        })}
      </ol>
    </div>
  );
}
