import { registry } from "antipattern";

export const logger = registry({
  log: {
    verbose(...args: any[]) {
      console.log(...args);
    },
    info(...args: any[]) {
      console.log(...args);
    },
    warn(...args: any[]) {
      console.error(...args);
    },
    error(...args: any[]) {
      console.error(...args);
    },
  },
});

export type Logger = (typeof logger)["log"];
