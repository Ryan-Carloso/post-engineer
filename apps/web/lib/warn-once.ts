export interface WarnOnceOptions {
  windowMs: number;
  maxKeys: number;
  now: () => number;
}

export function createWarnOnce(options: WarnOnceOptions): (key: string) => boolean {
  const quietUntil = new Map<string, number>();
  return (key: string): boolean => {
    const now = options.now();
    const until = quietUntil.get(key);
    if (until !== undefined && now < until) return false;
    quietUntil.delete(key);
    while (quietUntil.size >= options.maxKeys) {
      const oldest = quietUntil.keys().next();
      if (oldest.done === true) break;
      quietUntil.delete(oldest.value);
    }
    quietUntil.set(key, now + options.windowMs);
    return true;
  };
}
