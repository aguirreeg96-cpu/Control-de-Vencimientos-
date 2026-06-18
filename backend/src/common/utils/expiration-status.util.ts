export type ExpirationStatus = 'EXPIRED' | 'EXPIRING_SOON' | 'VALID';

const EXPIRING_SOON_DAYS = 30;

export function computeExpirationStatus(expiryDate: Date): ExpirationStatus {
  const now = new Date();
  // Compare using UTC midnight to avoid timezone drift
  const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const expiryUTC = Date.UTC(
    expiryDate.getUTCFullYear(),
    expiryDate.getUTCMonth(),
    expiryDate.getUTCDate(),
  );
  const threshold = todayUTC + EXPIRING_SOON_DAYS * 24 * 60 * 60 * 1000;

  if (expiryUTC < todayUTC) return 'EXPIRED';
  if (expiryUTC <= threshold) return 'EXPIRING_SOON';
  return 'VALID';
}
