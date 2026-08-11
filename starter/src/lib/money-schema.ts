import { z } from 'zod';
import { dec } from './money';

// Shared zod schema for money amounts at API boundaries.
// Money travels as strings (see src/lib/money.ts); JSON numbers are rejected outright
// so client bugs surface as 400s instead of silent float precision loss.
// Bounds mirror the DECIMAL(36,18) columns: more than 18 decimal places would be
// silently rounded by Postgres, and values at or beyond 1e18 would overflow into
// a 500 instead of a clean validation error.
export const positiveMoneyString = z.string().refine(
  (value) => {
    try {
      const bn = dec(value);
      // decimalPlaces() is only null for non-finite values, which dec() already rejects.
      return bn.isGreaterThan(0) && (bn.decimalPlaces() ?? 0) <= 18 && bn.isLessThan('1e18');
    } catch {
      return false;
    }
  },
  { message: 'must be a positive decimal string with at most 18 decimal places' },
);
