# Audora design language — adopted from the deployed prototype

_Owner decision 2026-09-06: adapt the existing colour scheme and UX design language of https://audora-workflow.onrender.com/ across this app. Keep our product structure, screens and copy; replace the look._

Reference material in `docs/reference/`: the prototype's SOURCE files from the teammate's `audora-full` branch of https://github.com/phanisaimunipalli/audora — the branch the deployed site is built from (`prototype-index.css` is the source of every token and pattern below; `prototype-App.jsx` has the landing, the buyer page, the poster rail and the world view chrome; `prototype-WorldView.jsx`; `prototype-index.html` with the Google Fonts link; `prototype-README.md`). `prototype-*.main-*-superseded.*` are the OLDER blue-accent variant from `main` — do not copy from those. Also the compiled stylesheet (`audora-workflow.css`) and screenshots `ref-landing.png`, `ref-world-furniture.png`, `ref-world-geometry.png`, `ref-mobile-landing.png`, `ref-mobile-world.png`.

## Tokens (verbatim from the prototype)

| token | value | use |
| --- | --- | --- |
| `--bg` | `#ffffff` | page background (light theme) |
| `--surface` / `--surface-2` | `#f7f7f7` / `#efefef` | cards, dropzones, list hover |
| `--line` / `--line-2` | `#e6e6e6` / `#d4d4d4` | hairlines, input borders |
| `--ink` / `--ink-2` | `#0a0a0a` / `#454545` | text, secondary text |
| `--dim` / `--faint` | `#737373` / `#a3a3a3` | captions, micro-labels, "not reported" |
| `--accent` / `--accent-deep` / `--accent-soft` | `#0a0a0a` / `#000000` / `#f2f2f2` | primary buttons are BLACK; soft = focus ring / selected wash |
| `--gold` | `#7a6a3f` | the one warm accent: anchors, "digitally staged", highlights |
| `--ok` / `--bad` / `--bad-soft` | `#2f7a52` / `#c0392b` / `#fbeceb` | fits / does not fit |
| buyer blue | `#1d63ff` (+ tints `#c9d9ff`, `#f4f7ff`) | buyer furniture and buyer UI only (from the prototype's house illustration and info tints) |
| `--glass` / `--glass-line` | `rgba(255,255,255,.82)` + `backdrop-filter: blur(14px)` / `rgba(10,10,10,.1)` | floating panels over the 3D view |
| `--r` | `12px` (also 8 / 10 / 14; pills `999px`) | radii |
| `--shadow` | `0 24px 60px rgba(10,10,10,.1), 0 2px 8px rgba(10,10,10,.05)` | cards, panels |
| `--shadow-sm` | `0 4px 16px rgba(10,10,10,.06)` | tiles, small controls |
| `--ease` | `cubic-bezier(.33,1,.68,1)` | every transition |
| `--serif` | `"Gilda Display", ui-serif, Georgia, serif` | display headlines only |
| body | `Manrope` 400–800 (Google Fonts) | all UI text |
| mono | `ui-monospace, SF Mono, Menlo, monospace` | every number, dimension, model id |

Google Fonts link: `https://fonts.googleapis.com/css2?family=Gilda+Display&family=Manrope:wght@400;500;600;700;800&display=swap`.

## Patterns (from the screenshots)

- **Wordmark**: `AUDORA` in small caps, letterspaced ~0.3em, 12–13px, ink; top-left. Top-right: quiet meta (credits) and text links.
- **Micro-labels**: uppercase, letterspaced 0.16em, 11px, `--dim` (`PHOTO TO WALKABLE 3D`, `WHAT THE MODEL MEASURED`, `STAGE A ROOM`, `OR ADD ONE`, `FLOOR HEIGHT`).
- **Headlines**: Gilda Display, very large (72–96px desktop), tight leading, ink, sentence case with a full stop ("Live it before buying or selling.").
- **Landing**: centred column; faded, slowly drifting "GENERATED ROOM" thumbnail cards behind it (ambient, ~25–75% opacity, blurred with depth); one white card with `--shadow` holding a dashed-border dropzone (`--surface` fill, round white 56px icon button with `--shadow-sm`, bold title, `--dim` subtitle); a text-link alternative under it; fine print in `--faint`; a secondary outlined pill CTA below the card.
- **Buttons**: pills (999px). Primary = black fill, white text. Secondary = white fill, `--line-2` hairline, ink text. Active toggle = black; inactive = white (see the world view's Furniture / Measurements / Geometry / Home).
- **Panels over 3D**: glass (`--glass` + blur), `--r` 14px, `--shadow`, 16px padding, micro-label heading, key/value rows (label `--ink-2`, value mono right-aligned, unknown values as `--faint` "not reported"), a footnote in `--dim` 11px. Left panel = measurements; right panel = staging (2×2 preset cards on `--surface`, then a list with a coloured dot + name + mono dimensions, then a slider).
- **Bottom strip**: "Rooms already generated · 12" + horizontally scrolling thumbnail tiles with a small `Draft` / `Full` badge and rail arrows; the active tile has a 3px `--accent-soft` ring.
- **Inputs / sliders**: hairline `--line-2`, 10px radius, focus ring `0 0 0 3px var(--accent-soft)`; range slider thumb black.
- **Density**: generous; nothing louder than a hairline; motion is opacity/transform with `--ease`.

## Mapping onto this app (what to change)

- `src/index.css` `@theme`: swap the dark tokens for the table above (keep the same token NAMES so components keep working: `--color-bg`, `--color-surface*`, `--color-line*`, `--color-ink*`, `--color-accent*`, `--color-ok/warn/danger`, `--color-buyer`; add `--color-gold`, `--color-dim`, `--color-faint`, `--color-glass`). Fonts: `--font-display` → Gilda Display, `--font-sans` → Manrope, `--font-mono` → system mono. `.glass`, `.panel`, `.chip`, `.skeleton`, `.grid-bg` restyled to the light language; `color-scheme: light`.
- `src/components/ui.tsx`: Button primary black / secondary white hairline / ghost; pills by default for actions, 10–12px radius for inputs; Chip = white hairline pill (gold tone for anchor/staged, buyer blue, ok green, bad red); Card = white + `--shadow`; Stat values mono ink; Segmented = white track with black active pill.
- `AnchorChip` gold; `StagedLabel` gold dot; ModeBadge quiet `--dim` text.
- 3D canvases: background `#ffffff`-adjacent (`#f4f4f4`) behind the shell in dollhouse; the HUD panels become glass-white; the mode control becomes the black/white pill group; the minimap a white card with ink lines.
- Landing: the prototype's layout (ambient thumbnails from the demo rooms' stills or gradients, centred headline, card with dropzone that links into `/new`), keeping our messaging and sections (anchor moment, furniture test, pricing, limits) restyled in the same language.
- Every screen: micro-labels for section headings, mono for numbers, black primary CTA, white secondary, `--gold` only for anchor/staged, blue only for the buyer.
