// Deterministic send-time guidance. Timing is an operating hypothesis, not a
// promise of higher reply rates. Keep the role/industry rules aligned with
// playbooks/_shared.md "When to send (by industry)".

const SENIOR_WEEK_PREPPER = /\b(?:chief|ceo|coo|cto|cfo|president|owner|founder|vice[- ]?president|vp|svp|evp|head|director|general manager|plant manager|operations manager)\b/i;
const WAREHOUSE_EARLY = /\b(?:warehouse|logistics|fulfilment|fulfillment|distribution|shipping|receiving)\b/i;
const OUTAGE_EARLY = /\b(?:operations|dispatch|field service|facilities|reliability|emergency|network|noc|service assurance|maintenance|infrastructure)\b/i;
const CONSTRUCTION_BUYER = /\b(?:construction|claims?|commercial|project controls?|scheduler|scheduling|project director|project executive|superintendent)\b/i;

function familyFor(campaign) {
  const key = String(campaign || '').toLowerCase();
  if (['outage', 'outagehub'].includes(key)) return 'outagehub';
  if (['gnk', 'delay', 'football', 'row'].includes(key)) return 'gnk';
  return 'wapahki';
}

function isSenior(title) {
  return SENIOR_WEEK_PREPPER.test(String(title || ''));
}

