// Loads campaign definitions (ICP + positioning + target titles) from data/campaigns.json.
// Each funnel (wapahki, gnk, outagehub, …) is fully described here so the same
// pipeline can source and write for any of them without code changes.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PATH = join(__dirname, '..', 'data', 'campaigns.json');

export function loadCampaigns() {
  return JSON.parse(readFileSync(PATH, 'utf8'));
}

export function getCampaign(name) {
  const all = loadCampaigns();
  const c = all[name];
  if (!c) throw new Error(`Unknown campaign "${name}". Known: ${Object.keys(all).join(', ')}`);
  return { id: name, ...c };
}

export function campaignIds() {
  return Object.keys(loadCampaigns());
}
