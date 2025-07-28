import { t } from "structural";
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

export function fixJsonPrompt(str: string) {
  return (
`The following string may be broken JSON. Fix it if possible; if it's not JSON, return null.
Respond only with valid JSON.
${str}`
);
}
