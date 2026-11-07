let verboseEnabled = !!process.env["OCTO_VERBOSE"];

export type LogItem = { target: "stdout" | "stderr"; content: any };

let buffering = false;
let queued: LogItem[] = [];

export function setVerbose(enabled: boolean) {
  verboseEnabled = enabled;
}

// Paintcannon only repaints the cells it knows it owns, so writing to the
// terminal while it holds the pty corrupts the screen. While it's up, hold
// writes in memory and let the caller replay them once it has exited.
export function startBuffering() {
  buffering = true;
}

export function stopBuffering() {
  buffering = false;
}

export function flush(): LogItem[] {
  const items = queued;
  queued = [];
  return items;
}

function write({ target, content }: LogItem) {
  if (target === "stdout") console.log(...content);
  else console.error(...content);
}

export function drain() {
  for (const item of flush()) write(item);
}

function emit(target: LogItem["target"], ...args: any[]) {
  const item: LogItem = { target, content: args };
  if (buffering) queued.push(item);
  else write(item);
}

export function verbose(...args: any[]) {
  if (!verboseEnabled) return;
  emit("stdout", ...args);
}

export function info(...args: any[]) {
  emit("stdout", ...args);
}

export function warn(...args: any[]) {
  emit("stderr", ...args);
}

export function error(...args: any[]) {
  emit("stderr", ...args);
}

export function displayLog({ info, verbose }: { info: string; verbose: string }) {
  if (verboseEnabled) return verbose;
  return info;
}