// The CRM has city/province data for most accounts but no canonical timezone
// field yet. Resolve only locations we can defend, and flag the Toronto fallback
// so the operator knows to verify it before sending.
export function resolveRecipientTimeZone({ city, location, campaign } = {}) {
  const raw = `${city || ''} ${location || ''}`.toLowerCase();
  const exact = (timezone, basis) => ({ timezone, confidence: 'location', basis });
  const explicitlyCanadian = /\b(?:canada|ontario|\bon\b|quebec|\bqc\b|british columbia|\bbc\b|alberta|\bab\b|manitoba|\bmb\b|saskatchewan|\bsk\b|nova scotia|\bns\b)\b/.test(raw);

  if (String(campaign || '').toLowerCase() === 'football'
    || /\b(?:united kingdom|england|scotland|wales)\b/.test(raw)
    || (!explicitlyCanadian && /\b(?:london|coventry|derby|norwich|sheffield|southampton|stoke-on-trent|swansea|wrexham)\b/.test(raw))) {
    return exact('Europe/London', 'UK account location');
  }
  if (/\b(?:honolulu|hawaii|\bhi\b)\b/.test(raw)) return exact('Pacific/Honolulu', 'Hawaii account location');
  if (/\b(?:vancouver|victoria|burnaby|richmond,? bc|surrey|british columbia|\bbc\b|los angeles|seattle|sacramento|california|washington|\bca\b|\bwa\b)\b/.test(raw)) {
    return exact('America/Vancouver', 'Pacific account location');
  }
  if (/\b(?:calgary|edmonton|alberta|\bab\b|denver|colorado|\bco\b)\b/.test(raw)) {
    return exact('America/Edmonton', 'Mountain account location');
  }
  if (/\b(?:winnipeg|manitoba|\bmb\b|regina|saskatchewan|\bsk\b|chicago|irving|texas|\btx\b|illinois|\bil\b)\b/.test(raw)) {
    return exact('America/Winnipeg', 'Central account location');
  }
  if (/\b(?:halifax|nova scotia|\bns\b|new brunswick|\bnb\b|prince edward island|\bpei\b)\b/.test(raw)) {
    return exact('America/Halifax', 'Atlantic account location');
  }
  if (/\b(?:st\.? john'?s|newfoundland|labrador|\bnl\b)\b/.test(raw)) {
    return exact('America/St_Johns', 'Newfoundland account location');
  }
  if (/\b(?:toronto|mississauga|brampton|ontario|\bon\b|montreal|quebec|\bqc\b|ottawa|new york|\bny\b|massachusetts|\bma\b|weymouth)\b/.test(raw)) {
    return exact('America/Toronto', 'Eastern account location');
  }
  return {
    timezone: familyFor(campaign) === 'gnk' && String(campaign || '').toLowerCase() === 'football'
      ? 'Europe/London'
      : 'America/Toronto',
    confidence: 'default',
    basis: 'No unambiguous account timezone; Toronto is the review-required default',
  };
}

export function recommendSendTiming({ campaign, title, industry, city, location, channel } = {}) {
  const family = familyFor(campaign);
  const role = `${title || ''} ${industry || ''}`;
  const senior = isSenior(title);
  const medium = channel === 'linkedin' ? 'LinkedIn' : 'Email';
  const zone = resolveRecipientTimeZone({ city, location, campaign });
  const common = {
    timezone: zone.timezone,
    timezone_confidence: zone.confidence,
    timezone_basis: zone.basis,
    preferred_weekdays: [2, 3, 4], // Tuesday through Thursday.
    cadence_fallback_weekday: 5,   // Friday morning only; never Friday afternoon.
  };

  if (family === 'wapahki') {
    const warehouse = WAREHOUSE_EARLY.test(role);
    const base = warehouse
      ? 'Tue–Thu, 6:00–7:00am recipient local'
      : 'Tue–Thu, 6:30–8:00am recipient local';
    return {
      ...common,
      local_hour: warehouse ? 6 : 7,
      local_minute: warehouse ? 30 : 0,
      window: senior ? `${base}; test Sun ~10:00am or Mon ~7:00am` : base,
      reason: `${medium} timed for the first inbox check before floor or warehouse work ramps${senior ? '; the Sunday/Monday window is a week-planning experiment, not the default' : ''}.`,
    };
  }

  if (family === 'outagehub') {
    const early = OUTAGE_EARLY.test(role);
    const base = early
      ? 'Tue–Thu, 6:30–8:00am recipient local; steady state only'
      : 'Tue–Thu, 7:00–9:00am recipient local; steady state only';
    return {
      ...common,
      local_hour: early ? 7 : 8,
      local_minute: 0,
      window: senior ? `${base}; test Sun ~10:00am or Mon ~7:00am` : base,
      reason: `${medium} timed for an early operational inbox check; never send opportunistically during an active outage${senior ? ', and treat the Sunday/Monday slot as a week-planning experiment' : ''}.`,
    };
  }

  const sourceCampaign = String(campaign || '').toLowerCase();
  if (sourceCampaign === 'football') {
    return {
      ...common,
      local_hour: 8,
      local_minute: 30,
      window: 'Tue–Thu, 8:00–10:00am recipient local; verify fixture calendar',
      reason: `${medium} timed for an analyst desk window. Never send on matchday or the day after; the fixture calendar must be checked manually.`,
    };
  }

  const construction = sourceCampaign === 'delay' || CONSTRUCTION_BUYER.test(role);
  const base = construction
    ? 'Tue–Thu, 7:00–8:30am recipient local'
    : 'Tue–Thu, 7:00–9:00am recipient local';
  return {
    ...common,
    local_hour: construction ? 7 : 8,
    local_minute: construction ? 45 : 0,
    window: senior
      ? `${base}; test Sun 4:30–6:30pm or Mon ~7:00am`
      : `${base}; fallback 1:00–2:00pm`,
    reason: construction
      ? `${medium} timed before site activity and meetings${senior ? '; the Sunday/Monday slot is a director planning experiment' : '; avoid Monday morning for site-based project managers'}.`
      : `${medium} timed for a knowledge worker's pre-meeting inbox check${senior ? '; the Sunday/Monday slot is an executive planning experiment' : ', with an early-afternoon fallback'}.`,
  };
}

function datePartsInZone(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year), month: Number(values.month), day: Number(values.day),
    hour: Number(values.hour), minute: Number(values.minute), second: Number(values.second),
  };
}

function addLocalDays(parts, days) {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate(),
  };
}

function localOrdinal(parts) {
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / 86_400_000);
}

