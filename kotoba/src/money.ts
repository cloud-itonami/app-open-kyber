/**
 * open-kyber kotoba — decimal MONEY helpers (no float; AT-Lexicon has no float type).
 *
 * All amounts are non-negative decimal STRINGS. Arithmetic is exact via BigInt fixed-point:
 * each value is scaled to a common number of fractional digits, summed as integers, and
 * rendered back to a string. This avoids IEEE-754 rounding in ledger math entirely.
 */

const DECIMAL_RE = /^\d+(\.\d+)?$/;

/** True for a non-negative decimal money string. */
export function isMoney(s: unknown): s is string {
  return typeof s === "string" && DECIMAL_RE.test(s);
}

/** Fractional-digit count of a decimal string. */
function fracDigits(s: string): number {
  const i = s.indexOf(".");
  return i < 0 ? 0 : s.length - i - 1;
}

/** Scale a decimal string to `scale` fractional digits, as a BigInt of minor units. */
function toScaledBigInt(s: string, scale: number): bigint {
  const neg = s.startsWith("-");
  const body = neg ? s.slice(1) : s;
  const [intPart, fracPart = ""] = body.split(".");
  const frac = (fracPart + "0".repeat(scale)).slice(0, scale);
  const v = BigInt((intPart || "0") + frac);
  return neg ? -v : v;
}

/** Render a BigInt of minor units at `scale` back to a decimal string (trims trailing zeros). */
function fromScaledBigInt(v: bigint, scale: number): string {
  const neg = v < 0n;
  const abs = (neg ? -v : v).toString().padStart(scale + 1, "0");
  const intPart = abs.slice(0, abs.length - scale) || "0";
  let frac = scale > 0 ? abs.slice(abs.length - scale) : "";
  frac = frac.replace(/0+$/, "");
  const out = frac ? `${intPart}.${frac}` : intPart;
  return neg ? `-${out}` : out;
}

/** Sum a list of decimal money strings exactly. Returns a decimal string. */
export function sumMoney(values: readonly string[]): string {
  if (values.length === 0) return "0";
  const scale = Math.max(...values.map(fracDigits), 0);
  let acc = 0n;
  for (const v of values) acc += toScaledBigInt(v, scale);
  return fromScaledBigInt(acc, scale);
}

/** a - b (may be negative). Returns a decimal string. */
export function subMoney(a: string, b: string): string {
  const scale = Math.max(fracDigits(a), fracDigits(b));
  return fromScaledBigInt(toScaledBigInt(a, scale) - toScaledBigInt(b, scale), scale);
}

/** Exact equality of two decimal money strings regardless of trailing zeros. */
export function eqMoney(a: string, b: string): boolean {
  const scale = Math.max(fracDigits(a), fracDigits(b));
  return toScaledBigInt(a, scale) === toScaledBigInt(b, scale);
}

/** True if the decimal string equals zero. */
export function isZero(s: string): boolean {
  return /^0+(\.0+)?$/.test(s);
}

/** a × n (n a non-negative integer), exact. Returns a decimal string. */
export function mulMoneyInt(a: string, n: number): string {
  if (!Number.isInteger(n) || n < 0) throw new Error(`mulMoneyInt: n must be a non-negative integer: ${n}`);
  const scale = fracDigits(a);
  return fromScaledBigInt(toScaledBigInt(a, scale) * BigInt(n), scale);
}

/** a ÷ n (n a positive integer), rounded HALF-UP to `dp` fractional digits. */
export function divMoney(a: string, n: number, dp = 2): string {
  if (!Number.isInteger(n) || n <= 0) throw new Error(`divMoney: n must be a positive integer: ${n}`);
  const num = toScaledBigInt(a, dp);
  const N = BigInt(n);
  let q = num / N;
  const r = num % N;
  if (r * 2n >= N) q += 1n; // half-up (operands non-negative for ledger amounts)
  return fromScaledBigInt(q, dp);
}

/** a × b (two decimal strings), EXACT. Used for qty × unit-cost in inventory valuation. */
export function mulMoney(a: string, b: string): string {
  const sa = fracDigits(a);
  const sb = fracDigits(b);
  return fromScaledBigInt(toScaledBigInt(a, sa) * toScaledBigInt(b, sb), sa + sb);
}

/** a ÷ b (b a positive decimal string), rounded HALF-UP to `dp` digits. For moving averages. */
export function divMoneyBy(a: string, b: string, dp = 4): string {
  const sa = fracDigits(a);
  const sb = fracDigits(b);
  const A = toScaledBigInt(a, sa);
  const B = toScaledBigInt(b, sb);
  if (B === 0n) throw new Error("divMoneyBy: divide by zero");
  const TEN = 10n;
  // a/b at dp digits = round( A · 10^(sb+dp) / (B · 10^sa) )
  const numerator = A * TEN ** BigInt(sb + dp);
  const denom = B * TEN ** BigInt(sa);
  let q = numerator / denom;
  const rem = numerator % denom;
  if (rem * 2n >= denom) q += 1n; // half-up (non-negative operands)
  return fromScaledBigInt(q, dp);
}
