// sdk/mcp/src/ui/variantMatrix.ts
//
// Pure helpers for attribute-matrix variant selection (no DOM). A "selection" is a
// map of axis name -> chosen value. These resolve which variant a partial/complete
// selection points at and which axis values are still in-stock-reachable.
import type { ProductCardVariant } from '../cards/types.js';

export interface VariantAxis {
  name: string;
  values: string[];
}

/** Ordered axes derived from the variants' attributes (distinct values, first-seen order). */
export function deriveAxes(variants: ProductCardVariant[]): VariantAxis[] {
  const order: string[] = [];
  const byName = new Map<string, string[]>();
  for (const v of variants) {
    for (const a of v.attributes ?? []) {
      if (!byName.has(a.name)) { byName.set(a.name, []); order.push(a.name); }
      const vals = byName.get(a.name)!;
      if (!vals.includes(a.value)) vals.push(a.value);
    }
  }
  return order.map((name) => ({ name, values: byName.get(name)! }));
}

/** True if a variant's attributes satisfy every entry in `selection`. */
function matchesSelection(v: ProductCardVariant, selection: Record<string, string>): boolean {
  return Object.entries(selection).every(([name, value]) =>
    (v.attributes ?? []).some((a) => a.name === name && a.value === value),
  );
}

/** The variant matching a COMPLETE selection (every axis chosen), else undefined. */
export function resolveVariant(
  variants: ProductCardVariant[],
  selection: Record<string, string>,
): ProductCardVariant | undefined {
  const axes = deriveAxes(variants);
  if (axes.length === 0 || Object.keys(selection).length < axes.length) return undefined;
  return variants.find((v) => matchesSelection(v, selection));
}

/** Is there an IN-STOCK variant consistent with picking `value` on `axisName`, given the rest? */
export function isValueAvailable(
  variants: ProductCardVariant[],
  selection: Record<string, string>,
  axisName: string,
  value: string,
): boolean {
  const probe = { ...selection, [axisName]: value };
  return variants.some((v) => v.inStock && matchesSelection(v, probe));
}
