const OCTO_PROCESS_TITLE = "\\_o_O.//"; // tmux window name
const OCTO_TERMINAL_TITLE = "\\\\_o_O.//"; // terminal title bar
// Escape sequence refs: https://invisible-island.net/xterm/ctlseqs/ctlseqs.html
// search webpage for "XTWINOPS 2 2  (save/push title) and 2 3  (restore/pop title)"
const SAVE_TERMINAL_TITLE = "\x1b[22;0t";
const RESTORE_TERMINAL_TITLE = "\x1b[23;0t";

export function setOctoTitles() {
  const originalProcessTitle = process.title;
  const isTTY = process.stdout.isTTY;
  let restored = false;

  const writeSequence = (sequence: string) => {
    if (isTTY) process.stdout.write(sequence);
  };

  writeSequence(SAVE_TERMINAL_TITLE);
  process.title = OCTO_PROCESS_TITLE;
  writeSequence(`\x1b]0;${OCTO_TERMINAL_TITLE}\x07`);

  const restoreTitles = () => {
    if (restored) return;
    restored = true;
    process.title = originalProcessTitle;
    try {
      writeSequence(RESTORE_TERMINAL_TITLE);
    } catch {
      // can technically fail, but not much we can do at that point
    }
  };
  process.once("exit", restoreTitles);

  return () => {
    // @ts-expect-error @types/node declares `on`/`once` overloads for process
    // events but omits the `off` overload, despite Process being an
    // EventEmitter.
    process.off("exit", restoreTitles);
    restoreTitles();
  };
}
