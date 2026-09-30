/*
 * Guards state shared between an in-flight loop and an out-of-band claimant (e.g. an exit
 * handler) from interleaved mutation. A new lease() invalidates every previously-issued ref;
 * consume() claims ownership permanently — no further lease() or consume() is honored — so
 * the consumer can never be overridden. A stale ref's pending ifOwner callbacks silently stop
 * running, moving mutation exclusively to the current owner.
 */
export type OwnershipLockRef = {
  ifOwner(callback: () => Promise<void>): Promise<void>;
};

export class OwnershipLock {
  private count = 0;
  private consumed = false;

  lease(): OwnershipLockRef {
    return this.ref(this.consumed ? -1 : ++this.count);
  }

  consume(): OwnershipLockRef {
    if (this.consumed) return this.ref(-1);
    this.consumed = true;
    return this.ref(++this.count);
  }

  private ref(id: number): OwnershipLockRef {
    return {
      ifOwner: async callback => {
        if (id === this.count) await callback();
      },
    };
  }
}
