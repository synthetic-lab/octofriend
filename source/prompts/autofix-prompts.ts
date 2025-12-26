import { t, toTypescript } from "structural";
import * as toolMap from "../tools/tool-defs/index.ts";
type DiffEdit = t.GetType<typeof toolMap.edit.DiffEdit>;

export const DiffApplySuccess = t.subtype({
  success: t.value(true),
  search: t.str,
});
export const DiffApplyFailure = t.subtype({
  success: t.value(false),
});
export const DiffApplyResponse = DiffApplySuccess.or(DiffApplyFailure);
export function fixEditPrompt(brokenEdit: { file: string, edit: DiffEdit }) {
  return (
`The following diff edit is invalid: the search string does not match perfectly with the file contents.
Your task is to fix the search string if possible.

Respond only with JSON in the following format, defined as TypeScript types:

// Response if you fixed the search string:
${toTypescript({ DiffApplySuccess })}

// Response if the edit is impossible to fix (search string is ambiguous or has no clear matches):
${toTypescript({ DiffApplyFailure })}

Here's the broken edit and underlying file it's being applied to:
${JSON.stringify(brokenEdit)}`
  );
}

export const JsonFixSuccess = t.subtype({
  success: t.value(true),
  fixed: t.any.comment("The parsed JSON"),
});
export const JsonFixFailure = t.subtype({
  success: t.value(false),
});
export const JsonFixResponseSchema = JsonFixSuccess.or(JsonFixFailure);
export type JsonFixResponse = t.GetType<typeof JsonFixResponseSchema>;

export function fixJsonPrompt(str: string) {
  return (
`The following string may be broken JSON. Fix it if possible. Respond with JSON in the following
format, defined as TypeScript types:

// Success response:
${toTypescript({ JsonFixSuccess })}

// Failure response:
${toTypescript({ JsonFixFailure })}

If it's more-or-less JSON, fix it and respond with the success response. If it's not, respond with
the failure response. Here's the string:
${str}`
);
}
