import HOTP from "./hotp";

/**
 * Calculates the current TOTP value based on the given key and interval.
 *
 * @param {number[]} key - The secret key for the TOTP.
 * @param {number} interval - The time interval in seconds between TOTP code changes (default: 30).
 * @returns {number} The current TOTP value.
 */
function calculateTOTP(key: number[], interval: number = 30): number {
  const counterValue = Math.floor(new Date().getTime() / 1000) / interval;
  const hotp = new HOTP(key, counterValue);
  return hotp.value();
}

/**
 * Calculates the time until the next TOTP code change in milliseconds.
 *
 * @param {number} interval - The time interval in seconds between TOTP code changes (default: 30).
 * @returns {number} The time until the next code change in milliseconds.
 */
function timeUntilTOTPUpdate(interval: number = 30): number {
  return 30000 - (new Date().getTime() % (interval * 1000));
}

export { calculateTOTP, timeUntilTOTPUpdate };