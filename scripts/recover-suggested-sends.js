#!/usr/bin/env node
// One-time recovery for the first capacity-plan rollout: restore the immutable
// role/recipient timing recommendation from the pre-rebalance snapshot while
// keeping the capacity-adjusted scheduled_for values in the live database.
import { resolve } from 'node:path';
import { db } from '../src/db.js';

const backupArg = (process.argv.find((arg) => arg.startsWith('--backup=')) || '').slice('--backup='.length);
if (!backupArg) throw new Error('usage: node scripts/recover-suggested-sends.js --backup=path/to/backup.db');
const backup = resolve(backupArg);

db.prepare('ATTACH DATABASE ? AS suggested_backup').run(backup);
const before = db.prepare("SELECT COUNT(*) n FROM sequences WHERE COALESCE(suggested_for, '')!=''").get().n;
db.exec(`
  UPDATE sequences
  SET suggested_window=(SELECT old.send_window FROM suggested_backup.sequences old WHERE old.id=sequences.id),
      suggested_reason=(SELECT old.timing_reason FROM suggested_backup.sequences old WHERE old.id=sequences.id),
      suggested_for=(SELECT old.scheduled_for FROM suggested_backup.sequences old WHERE old.id=sequences.id),
      suggested_local=(SELECT old.scheduled_local FROM suggested_backup.sequences old WHERE old.id=sequences.id),
      suggested_timezone=(SELECT old.send_timezone FROM suggested_backup.sequences old WHERE old.id=sequences.id),
      send_window=(SELECT old.send_window FROM suggested_backup.sequences old WHERE old.id=sequences.id),
      timing_reason=(SELECT old.timing_reason FROM suggested_backup.sequences old WHERE old.id=sequences.id)
  WHERE EXISTS (SELECT 1 FROM suggested_backup.sequences old WHERE old.id=sequences.id)
    AND channel='email';
`);
const after = db.prepare("SELECT COUNT(*) n FROM sequences WHERE COALESCE(suggested_for, '')!=''").get().n;
db.exec('DETACH DATABASE suggested_backup');
console.log(`Recovered ${after - before} original suggested-send records from ${backup}.`);
db.close();
