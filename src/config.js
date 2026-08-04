// Loads configuration from (in priority order):
//   1. Real system / shell environment variables   ->  export APOLLO_API_KEY=...
//   2. A local .env file in the project root        ->  APOLLO_API_KEY=...
//
// System env vars WIN over the .env file, so you can set the key however you like.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(__dirname, '..', '.env');

// 1. Capture anything already set in the real environment BEFORE we read the file.
const fromSystem = {
  APOLLO_API_KEY: process.env.APOLLO_API_KEY,
  GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY,
  PORT: process.env.PORT,
};

// 2. Load the .env file if present (won't clobber our captured system values below).
if (existsSync(ENV_PATH)) {
  try {
    process.loadEnvFile(ENV_PATH);
  } catch (err) {
    console.warn(`[config] could not read .env: ${err.message}`);
  }
}

// System env var wins; otherwise use whatever the .env file provided.
const pick = (name) => {
  const sys = fromSystem[name];
  if (sys && sys.trim() !== '') return sys.trim();
  const fileVal = process.env[name];
  return fileVal && fileVal.trim() !== '' ? fileVal.trim() : '';
};

export const APOLLO_API_KEY = pick('APOLLO_API_KEY');
export const GOOGLE_MAPS_API_KEY = pick('GOOGLE_MAPS_API_KEY');
export const PORT = Number(pick('PORT') || 8787);

export const config = {
  APOLLO_API_KEY,
  GOOGLE_MAPS_API_KEY,
  PORT,
  hasApollo: APOLLO_API_KEY.length > 0,
  hasGoogle: GOOGLE_MAPS_API_KEY.length > 0,
  // Tells the UI where the key came from, purely informational.
  apolloKeySource: fromSystem.APOLLO_API_KEY ? 'system env var' : (APOLLO_API_KEY ? '.env file' : 'not set'),
};
