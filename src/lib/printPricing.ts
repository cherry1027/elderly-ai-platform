// Tryckpriser för Premium-böcker (engångsavgift per bok)
// Premium-licensen (799 kr) låser upp verktyget; tryckkostnad tillkommer per bok.

export type PrintTier = "p24" | "p36" | "p48" | "p72" | "custom";

export interface PrintTierInfo {
  id: PrintTier;
  label: string;
  pages: number; // 0 = custom (beräknas från target_page_count)
  basePriceSek: number;
  description: string;
}

export const PRINT_TIERS: PrintTierInfo[] = [
  {
    id: "p24",
    label: "24 sidor",
    pages: 24,
    basePriceSek: 399,
    description: "Liten minnesbok – perfekt för en kort historia",
  },
  {
    id: "p36",
    label: "36 sidor",
    pages: 36,
    basePriceSek: 549,
    description: "Mellanstor bok med plats för flera kapitel",
  },
  {
    id: "p48",
    label: "48 sidor",
    pages: 48,
    basePriceSek: 699,
    description: "Fyllig bok med många minnen och bilder",
  },
  {
    id: "p72",
    label: "72 sidor",
    pages: 72,
    basePriceSek: 899,
    description: "Stor minnesbok – livets stora berättelse",
  },
  {
    id: "custom",
    label: "Fritt antal sidor",
    pages: 0,
    basePriceSek: 399, // baspris för 24 sidor, +12 kr/sida över 24
    description: "Välj exakt antal sidor (12 kr per extra sida över 24)",
  },
];

export const EXTRA_PAGE_PRICE_SEK = 12;
export const CUSTOM_BASE_PAGES = 24;

export function calculatePrintPrice(tier: PrintTier, customPages?: number): number {
  const info = PRINT_TIERS.find((t) => t.id === tier);
  if (!info) return 0;
  if (tier !== "custom") return info.basePriceSek;
  const pages = Math.max(CUSTOM_BASE_PAGES, customPages || CUSTOM_BASE_PAGES);
  return info.basePriceSek + Math.max(0, pages - CUSTOM_BASE_PAGES) * EXTRA_PAGE_PRICE_SEK;
}

export function getTierPageCount(tier: PrintTier, customPages?: number): number {
  const info = PRINT_TIERS.find((t) => t.id === tier);
  if (!info) return 0;
  if (tier !== "custom") return info.pages;
  return Math.max(CUSTOM_BASE_PAGES, customPages || CUSTOM_BASE_PAGES);
}
