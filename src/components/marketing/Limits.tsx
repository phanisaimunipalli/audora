import type { ReactNode } from 'react';
import { Icon } from '@/components/icons';
import { SectionTitle, StagedLabel } from '@/components/ui';
import { MISTAP } from './demoRoom';
import { Reveal } from './Reveal';
import { Section } from './Section';

interface Limit {
  title: string;
  body: ReactNode;
  icon: ReactNode;
}

const LIMITS: Limit[] = [
  {
    title: 'Generative reconstruction invents detail.',
    body: 'Marble builds what the photo implies, including the parts behind the camera. Walls, openings and floor area are checked against the anchor; the grain of the floorboards is a guess. Treat the tour as a measured model with a plausible skin, not a survey.',
    icon: <Icon.Sparkles />,
  },
  {
    title: 'The anchor carries the risk.',
    body: `Every number is derived from one reference. Mis-tap the door and every number is wrong by the same factor. Plausibility checks catch the wild ones (a ${MISTAP.geometry.height.toFixed(2)} m ceiling), not the subtle ones. A tape or laser measurement is better than a tap, and the chip always says which you used.`,
    icon: <Icon.Door />,
  },
  {
    title: 'Reference dimensions are claims until verified.',
    body: 'Catalogue pieces are category references: a “3-seat sofa” is 220 × 95 × 85 cm, and it is marked unverified. Mattress sizes are verified against the standard. Your own furniture is exactly as you typed it, so measure it.',
    icon: <Icon.Ruler />,
  },
  {
    title: 'Everything is labelled digitally staged.',
    body: (
      <>
        Every tour, still and share link carries the label and the anchor chip. A buyer should never mistake a staged room for a furnished one, and a seller should never be able to make them. <StagedLabel className="ml-1 align-middle" />
      </>
    ),
    icon: <Icon.Eye />,
  },
];

export function Limits() {
  return (
    <Section id="limits" className="border-y border-line bg-surface">
      <Reveal>
        <SectionTitle eyebrow="Honest limits" title="What this is not." body="You will hear these from a sceptical buyer eventually. Better to hear them from us first." />
      </Reveal>
      <div className="mt-10 grid gap-4 md:grid-cols-2">
        {LIMITS.map((l, i) => (
          <Reveal key={l.title} delay={i * 0.05} className="h-full">
            <div className="panel flex h-full gap-4 bg-bg p-5 shadow-sm md:p-6">
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line bg-bg text-ink shadow-sm">{l.icon}</span>
              <div>
                <div className="display text-xl text-ink md:text-2xl">{l.title}</div>
                <p className="mt-2 text-sm leading-relaxed text-ink-2">{l.body}</p>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
      <Reveal delay={0.15}>
        <p className="display mt-10 text-center text-2xl text-ink-2 md:text-3xl">
          Audora does not replace a viewing. <span className="text-ink">It replaces the guess before it.</span>
        </p>
      </Reveal>
    </Section>
  );
}
