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
            <div className="micro">Start with one room</div>
            <h2 className="display mx-auto mt-4 max-w-3xl text-4xl leading-[1.02] text-ink md:text-6xl">Stage a room in the time it takes to make coffee.</h2>
            <p className="mx-auto mt-5 max-w-xl text-[15px] leading-relaxed text-ink-2">One photo, two taps on the door, about a minute. Start it, leave, and we will tell you when it is ready. No card for the first room.</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <CtaLink to="/new">
                Generate a tour <Icon.ArrowRight size={18} />
              </CtaLink>
              <CtaLink to="/t/oak1247" variant="secondary">
                <Icon.Walk size={18} /> Walk the demo
              </CtaLink>
            </div>
            <div className="mono mt-8 text-[11px] text-dim">draft ≈ 1 min · full ≈ 10 min · eye height 1.60 m · walkway ≥ 0.75 m · every frame digitally staged</div>
          </div>
        </div>
      </Reveal>
    </Section>
  );
}
