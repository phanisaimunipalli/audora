import { Icon } from '@/components/icons';
import { cx } from '@/components/ui';

export const WIZARD_STEPS = [
  { key: 'listing', label: 'Listing', blurb: 'Where is it' },
  { key: 'site', label: 'Site', blurb: 'Sun and compass' },
  { key: 'plan', label: 'Floor plan', blurb: 'Rooms and metres' },
  { key: 'rooms', label: 'Rooms', blurb: 'Photos per room' },
  { key: 'anchor', label: 'Anchor', blurb: 'One real measurement' },
  { key: 'launch', label: 'Launch', blurb: 'Generate' },
] as const;

export function Stepper({ step, done, onJump }: { step: number; done: boolean[]; onJump: (i: number) => void }) {
  return (
    // Six steps do not fit a 390 px phone at full size: the row scrolls, fades at the edge, and the
    // labels tighten rather than pushing the last step off with no way to reach it.
    <ol className="no-scrollbar -mx-1 flex w-full items-center gap-0.5 overflow-x-auto px-1 sm:gap-1 [mask-image:linear-gradient(to_right,black_calc(100%-20px),transparent)] sm:[mask-image:none]">
      {WIZARD_STEPS.map((s, i) => {
        const active = i === step;
        const complete = done[i] && i < step;
        const reachable = i <= step || done.slice(0, i).every(Boolean);
        return (
          <li key={s.key} className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              disabled={!reachable}
              onClick={() => reachable && onJump(i)}
              className={cx(
                'flex items-center gap-2 rounded-xl px-2 py-2 text-left transition-colors disabled:cursor-not-allowed sm:gap-2.5 sm:px-3',
                active ? 'bg-surface-2 text-ink' : reachable ? 'text-ink-2 hover:bg-surface-2 hover:text-ink' : 'text-ink-3',
              )}
            >
              <span
                className={cx(
                  'mono flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px]',
                  active ? 'border-accent bg-accent text-[#1a0f0a]' : complete ? 'border-ok/50 bg-ok/15 text-ok' : 'border-line-2 text-ink-3',
                )}
              >
                {complete ? <Icon.Check size={13} /> : i + 1}
              </span>
              <span className="flex flex-col leading-tight">
                <span className="text-[13px] font-medium whitespace-nowrap sm:text-sm">{s.label}</span>
                <span className="hidden text-[11px] text-ink-3 sm:block">{s.blurb}</span>
              </span>
            </button>
            {i < WIZARD_STEPS.length - 1 ? <span className="mx-1 hidden h-px w-6 bg-line-2 md:block" /> : null}
          </li>
        );
      })}
    </ol>
  );
}
