// Tiny publish/subscribe helper. Pages subscribe to data changes and re-render.
const listeners = new Map();

/** Listen to a topic. Returns a function that stops listening. */
export function on(topic, handler) {
  if (!listeners.has(topic)) listeners.set(topic, new Set());
  listeners.get(topic).add(handler);
  return () => listeners.get(topic)?.delete(handler);
}

export function emit(topic, payload) {
  for (const handler of [...(listeners.get(topic) || [])]) {
    try {
      handler(payload);
    } catch (err) {
      console.error(`[SMMS] Listener for "${topic}" failed:`, err);
    }
  }
}
