import type { ReactNode } from 'react';
import { Icon } from '@/components/icons';
import { Progress, SectionTitle, StagedLabel, cx } from '@/components/ui';
import { Reveal } from './Reveal';
import { Section } from './Section';

interface Step {
  n: string;
  title: string;
  body: string;
  meta: string;
  icon: ReactNode;
}

const SELLER: Step[] = [
  { n: '01', title: 'Photo', body: 'Paste the listing URL or upload one photo per room. Empty rooms work best; we say so when a shot is too dark or too busy.', meta: '1 photo per room', icon: <Icon.Camera /> },
  { n: '02', title: 'Anchor', body: 'Tap the top and bottom of the door. That one reference scales the whole reconstruction, and the uncertainty is stated, not hidden.', meta: '2.03 m · ±4 cm', icon: <Icon.Door /> },
  { n: '03', title: 'Reconstruct', body: 'World Labs Marble builds the room from the photo. A draft appears in about a minute; full quality takes about ten. Start it and leave.', meta: '≈ 1 min · ≈ 10 min', icon: <Icon.Sparkles /> },
  { n: '04', title: 'Stage', body: 'Auto-staging places catalogue furniture and the fit engine validates every piece: nothing overlaps, blocks the door, or squeezes a walkway under 0.75 m.', meta: 'walkway ≥ 0.75 m', icon: <Icon.Sofa /> },
  { n: '05', title: 'Publish', body: 'One link. Buyers land standing in the room at 1.60 m eye height, no app, no account. Every frame says digitally staged.', meta: '/t/oak1247', icon: <Icon.Share /> },
];

const BUYER: Step[] = [
  { n: 'A', title: 'Walk it', body: 'Land in the doorway at 1.60 m. WASD or touch. Toggle the staging off to see it bare. Measure anything: two clicks, one number, with the anchor’s ±.', meta: 'eye height 1.60 m', icon: <Icon.Walk /> },
  { n: 'B', title: 'Test your furniture', body: 'Type it the way you would say it: "sectional, 220 by 95". It appears in blue and the engine says fits or does not, and by how much. My Stuff remembers it for the next listing.', meta: 'your pieces, in blue', icon: <Icon.Sofa /> },
  { n: 'C', title: 'Fit report to the agent', body: 'What was tested, in which room, and what failed goes back to the agent. The buyer’s question becomes the seller’s insight.', meta: '12 tested · 4 failed', icon: <Icon.Chart /> },
];

function StepCard({ s, tone = 'seller', delay = 0 }: { s: Step; tone?: 'seller' | 'buyer'; delay?: number }) {
  const buyer = tone === 'buyer';
  return (
    <Reveal delay={delay} className="h-full">
      <div className={cx('panel flex h-full flex-col gap-4 p-5', buyer && 'border-buyer/25')}>
        <div className="flex items-center justify-between">
          <span className={cx('inline-flex h-9 w-9 items-center justify-center rounded-xl border', buyer ? 'border-buyer/40 bg-buyer/10 text-buyer' : 'border-accent/40 bg-accent/10 text-accent-2')}>{s.icon}</span>
          <span className="mono text-xs text-ink-3">{s.n}</span>
        </div>
        <div>
          <div className="text-base font-medium text-ink">{s.title}</div>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{s.body}</p>
        </div>
        <div className={cx('mono mt-auto text-xs', buyer ? 'text-buyer' : 'text-accent-2')}>{s.meta}</div>
      </div>
    </Reveal>
  );
}

