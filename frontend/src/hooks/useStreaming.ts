import { useRef, useState, useCallback } from 'react';

/**
 * rAF-batched token streaming.
 * Stores buffers in a ref (no re-render per token),
 * flushes to state once per animation frame.
 */
export function useStreaming(): {
  getBuffer: (messageId: string) => string;
  appendToken: (messageId: string, token: string) => void;
  clearBuffer: (messageId: string) => void;
  streamVersion: number;
} {
  const buffers = useRef<Map<string, string>>(new Map());
  const rafPending = useRef(false);
  const [streamVersion, setStreamVersion] = useState(0);

  const scheduleFlush = useCallback(() => {
    if (rafPending.current) return;
    rafPending.current = true;
    requestAnimationFrame(() => {
      rafPending.current = false;
      setStreamVersion(v => v + 1);
    });
  }, []);

  const appendToken = useCallback(
    (messageId: string, token: string) => {
      const current = buffers.current.get(messageId) ?? '';
      buffers.current.set(messageId, current + token);
      scheduleFlush();
    },
    [scheduleFlush]
  );

  const getBuffer = useCallback((messageId: string): string => {
    return buffers.current.get(messageId) ?? '';
  }, []);

  const clearBuffer = useCallback((messageId: string) => {
    buffers.current.delete(messageId);
  }, []);

  return { getBuffer, appendToken, clearBuffer, streamVersion };
}
