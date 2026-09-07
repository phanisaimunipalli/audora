/** Browser notifications for long-running generation. Deep-research style: start it, leave, get told. */

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
  return notificationsSupported() ? Notification.permission : 'unsupported';
}

export async function requestNotifications(): Promise<NotificationPermission | 'unsupported'> {
  if (!notificationsSupported()) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

export function sendNotification(title: string, body: string, onClick?: () => void): boolean {
  if (!notificationsSupported() || Notification.permission !== 'granted') return false;
  try {
    const n = new Notification(title, { body, icon: '/favicon.svg', tag: `audora-${Date.now()}` });
    n.onclick = () => {
      window.focus();
      onClick?.();
      n.close();
    };
    return true;
  } catch {
    return false;
  }
}

/* ---------- unseen-job badge in the tab title ----------
 * The badge belongs to the seller's app chrome. The job runner is mounted app-wide, so without a
 * switch a buyer sitting on a public share link would watch the seller's tab title turn into
 * "(1) 1247 Oak Street · Audora tour". Routes that own their own title (the public viewer) turn it
 * off while they are mounted, and the title is left exactly as they set it. */
let baseTitle: string | null = null;
let badgeCount = 0;
let badgeEnabled = true;

/** "(2) Audora" → "Audora", so a re-read never captures a badge as the base title. */
function stripBadge(title: string): string {
  return title.replace(/^\(\d+\)\s+/, '');
}

function renderTitle() {
  if (typeof document === 'undefined' || !badgeEnabled) return;
  if (baseTitle === null) baseTitle = stripBadge(document.title);
  document.title = badgeCount > 0 ? `(${badgeCount}) ${baseTitle}` : baseTitle;
}

export function setTitleBadge(count: number) {
  badgeCount = count;
  renderTitle();
}

/**
 * Turn the badge off for routes with no app chrome. Switching it off restores the plain title and
 * forgets it, so the route is free to set its own; switching it back on re-reads whatever is there.
 */
export function setTitleBadgeEnabled(on: boolean) {
  if (on === badgeEnabled) return;
  if (!on) {
    if (typeof document !== 'undefined' && baseTitle !== null) document.title = baseTitle;
    baseTitle = null;
  }
  badgeEnabled = on;
  renderTitle();
}

/** A short, soft chime using WebAudio — no asset needed. */
export function chime() {
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    [523.25, 659.25, 783.99].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0, now + i * 0.12);
      g.gain.linearRampToValueAtTime(0.08, now + i * 0.12 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.12 + 0.6);
      o.connect(g).connect(ctx.destination);
      o.start(now + i * 0.12);
      o.stop(now + i * 0.12 + 0.7);
    });
  } catch {
    /* audio is optional */
  }
}