function Timeline() {
  const marks = [
    { at: '0:00', label: 'photo' },
    { at: '0:20', label: 'anchor' },
    { at: '≈ 1:00', label: 'draft ready' },
    { at: '≈ 10:00', label: 'full quality ready' },
  ];
  return (
    <div className="mt-10 overflow-x-auto">
      <div className="relative min-w-[560px]">
        <div className="absolute left-0 right-0 top-[7px] h-px bg-line-2" />
        <div className="absolute left-0 top-[7px] h-px w-[38%] bg-accent" />
        <div className="grid grid-cols-4">
          {marks.map((m, i) => (
            <div key={m.at} className="relative pt-5">
              <span className={cx('absolute left-0 top-0 h-[15px] w-[15px] rounded-full border-2 bg-bg', i < 3 ? 'border-accent' : 'border-line-2')} />
              <div className="mono text-sm text-ink">{m.at}</div>
              <div className="text-xs text-ink-3">{m.label}</div>
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
      <div className="panel overflow-hidden">
        <div className="flex items-center gap-2 border-b border-line bg-bg-2 px-3 py-2">
          <div className="flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-line-2" />
            <span className="h-2.5 w-2.5 rounded-full bg-line-2" />
            <span className="h-2.5 w-2.5 rounded-full bg-line-2" />
          </div>
          <div className="ml-2 flex h-7 max-w-[260px] items-center gap-2 truncate rounded-md bg-surface-2 px-2.5 text-xs text-ink-2">
            <span className="text-accent"><Icon.Logo size={12} /></span>
            <span className="mono text-accent-2">(1)</span>
            <span className="truncate">Audora — one photo, a room you can walk</span>
          </div>
          <div className="ml-1 hidden h-7 items-center rounded-md px-2.5 text-xs text-ink-3 sm:flex">Inbox</div>
          <div className="hidden h-7 items-center rounded-md px-2.5 text-xs text-ink-3 sm:flex">Calendar</div>
        </div>
        <div className="flex flex-col gap-4 p-5">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-ink">1247 Oak Street · generating</div>
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
                  {j.done ? <Icon.Check size={14} className="text-ok" /> : <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
                  {j.name}
                </div>
                <div className="mono text-xs text-ink-3">
                  {j.step} · {j.pct}%
                </div>
              </div>
              <Progress value={j.pct} tone={j.done ? 'ok' : 'accent'} />
              <div className="mono text-[11px] text-ink-3">{j.eta}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="glass animate-rise mt-3 flex w-full items-start gap-3 rounded-2xl border-ok/40 p-4 shadow-soft sm:absolute sm:-bottom-6 sm:-right-4 sm:mt-0 sm:w-[min(340px,calc(100%-1.5rem))]">
        <div className="mt-0.5 text-ok"><Icon.Check /></div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-ink">Living room is ready</div>
          <div className="mt-0.5 text-xs text-ink-2">Full quality · 9 min 42 s · door anchor ±4 cm</div>
          <div className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent-2">
            Walk it <Icon.ArrowRight size={14} />
          </div>
        </div>
        <StagedLabel className="hidden sm:inline-flex" />
      </div>
    </div>
  );
}

export function HowItWorks() {
  return (
    <Section id="how">
      <Reveal>
        <SectionTitle eyebrow="How it works" title="Five taps for the seller. One loop for the buyer." body="Generation takes minutes, not seconds, and the product is honest about that. The job starts instantly, shows real progress, and finds you when it is done." />
      </Reveal>
      <Reveal delay={0.05}>
        <Timeline />
      </Reveal>

      <div className="mt-12 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {SELLER.map((s, i) => (
          <StepCard key={s.n} s={s} delay={i * 0.05} />
        ))}
      </div>

      <div className="mt-20 grid items-center gap-12 lg:grid-cols-12 lg:gap-10">
        <div className="lg:col-span-5">
          <Reveal>
            <div className="text-[11px] uppercase tracking-[0.18em] text-accent-2">The notification moment</div>
            <h3 className="display mt-3 text-3xl leading-tight text-ink md:text-4xl">Start it, leave, we tell you when it is ready.</h3>
            <p className="mt-5 text-[15px] leading-relaxed text-ink-2">
              Reconstruction is slow the way research is slow, so the product behaves like a research tool. The job starts the moment you tap Generate, shows honest progress, survives a reload, and keeps running when you close the tab. When a room finishes you get a browser notification, a toast in the app, and a badge on the tab title.
            </p>
            <ul className="mt-5 space-y-2 text-sm text-ink-2">
              {['Draft in about a minute: good enough to anchor and stage.', 'Full quality in about ten: listing grade.', 'Jobs are persisted. Come back tomorrow and the tour is waiting.'].map((t) => (
                <li key={t} className="flex gap-2.5">
                  <Icon.Check size={16} className="mt-0.5 shrink-0 text-ok" /> {t}
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

      <div className="mt-24">
        <Reveal>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-buyer">The buyer loop</div>
              <h3 className="display mt-3 text-3xl leading-tight text-ink md:text-4xl">Then the buyer walks in.</h3>
            </div>
            <div className="mono text-xs text-ink-3">buyer furniture is always blue · seller staging never is</div>
          </div>
        </Reveal>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {BUYER.map((s, i) => (
            <StepCard key={s.n} s={s} tone="buyer" delay={i * 0.06} />
          ))}
        </div>
      </div>
    </Section>
  );
}
