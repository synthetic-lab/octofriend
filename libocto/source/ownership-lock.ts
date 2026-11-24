/*
 * A lock to synchronize mutating shared state between different async functions that may get called
 * at different times.
 *
 * Wrap all mutations to the shared state in ifOwner(async () => { ... }) checks. Assuming you do
 * that, the lock will prevent certain types of race conditions. The way it works is:
 *
 * 1. If you want to be allowed to mutate state, call .lease(), which gives you a lock reference
 * with an ifOwner method.
 * 2. If someone later calls .lease() after you on the same lock, they'll acquire it, and your
 * attempts to mutate will no-op.
 * 3. If you want to permanently gain ownership of the lock and prevent anyone from taking it from
 * you in the future, call .consume(). Future calls to .lease() will always return lock references
 * that no-op their ifOwner checks.
 *
 * This allows you to build relatively flexible heirarchies around controlling state mutation. If
 * you only want to mutate state if someone else hasn't touched it in the meantime, use .lease(). If
 * you want to gain permanent ownership and prevent others from mutating the shared state, call
 * .consume().
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
