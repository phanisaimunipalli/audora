import { AnchorMoment } from '@/components/marketing/AnchorMoment';
import { FooterCta } from '@/components/marketing/FooterCta';
import { ForAgents } from '@/components/marketing/ForAgents';
import { Freshness } from '@/components/marketing/Freshness';
import { Hero } from '@/components/marketing/Hero';
import { HowItWorks } from '@/components/marketing/HowItWorks';
import { LayoutPlan } from '@/components/marketing/LayoutPlan';
import { Limits } from '@/components/marketing/Limits';
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
      <LayoutPlan />
      <Hairline />
      <Freshness />
      <Hairline />
      <ForAgents />
      <Limits />
      <FooterCta />
    </div>
  );
}
