/** Concurrent CLI runs allowed per api process. */
export const PLATFORM_AGENT_MAX_CONCURRENT_RUNS = 4;

/** Counting semaphore without queueing: `tryAcquire` returns a release function or `null`. */
export function createRunSlots(max: number) {
  let active = 0;
  return {
    tryAcquire(): (() => void) | null {
      if (active >= max) {
        return null;
      }
      active += 1;
      let released = false;
      return () => {
        if (released) {
          return;
        }
        released = true;
        active -= 1;
      };
    },
    active(): number {
      return active;
    },
  };
}
