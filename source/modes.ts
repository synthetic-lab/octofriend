const UNCHAINED_NOTIF = "Octo runs edits and shell commands automatically";
const CHAINED_NOTIF = "Octo asks permission before running edits or shell commands";
const PLAN_NOTIF = "Octo is in plan mode - exploration and planning tools only";

export type ModeType = "collaboration" | "unchained" | "plan";
export const MODES: ModeType[] = ["collaboration", "unchained", "plan"];
export type PlanModeConfig =
  | { isPlanMode: false }
  | { isPlanMode: true; planFilePath: string | null };
export const MODE_NOTIFICATIONS: Record<ModeType, string> = {
  collaboration: CHAINED_NOTIF,
  unchained: UNCHAINED_NOTIF,
  plan: PLAN_NOTIF,
};
