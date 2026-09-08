import type { ReactNode } from 'react';
import { Icon } from '@/components/icons';
import { Progress, SectionTitle, cx } from '@/components/ui';
import { Reveal } from './Reveal';
import { Section } from './Section';
import { SourceLabel } from './SourceLabel';

interface Step {
  n: string;
  title: string;
  body: string;
  meta: string;
  icon: ReactNode;
}

const STEPS: Step[] = [
  {
    n: '01',
    title: 'Upload the unit’s photos and floor plan',
    body: 'The make-ready photos you already take, two to four angles per room, plus the floor plan from the listing. Empty rooms are the best input there is, and we say so when a shot is too dark or too busy.',
    meta: '2–4 angles per room',
    icon: <Icon.Upload />,
  },
  {
    n: '02',
    title: 'Confirm the scale anchor and the plan’s dimensions',
    body: 'Tap the top and bottom of a door, or type a wall length. Then confirm what the plan prints for each room. Those two are what turn a reconstruction into a unit with a size, and every number keeps the ± they imply.',
    meta: '2.03 m · ±4 cm',
    icon: <Icon.Door />,
  },
  {
    n: '03',
    title: 'Walk it, measure it, put the link on the listing',
    body: 'A draft is walkable in about a minute, full quality in about ten. One link goes in the virtual-tour field of the feed the property already syndicates, and renters walk the unit at eye height before they book a showing.',
    meta: '/t/oak1247',
    icon: <Icon.Share />,
  },
];

function StepCard({ s, delay = 0 }: { s: Step; delay?: number }) {
  return (
    <Reveal delay={delay} className="h-full">
      <div className="flex h-full flex-col gap-4 border-t border-ink pt-4">
        <div className="flex items-center justify-between">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-line bg-bg text-ink shadow-sm">{s.icon}</span>
          <span className="mono text-xs text-faint">{s.n}</span>
        </div>
        <div>
          <div className="text-base font-semibold text-ink">{s.title}</div>
          <p className="mt-1.5 text-sm leading-[1.62] text-dim">{s.body}</p>
        </div>
        <div className="mono mt-auto text-xs text-dim">{s.meta}</div>
      </div>
    </Reveal>
  );
}

