import type { PeriodKey } from "@/shared/api/types";

const fmtCache = new Map<string, Intl.NumberFormat>();
function nf(key: string, make: () => Intl.NumberFormat) {
  let f = fmtCache.get(key);
  if (!f) {
    f = make();
    fmtCache.set(key, f);
  }
  return f;
}

/** Full-precision money, e.g. $672,258.25 or ₹3,00,000.00 */
export function money(value: number, currency = "USD", opts: { signed?: boolean } = {}) {
  const f = nf(`m-${currency}`, () =>
    new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  );
  const s = f.format(Math.abs(value));
  if (value < 0) return `-${s}`;
  return opts.signed && value > 0 ? `+${s}` : s;
}

/** Compact money for KPIs, e.g. $1.2M */
export function moneyCompact(value: number, currency = "USD") {
  const f = nf(`mc-${currency}`, () =>
    new Intl.NumberFormat("en-US", { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 }),
  );
  return f.format(value);
}

export function pct(value: number | null | undefined, digits = 1, signed = false) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  const s = `${Math.abs(value).toFixed(digits)}%`;
  if (value < 0) return `-${s}`;
  return signed && value > 0 ? `+${s}` : s;
}

export function periodLabel(p: PeriodKey) {
  const [y, m] = p.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

export function dateLabel(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function dateTimeLabel(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function relativeTime(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return "never";
  const diff = Math.round((now - new Date(iso).getTime()) / 60000);
  if (diff < 1) return "just now";
  if (diff < 60) return `${diff} min ago`;
  const h = Math.round(diff / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function closeDay(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return `D${n >= 0 ? "+" : ""}${Number.isInteger(n) ? n : n.toFixed(1)}`;
}

export function bytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
