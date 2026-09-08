import type { ReactNode } from 'react';
import { Icon } from '@/components/icons';
import { SectionTitle } from '@/components/ui';
import { MISTAP } from './demoRoom';
import { Reveal } from './Reveal';
import { Section } from './Section';
import { SourceLabel } from './SourceLabel';

interface Limit {
  title: string;
  body: ReactNode;
  icon: ReactNode;
}

const LIMITS: Limit[] = [
  {
    title: 'A reconstruction, not a survey.',
    body: 'The model builds what the photographs imply, including the parts behind the camera. Walls, openings and floor area are checked against the floor plan and the anchor; the grain of the floorboards is a guess. It is a measured model with a plausible skin, and it never substitutes for disclosed square footage.',
    icon: <Icon.Sparkles />,
  },
  {
    title: 'A draft has no metric scale until it is anchored.',
    body: `The fast tier returns a walkable world with no size of its own. Until someone taps a door or types a wall length, the dimensions are assumptions with wide error bars — and the chip says so. Plausibility checks catch the wild ones (a ${MISTAP.geometry.height.toFixed(2)} m ceiling), not the subtle ones.`,
    icon: <Icon.Door />,
  },
  {
    title: 'Verify before you rely on a measurement.',
    body: 'Every dimension is shown with its ±, and where the plan and the model disagree the unit says both numbers rather than picking one. Before buying furniture, or signing anything that turns on a centimetre, measure the wall in person.',
    icon: <Icon.Ruler />,
  },
  {
    title: 'Always labelled.',
    body: (
      <>
        Every model, still and share link says it was generated from photographs and carries its scale anchor. A renter should never mistake a reconstruction for a photograph of the unit, and a leasing team should never be able to make them. <SourceLabel className="ml-1 align-middle" />
      </>
    ),
    icon: <Icon.Eye />,
  },
];

export function Limits() {
  return (
    <Section id="limits" className="border-y border-line bg-surface">
      <Reveal>
        <SectionTitle eyebrow="Honest limits" title="What it is not." body="You will hear these from a sceptical renter eventually. Better to hear them from us first." />
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
          Audora does not replace the showing. <span className="text-ink">It replaces the guess before it.</span>
        </p>
      </Reveal>
    </Section>
  );
}
