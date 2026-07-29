/*
 * The roles of every IR shape built into libocto, in contrast to tool-defined extension IRs
 * (see ToolExtensionIR) whose roles are not statically known here. Keep this list exhaustive:
 * the _BuiltinIRRolesMatch assertion in llm-ir.ts forces the built-in IR union to stay in sync
 * with it, and answeredToolCallId relies on that to switch exhaustively over built-in roles.
 */
export const BUILTIN_IR_ROLES = {
  assistant: true,
  user: true,
  checkpoint: true,
  "lowered-checkpoint": true,
  "tool-output": true,
  "tool-runtime-error": true,
  "tool-validation-error": true,
  "tool-parse-error": true,
  "tool-skip-output": true,
  trajectory: true,
} as const;

export type BuiltinIRRole = keyof typeof BUILTIN_IR_ROLES;
