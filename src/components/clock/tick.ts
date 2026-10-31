/**
 * A once-a-second tick shared by everything showing the running clock (top bar, dashboard, tab title, pop-out),
 * as an external store: it only runs while something subscribes, and reads the system clock outside render.
 */
let tick = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

export function subscribeTick(onTick: () => void): () => void {
  listeners.add(onTick);
  if (!timer) {
    tick = Date.now();
    timer = setInterval(() => {
      tick = Date.now();
      for (const listener of listeners) listener();
    }, 1000);
  }
  return () => {
    listeners.delete(onTick);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export const subscribeNothing = () => () => {};
export const getTick = () => tick;
export const getServerTick = () => 0;
