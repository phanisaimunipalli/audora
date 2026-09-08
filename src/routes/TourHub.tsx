/**
 * The tour hub: progress while generating, then Tour / Rooms / Publish / Insights.
 * Tab and selected room live in the query string so links land on the right view.
 *
 * The rooms tab is the per-room list. With staging deferred (docs/ACCURACY.md 3.7) it leads with
 * each room's measurements and is called "Rooms"; with `Settings.stagingEnabled` on, the same list
 * grows the furniture controls back and is called "Stage". The tab itself is never removed —
 * hiding it would take the accuracy cards with it — but the old `?tab=stage` links still resolve,
 * and `resolveTab` catches anything else that is no longer a tab.
 */
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { selectTour, toast, useAudora, useTourJobs, useTourRooms } from '@/state/store';
import { generateTour } from '@/state/jobs';
import { Button, Callout, EmptyState, Segmented } from '@/components/ui';
import { Icon } from '@/components/icons';
import { TourViewer } from '@/screens/TourViewer';
import { PublishPanel } from '@/screens/PublishPanel';
import { TourInsights } from '@/screens/TourInsights';
import { HubHeader } from '@/screens/hub/HubHeader';
import { GeneratingView } from '@/screens/hub/GeneratingView';
import { RoomCard } from '@/screens/hub/RoomCard';
import { UpgradeBanner } from '@/screens/hub/UpgradeBanner';
import { latestJobFor, tourStatus } from '@/screens/hub/jobMeta';
import { resolveTab, stagingEnabled } from '@/state/staging';

type Tab = 'tour' | 'rooms' | 'publish' | 'insights';
const TABS: Tab[] = ['tour', 'rooms', 'publish', 'insights'];
/** Links shared before the tab was renamed. Same panel, so they land where they always did. */
const TAB_ALIASES: Record<string, Tab> = { stage: 'rooms' };

