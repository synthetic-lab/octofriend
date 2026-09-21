export async function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>(resolve => {
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    if (signal?.aborted) return finish();
    signal?.addEventListener("abort", finish, { once: true });
  });
}
