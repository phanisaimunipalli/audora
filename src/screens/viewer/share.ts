/** Public link helpers, the disclosure line, and a clipboard writer that never throws. */

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

/**
 * The disclosure line — one text, in one place, so the embed, the publish panel and anything else
 * that has to say what this model is cannot drift apart (docs/COPY.md).
 *
 * It says the three things the product owes a renter: the model was generated from the unit's own
 * photographs and checked against its floor plan; every dimension comes from a declared scale
 * reference and carries its ± uncertainty; verify anything you are going to rely on. It never
 * claims "digitally staged" — that is a separate claim about furniture, made by `StagedLabel` and
 * only when there is furniture to disclose.
 *
 * Pass each room's anchor label ("Living room: door · 2.03 m · ±3 cm") to name the references; with
 * none, the sentence stays true and simply does not enumerate them.
 */
export function disclosure(anchors: string[] = []): string {
  const references = anchors.length ? ` (${anchors.join('; ')})` : '';
  return (
    'AI-generated from photos. The 3D model of this unit was generated from photographs of it and checked against its floor plan; ' +
    'it is a reconstruction, not a photograph and not a survey. Room dimensions come from a declared scale reference in each room' +
    `${references} and carry the stated ± uncertainty. Verify any measurement before you rely on it.`
  );
}

export function embedSnippet(shareId: string, title: string): string {
  const src = publicUrl(shareId);
  return [
    `<iframe src="${src}" title="${title.replace(/"/g, '&quot;')} · 3D model of the unit" width="100%" height="640" style="border:0;border-radius:14px;overflow:hidden" allow="fullscreen; xr-spatial-tracking" allowfullscreen loading="lazy"></iframe>`,
    `<p style="font:12px/1.5 system-ui,sans-serif;color:#737373;margin:8px 0 0">${disclosure()} Made with Audora.</p>`,
  ].join('\n');
}