export default function TourHub() {
  const { tourId = '' } = useParams();
  const tour = useAudora(selectTour(tourId));
  const rooms = useTourRooms(tourId);
  const jobs = useTourJobs(tourId);
  const markJobsSeen = useAudora((s) => s.markJobsSeen);
  const [params, setParams] = useSearchParams();
  const stagingOn = useAudora((s) => stagingEnabled(s.settings));
  const requested = params.get('tab');
  const tab: Tab = resolveTab((requested && TAB_ALIASES[requested]) || (requested as Tab | null), TABS, { stagingEnabled: stagingOn });
  const roomParam = params.get('room') ?? undefined;
  const [showTabs, setShowTabs] = useState(false);

  const setQuery = (patch: Record<string, string | undefined>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
        return next;
      },
      { replace: true },
    );

  // Seeing the hub counts as seeing the finished jobs.
  const unseenIds = jobs.filter((j) => j.status === 'done' && !j.seen).map((j) => j.id);
  const unseenKey = unseenIds.join(',');
  useEffect(() => {
    if (unseenKey) markJobsSeen(unseenKey.split(','));
  }, [unseenKey, markJobsSeen]);

  if (!tour) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 md:px-6">
        <EmptyState
          title="Tour not found"
          body="It may have been deleted, or it lives in another browser's storage."
          action={
            <Link to="/tours" className="text-sm text-ink-2 hover:text-ink">
              All tours →
            </Link>
          }
        />
      </div>
    );
  }

  const status = tourStatus(tour, rooms, jobs);
  // An upgrade is not a generation: every room is already walkable, so the hub keeps its tabs and
  // only shows the "upgrading to full quality" banner.
  const generating = status.kind === 'generating' && !status.upgrading;
  const selected = rooms.find((r) => r.id === roomParam) ?? rooms.find((r) => r.status === 'ready') ?? rooms[0];
  const pendingCount = rooms.filter((r) => r.status === 'pending').length;

  const view = (roomId: string) => {
    setShowTabs(true);
    setQuery({ tab: 'tour', room: roomId });
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 md:px-6">
      <HubHeader tour={tour} rooms={rooms} jobs={jobs} status={status} selectedRoomId={selected?.id} onSelectRoom={view} />

      {!rooms.length ? (
        <EmptyState
          title="This tour has no rooms"
          body="Add rooms from a new tour, or delete this one from the tours list."
          action={
            <Link to="/new" className="text-sm text-ink-2 hover:text-ink">
              Start a new tour →
            </Link>
          }
        />
      ) : generating && !showTabs ? (
        <GeneratingView tour={tour} rooms={rooms} jobs={jobs} status={status} onPeek={view} onShowTour={() => setShowTabs(true)} />
      ) : (
        <>
          {generating ? (
            <Callout tone="info" title={`${status.label} · ${status.progress}%`}>
              <div className="flex flex-wrap items-center gap-2">
                <span>Rooms still generating will appear here as they land.</span>
                <button type="button" onClick={() => setShowTabs(false)} className="text-ink-2 hover:text-ink">
                  Back to progress →
                </button>
              </div>
            </Callout>
          ) : null}
          {status.upgrades.length ? <UpgradeBanner jobs={status.upgrades} rooms={rooms} compact /> : null}
          {pendingCount > 0 && !generating ? (
            <Callout tone="warn" title={`${pendingCount} room${pendingCount === 1 ? '' : 's'} not generated yet`}>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  const js = generateTour(tour.id, tour.quality);
                  toast({ kind: 'info', title: `Generating ${js.length} room${js.length === 1 ? '' : 's'}` });
                }}
              >
                <Icon.Play size={14} /> Generate pending rooms
              </Button>
            </Callout>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Segmented
              value={tab}
              onChange={(t) => setQuery({ tab: t })}
              options={[
                { value: 'tour', label: 'Tour', icon: <Icon.Walk size={15} /> },
                stagingOn
                  ? { value: 'rooms', label: 'Stage', icon: <Icon.Sofa size={15} /> }
                  : { value: 'rooms', label: 'Rooms', icon: <Icon.Ruler size={15} /> },
                { value: 'publish', label: 'Publish', icon: <Icon.Share size={15} /> },
                { value: 'insights', label: 'Insights', icon: <Icon.Chart size={15} /> },
              ]}
            />
            {/* The viewer carries its own anchor chip and staged label; the tab row only adds the dimensions. */}
            {tab === 'tour' && selected ? (
              <span className="mono text-sm text-ink-2">
                {selected.geometry.width.toFixed(2)} × {selected.geometry.depth.toFixed(2)} × {selected.geometry.height.toFixed(2)} m
              </span>
            ) : null}
          </div>

          {tab === 'tour' ? (
            <div className="flex flex-col gap-3">
              {/* Not keyed by room: switching rooms keeps the viewer mounted, so Walk stays Walk and the buyer's test pieces survive. */}
              <TourViewer tourId={tour.id} roomId={selected?.id} onRoomChange={(id) => setQuery({ room: id })} className="h-[70vh] overflow-hidden rounded-2xl border border-line bg-surface" />
              {selected?.status !== 'ready' ? (
                <Callout tone="warn">
                  {selected?.name} has no reconstruction yet: this is the anchored room shell with the staging. {selected?.status === 'generating' ? 'The splat world will replace it when the job lands.' : ''}
                </Callout>
              ) : null}
            </div>
          ) : null}

          {tab === 'rooms' ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {rooms.map((room) => (
                <RoomCard key={room.id} tour={tour} room={room} job={latestJobFor(jobs, room.id)} onView={view} />
              ))}
            </div>
          ) : null}

          {tab === 'publish' ? <PublishPanel tourId={tour.id} /> : null}
          {tab === 'insights' ? <TourInsights tourId={tour.id} /> : null}
        </>
      )}
    </div>
  );
}
