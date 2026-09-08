import { useEffect } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from '@/components/AppShell';
import { Toaster } from '@/components/Toaster';
import { useJobRunner } from '@/state/jobs';
import { useAudora } from '@/state/store';
import { providerStatus } from '@/services/marble';
import Landing from '@/routes/Landing';
import NewTour from '@/routes/NewTour';
import Tours from '@/routes/Tours';
import TourHub from '@/routes/TourHub';
import PublicTour from '@/routes/PublicTour';
import Dashboard from '@/routes/Dashboard';
import Settings from '@/routes/Settings';
import { StageEditor } from '@/screens/StageEditor';
import { useParams } from 'react-router-dom';

function StageRoute() {
  const { tourId = '', roomId = '' } = useParams();
  return <StageEditor tourId={tourId} roomId={roomId} />;
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [pathname]);
  return null;
}

/**
 * Toasts are leasing-team chrome: job progress, credits, room names from their own units and
 * links into the authenticated hub. The public renter view has no app chrome and no account, so a
 * job landing in another tab must not drop "Full quality is ready — Dining room … Open unit →" over
 * a stranger's viewer. The tray, the title badge and browser notifications are already suppressed
 * there; this is the last one.
 */
function AppToaster() {
  const { pathname } = useLocation();
  if (pathname === '/t' || pathname.startsWith('/t/')) return null;
  return <Toaster />;
}

export default function App() {
  useJobRunner();
  const setProviders = useAudora((s) => s.setProviders);
  useEffect(() => {
    let alive = true;
    const check = async () => {
      const st = await providerStatus();
      if (alive) setProviders(st);
    };
    void check();
    const id = window.setInterval(check, 60_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [setProviders]);

  return (
    <>
      <ScrollToTop />
      <Routes>
        {/* Public renter view: no app chrome, no account. */}
        <Route path="/t/:shareId" element={<PublicTour />} />
        <Route path="/t/:shareId/:roomId" element={<PublicTour />} />
        {/* Full-bleed editor. */}
        <Route path="/tours/:tourId/stage/:roomId" element={<StageRoute />} />
        <Route element={<AppShell />}>
          <Route path="/" element={<Landing />} />
          <Route path="/new" element={<NewTour />} />
          <Route path="/tours" element={<Tours />} />
          <Route path="/tours/:tourId" element={<TourHub />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Landing />} />
        </Route>
      </Routes>
      <AppToaster />
    </>
  );
}
