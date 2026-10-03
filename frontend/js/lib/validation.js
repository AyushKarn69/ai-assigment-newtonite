// Client-side checks for the sign-up form. They mirror the server's rules so people get
// instant feedback; the server remains the authority and re-validates everything.

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX_BYTES = 72; // bcrypt ignores everything after 72 bytes

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Byte length of a string as UTF-8 (a character can take up to 4 bytes). */
export function byteLength(text) {
  return new TextEncoder().encode(String(text ?? '')).length;
}

/**
 * @returns an object with a message for each invalid field (empty when everything is fine)
 */
export function validateRegistration({ name, email, password, confirm }) {
  const errors = {};

  const cleanName = String(name ?? '').trim();
  if (!cleanName) errors.name = 'Enter your name.';
  else if (cleanName.length > 100) errors.name = 'That name is too long (100 characters at most).';

  const cleanEmail = String(email ?? '').trim();
  if (!cleanEmail) errors.email = 'Enter your email address.';
  else if (!EMAIL.test(cleanEmail) || cleanEmail.length > 254) errors.email = 'That does not look like an email address.';

  const pw = String(password ?? '');
  if (pw.length < PASSWORD_MIN) errors.password = `Use at least ${PASSWORD_MIN} characters.`;
  else if (byteLength(pw) > PASSWORD_MAX_BYTES) errors.password = 'That password is too long (72 bytes at most).';

  if (!errors.password && pw !== String(confirm ?? '')) errors.confirm = 'The two passwords do not match.';

  return errors;
}

/** A rough strength hint for the form: 0 (too short) … 3 (strong). Never blocks sign-up. */
export function passwordStrength(password) {
  const pw = String(password ?? '');
  if (pw.length < PASSWORD_MIN) return 0;
  let score = 1;
  if (pw.length >= 12) score += 1;
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(pw)).length;
  if (kinds >= 3) score += 1;
  return Math.min(score, 3);
}
