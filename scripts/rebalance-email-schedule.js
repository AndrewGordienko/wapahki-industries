#!/usr/bin/env node
import { db, rebalanceEmailSchedule } from '../src/db.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const value = (name) => (args.find((arg) => arg.startsWith(`${name}=`)) || '').slice(name.length + 1);
const start = value('--start') || new Date().toISOString().slice(0, 10);
const cap = Number(value('--cap') || 30);

if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) throw new Error('--start must be YYYY-MM-DD');
if (!Number.isInteger(cap) || cap < 1 || cap > 30) throw new Error('--cap must be an integer from 1 to 30');

const plan = rebalanceEmailSchedule({ start, dailyCap: cap, dryRun: !apply });
const byBusiness = {};
for (const assignment of plan.assignments) {
  const summary = (byBusiness[assignment.business] ||= {
    emails: 0, first: assignment.scheduled_for, last: assignment.scheduled_for,
  });
  summary.emails += 1;
  if (assignment.scheduled_for < summary.first) summary.first = assignment.scheduled_for;
  if (assignment.scheduled_for > summary.last) summary.last = assignment.scheduled_for;
}
const maxPerDay = Math.max(0, ...plan.days.map((day) => day.count));
const weekdaysUsed = [...new Set(plan.days.map((day) => new Date(`${day.date}T12:00:00Z`).getUTCDay()))].sort();

console.log(`${apply ? 'Applied' : 'Dry run'} · ${plan.policy} · cap ${plan.daily_cap} emails per brand/day`);
console.log(`Start ${start} · ${plan.assignments.length.toLocaleString('en-US')} pending emails · max observed ${maxPerDay}/day`);
for (const [business, summary] of Object.entries(byBusiness)) {
  console.log(`${business}: ${summary.emails.toLocaleString('en-US')} emails · ${summary.first.slice(0, 10)} → ${summary.last.slice(0, 10)}`);
}
console.log(`Calendar weekdays used (0=Sun): ${weekdaysUsed.join(', ')}`);
if (!apply) console.log('No rows changed. Re-run with --apply after reviewing this plan.');

db.close();
