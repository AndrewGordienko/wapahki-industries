// Store Andrew's human-approved BCTS sequences verbatim. This is founder-approved
// copy that intentionally qualifies before pitching and uses a role-tiered cadence
// (operator = full, adjacent = two qualifiers, executive = one router email), so it
// is written directly rather than through the four-touch validators.
import { db } from '../src/db.js';

const SIG = '\n\nThanks,\nAndrew Gordienko\nGnK';

const sequences = {
  // Girish Hewawasam — Corporate Operations Manager — primary full sequence
  2259: [
    { touch: 1, day: 1, channel: 'email', subject: 'Inspection follow-up work',
      body: `Hi Girish,\n\nBCTS’s road procedure covers bridge and major-culvert inspections, including reviewing relevant earlier assessments.\n\nWhen an inspection identifies a condition that may require action, is the report itself enough to move the work forward, or does someone separately compare the finding with earlier assessments and determine the follow-up?\n\nI run GnK, a Toronto software and AI engineering team. I’m trying to establish whether that handoff creates real work before assuming BCTS needs another tool.\n\nWould you be open to discussing the last completed case that required follow-up?${SIG}` },
    { touch: 2, day: 4, channel: 'email', subject: 'Inspection follow-up work',
      body: `Hi Girish,\n\nBCTS guidance already allows inspection reports to be completed on paper, in Word or through a handheld application, so report capture may not be the problem.\n\nOn the last finding that required action, who reviewed the earlier assessment, decided what needed to happen and recorded that it was complete?\n\nIf one existing system already handles that end to end, that answer would be equally useful.${SIG}` },
    { touch: 3, day: 9, channel: 'linkedin', subject: null,
      body: `Hi Girish — I’m looking at what happens after a BCTS bridge or major-culvert inspection identifies a condition requiring action. I’m trying to determine whether the business area handles the follow-up end to end or whether corporate operations becomes involved.` },
    { touch: 4, day: 18, channel: 'email', subject: 'Follow-up decision owner',
      body: `Hi Girish,\n\nI’ll close the loop on this.\n\nI’m trying to identify who owns the decision after a bridge or major-culvert inspection identifies a condition requiring attention.\n\nIs that handled by corporate operations, engineering or road staff within each business area, or another group entirely? A job title is enough.${SIG}` },
  ],
  // Kaitlin Baskerville — Preparedness — two qualification touches only
  2257: [
    { touch: 1, day: 1, channel: 'email', subject: 'Post-event access checks',
      body: `Hi Kaitlin,\n\nWhen a storm, wildfire or other event raises concern about road access, does BCTS preparedness coordinate the resulting bridge and culvert checks, or is that handled entirely within the affected business area?\n\nI run GnK, a Toronto software and AI engineering team. I’m looking at whether staff ever need to reconcile new inspection findings with earlier assessments before deciding the next access action, but I don’t want to assume that workflow belongs to preparedness.\n\nCould you tell me where your role enters that process, if at all?${SIG}` },
    { touch: 2, day: 4, channel: 'email', subject: 'Post-event access checks',
      body: `Hi Kaitlin,\n\nTo make the routing question concrete, after an event raises concern about a bridge or major culvert, does preparedness review the resulting findings, request status from the business area, or only coordinate the broader response?\n\nIf another team owns the inspection-to-action handoff, a job title would be helpful.${SIG}` },
  ],
  // Jana Sexton — Executive Operations — one fallback router email
  2258: [
    { touch: 1, day: 1, channel: 'email', subject: 'Placing a BCTS workflow',
      body: `Hi Jana,\n\nThis may sit outside executive operations, but I’m trying to place one BCTS workflow correctly.\n\nWhen a bridge or major-culvert inspection identifies a condition requiring action, is the review and follow-up kept within the local business area, or does a corporate operations group become involved?\n\nI run GnK, a Toronto software and AI engineering team. I’m trying to identify the owner before making assumptions about the process or proposing anything.\n\nCould you point me to the relevant job title?${SIG}` },
  ],
};

const guard = db.prepare("SELECT COUNT(*) n FROM sequences WHERE person_id=? AND status<>'draft'");
const del = db.prepare("DELETE FROM sequences WHERE person_id=? AND status='draft'");
const ins = db.prepare(`INSERT INTO sequences (person_id, campaign, touch, day, channel, subject, body, status)
  VALUES (?, 'gnk', ?, ?, ?, ?, ?, 'draft')`);

for (const [personId, touches] of Object.entries(sequences)) {
  if (guard.get(personId).n > 0) throw new Error(`Person ${personId} has protected (sent) history; refusing to overwrite.`);
}
for (const [personId, touches] of Object.entries(sequences)) {
  del.run(personId);
  for (const t of touches) ins.run(personId, t.touch, t.day, t.channel, t.subject, t.body);
}

for (const [personId, touches] of Object.entries(sequences)) {
  const name = db.prepare('SELECT name FROM people WHERE id=?').get(personId)?.name;
  console.log(`Stored ${touches.length} approved touch(es) for ${name} (${personId}).`);
}
