/**
 * Staging deferred — docs/ACCURACY.md section 3.7.
 *
 * The priority set on 2026-09-08 is the accurate 3D model of the unit; staging and furniture
 * layering wait. Rather than delete working code, every staging surface asks this module whether it
 * should be on. The flag lives on `Settings.stagingEnabled` and is **off unless it says otherwise**:
 * an undefined flag (a store persisted before the setting existed) is off, which is what makes
 * "default false" true for existing browsers as well as new ones.
 *
 * Pure and dependency-free on purpose — the components that need it are spread across the hub, the
 * wizard, the viewer and the editor, and none of them should re-derive the rule.
 */
import type { Settings } from './types';

/** Staging is off until someone turns it on. */
export const STAGING_DEFAULT_ENABLED = false;

/** Every place staging can be reached from. Naming them is how "hide the entry points" stays checkable. */
export type StagingSurface =
  /** The hub's Stage tab. */
  | 'stage-tab'
  /** The "Auto-stage" button on a room card and in the editor's top bar. */
  | 'auto-stage'
  /** `/tours/:tourId/stage/:roomId` and every link into it. */
  | 'editor'
  /** The buyer's "test your own furniture" panel in the viewer. */
  | 'furniture-test'
  /** Rendering placed pieces inside the 3D scene at all. */
  | 'staging-layer';

export const STAGING_SURFACES: StagingSurface[] = ['stage-tab', 'auto-stage', 'editor', 'furniture-test', 'staging-layer'];

/** What the user is told when they reach a staging surface that is switched off. */
export const STAGING_OFF_COPY = {
  title: 'Staging is off',
  body: 'Audora is showing the measured model of this unit: its dimensions against the plan, the model date and the anchor. Turn staging back on in Settings to arrange furniture.',
} as const;

/** The one reader. Anything that branches on staging calls this, never `settings.stagingEnabled`. */
export function stagingEnabled(settings?: Pick<Settings, 'stagingEnabled'> | null): boolean {
  return settings?.stagingEnabled === true;
}

/** Whether one named surface should be rendered at all. */
export function showsStaging(settings: Pick<Settings, 'stagingEnabled'> | null | undefined, _surface: StagingSurface): boolean {
  // Every surface currently follows the single flag; the parameter keeps the call sites self-documenting
  // and gives a later "hide the editor but keep the buyer's test" one obvious place to happen.
  return stagingEnabled(settings);
}

/** The staging surfaces that are hidden right now, in a stable order — what a test asserts against. */
export function hiddenStagingSurfaces(settings?: Pick<Settings, 'stagingEnabled'> | null): StagingSurface[] {
  return stagingEnabled(settings) ? [] : [...STAGING_SURFACES];
}

/**
 * Filter a tab list. Written generically so the hub keeps ownership of its own `Tab` union and this
 * module never has to know what the other tabs are called.
 */
export function visibleTabs<T extends string>(tabs: readonly T[], settings?: Pick<Settings, 'stagingEnabled'> | null): T[] {
  return stagingEnabled(settings) ? [...tabs] : tabs.filter((t) => t !== ('stage' as T));
}

/** A tab the user asked for by query string may no longer exist; fall back to the first visible one. */
export function resolveTab<T extends string>(requested: T | null | undefined, tabs: readonly T[], settings?: Pick<Settings, 'stagingEnabled'> | null): T {
  const visible = visibleTabs(tabs, settings);
  return requested && visible.includes(requested) ? requested : visible[0];
}
