import { Icon } from '@/components/icons';
import { cx } from '@/components/ui';
import { HERO_MEASURED, HERO_PLAN, HERO_ROOM } from './demoRoom';
import { Reveal } from './Reveal';
import { RoomPlan } from './RoomPlan';
import { Eyebrow, Section } from './Section';

const POINTS: { title: string; body: string; icon: React.ReactNode }[] = [
  {
    title: 'The plan is the source of truth',
    body: 'Width, depth and orientation come from the drawing, not from the reconstruction. A photo can be taken from anywhere; the plan was drawn to a scale.',
    icon: <Icon.Ruler />,
  },
  {
    title: 'The model is checked against it',
    body: 'Every room is measured off its own collider and compared with what the plan printed. Agreement is the product; disagreement is a flag on the room, not a number quietly rounded away.',
    icon: <Icon.Check />,
  },
  {
    title: 'Doors put the rooms in order',
    body: 'The plan says which door leads where, so the rooms are laid out the way the unit is laid out and a renter walks from the hall into the bedroom, not into a list.',
    icon: <Icon.Door />,
  },
];

/**
 * "Layout with dimensions": the same top-down plan the app draws, with the room bare — the drawing
 * is the constraint the reconstruction is measured against (docs/ACCURACY.md section 2).
 */
export function LayoutPlan() {
  /* The drawing is the drawing: this plan is rendered at the dimensions the plan PRINTS, not at the
     reconstruction's own, so the labels on it and the "plan says" numbers under it are one number. */
  const plan = { ...HERO_ROOM.geometry, width: HERO_PLAN.width, depth: HERO_PLAN.depth };
  const width = HERO_MEASURED.lines.find((l) => l.dimension === 'width');
  const depth = HERO_MEASURED.lines.find((l) => l.dimension === 'depth');
  return (
    <Section id="layout">
      <div className="grid gap-12 lg:grid-cols-12 lg:gap-10">
        <div className="lg:col-span-5">
          <Reveal>
            <Eyebrow>Layout with dimensions</Eyebrow>
            <h2 className="display mt-4 text-4xl leading-[1.02] text-ink md:text-5xl">The floor plan is the constraint.</h2>
            <p className="mt-6 text-[15px] leading-relaxed text-ink-2">
              A reconstruction from photographs is a good likeness with no opinion about how big it is. The floor plan has one: it prints the dimensions, it says which wall faces north, and it says which door opens into which room. Audora treats it as the truth and reports how far the model is from it.
            </p>
          </Reveal>
          <div className="mt-8 flex flex-col gap-3">
            {POINTS.map((p, i) => (
              <Reveal key={p.title} delay={0.06 * i}>
                <div className="flex gap-4 rounded-2xl border border-line bg-surface p-4">
                  <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-bg text-ink shadow-sm">{p.icon}</span>
                  <div>
                    <div className="text-sm font-medium text-ink">{p.title}</div>
                    <p className="mt-1 text-sm leading-relaxed text-ink-2">{p.body}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>

        <div className="lg:col-span-7">
          <Reveal delay={0.1} y={24}>
            <div className="panel overflow-hidden shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
                <div>
                  <div className="text-sm font-medium text-ink">{HERO_ROOM.name} · demo unit</div>
                  <div className="mono text-[11px] text-ink-3">plan {HERO_PLAN.width.toFixed(2)} × {HERO_PLAN.depth.toFixed(2)} m · north arrow from the drawing</div>
                </div>
                <span className="chip mono !text-[11px]">bare room</span>
              </div>
              <div className="bg-bg p-5 md:p-8">
                <RoomPlan room={plan} staging={[]} className="mx-auto max-h-[460px]" />
              </div>
              <div className="grid gap-px border-t border-line bg-line sm:grid-cols-2">
                {[width, depth].map((l) =>
                  l ? (
                    <div key={l.dimension} className="bg-bg px-5 py-4">
                      <div className="micro capitalize">{l.dimension}</div>
                      <div className="mono mt-1.5 text-sm text-ink">
                        plan {l.expected?.toFixed(2)} m <span className="text-faint">·</span> model {l.measured.toFixed(2)} m
                      </div>
                      <div className={cx('mono mt-0.5 text-[11px]', Math.abs(l.delta ?? 0) > 0.15 ? 'text-warn' : 'text-dim')}>
                        {(l.delta ?? 0) >= 0 ? '+' : '−'}
                        {Math.abs(l.delta ?? 0).toFixed(2)} m · {(((Math.abs(l.delta ?? 0) / (l.expected || 1)) * 100) || 0).toFixed(1)} % off the drawing
                      </div>
                    </div>
                  ) : null,
                )}
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </Section>
  );
}
