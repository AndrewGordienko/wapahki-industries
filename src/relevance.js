// Scores a contact 0..10 on "how likely to accept a short founder call about a
// flexible robotic cell", and generates the "why they'd reply" reason.
//
// Target: the people close enough to the work to describe a credible first
// problem and senior enough to help a useful conversation move. Managers are
// usually the first route, but supervisors, engineers, MRO buyers and quality
// leads remain valuable champions instead of being discarded.

const CATEGORIES = [
  {
    key: 'ops_leader',
    score: 10,
    test: /(operations|production|plant|manufacturing|site|factory|warehouse|maintenance|continuous improvement|process improvement|operational excellence|engineering|packaging)\s+(manager|director|lead(?:er)?)|director of (operations|manufacturing|production|engineering|supply chain|warehouse(?: operations)?|plant)|general manager|plant superintendent|operations director|head of (operations|manufacturing|production|engineering)/i,
    reason: (company) =>
      `Can assess whether a recurring task at ${company} is consistent and valuable enough for a site check, and can bring operations, engineering, safety, and budget stakeholders into a bounded pilot evaluation.`,
  },
  {
    key: 'engineer',
    score: 9,
    test: /process engineer|packaging engineer|manufacturing engineer|automation|controls engineer|industrial engineer|mechanical engineer|process optimization|\bengineer\b/i,
    reason: (company) =>
      `Can assess task repeatability, integration, recovery, guarding, and acceptance criteria at ${company}, then help define what a site check or bounded pilot would need to prove.`,
  },
  {
    key: 'supervisor',
    score: 8,
    test: /supervisor|lead hand|line lead|team lead|shift lead|floor lead|group lead|foreman/i,
    reason: (company) =>
      `Works close to ${company}'s day-to-day production and can identify task variation, rate, lifting, changeovers, and exceptions. Useful discovery route; pair with a manager before proposing a pilot.`,
  },
  {
    key: 'technical_floor',
    score: 7,
    test: /maintenance technician|maintenance mechanic|industrial mechanic|millwright|industrial electrician|automation technician|controls technician|engineering technician|packaging specialist|packaging technologist|mro buyer/i,
    reason: (company) =>
      `Can evaluate a practical part of ${company}'s automation fit, such as package constraints, equipment access, ordinary recovery, parts, training, or the human exception path, and can route the site-check discussion to the responsible manager.`,
  },
  {
    key: 'coordinator_quality',
    score: 7,
    test: /coordinator|planner|scheduler|materials|supply chain|project manager|program manager|\bbuyer\b|quality|\bqa\b|\bqc\b|gmp|compliance/i,
    reason: (company) =>
      `Sits close to ${company}'s product, package, quality, planning, materials, or fulfilment changes. Useful for locating the real constraint and routing an evidence-backed fit check to the operational owner.`,
  },
  {
    key: 'exec',
    score: 2,
    test: /\bceo\b|chief|\bpresident\b|founder|owner|\bvp\b|vice president|\bcfo\b|\bcoo\b|\bcto\b|partner|\bsales\b|account executive/i,
    reason: (company) =>
      `Too senior to reach cold and likely to just forward it. Not a first-touch target for Wapahki — the managers and directors are.`,
  },
  {
    key: 'operator',
    score: 6,
    test: /\boperator\b|machine op|\bpacker\b|assembler|labou?rer|\bpicker\b|forklift/i,
    reason: (company) =>
      `Works directly with ${company}'s production or material-handling task and can explain setup, lifting, ordinary stops, resets, and exceptions. Treat as a discovery contact, not the pilot buyer.`,
  },
];

const DEFAULT = {
  score: 3,
  reason: (company) =>
    `Works inside ${company}'s operation but the title is unclear — verify it in Apollo. ` +
    `We want managers and directors who can host a tour and sponsor a pilot.`,
};

export function scoreContact(title, companyName = 'the company') {
  const t = (title || '').toString();
  if (/\b(sales|marketing|finance|accounting|controller|human resources|talent|recruit|legal|counsel|business development)\b/i.test(t)) {
    return {
      score: 3,
      reason: `May help route a Wapahki question inside ${companyName}, but the title does not establish access to the physical task or responsibility for equipment evaluation.`,
      category: 'routing_only',
    };
  }
  if (/\b(data|software|solution|cloud|network|security) engineer\b|\boffice supervisor\b/i.test(t)) {
    return {
      score: 3,
      reason: `The title is not close enough to ${companyName}'s physical packing, handling, maintenance, or plant-engineering work for a primary automation-fit approach.`,
      category: 'unrelated_specialist',
    };
  }
  for (const c of CATEGORIES) {
    if (c.test.test(t)) {
      return { score: c.score, reason: c.reason(companyName), category: c.key };
    }
  }
  return { score: DEFAULT.score, reason: DEFAULT.reason(companyName), category: 'unknown' };
}

// Human label for a score, used for the colored badge in the UI.
export function scoreTier(score) {
  if (score >= 9) return 'best';
  if (score >= 7) return 'strong';
  if (score >= 5) return 'ok';
  if (score >= 3) return 'weak';
  return 'skip';
}
