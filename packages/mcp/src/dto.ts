// Minimal local AMPS shapes (avoid cross-package dep)
interface Money { amount: string; currency: string }
type Availability = 'in_stock' | 'out_of_stock' | 'backorder';
interface AmpsVariant { variant_id: string; title: string; price: Money; availability: Availability }
interface AmpsProductLike {
  product_id: string; title: string; price: Money; availability: Availability;
  image_url?: string | null; images?: { url: string }[]; url?: string | null;
  variants?: AmpsVariant[]; addons?: unknown[];
}
export interface LeanVariant { variant_id: string; title: string; price: Money; availability: Availability }
export interface LeanProduct {
  product_id: string; title: string; price: Money; availability: Availability;
  image_url?: string; url?: string; variants?: LeanVariant[]; addons?: unknown[];
}
export function toLeanProduct(p: AmpsProductLike): LeanProduct {
  const image_url = p.image_url ?? p.images?.[0]?.url ?? undefined;
  const out: LeanProduct = { product_id: p.product_id, title: p.title, price: p.price, availability: p.availability };
  if (image_url) out.image_url = image_url;
  if (p.url) out.url = p.url;
  if (p.variants?.length) out.variants = p.variants.map((v) => ({ variant_id: v.variant_id, title: v.title, price: v.price, availability: v.availability }));
  if (p.addons?.length) out.addons = p.addons;
  return out;
}
