/*
 * Limits on how much one member, and the whole server, can ask of the plugin. Each stream is one
 * real-time encode of CPU and one stream's worth of upload per viewer.
 */

/** A check that allows each key at most `limit` uses in any `windowMs`. */
const createRateLimiter = (limit: number, windowMs: number, now = () => Date.now()) => {
  const uses = new Map<number, number[]>();

  return (key: number): boolean => {
    const at = now();
    const recent = (uses.get(key) ?? []).filter((used) => at - used < windowMs);

    if (recent.length >= limit) {
      uses.set(key, recent);

      return false;
    }

    recent.push(at);
    uses.set(key, recent);

    return true;
  };
};

/** Whether a stream may start in channelId: replacing that channel's own video doesn't add one. */
const canStartStream = (activeChannels: Iterable<number>, channelId: number, max: number): boolean => {
  let others = 0;

  for (const id of activeChannels) if (id !== channelId) others += 1;

  return others < max;
};

export { canStartStream, createRateLimiter };
