import { QueryClient } from '@tanstack/react-query';

/** Thrown from player API queryFns when `fetch` returns a non-OK status. */
export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

function queryRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof HttpError && error.status >= 400 && error.status < 500) {
    return false;
  }
  return failureCount < 2;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10 * 60 * 1000,
      gcTime: 45 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: queryRetry,
    },
  },
});
