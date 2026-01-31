import { setMaxListeners } from "node:events";

export function timeout(ms: number): AbortSignal {
  const controller = new AbortController();
  setMaxListeners(0, controller.signal);
  setTimeout(() => {
    controller.abort();
  }, ms);
  return controller.signal;
}
