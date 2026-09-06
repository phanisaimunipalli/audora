import { Icon } from '@/components/icons';
import { SectionTitle, cx } from '@/components/ui';
import { TIER_INFO } from '@/services/mockWorld';
import { CtaLink } from './Cta';
import { Reveal } from './Reveal';
import { Section } from './Section';

interface Plan {
  name: string;
  price: string;
  period: string;
  who: string;
  features: string[];
  cta: { label: string; to: string; variant: 'primary' | 'secondary' | 'buyer' };
  highlight?: boolean;
  buyer?: boolean;
  note?: string;
}

const PLANS: Plan[] = [
  {
    name: 'Free',
    price: '$0',
    period: 'one room',
    who: 'Try it on the room you are least sure about.',
    features: ['1 room, draft quality', 'Audora badge on the tour', 'Share link, furniture test, fit report', 'No card'],
    cta: { label: 'Generate a tour', to: '/new', variant: 'secondary' },
  },
  {
    name: 'Seller',
    price: '$39',
    period: 'per listing',
    who: 'One home, every room, listing grade.',
    features: ['Up to 10 rooms, full quality', 'No badge. Your name on it', 'Listing copy written from the tour', 'Hosted for the life of the listing'],
    cta: { label: 'Generate a tour', to: '/new', variant: 'primary' },
    highlight: true,
  },
  {
    name: 'Agent',
    price: '$149',
    period: 'per month',
    who: 'For the agent who lists every week.',
    features: ['20 listings a month, then $9 each', 'Your branding and colour', 'Analytics: walked, tested, fit failures per room', '3 seats included'],
    cta: { label: 'See the insights', to: '/dashboard', variant: 'secondary' },
  },
  {
    name: 'Buyer',
    price: 'Free',
    period: 'forever',
    who: 'No account. Open the link, walk in.',
    features: ['Walk any Audora tour', 'Test your own furniture', 'My Stuff across listings', 'Send the fit report to the agent'],
    cta: { label: 'Walk the demo', to: '/t/oak1247', variant: 'buyer' },
    buyer: true,
    note: 'The buyer is distribution, not revenue.',
  },
];

export function Pricing() {
  return (
    <Section id="pricing">
      <Reveal>
        <SectionTitle eyebrow="Pricing" title="Priced like software, not like a stylist." body="Launch pricing. Sellers and agents pay per listing or per month; buyers never pay." />
      </Reveal>
      <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {PLANS.map((p, i) => (
          <Reveal key={p.name} delay={i * 0.06} className="h-full">
            <div className={cx('panel relative flex h-full flex-col gap-5 p-6', p.highlight && 'ring-accent', p.buyer && 'border-buyer/30')}>
              {p.highlight ? <span className="chip absolute -top-3 left-5 border-accent/40 bg-accent/15 text-accent-2">Most listings</span> : null}
              <div>
                <div className={cx('text-sm font-medium', p.buyer ? 'text-buyer' : 'text-ink-2')}>{p.name}</div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="mono text-4xl leading-none text-ink">{p.price}</span>
                  <span className="text-sm text-ink-3">{p.period}</span>
                </div>
                <p className="mt-3 text-sm text-ink-2">{p.who}</p>
              </div>
              <ul className="flex flex-col gap-2 text-sm text-ink-2">
                {p.features.map((f) => (
                  <li key={f} className="flex gap-2.5">
                    <Icon.Check size={16} className={cx('mt-0.5 shrink-0', p.buyer ? 'text-buyer' : 'text-ok')} /> {f}
                  </li>
                ))}
              </ul>
              <div className="mt-auto flex flex-col gap-3">
                <CtaLink to={p.cta.to} variant={p.cta.variant} size="md">
                  {p.cta.label}
                </CtaLink>
                {p.note ? <div className="text-[11px] italic text-ink-3">{p.note}</div> : null}
              </div>
            </div>
          </Reveal>
        ))}
      </div>
      <Reveal delay={0.1}>
        <div className="mt-8 flex flex-col gap-4 rounded-2xl border border-line bg-bg-2/60 p-5 md:flex-row md:items-center md:justify-between">
          <div className="text-sm text-ink-2">
            <span className="font-medium text-ink">Unit economics.</span> A draft world costs about <span className="mono text-ink">${TIER_INFO.draft.usd.toFixed(2)}</span> to make and a full one about <span className="mono text-ink">${TIER_INFO.full.usd.toFixed(2)}</span>. Traditional staging costs hundreds of dollars a room. That gap is the margin, and it is why the free tier exists.
          </div>
          <div className="mono shrink-0 text-xs text-ink-3">
            draft {TIER_INFO.draft.credits} credits · full {TIER_INFO.full.credits} credits
          </div>
        </div>
      </Reveal>
    </Section>
  );
}
