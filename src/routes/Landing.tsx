import { AnchorMoment } from '@/components/marketing/AnchorMoment';
import { FooterCta } from '@/components/marketing/FooterCta';
import { ForAgents } from '@/components/marketing/ForAgents';
import { FurniturePlayground } from '@/components/marketing/FurniturePlayground';
import { Hero } from '@/components/marketing/Hero';
import { HowItWorks } from '@/components/marketing/HowItWorks';
import { Limits } from '@/components/marketing/Limits';
import { Pricing } from '@/components/marketing/Pricing';
import { Hairline } from '@/components/marketing/Section';
import { Thesis } from '@/components/marketing/Thesis';

/** Marketing landing: the product argued in order, with the real engine doing the arithmetic. */
export default function Landing() {
  return (
    <div className="overflow-x-clip">
      <Hero />
      <Hairline />
      <Thesis />
      <Hairline />
      <HowItWorks />
      <AnchorMoment />
      <FurniturePlayground />
      <Hairline />
      <ForAgents />
      <Hairline />
      <Pricing />
      <Limits />
      <FooterCta />
    </div>
  );
}
