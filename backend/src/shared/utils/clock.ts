/**
 * Time source abstraction so time-dependent logic (e.g. lock expiry) can be
 * tested deterministically without sleeping.
 */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};
