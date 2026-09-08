import { Icon } from '@/components/icons';
import { CtaLink } from './Cta';
import { Reveal } from './Reveal';
import { Section } from './Section';

export function FooterCta() {
  return (
    <Section id="start">
      <Reveal y={24}>
        <div className="relative overflow-hidden rounded-[18px] border border-line bg-bg px-6 py-14 text-center shadow-soft md:px-14 md:py-20">
          <div className="relative">
            <div className="micro">The first unit</div>
            <h2 className="display mx-auto mt-4 max-w-3xl text-4xl leading-[1.02] text-ink md:text-6xl">Start with whatever is empty today.</h2>
            <p className="mx-auto mt-5 max-w-xl text-[15px] leading-relaxed text-ink-2">
              The make-ready photos and the floor plan are all it takes. A draft is walkable in about a minute; start it, leave, and we will tell you when full quality lands.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <CtaLink to="/new">
                Model your vacant units this week <Icon.ArrowRight size={18} />
              </CtaLink>
              <CtaLink to="/t/oak1247" variant="secondary">
                <Icon.Walk size={18} /> Walk the demo
              </CtaLink>
            </div>
            <div className="mono mt-8 text-[11px] text-dim">draft ≈ 1 min · full ≈ 10 min · eye height 1.60 m · measured against the floor plan · every frame AI-generated from photos</div>
          </div>
        </div>
      </Reveal>
    </Section>
  );
}
