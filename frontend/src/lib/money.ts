/** Null means the amount wasn't recorded, which isn't the same as zero. */
export function formatMoney(amount: string | number | null, currency: string) {
  if (amount === null) return "Not recorded";
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(amount));
}
