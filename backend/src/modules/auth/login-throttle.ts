import { TooManyRequestsError } from '../../shared/errors/index';
import { Clock } from '../../shared/utils/clock';

export interface LoginThrottleOptions {
  /** Failed attempts allowed within the window before logins are refused. Default 5. */
  maxFailures?: number;
  /** Sliding window length. Default 15 minutes. */
  windowMs?: number;
}

const SWEEP_THRESHOLD = 10_000;

/**
 * Slows down password guessing: after `maxFailures` failed logins for the same
 * email within the window, further attempts (even with the right password) are
 * refused with 429 until the oldest failure ages out.
 *
 * Attempts are counted per email whether or not the account exists, so the
 * throttle does not reveal which emails are registered. The trade-off is that
 * someone can deliberately lock a known email out for the window.
 */
export class LoginThrottle {
  private readonly maxFailures: number;
  private readonly windowMs: number;
  private failures = new Map<string, number[]>(); // email -> failure timestamps (ms)

  constructor(
    private readonly clock: Clock,
    options: LoginThrottleOptions = {},
  ) {
    this.maxFailures = options.maxFailures ?? 5;
    this.windowMs = options.windowMs ?? 15 * 60 * 1000;
  }

  /** Throws TooManyRequestsError if this email is currently locked out. */
  assertAllowed(email: string): void {
    const recent = this.recent(email);
    if (recent.length < this.maxFailures) return;

    const unlocksAt = recent[recent.length - this.maxFailures] + this.windowMs;
    const retryAfterSeconds = Math.max(1, Math.ceil((unlocksAt - this.clock.now().getTime()) / 1000));
    throw new TooManyRequestsError(
      'Too many failed login attempts. Try again later.',
      'TOO_MANY_LOGIN_ATTEMPTS',
      retryAfterSeconds,
    );
  }

  recordFailure(email: string): void {
    const key = normalize(email);
    const list = this.recent(email);
    list.push(this.clock.now().getTime());
    this.failures.set(key, list);
    if (this.failures.size > SWEEP_THRESHOLD) this.sweep();
  }

  recordSuccess(email: string): void {
    this.failures.delete(normalize(email));
  }

  /** Failure timestamps still inside the window, oldest first. */
  private recent(email: string): number[] {
    const cutoff = this.clock.now().getTime() - this.windowMs;
    const list = (this.failures.get(normalize(email)) ?? []).filter((t) => t > cutoff);
    if (list.length === 0) this.failures.delete(normalize(email));
    return list;
  }

  private sweep(): void {
    const cutoff = this.clock.now().getTime() - this.windowMs;
    for (const [key, list] of this.failures) {
      if (list[list.length - 1] <= cutoff) this.failures.delete(key);
    }
  }
}

function normalize(email: string): string {
  return email.trim().toLowerCase();
}
