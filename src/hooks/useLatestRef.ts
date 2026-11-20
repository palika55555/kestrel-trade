import {useRef, type RefObject} from 'react';

/**
 * Returns a ref whose `.current` is re-assigned to `value` on every render.
 * Used by long-lived handlers (SSE tick loop, pollers) to read fresh state
 * without re-subscribing.
 */
export function useLatestRef<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
