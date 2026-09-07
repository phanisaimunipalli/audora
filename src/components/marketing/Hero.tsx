import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AnchorChip } from '@/components/AnchorChip';
import { Icon } from '@/components/icons';
import { StagedLabel, cx } from '@/components/ui';
import { HERO_ROOM } from './demoRoom';
import { HeroScene } from './HeroScene';
import { findPlacement, parseBuyerText } from './placement';
import { Eyebrow } from './Section';
import { Sky } from './Sky';

const HERO_PIECE = 'sectional, 220 by 95';

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
 */
export function Hero() {
  const room = HERO_ROOM;
  const buyer = useMemo(() => {
    const spec = parseBuyerText(HERO_PIECE);
    return spec ? findPlacement(spec, room.geometry, room.staging) : null;
  }, [room]);
  const g = room.geometry;

  const dims = (
    <div className="glass rounded-xl px-3.5 py-2.5">
      <div className="micro">{room.name} · demo</div>
      <div className="mono mt-1 text-sm text-ink">
        {g.width.toFixed(2)} × {g.depth.toFixed(2)} m <span className="text-faint">·</span> ceiling {g.height.toFixed(2)} m
      </div>
      <div className="mono mt-0.5 text-[11px] text-dim">
        narrowest walkway {room.report.narrowestWalkway?.toFixed(2) ?? '—'} m · floor used {room.report.floorUsedPct}% · drag to turn
      </div>
    </div>
  );
  const verdict = buyer ? (
    <div className="glass rounded-xl border-buyer-line px-3.5 py-2.5 sm:max-w-xs">
      <div className="mono flex items-center gap-2 text-[11px] text-buyer">
        <span className="h-2 w-2 rounded-full bg-buyer" /> your {buyer.piece.name.toLowerCase()} · {Math.round(buyer.piece.w * 100)} × {Math.round(buyer.piece.d * 100)}
      </div>
      <div className="mt-1 text-sm font-semibold text-ink">{buyer.verdict.headline}</div>
      <div className="text-xs text-ink-2">{buyer.verdict.detail}</div>
    </div>
  ) : null;

  return (
    <section className="relative isolate overflow-hidden px-5 pb-16 md:pb-24">
      <Sky />

      <div className="relative z-10 mx-auto w-full max-w-[680px] pt-[clamp(28px,9vh,104px)] text-center">
        <Rise>
          {/* The one micro-label the whole page is measured against: `.micro`, like every other. */}
          <Eyebrow>Live it before buying or selling</Eyebrow>
        </Rise>
        <Rise delay={0.05}>
          <h1 className="display mt-6 text-[clamp(40px,6.2vw,76px)] leading-[1.04] text-balance text-ink">One photo. A room you can walk.</h1>
        </Rise>
        <Rise delay={0.1}>
          <p className="mx-auto mt-4 max-w-[46ch] text-[16px] leading-[1.62] text-dim">
            Audora turns one photo of an empty room into a walkable, honestly measured space that a buyer can test their own furniture inside.
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
              <span className="text-[15.5px] font-semibold text-ink">Add photos of the room</span>
              <span className="text-[12.5px] text-dim">One works. Several from different angles works better.</span>
            </Link>
            <Link to="/new" className="ease-audora mt-3 inline-flex items-center gap-2 px-1 py-1.5 text-[13px] font-medium text-dim transition-colors hover:text-ink hover:underline hover:underline-offset-[3px]">
              <Icon.Camera size={16} /> Use the camera instead
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
          <dl className="mx-auto mt-10 grid max-w-md grid-cols-3 gap-4 border-t border-line pt-6 text-left">
            {[
              ['Draft', '≈ 1 min'],
              ['Full quality', '≈ 10 min'],
              ['Cost to make', '$0.18'],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="micro">{k}</dt>
                <dd className="mono mt-1 text-lg text-ink">{v}</dd>
              </div>
            ))}
          </dl>
        </Rise>
      </div>

      {/* The room itself, live: the same engine, the same anchor chip a buyer sees inside a tour. */}
      <div className="relative z-10 mx-auto mt-16 w-full max-w-6xl md:mt-24">
        <Rise delay={0.1}>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div className="micro">Photo to walkable 3D</div>
            <div className="mono text-[11px] text-dim">every number below is the engine’s own output</div>
          </div>
          <div className="relative aspect-[4/5] overflow-hidden rounded-[18px] border border-line bg-surface shadow-soft sm:aspect-[16/11]">
            <HeroScene room={g} staging={room.staging} buyerPieces={buyer ? [buyer.piece] : []} className="absolute inset-0" />
            <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-wrap items-start justify-between gap-2">
              <StagedLabel className="!bg-glass backdrop-blur-[10px]" />
              <AnchorChip anchor={room.anchor} size="sm" className="!bg-glass backdrop-blur-[10px]" />
            </div>
            <div className="pointer-events-none absolute inset-x-3 bottom-3 hidden items-end justify-between gap-2 sm:flex">
              {dims}
              {verdict}
            </div>
          </div>
          <div className="mt-3 grid gap-2 sm:hidden">
            {dims}
            {verdict}
          </div>
        </Rise>
      </div>
    </section>
  );
}
