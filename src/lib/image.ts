export interface LoadedPhoto {
  dataUrl: string;
  width: number;
  height: number;
  /** 0..1 mean luminance */
  brightness: number;
  /** 0..1 fraction of near-black pixels */
  darkFraction: number;
  /** Simple edge density, a proxy for "is there anything to reconstruct". */
  detail: number;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read that image'));
    img.src = src;
  });
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/** Downscale to `max` px on the long edge, JPEG-encode, and compute cheap quality signals. */
export async function preparePhoto(src: string | File, max = 1280, quality = 0.82): Promise<LoadedPhoto> {
  const url = typeof src === 'string' ? src : await fileToDataUrl(src);
  const img = await loadImage(url);
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  const dataUrl = canvas.toDataURL('image/jpeg', quality);

  // Analyse a small copy.
  const sw = 96;
  const sh = Math.max(1, Math.round((h / w) * sw));
  const small = document.createElement('canvas');
  small.width = sw;
  small.height = sh;
  const sctx = small.getContext('2d', { willReadFrequently: true })!;
  sctx.drawImage(img, 0, 0, sw, sh);
  const { data } = sctx.getImageData(0, 0, sw, sh);
  let sum = 0;
  let dark = 0;
  const lum = new Float32Array(sw * sh);
  for (let i = 0; i < sw * sh; i++) {
    const l = (0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]) / 255;
    lum[i] = l;
    sum += l;
    if (l < 0.08) dark++;
  }
  let edges = 0;
  for (let y = 1; y < sh - 1; y++) {
    for (let x = 1; x < sw - 1; x++) {
      const i = y * sw + x;
      const gx = lum[i + 1] - lum[i - 1];
      const gy = lum[i + sw] - lum[i - sw];
      if (Math.hypot(gx, gy) > 0.12) edges++;
    }
  }
  return {
    dataUrl,
    width: w,
    height: h,
    brightness: sum / (sw * sh),
    darkFraction: dark / (sw * sh),
    detail: edges / (sw * sh),
  };
}

/** Live capture guidance. Cheap heuristics; the vision model refines them when live. */
export function photoHints(p: LoadedPhoto): { level: 'ok' | 'warn' | 'bad'; text: string }[] {
  const hints: { level: 'ok' | 'warn' | 'bad'; text: string }[] = [];
  if (p.brightness < 0.22) hints.push({ level: 'bad', text: 'Too dark to reconstruct well. Open the blinds or turn on the lights.' });
  else if (p.brightness < 0.32) hints.push({ level: 'warn', text: 'A little dark. More light gives a cleaner room.' });
  if (p.width / p.height < 1.1) hints.push({ level: 'warn', text: 'Turn the phone sideways. A wide frame gets the far corner in shot.' });
  if (p.detail < 0.04) hints.push({ level: 'warn', text: 'Very little detail in frame. Blank walls give the model less to work with.' });
  if (!hints.length) hints.push({ level: 'ok', text: 'Good frame. The far corner is in shot.' });
  return hints;
}
