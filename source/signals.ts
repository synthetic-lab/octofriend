export function timeout(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => {
    controller.abort();
  }, ms);
  return controller.signal;
}
