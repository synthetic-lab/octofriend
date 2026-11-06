export type Logger = {
  log(...args: any[]): void;
  error(...args: any[]): void;
};

export const consoleLogger: Logger = {
  log: (...args) => console.log(...args),
  error: (...args) => console.error(...args),
};
