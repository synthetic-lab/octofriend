const UNCHAINED_NOTIF = "Octo runs edits and shell commands automatically";
const CHAINED_NOTIF = "Octo asks permission before running edits or shell commands";
const PLAN_NOTIF = "Octo is in plan mode - exploration and planning tools only";

export const MODES = ["collaboration", "unchained", "plan"] as const;
export type ModeType = (typeof MODES)[number];

export function nextMode(current: ModeType): ModeType {
  const idx = MODES.indexOf(current);
  return MODES[(idx + 1) % MODES.length];
}
/**
 * Configuration for plan mode.
 *
 * - When `isPlanMode` is false, plan mode is disabled.
 * - When `isPlanMode` is true, `planFilePath` must be a valid string (never null).
 *
 * This type design ensures that when plan mode is active, there is always a valid plan file path.
 * Runtime code must guarantee that `activePlanFilePath` is non-null before creating a config
 * with `isPlanMode: true`.
 *
 * @see activePlanFilePath in source/state.ts - The path currently being used by agent tools
 */
export type PlanModeConfig = { isPlanMode: false } | { isPlanMode: true; planFilePath: string };
export const MODE_NOTIFICATIONS: Record<ModeType, string> = {
  collaboration: CHAINED_NOTIF,
  unchained: UNCHAINED_NOTIF,
  plan: PLAN_NOTIF,
};
