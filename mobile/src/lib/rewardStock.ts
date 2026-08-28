/**
 * @file rewardStock.ts
 * @owner Shaun (CEO) — business logic and the rewards domain
 * @brief The reward-stock rules the business screens and the marketplace share.
 * Formats the "left out of allocated" line, parses the stock field where blank means no cap,
 * and decides what counts as sold out — for the card that disables it and the list that sorts it down.
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

/**
 * Sold out, for a reward the server reported on. `=== 0` and not a falsy test:
 * `null` is the uncapped case and is always redeemable.
 *
 * The card disables exactly what the list sorts to the end, so the rule is shared
 * rather than written twice — the two drifting apart offers a reward the list
 * already gave up on.
 */
export function isSoldOut(available: number | null): boolean {
  return available === 0;
}

/** The marketplace list order: sold out last, everything else where it already was. */
export function sortByAvailability<T extends { available: number | null }>(rewards: T[]): T[] {
  // Sorts a copy — the caller's array is React state. `sort` is stable, so the
  // cost ordering the server applied survives inside each group.
  return [...rewards].sort((a, b) => Number(isSoldOut(a.available)) - Number(isSoldOut(b.available)));
}
