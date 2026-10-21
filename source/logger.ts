const levelNames = ["verbose", "info"] as const;
type LogLevel = (typeof levelNames)[number];
let level = process.env["OCTO_VERBOSE"] ? 0 : 1;

export type LogItem = { target: "stdout" | "stderr"; content: any };

let buffering = false;
let queued: LogItem[] = [];

export function setLevel(newLevel: LogLevel) {
  level = levelNames.indexOf(newLevel);
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

function emit(target: LogItem["target"], logLevel: LogLevel, ...args: any[]) {
  // Filtered-out messages are never queued, so the queue doesn't carry a level.
  if (levelNames.indexOf(logLevel) < level) return;

  const item: LogItem = { target, content: args };
  if (buffering) queued.push(item);
  else write(item);
}

export function log(logLevel: LogLevel, ...args: any[]) {
  emit("stdout", logLevel, ...args);
}

export function error(logLevel: LogLevel, ...args: any[]) {
  emit("stderr", logLevel, ...args);
}

export function displayLog({ info, verbose }: { info: string; verbose: string }) {
  const currLevel = levelNames[level];
  if (currLevel === "verbose") return verbose;
  return info;
}
