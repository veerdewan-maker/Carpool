"use client";

import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "./format";

type State<T> = { data: T | null; error: string | null; loading: boolean };

/**
 * Runs `fetcher` when it changes (and on `reload()`), discarding results from
 * superseded calls. Pass a `useCallback`-wrapped fetcher that returns the data
 * and throws on failure.
 */
export function useAsyncData<T>(fetcher: () => Promise<T>) {
  const [state, setState] = useState<State<T>>({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let active = true;
    fetcher().then(
      (data) => {
        if (active) setState({ data, error: null, loading: false });
      },
      (e: unknown) => {
        if (active) setState((s) => ({ data: s.data, error: errorMessage(e), loading: false }));
      }
    );
    return () => {
      active = false;
    };
  }, [fetcher, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}
