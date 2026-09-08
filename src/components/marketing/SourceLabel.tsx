/**
 * `SourceLabel` now lives beside `StagedLabel` in `@/components/ui`, where the rule between the two
 * is written down once. This re-export keeps the marketing imports working; prefer importing from
 * `@/components/ui` in new code.
 */
export { SourceLabel } from '@/components/ui';
