import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAudora } from '@/state/store';
import { Icon } from './icons';
import { JobsTray } from './JobsTray';
import { cx } from './ui';

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
      className="chip mono !text-[11px]"
      title={`${spends ? 'New generations call World Labs Marble and spend credits.' : p.marble ? 'A Marble key is set, but "Prefer simulated reconstruction" is on: no credits are spent.' : 'No Marble key: reconstruction is simulated.'} Nebius: ${p.nebius ? 'live' : 'mock'}.`}
    >
      <span className={cx('h-1.5 w-1.5 rounded-full', spends ? 'bg-ok' : 'bg-warn')} />
      {marble} · {nebius}
    </Link>
  );
}

export function AppShell() {
  const loc = useLocation();
  const onLanding = loc.pathname === '/';
  const nav = [
    { to: '/tours', label: 'Tours' },
    { to: '/dashboard', label: 'Insights' },
  ];
  return (
    <div className="flex min-h-full flex-col">
      <header className={cx('sticky top-0 z-40 border-b', onLanding ? 'border-transparent bg-bg/70 backdrop-blur-md' : 'border-line bg-bg/85 backdrop-blur-md')}>
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4 md:px-6">
          <Link to="/" className="flex items-center gap-2 text-ink">
            <span className="text-accent"><Icon.Logo /></span>
            <span className="display text-xl tracking-tight">Audora</span>
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {nav.map((n) => (
              <NavLink key={n.to} to={n.to} className={({ isActive }) => cx('rounded-lg px-3 py-1.5 text-sm transition-colors', isActive ? 'bg-surface-2 text-ink' : 'text-ink-2 hover:text-ink')}>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <div className="hidden md:block"><ModeBadge /></div>
            <JobsTray />
            <Link to="/new" className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-accent px-3.5 text-sm font-medium text-[#1a0f0a] hover:bg-accent-2">
              <Icon.Plus size={16} /> New tour
            </Link>
          </div>
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-6 text-xs text-ink-3 md:flex-row md:items-center md:justify-between md:px-6">
          <div>Audora · one photo, a room you can walk. Every artifact is labelled digitally staged and carries its scale anchor.</div>
          <div className="mono">reconstruction: World Labs Marble · models: Nebius Token Factory</div>
        </div>
      </footer>
    </div>
  );
}
