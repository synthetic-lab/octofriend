// Some terminals report unmodified printable keys via the kitty keyboard
// protocol with an *empty* modifier field, e.g. `CSI 104 ;; 104 u` for the
// 'h' key (codepoint 104, no modifiers, associated text 'h'). Ink's parser
// requires the modifier field to be present, so these sequences fall through
// to legacy parsing and leak as literal text (`[104;;104u`) into the prompt.
//
// We can't patch Ink itself (it's an npm dependency, and this CLI is installed
// with `--omit=dev`), so instead we normalize the raw stdin stream before Ink
// reads it: insert an explicit `1` (the "no modifiers" value) into the empty
// modifier field, turning `CSI 104 ;; 104 u` into `CSI 104 ; 1 ; 104 u`,
// which Ink parses correctly as a printable key.
//
// Sequences that already carry a modifier field are untouched — only the bare
// `;;` empty-modifier form is rewritten. So Shift+Enter (`CSI 13;2u`),
// Shift+h (`CSI 104;2;72u`), plain Enter (`CSI 13u`), Escape (`CSI 27u`),
// etc. all pass through unchanged.
export function normalizeKittyStdin(stdin: NodeJS.ReadStream): void {
  const marked = stdin as any;
  if (marked.__kittyNormalized) return;
  marked.__kittyNormalized = true;

  const originalRead = stdin.read.bind(stdin);
  stdin.read = ((...args: any[]) => {
    const chunk = originalRead(...args);
    if (typeof chunk !== "string" || chunk.indexOf("\u001b[") === -1) {
      return chunk;
    }
    return chunk.replace(/\u001b\[(\d+);;([\d:]+)u/g, "\u001b[$1;1;$2u");
  }) as any;
}
