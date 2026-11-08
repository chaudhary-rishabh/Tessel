"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const scrollToEnd = (element: HTMLElement) => element.scrollTo({ top: element.scrollHeight });

/**
 * Keeps a scroll container pinned to the bottom while content grows, unless
 * the user has scrolled up to read something. Pass `ref` to the container.
 */
export function useStickToBottom<T extends HTMLElement>(dependency: unknown) {
  const [element, setElement] = useState<T | null>(null);
  const pinned = useRef(true);

  const onScroll = useCallback(() => {
    if (!element) return;
    pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
  }, [element]);

  useEffect(() => {
    if (element && pinned.current) scrollToEnd(element);
  }, [element, dependency]);

  const pin = useCallback(() => {
    pinned.current = true;
    if (element) scrollToEnd(element);
  }, [element]);

  return { ref: setElement, onScroll, pin };
}
