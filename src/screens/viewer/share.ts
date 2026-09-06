/** Public link helpers and a clipboard writer that never throws. */

export function publicUrl(shareId: string, roomId?: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}/t/${shareId}${roomId ? `/${roomId}` : ''}`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export function embedSnippet(shareId: string, title: string): string {
  const src = publicUrl(shareId);
  return [
    `<iframe src="${src}" title="${title.replace(/"/g, '&quot;')} · 3D tour" width="100%" height="640" style="border:0;border-radius:18px;overflow:hidden" allow="fullscreen; xr-spatial-tracking" allowfullscreen loading="lazy"></iframe>`,
    `<p style="font:12px/1.5 system-ui,sans-serif;color:#7f7468;margin:8px 0 0">Digitally staged. Furniture is virtual and shown for scale; every dimension carries its measurement anchor. Made with Audora.</p>`,
  ].join('\n');
}
