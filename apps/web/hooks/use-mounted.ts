import { useSyncExternalStore } from 'react';

const subscribe = (): (() => void) => () => undefined;

export function useMounted(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
