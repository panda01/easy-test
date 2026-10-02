import { useEffect, useState } from "react";

/** The JSON body returned by `GET /api/health`. */
export interface HealthStatus {
  status: string;
  uptime: number;
}

/**
 * Fetches `GET /api/health` once on mount and exposes the result as three flat
 * values, so a component can render loading / healthy / unreachable without
 * unpacking a discriminated union.
 *
 * Plain `fetch` against a RELATIVE url on purpose: in dev the Vite server
 * proxies `/api` to the Express process, so there is no base url to configure
 * and no CORS to enable. No axios, no react-query.
 *
 * The `cancelled` flag is what stops a response that resolves after unmount
 * from calling setState on a dead component.
 * @returns `{ health, isLoading, errorMessage }`: `health` is null until a
 *   successful response arrives; `errorMessage` is non-null only when the
 *   request failed or returned a non-2xx status.
 */
export function useHealth(): {
  health: HealthStatus | null;
  isLoading: boolean;
  errorMessage: string | null;
} {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    /**
     * Performs the GET and records its outcome, unless the component has
     * unmounted in the meantime.
     * @returns Resolves once the outcome is recorded (or discarded when cancelled)
     */
    const loadHealth = async (): Promise<void> => {
      try {
        const response = await fetch("/api/health");
        const responseIsOk = response.ok;
        if (!responseIsOk) {
          throw new Error(`Server responded with ${String(response.status)}`);
        }
        const data = (await response.json()) as HealthStatus;
        if (cancelled) return;
        setHealth(data);
        setErrorMessage(null);
      } catch (err: unknown) {
        if (cancelled) return;
        setHealth(null);
        setErrorMessage(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void loadHealth();

    return () => {
      cancelled = true;
    };
  }, []);

  return { health, isLoading, errorMessage };
}
