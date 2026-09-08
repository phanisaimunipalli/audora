import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAudora } from '@/state/store';
import { Icon } from './icons';
import { JobsTray } from './JobsTray';
import { pillClass } from './ui';
import { cx } from './ui';

/** Quiet meta, not a badge: the top right of the page is where the prototype keeps its credits line. */
export function ModeBadge() {
  const p = useAudora((s) => s.providers);
  const preferMock = useAudora((s) => s.settings.preferMock);
  // Say what a new job would actually use (activeProvider), not merely which keys exist.
  const marble = p.marble ? (preferMock ? 'marble simulated' : 'marble live') : 'marble mock';
  const nebius = p.nebius ? 'nebius live' : 'nebius mock';
  const spends = p.marble && !preferMock;
  return (
    <Link
      to="/settings"
      className="mono inline-flex items-center gap-1.5 text-[11px] text-dim transition-colors hover:text-ink"
      title={`${spends ? 'New generations call World Labs Marble and spend credits.' : p.marble ? 'A Marble key is set, but "Prefer simulated reconstruction" is on: no credits are spent.' : 'No Marble key: reconstruction is simulated.'} Nebius: ${p.nebius ? 'live' : 'mock'}.`}
    >
      {/* Ink, not gold and not green: `--gold` means anchor / digitally staged and `--ok` means
          "it fits". A provider dot is neither, so it is filled only when credits are at stake. */}
      <span className={cx('h-1.5 w-1.5 rounded-full', spends ? 'bg-ink' : 'bg-line-2')} />
      {marble} · {nebius}
    </Link>
  );
}

const NAV = [
  { to: '/tours', label: 'Units' },
  { to: '/dashboard', label: 'Insights' },
];

export function AppShell() {
  const loc = useLocation();
  const onLanding = loc.pathname === '/';
  return (
    <div className="flex min-h-full flex-col">
      <header className={cx('sticky top-0 z-40 border-b backdrop-blur-md', onLanding ? 'border-transparent bg-bg/80' : 'border-line bg-bg/90')}>
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4 md:gap-7 md:px-6">
          <Link to="/" className="shrink-0 text-[12px] font-semibold tracking-[0.26em] text-ink uppercase md:text-[13px] md:tracking-[0.34em]" aria-label="Audora, home">
            Audora
          </Link>
          {/* The nav is never hidden. It used to disappear below 768 px with no hamburger and no
              bottom bar behind it, which left a leasing team on a phone with the wordmark and
              "New unit" as their entire map: /tours and /dashboard were unreachable from every
              other screen. */}
          <nav className="flex min-w-0 items-center gap-4 md:gap-5">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) =>
                  cx('shrink-0 text-[13px] font-medium transition-colors', isActive ? 'text-ink underline decoration-line-2 underline-offset-[6px]' : 'text-dim hover:text-ink')
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2 md:gap-3">
            <div className="hidden md:block"><ModeBadge /></div>
            <JobsTray />
            <Link to="/new" className={pillClass('primary', 'sm', 'h-9 shrink-0 px-3.5 text-[13px] md:px-4')}>
              <Icon.Plus size={15} /> New unit
            </Link>
          </div>
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-8 text-xs text-dim md:flex-row md:items-center md:justify-between md:px-6">
          <div>Audora: your photos and floor plan, a unit you can walk. Every model is labelled AI-generated from photos and carries its scale anchor.</div>
          <div className="flex flex-col gap-2 md:items-end">
            {/* The same links again at the foot of the page, so a phone always has two ways there. */}
            <nav className="flex items-center gap-4">
              {NAV.map((n) => (
                <Link key={n.to} to={n.to} className="text-dim transition-colors hover:text-ink">
                  {n.label}
                </Link>
              ))}
              <Link to="/settings" className="text-dim transition-colors hover:text-ink">
                Settings
              </Link>
            </nav>
            <div className="mono text-faint">reconstruction: World Labs Marble · models: Nebius Token Factory</div>
          </div>
        </div>
      </footer>
    </div>
  );
}
