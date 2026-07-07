import { registry } from "antipattern";

export const fetchDeps = registry({
  fetch(
    input: Parameters<typeof globalThis.fetch>[0],
    init?: Parameters<typeof globalThis.fetch>[1],
  ) {
    return fetch(input, init);
  },
});
