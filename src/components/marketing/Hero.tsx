import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AnchorChip } from '@/components/AnchorChip';
import { Icon } from '@/components/icons';
import { cx } from '@/components/ui';
import { HERO_ROOM } from './demoRoom';
import { HeroScene } from './HeroScene';
import { Eyebrow } from './Section';
import { SourceLabel } from './SourceLabel';
import { Sky } from './Sky';

/** CSS-only rise so the hero paints before the WebGL context finishes compiling. */
function Rise({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <div className={cx('animate-rise', className)} style={{ animationDelay: `${delay}s` }}>
      {children}
    </div>
  );
}

/**
 * The hero, after the deployed prototype: a centred column over slowly drifting room cards, with the
 * upload card as the only loud thing on the page. The dropzone opens the create flow — the wizard
 * takes the photos, so nothing is lost by handing the file picker over one screen later.
 *
 * The live room under it is the BARE unit: no furniture, its own measurements, its anchor chip.
 * Staging is deferred (docs/COPY.md), and the thing being sold is the room, at its real size.
 */
export function Hero() {
  const room = HERO_ROOM;
  const g = room.geometry;

  const dims = (
    <div className="glass rounded-xl px-3.5 py-2.5">
      <div className="micro">{room.name} · demo unit</div>
      <div className="mono mt-1 text-sm text-ink">{(g.width * g.depth).toFixed(1)} m² of floor</div>
      <div className="mono mt-0.5 text-[11px] text-dim">the bare unit · no furniture · drag to turn</div>
    </div>
  );
  const callouts = (
    <div className="glass rounded-xl px-3.5 py-2.5 sm:max-w-[15rem]">
      <div className="micro">What the model measures</div>
      <dl className="mono mt-1.5 flex flex-col gap-1 text-[12px]">
        {[
          ['width', g.width],
          ['depth', g.depth],
          ['ceiling', g.height],
        ].map(([label, value]) => (
          <div key={label as string} className="flex items-baseline justify-between gap-3">
            <dt className="text-dim">{label}</dt>
            <dd className="text-ink">{(value as number).toFixed(2)} m</dd>
          </div>
        ))}
      </dl>
    </div>
  );

  return (
    <section className="relative isolate overflow-hidden px-5 pb-16 md:pb-24">
      <Sky />

      <div className="relative z-10 mx-auto w-full max-w-[680px] pt-[clamp(28px,9vh,104px)] text-center">
        <Rise>
          {/* The one micro-label the whole page is measured against: `.micro`, like every other. */}
          <Eyebrow>For rental units, from the photos you already have</Eyebrow>
        </Rise>
        <Rise delay={0.05}>
          <h1 className="display mt-6 text-[clamp(40px,6.2vw,76px)] leading-[1.04] text-balance text-ink">Your photos and floor plan. A unit you can walk.</h1>
        </Rise>
        <Rise delay={0.1}>
          <p className="mx-auto mt-4 max-w-[46ch] text-[16px] leading-[1.62] text-dim">
            Audora turns a unit’s real photos and its floor plan into an accurate 3D model a renter can walk, measure and trust before they visit.
          </p>
        </Rise>

        <Rise delay={0.15}>
          <div className="mt-9 rounded-[14px] border border-line bg-bg p-4 text-center shadow-soft">
            <Link
              to="/new"
              className="ease-audora flex flex-col items-center gap-1.5 rounded-[10px] border border-dashed border-line-2 bg-surface px-5 pt-11 pb-10 transition-colors duration-200 hover:border-ink-2 hover:bg-surface-2"
            >
              <span className="mb-1.5 grid h-[52px] w-[52px] place-items-center rounded-full bg-bg text-ink shadow-sm">
                <Icon.Upload size={24} />
              </span>
              <span className="text-[15.5px] font-semibold text-ink">Add photos of the unit</span>
              <span className="text-[12.5px] text-dim">Two to four angles of each room work best</span>
            </Link>
            <Link to="/new" className="ease-audora mt-3 inline-flex items-center gap-2 px-1 py-1.5 text-[13px] font-medium text-dim transition-colors hover:text-ink hover:underline hover:underline-offset-[3px]">
              <Icon.Ruler size={16} /> Add the floor plan, with dimensions if it has them
            </Link>
            <p className="mt-2 text-[11.5px] text-dim">Draft first, always. Full quality only when you say so.</p>
          </div>
        </Rise>

        <Rise delay={0.2}>
          <Link
            to="/t/oak1247"
            className="ease-audora mt-6 inline-flex h-11 items-center gap-2 rounded-full border border-line-2 bg-bg px-5 text-[13px] font-semibold text-dim transition-colors duration-200 hover:border-ink-2 hover:text-ink"
          >
            <Icon.Walk size={16} /> Walk the demo →
          </Link>
        </Rise>

        <Rise delay={0.25}>
          <dl className="mx-auto mt-10 grid max-w-xs grid-cols-2 gap-4 border-t border-line pt-6 text-left">
            {[
              ['Draft', '≈ 1 min'],
              ['Full quality', '≈ 10 min'],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="micro">{k}</dt>
                <dd className="mono mt-1 text-lg text-ink">{v}</dd>
              </div>
            ))}
          </dl>
        </Rise>
      </div>

      {/* The unit itself, live: the same engine, the same anchor chip a renter sees inside the model. */}
      <div className="relative z-10 mx-auto mt-16 w-full max-w-6xl md:mt-24">
        <Rise delay={0.1}>
          <div className="mono mb-4 text-[11px] text-dim">every number below is the engine’s own output</div>
          <div className="relative aspect-[4/5] overflow-hidden rounded-[18px] border border-line bg-surface shadow-soft sm:aspect-[16/11]">
            <HeroScene room={g} staging={[]} className="absolute inset-0" />
            <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-wrap items-start justify-between gap-2">
              <SourceLabel className="!bg-glass backdrop-blur-[10px]" />
              <AnchorChip anchor={room.anchor} size="sm" className="!bg-glass backdrop-blur-[10px]" />
            </div>
            <div className="pointer-events-none absolute inset-x-3 bottom-3 hidden items-end justify-between gap-2 sm:flex">
              {dims}
              {callouts}
            </div>
          </div>
          <div className="mt-3 grid gap-2 sm:hidden">
            {dims}
            {callouts}
          </div>
        </Rise>
      </div>
    </section>
  );
}
