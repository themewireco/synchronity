// sdk/mcp/src/cards/siteNames.ts
//
// A tiny process-wide site_id -> name cache so user-facing output can show the
// store's name (e.g. "Sorella Bakery") instead of a raw UUID. Site names are
// public, non-buyer-specific metadata, so a shared cache is safe in the hosted
// multi-tenant gateway (unlike cart state — see the cart-cache removal in
// commit 38475683). Populated whenever list_sites runs; read by search_products.
// Misses fall back gracefully to a name-less label.

const siteNames = new Map<string, string>();

/** Record id -> name pairs from a /v1/sites response (any of the known shapes). */
export function rememberSiteNames(data: unknown): void {
  const d = data as { sites?: unknown[]; data?: unknown[] } | unknown[];
  const sites = Array.isArray(d) ? d : (d?.sites ?? d?.data ?? []);
  if (!Array.isArray(sites)) return;
  for (const s of sites as Array<{ id?: string; site_id?: string; name?: string }>) {
    const id = s?.id ?? s?.site_id;
    if (id && s?.name) siteNames.set(id, s.name);
  }
}

/** The cached store name for a site_id, or undefined if not seen yet. */
export function siteNameFor(siteId: string | undefined): string | undefined {
  return siteId ? siteNames.get(siteId) : undefined;
}
