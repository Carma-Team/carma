/**
 * Reward stock as the business owner sees it.
 *
 * `stock` is the allocation the business committed to and the server never
 * decrements it (CAR-47) — what is left is derived per request from the
 * redemptions ledger and arrives alongside it as `available`. Rendering `stock`
 * on its own shows a number that can never move, which is the whole reason
 * these two rules were worth pulling out of the screens.
 */

/** The dashboard's stock line: what is left, out of what was allocated. */
export function formatStockLabel(
  stock: number | null,
  available: number | null,
  unlimitedLabel: string,
): string {
  if (stock === null) return unlimitedLabel;
  // `??` and not `||`: a sold-out reward has `available === 0` and has to read
  // "0/5", not fall through to the allocation and claim all five are free.
  return `${available ?? stock}/${stock}`;
}

export type ParsedStock =
  | { valid: true; stock: number | null }
  | { valid: false };

/** The reward form's stock field. Blank is a real answer — it means no cap. */
export function parseStockInput(text: string): ParsedStock {
  const trimmed = text.trim();
  if (trimmed === '') return { valid: true, stock: null };

  const stock = Number(trimmed);
  // Rejected rather than coerced: `Number('abc')` is NaN, and JSON serialises
  // NaN as null — which would quietly turn a capped reward into an unlimited one.
  if (!Number.isInteger(stock) || stock < 0) return { valid: false };
  return { valid: true, stock };
}
