import { useEffect, useRef, useCallback } from 'react';
import { BackendMessage } from '@ciper-agent/shared';
import { onExtensionMessage } from '../vscodeApi';

export function useVSCodeMessage(
  handler: (message: BackendMessage) => void
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  const stableHandler = useCallback((msg: BackendMessage) => {
    handlerRef.current(msg);
  }, []);

  useEffect(() => {
    const unsubscribe = onExtensionMessage(stableHandler);
    return unsubscribe;
  }, [stableHandler]);
}
