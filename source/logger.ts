const levelNames = ["verbose", "info"] as const;
type LogLevel = (typeof levelNames)[number];
let level = process.env["OCTO_VERBOSE"] ? 0 : 1;

export function setLevel(newLevel: LogLevel) {
  level = levelNames.indexOf(newLevel);
}

export function log(logLevel: LogLevel, ...args: any[]) {
  const levelIndex = levelNames.indexOf(logLevel);
  if (levelIndex >= level) {
    console.log(...args);
  }
}

export function error(logLevel: LogLevel, ...args: any[]) {
  const levelIndex = levelNames.indexOf(logLevel);
  if (levelIndex >= level) {
    console.error(...args);
  }
}

export function displayLog({ info, verbose }: { info: string; verbose: string }) {
  const currLevel = levelNames[level];
  if (currLevel === "verbose") return verbose;
  return info;
}
