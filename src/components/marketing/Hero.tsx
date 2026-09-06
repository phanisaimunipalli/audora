import { useMemo, type ReactNode } from 'react';
import { AnchorChip } from '@/components/AnchorChip';
import { Icon } from '@/components/icons';
import { StagedLabel, cx } from '@/components/ui';
import { CtaLink } from './Cta';
import { HERO_ROOM } from './demoRoom';
import { HeroScene } from './HeroScene';
import { findPlacement, parseBuyerText } from './placement';
import { Eyebrow } from './Section';

const HERO_PIECE = 'sectional, 220 by 95';

/** CSS-only rise so the hero paints before the WebGL context finishes compiling. */
function Rise({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <div className={cx('animate-rise', className)} style={{ animationDelay: `${delay}s` }}>
      {children}
    </div>
  );
}

export function Hero() {
  const room = HERO_ROOM;
  const buyer = useMemo(() => {
    const spec = parseBuyerText(HERO_PIECE);
    return spec ? findPlacement(spec, room.geometry, room.staging) : null;
  }, [room]);
  const g = room.geometry;

  const dims = (
    <div className="glass rounded-2xl px-3.5 py-2.5">
      <div className="text-[10px] uppercase tracking-[0.14em] text-ink-3">{room.name} · demo</div>
      <div className="mono mt-0.5 text-sm text-ink">
        {g.width.toFixed(2)} × {g.depth.toFixed(2)} m <span className="text-ink-3">·</span> ceiling {g.height.toFixed(2)} m
      </div>
      <div className="mono mt-0.5 text-[11px] text-ink-3">
        narrowest walkway {room.report.narrowestWalkway?.toFixed(2) ?? '—'} m · floor used {room.report.floorUsedPct}% · drag to turn
      </div>
    </div>
  );
  const verdict = buyer ? (
    <div className="glass rounded-2xl border-buyer/40 px-3.5 py-2.5 sm:max-w-xs">
      <div className="mono flex items-center gap-2 text-[11px] text-buyer">
        <span className="h-2 w-2 rounded-full bg-buyer" /> your {buyer.piece.name.toLowerCase()} · {Math.round(buyer.piece.w * 100)} × {Math.round(buyer.piece.d * 100)}
      </div>
      <div className="mt-1 text-sm font-medium text-ink">{buyer.verdict.headline}</div>
      <div className="text-xs text-ink-2">{buyer.verdict.detail}</div>
    </div>
  ) : null;

  return (
    <section className="relative overflow-hidden">
      <div className="grid-bg pointer-events-none absolute inset-0 opacity-70 [mask-image:radial-gradient(ellipse_at_70%_20%,black,transparent_70%)]" aria-hidden />
      <div className="pointer-events-none absolute -top-40 right-[-10%] h-[520px] w-[520px] rounded-full bg-accent/10 blur-3xl" aria-hidden />
      <div className="relative mx-auto max-w-7xl px-4 pb-16 pt-10 md:px-6 md:pb-24 md:pt-16">
        <div className="grid items-center gap-10 lg:grid-cols-12 lg:gap-10">
          <div className="lg:col-span-5">
            <Rise>
              <Eyebrow>Matterport, but AI-generated</Eyebrow>
            </Rise>
            <Rise delay={0.05}>
              <h1 className="display mt-5 text-[46px] leading-[0.98] text-ink sm:text-6xl md:text-7xl">
                One photo.
                <br />
                <span className="italic text-ink-2">A room you can walk.</span>
              </h1>
            </Rise>
            <Rise delay={0.1}>
              <p className="mt-6 max-w-lg text-[17px] leading-relaxed text-ink-2">
                Audora turns one photo of an empty room into a walkable, honestly measured space that a buyer can test their own furniture inside.
              </p>
            </Rise>
            <Rise delay={0.15}>
              <div className="mt-8 flex flex-wrap gap-3">
                <CtaLink to="/new">
                  Generate a tour <Icon.ArrowRight size={18} />
                </CtaLink>
                <CtaLink to="/t/oak1247" variant="secondary">
                  <Icon.Walk size={18} /> Walk the demo
                </CtaLink>
              </div>
            </Rise>
            <Rise delay={0.2}>
              <dl className="mt-10 grid max-w-md grid-cols-3 gap-4 border-t border-line pt-6">
                {[
                  ['Draft', '≈ 1 min'],
                  ['Full quality', '≈ 10 min'],
                  ['Cost to make', '$0.18'],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-[11px] uppercase tracking-[0.12em] text-ink-3">{k}</dt>
                    <dd className="mono mt-1 text-lg text-ink">{v}</dd>
                  </div>
                ))}
              </dl>
            </Rise>
          </div>

          <div className="lg:col-span-7">
            <Rise delay={0.1}>
              <div className="relative aspect-[4/5] overflow-hidden rounded-[26px] border border-line-2 bg-surface shadow-soft sm:aspect-[16/11]">
                <HeroScene room={g} staging={room.staging} buyerPieces={buyer ? [buyer.piece] : []} className="absolute inset-0" />
                <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-wrap items-start justify-between gap-2">
                  <span className="glass rounded-full"><StagedLabel /></span>
                  <span className="glass rounded-full"><AnchorChip anchor={room.anchor} size="sm" className="!bg-surface/80" /></span>
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
        </div>
      </div>
    </section>
  );
}
