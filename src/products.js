// Loads the Problem Found product portfolio from data/products.json.
// Successor to campaigns.js: each product carries its own ICP, personas-by-role,
// signals, exclusions, Apollo discovery config and target titles; cross-product
// rules (offers, scoring, stages, qualification questions, outreach) live under
// `shared`. The `product` column on companies keys an account to a product.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PATH = join(__dirname, '..', 'data', 'products.json');

export function loadProducts() {
  return JSON.parse(readFileSync(PATH, 'utf8'));
}

export function getProduct(id) {
  const all = loadProducts();
  const p = all.products[id];
  if (!p) throw new Error(`Unknown product "${id}". Known: ${Object.keys(all.products).join(', ')}`);
  return { id, ...p };
}

export function productIds() {
  return Object.keys(loadProducts().products);
}

// Cross-product config (scoring rubric, offers, stages, qualification Qs, …).
export function shared() {
  return loadProducts().shared;
}

export function companyMeta() {
  return loadProducts().company;
}

// The order products should appear in tabs (priority ascending, then key).
export function productsByPriority() {
  const { products } = loadProducts();
  return Object.entries(products)
    .map(([id, p]) => ({ id, ...p }))
    .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99) || a.id.localeCompare(b.id));
}