function Timeline() {
  const marks = [
    { at: '0:00', label: 'photos and plan' },
    { at: '0:20', label: 'anchor confirmed' },
    { at: '≈ 1:00', label: 'draft ready' },
    { at: '≈ 10:00', label: 'full quality ready' },
  ];
  return (
    <div className="mt-10 overflow-x-auto">
      <div className="relative min-w-[560px]">
        <div className="absolute left-0 right-0 top-[7px] h-px bg-line" />
        <div className="absolute left-0 top-[7px] h-px w-[38%] bg-accent" />
        <div className="grid grid-cols-4">
          {marks.map((m, i) => (
            <div key={m.at} className="relative pt-5">
              <span className={cx('absolute left-0 top-0 h-[15px] w-[15px] rounded-full border-2 bg-bg', i < 3 ? 'border-accent' : 'border-line-2')} />
              <div className="mono text-sm text-ink">{m.at}</div>
              <div className="text-xs text-dim">{m.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The deep-research moment: the job finished while you were somewhere else, and you were told. */
function NotificationMoment() {
  return (
    <div className="relative">
      <div className="panel overflow-hidden shadow-soft">
        <div className="flex items-center gap-2 border-b border-line bg-surface px-3 py-2">
          <div className="flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-line-2" />
            <span className="h-2.5 w-2.5 rounded-full bg-line-2" />
            <span className="h-2.5 w-2.5 rounded-full bg-line-2" />
          </div>
          <div className="ml-2 flex h-7 max-w-[260px] items-center gap-2 truncate rounded-full border border-line bg-bg px-2.5 text-xs text-ink-2">
            <span className="text-ink"><Icon.Logo size={12} /></span>
            <span className="mono text-ink">(1)</span>
            <span className="truncate">Audora — a unit you can walk</span>
          </div>
          <div className="ml-1 hidden h-7 items-center rounded-md px-2.5 text-xs text-ink-3 sm:flex">Inbox</div>
          <div className="hidden h-7 items-center rounded-md px-2.5 text-xs text-ink-3 sm:flex">Calendar</div>
        </div>
        <div className="flex flex-col gap-4 p-5">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-ink">1247 Oak Street, Unit 3 · generating</div>
            <span className="chip mono !text-[11px]">
              <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-accent" /> 2 of 4 running
            </span>
          </div>
          {[
            { name: 'Living room', step: 'Ready', pct: 100, eta: '9 min 42 s', done: true },
            { name: 'Primary bedroom', step: 'Painting surfaces and light', pct: 62, eta: 'about 4 minutes left' },
            { name: 'Second bedroom', step: 'Generating geometry', pct: 31, eta: 'about 7 minutes left' },
            { name: 'Dining room', step: 'Queued', pct: 0, eta: 'starts after the bedroom' },
          ].map((j) => (
            <div key={j.name} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-3 text-sm">
                <div className="flex items-center gap-2 text-ink">
                  {j.done ? <Icon.Check size={14} className="text-ink" /> : <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
                  {j.name}
                </div>
                <div className="mono text-xs text-dim">
                  {j.step} · {j.pct}%
                </div>
              </div>
              <Progress value={j.pct} tone={j.done ? 'ok' : 'accent'} />
              <div className="mono text-[11px] text-faint">{j.eta}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="glass animate-rise mt-3 flex w-full items-start gap-3 rounded-2xl p-4 sm:absolute sm:-bottom-6 sm:-right-4 sm:mt-0 sm:w-[min(340px,calc(100%-1.5rem))]">
        <div className="mt-0.5 shrink-0 text-ink"><Icon.Check /></div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-ink">Living room is ready</div>
          <div className="mono mt-0.5 text-xs text-dim">Full quality · 9 min 42 s · door anchor ±4 cm</div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-ink">
              Walk it <Icon.ArrowRight size={14} />
            </span>
            <SourceLabel />
          </div>
        </div>
      </div>
    </div>
  );
}

export function HowItWorks() {
  return (
    <Section id="how">
      <Reveal>
        <SectionTitle
          eyebrow="How it works"
          title="Three steps, from a folder of photos to a link in the feed."
          body="Generation takes minutes, not seconds, and the product is honest about that. The job starts instantly, shows real progress, and finds you when it is done."
        />
      </Reveal>
      <Reveal delay={0.05}>
        <Timeline />
      </Reveal>

      <div className="mt-12 grid gap-6 md:grid-cols-3 md:gap-4">
        {STEPS.map((s, i) => (
          <StepCard key={s.n} s={s} delay={i * 0.05} />
        ))}
      </div>

      <div className="mt-20 grid items-center gap-12 lg:grid-cols-12 lg:gap-10">
        <div className="lg:col-span-5">
          <Reveal>
            <div className="micro">The notification moment</div>
            <h3 className="display mt-3 text-3xl leading-tight text-ink md:text-4xl">Start it, leave, we tell you when it is ready.</h3>
            <p className="mt-5 text-[15px] leading-relaxed text-ink-2">
              Reconstruction is slow the way research is slow, so the product behaves like a research tool. The job starts the moment you tap Generate, shows honest progress, survives a reload, and keeps running when you close the tab. When a room finishes you get a browser notification, a toast in the app, and a badge on the tab title.
            </p>
            <ul className="mt-5 space-y-2 text-sm text-ink-2">
              {[
                'Draft in about a minute: good enough to check the anchor and the plan.',
                'Full quality in about ten: the model a renter walks.',
                'Jobs are persisted. Come back tomorrow and the unit is waiting.',
              ].map((t) => (
                <li key={t} className="flex gap-2.5">
                  <Icon.Check size={16} className="mt-0.5 shrink-0 text-ink-2" /> {t}
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
        <div className="lg:col-span-7">
          <Reveal delay={0.1} y={24}>
            <NotificationMoment />
          </Reveal>
        </div>
      </div>
    </Section>
  );
}
