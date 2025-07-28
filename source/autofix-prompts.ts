import { t, toTypescript } from "structural";
import * as toolMap from "./tools/tool-defs/index.ts";
type DiffEdit = t.GetType<typeof toolMap.edit.DiffEdit>;

export function fixEditPrompt(brokenEdit: { file: string, edit: DiffEdit }) {
  return (
`This edit is invalid; please fix it. The search string does not match perfectly with the file contents.
Respond only with JSON, and only with the edit JSON, not the original file.
If the edit is ambiguous, respond with null.
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
export const JsonFixResponse = JsonFixSuccess.or(JsonFixFailure);

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
