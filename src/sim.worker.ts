/**
 * Heartbeat for the maze simulation.
 * Main-thread timers and requestAnimationFrame pause or slow down in a hidden
 * tab. A worker interval keeps firing, and a pump reply lets the page drain a
 * backlog without waiting for the next interval.
 */

const STEP_MS = 1000 / 60;

setInterval(() => {
  self.postMessage({ type: 'tick' });
}, STEP_MS);

self.onmessage = (event: MessageEvent) => {
  const data: unknown = event.data;
  if (typeof data !== 'object' || data === null || !('type' in data)) return;
  if (data.type === 'pump') self.postMessage({ type: 'drain' });
};
