// Deletes the local database so you can start fresh. Then run `npm run seed`.
import { rmSync } from 'node:fs';
import { DB_PATH } from '../src/db.js';

for (const suffix of ['', '-wal', '-shm']) {
  try { rmSync(DB_PATH + suffix, { force: true }); } catch {}
}
console.log('Database reset. Re-seed with:  npm run seed');
