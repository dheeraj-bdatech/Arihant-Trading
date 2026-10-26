import type { PaginatedResult } from '@arihant/shared';

export interface PaginationOptions {
  page?: number;
  limit?: number;
}

export function getPaginationParams(options?: PaginationOptions): { page: number; limit: number; offset: number } {
  // Whole, finite numbers only: "2.5" or "1e309" from a query string must never reach LIMIT / OFFSET.
  const whole = (v: unknown, fallback: number) => {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  const page = Math.min(whole(options?.page, 1), 1_000_000);
  const limit = Math.min(100, whole(options?.limit, 20));
  const offset = (page - 1) * limit;

  return { page, limit, offset };
}

export function buildPaginatedResult<T>(data: T[], total: number, page: number, limit: number): PaginatedResult<T> {
  const totalPages = Math.ceil(total / limit) || 1;
  return {
    data,
    total,
    page,
    limit,
    totalPages,
  };
}
