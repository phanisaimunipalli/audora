import { useMemo, useState, type FormEvent } from 'react';
import { AnchorChip } from '@/components/AnchorChip';
import { Icon } from '@/components/icons';
import { Input, SectionTitle, Segmented, StagedLabel, Toggle, cx } from '@/components/ui';
import { DEMO_ROOMS } from './demoRoom';
import { cmDims, findPlacement, nearestGap, parseBuyerText } from './placement';
import { Reveal } from './Reveal';
import { RoomPlan } from './RoomPlan';
import { Section } from './Section';

const PRESETS = ['sectional, 220 by 95', 'queen bed 160 x 210', 'dining table 200 by 190', 'bookshelf 80 x 30 x 200', 'L-sectional 280 by 200'];

/** Type a piece, get the product's verdict. Pure engine; the plan is SVG. */
export function FurniturePlayground() {
  const [text, setText] = useState(PRESETS[0]);
  const [roomId, setRoomId] = useState(DEMO_ROOMS[0].id);
  const [staged, setStaged] = useState(true);
  const room = DEMO_ROOMS.find((r) => r.id === roomId) ?? DEMO_ROOMS[0];

  const result = useMemo(() => {
    const spec = parseBuyerText(text);
    if (!spec) return null;
    const staging = staged ? room.staging : [];
    const placement = findPlacement(spec, room.geometry, staging);
    const gap = placement.verdict.fits ? nearestGap(placement.piece, staging, room.geometry) : null;
    return { spec, ...placement, gap };
  }, [text, room, staged]);

  const submit = (e: FormEvent) => e.preventDefault();

  return (
    <Section id="try">
      <Reveal>
        <SectionTitle eyebrow="Try it" title="Test your own furniture." body="Type a piece the way you would say it. The same engine that answers inside every tour answers here, against the demo room’s real staging." />
      </Reveal>
      <div className="mt-10 grid gap-8 lg:grid-cols-12 lg:gap-10">
        <div className="flex flex-col gap-5 lg:col-span-5">
          <Reveal delay={0.05}>
            <form onSubmit={submit} className="flex flex-col gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-ink-2">Your piece</span>
                <div className="relative">
                  <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="sectional, 220 by 95" aria-label="Describe your furniture" className="h-12 pl-11 text-[15px]" />
                  <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-buyer">
                    <Icon.Sofa size={18} />
                  </span>
                </div>
                <span className="text-xs text-ink-3">Width by depth, in cm or m. Height is optional.</span>
              </label>
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((p) => (
                  <button key={p} type="button" onClick={() => setText(p)} className={cx('chip mono transition-colors hover:border-buyer-line hover:text-ink', text === p && 'border-buyer-line bg-buyer-soft text-buyer')}>
                    {p}
                  </button>
                ))}
              </div>
            </form>
          </Reveal>
          <Reveal delay={0.1}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Segmented size="sm" value={room.id} onChange={setRoomId} options={DEMO_ROOMS.map((r) => ({ value: r.id, label: r.name }))} />
              <Toggle checked={staged} onChange={setStaged} label="Against the staging" />
            </div>
          </Reveal>
          <Reveal delay={0.15}>
            {result ? (
              <div className={cx('rounded-2xl border p-5', result.verdict.fits ? 'border-buyer-line bg-buyer-soft' : 'border-danger/40 bg-danger-soft')} aria-live="polite">
                <div className="mono flex items-center gap-2 text-[11px] text-buyer">
                  <span className="h-2 w-2 rounded-full bg-buyer" /> your {result.piece.name.toLowerCase()} · {cmDims(result.piece.w, result.piece.d)}
                  {result.piece.h > 0.05 && !result.piece.flat ? <span className="text-ink-3">· {Math.round(result.piece.h * 100)} tall</span> : null}
                </div>
                <div className={cx('display mt-2 text-2xl md:text-3xl', result.verdict.fits ? 'text-ink' : 'text-danger')}>{result.verdict.headline}</div>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{result.verdict.detail}</p>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-line-2 p-5 text-sm text-ink-3">Give me two numbers: width and depth. “armchair 85 by 90”, “rug 2.4 x 1.7”, “desk 140cm x 70cm”.</div>
            )}
          </Reveal>
          <Reveal delay={0.2}>
            <div className="flex flex-wrap items-center gap-2">
              <AnchorChip anchor={room.anchor} size="sm" />
              <StagedLabel />
              <span className="mono text-[11px] text-ink-3">
                {room.name} · {room.geometry.width.toFixed(2)} × {room.geometry.depth.toFixed(2)} m
              </span>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-ink-3">In a tour you drop the piece where you want it and drag it around; the verdict updates as you move. Here it is placed automatically where it has the most room. My Stuff keeps what you typed for the next listing.</p>
          </Reveal>
        </div>
        <div className="lg:col-span-7">
          <Reveal delay={0.1} y={24}>
            <div className="panel p-4 md:p-6">
              <div className="mx-auto max-w-[560px]">
                <RoomPlan room={room.geometry} staging={room.staging} showSeller={staged} buyer={result?.piece} gap={result?.gap} fits={result?.verdict.fits ?? true} />
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-4 text-xs text-ink-3">
                <span className="inline-flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-sm bg-[#8d7b6a]" /> seller staging
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-sm bg-buyer" /> your piece
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="h-px w-4 border-t border-dashed border-accent" /> nearest walkway
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="h-2.5 w-4 border-b-2 border-buyer-line" /> window
                </span>
                <span className="mono ml-auto">top-down · north up</span>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </Section>
  );
}