function localWeekday(parts) {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

function zonedLocalToDate(parts, timezone) {
  let instant = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute));
  // Two correction passes handle ordinary offsets and DST boundaries without a
  // dependency on Temporal or a timezone package.
  for (let pass = 0; pass < 2; pass++) {
    const seen = datePartsInZone(instant, timezone);
    const wantedUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    const seenUtc = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute);
    instant = new Date(instant.getTime() + (wantedUtc - seenUtc));
  }
  return instant;
}

function formatScheduledLocal(date, profile) {
  const formatted = new Intl.DateTimeFormat('en-GB', {
    timeZone: profile.timezone,
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short',
  }).format(date);
  return profile.timezone_confidence === 'default'
    ? `${formatted} · ${profile.timezone} (verify timezone)`
    : `${formatted} · ${profile.timezone}`;
}

function nextViableDate(target, profile, { primaryOnly = false } = {}) {
  let candidate = { ...target };
  for (let guard = 0; guard < 14; guard++) {
    const weekday = localWeekday(candidate);
    if (profile.preferred_weekdays.includes(weekday)) return candidate;
    if (!primaryOnly && weekday === profile.cadence_fallback_weekday) return candidate;
    candidate = addLocalDays(candidate, 1);
  }
  throw new Error('Could not find a viable send date inside two weeks.');
}

// Return one schedule record per touch. `day` remains the narrative spacing
// target; `scheduled_for` is the actual UTC instant after weekend adjustment.
export function buildSequenceSchedule({
  campaign, title, industry, city, location, touches = [], now = new Date(),
} = {}) {
  const sorted = [...touches].sort((a, b) => Number(a.touch) - Number(b.touch));
  if (!sorted.length) return [];
  const firstProfile = recommendSendTiming({
    campaign, title, industry, city, location, channel: sorted[0].channel,
  });
  const localNow = datePartsInZone(now, firstProfile.timezone);
  let start = nextViableDate(localNow, firstProfile, { primaryOnly: true });
  let startInstant = zonedLocalToDate({
    ...start, hour: firstProfile.local_hour, minute: firstProfile.local_minute,
  }, firstProfile.timezone);
  if (startInstant <= now) {
    start = nextViableDate(addLocalDays(start, 1), firstProfile, { primaryOnly: true });
    startInstant = zonedLocalToDate({
      ...start, hour: firstProfile.local_hour, minute: firstProfile.local_minute,
    }, firstProfile.timezone);
  }

  let previousOrdinal = null;
  return sorted.map((touch) => {
    const profile = recommendSendTiming({
      campaign, title, industry, city, location, channel: touch.channel,
    });
    const target = addLocalDays(start, Math.max(0, Number(touch.day || 1) - 1));
    let candidate = nextViableDate(target, profile);
    if (previousOrdinal !== null && localOrdinal(candidate) <= previousOrdinal) {
      candidate = nextViableDate(addLocalDays(candidate, previousOrdinal - localOrdinal(candidate) + 1), profile);
    }
    previousOrdinal = localOrdinal(candidate);
    const scheduled = zonedLocalToDate({
      ...candidate, hour: profile.local_hour, minute: profile.local_minute,
    }, profile.timezone);
    const moved = localOrdinal(candidate) !== localOrdinal(target);
    const friday = localWeekday(candidate) === 5;
    const adjustment = moved
      ? ` Day-${touch.day} spacing landed outside the preferred window and was moved to the next viable morning.`
      : friday
        ? ' Friday morning is retained to preserve cadence; avoid Friday afternoon.'
        : '';
    return {
      touch: Number(touch.touch),
      send_window: profile.window,
      timing_reason: `${profile.reason} ${profile.timezone_basis}.${adjustment}`.trim(),
      scheduled_for: scheduled.toISOString(),
      scheduled_local: formatScheduledLocal(scheduled, profile),
      send_timezone: profile.timezone,
      timezone_confidence: profile.timezone_confidence,
    };
  });
}
