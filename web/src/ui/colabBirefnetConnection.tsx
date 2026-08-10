import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ColabBirefnetConnectionConfig } from '../webpipe/colabBirefnet.js';

export interface ColabBirefnetConnection {
  config: ColabBirefnetConnectionConfig;
  configuredAt: number;
  /** In-memory cache identity. This is not a credential and is never persisted. */
  generation: number;
}

interface ColabBirefnetConnectionContextValue {
  connection: ColabBirefnetConnection | null;
  setConnection: (config: ColabBirefnetConnectionConfig) => void;
  forgetConnection: () => void;
  registerActiveRemoval: (controller: AbortController) => () => void;
}

const ColabBirefnetConnectionContext = createContext<ColabBirefnetConnectionContextValue | null>(null);

export function createColabBirefnetRemovalRegistry() {
  const activeControllers = new Set<AbortController>();
  return {
    register(controller: AbortController): () => void {
      activeControllers.add(controller);
      return () => activeControllers.delete(controller);
    },
    invalidate(): void {
      for (const controller of activeControllers) controller.abort();
      activeControllers.clear();
    },
  };
}

/**
 * Deliberately in-memory only. Do not persist the rotating tunnel URL or
 * session key to storage, a URL, logs, downloads, or Project ZIP metadata.
 */
export function ColabBirefnetConnectionProvider({ children }: { children: React.ReactNode }) {
  const [connection, setConnectionState] = useState<ColabBirefnetConnection | null>(null);
  const generationRef = useRef(0);
  const removalRegistry = useMemo(createColabBirefnetRemovalRegistry, []);
  const setConnection = useCallback((config: ColabBirefnetConnectionConfig) => {
    removalRegistry.invalidate();
    const generation = ++generationRef.current;
    setConnectionState({ config: { ...config }, configuredAt: Date.now(), generation });
  }, [removalRegistry]);
  const forgetConnection = useCallback(() => {
    removalRegistry.invalidate();
    setConnectionState(null);
  }, [removalRegistry]);
  const registerActiveRemoval = useCallback(
    (controller: AbortController) => removalRegistry.register(controller),
    [removalRegistry],
  );
  const value = useMemo(
    () => ({ connection, setConnection, forgetConnection, registerActiveRemoval }),
    [connection, forgetConnection, registerActiveRemoval, setConnection],
  );
  return (
    <ColabBirefnetConnectionContext.Provider value={value}>
      {children}
    </ColabBirefnetConnectionContext.Provider>
  );
}

export function useColabBirefnetConnection(): ColabBirefnetConnectionContextValue {
  const value = useContext(ColabBirefnetConnectionContext);
  if (!value) throw new Error('ColabBirefnetConnectionProvider is missing');
  return value;
}
