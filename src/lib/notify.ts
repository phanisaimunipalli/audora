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

let baseTitle: string | null = null;
export function setTitleBadge(count: number) {
  if (typeof document === 'undefined') return;
  if (baseTitle === null) baseTitle = document.title;
  document.title = count > 0 ? `(${count}) ${baseTitle}` : baseTitle;
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
