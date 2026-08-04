import {
  looksLikeIllustrativeCostAnalysis,
  validateIllustrativeCostAnalysis,
} from './cost-analysis.js';
import { normalizeSubject } from './subject-lines.js';

const SIGNATURES = {
  wapahki: 'Founder, Wapahki Industries',
  gnk: 'GnK',
  outagehub: 'OutageHub',
};

const BANNED = [
  ['just following up', /\bjust follow(?:ing)? up\b/i],
  ['following up', /\bfollowing up\b/i],
  ['checking in', /\bcheck(?:ing)? in\b/i],
  ['circling back', /\bcircl(?:e|ing) back\b/i],
  ['bumping', /\bbump(?:ing)? (?:this|the|my)\b/i],
  ['touch base', /\btouch base\b/i],
  ['in case you missed it', /\bin case you missed it\b/i],
  ['previous email', /\b(?:previous|last|first) email\b/i],
  ['quick question', /\bquick question\b/i],
  ['quick call', /\bquick call\b/i],
  ['I wanted to', /\bI wanted to\b/i],
  ['canned model transition', /\bthat made me (?:think|want|wonder)\b/i],
  ['hope you are well', /\bhope (?:you are|you['’]re) well\b/i],
  ['thoughts', /\b(?:your|any) thoughts\b/i],
  ['artificial urgency', /\b(?:last chance|final notice|before it is too late)\b/i],
  ['claimed finished artifact', /\bI (?:pulled|made|created|prepared|put together|went back and pulled)\b/i],
];

const STOPWORDS = new Set([
  'about', 'after', 'again', 'also', 'and', 'are', 'because', 'been', 'before',
  'being', 'between', 'both', 'but', 'can', 'could', 'does', 'each', 'for', 'from',
  'have', 'help', 'here', 'how', 'into', 'just', 'more', 'most', 'not', 'one',
  'only', 'our', 'out', 'over', 'same', 'should', 'that', 'the', 'their', 'them',
  'then', 'there', 'these', 'they', 'this', 'through', 'under', 'very', 'was',
  'what', 'when', 'where', 'which', 'while', 'with', 'would', 'you', 'your',
  'andrew', 'gordienko', 'thanks', 'founder', 'industries', 'wapahki', 'gnk',
  'outagehub',
]);

export function signatureFor(campaign) {
  const signature = SIGNATURES[campaign];
  if (!signature) throw new Error(`Unknown touch-2 campaign: ${campaign}`);
  return signature;
}

export function wordCount(value) {
  return (String(value || '').match(/\b[\p{L}\p{N}][\p{L}\p{N}'’-]*\b/gu) || []).length;
}

function signaturePattern(campaign) {
  const signature = signatureFor(campaign).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`Thanks,\\s*\\nAndrew Gordienko\\s*\\n${signature}\\s*$`);
}

export function contentOnly(body, campaign) {
  return String(body || '')
    .replace(/^Hi [^,\n]+,\s*/i, '')
    .replace(signaturePattern(campaign), '')
    .trim();
}

export function normalizeTouch2Body(body, { campaign, firstName }) {
  const signature = signatureFor(campaign);
  let value = String(body || '').replace(/\r/g, '').trim();
  value = value
    .replace(
      /\s*(?:Thanks|Best),?\s*\nAndrew(?: Gordienko)?\s*\n(?:Founder,\s*Wapahki Industries|Wapahki Industries|GnK|OutageHub)\s*$/i,
      '',
    )
    .trim();
  if (/^Hi [^,\n]+,/i.test(value)) {
    value = value.replace(/^Hi [^,\n]+,\s*/i, `Hi ${firstName},\n\n`);
  } else {
    value = `Hi ${firstName},\n\n${value}`;
  }
  value = value
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return `${value}\n\nThanks,\nAndrew Gordienko\n${signature}`;
}

function normalizedWords(value) {
  return (String(value || '').toLowerCase().match(/[\p{L}\p{N}']+/gu) || []);
}

function meaningfulWords(value) {
  return new Set(
    normalizedWords(value).filter((word) => word.length >= 4 && !STOPWORDS.has(word)),
  );
}

function repeatedPhrase(first, second, width = 8) {
  const a = normalizedWords(first);
  const b = normalizedWords(second);
  if (a.length < width || b.length < width) return '';
  const phrases = new Set();
  for (let index = 0; index <= a.length - width; index++) {
    phrases.add(a.slice(index, index + width).join(' '));
  }
  for (let index = 0; index <= b.length - width; index++) {
    const phrase = b.slice(index, index + width).join(' ');
    if (phrases.has(phrase)) return phrase;
  }
  return '';
}

export function validateTouch2({
  campaign,
  firstName,
  t1Subject,
  t1Body,
  t2Subject,
  t2Body,
}) {
  const errors = [];
  const subject = String(t2Subject || '').trim();
  const body = String(t2Body || '').trim();
  const content = contentOnly(body, campaign);
  const words = wordCount(content);

  if (!subject) errors.push('missing subject');
  if (subject !== String(t1Subject || '').trim()) errors.push('subject does not exactly match T1');
  if (subject !== normalizeSubject(subject) && subject !== subject.toLocaleLowerCase('en')) {
    errors.push('subject does not use natural sentence capitalization');
  }
  if (wordCount(subject) < 2 || wordCount(subject) > 5) errors.push('subject is not 2-5 words');
  if (/[:!?]/.test(subject)) errors.push('subject contains punctuation');
  if (!body.startsWith(`Hi ${firstName},\n\n`)) errors.push('greeting or greeting spacing is wrong');
  if (!signaturePattern(campaign).test(body)) errors.push('signature is wrong');
  const minimumWords = campaign === 'wapahki' ? 25 : 60;
  if (words < minimumWords || words > 120) errors.push(`body has ${words} content words`);
  if (/[—–]/.test(content)) errors.push('body contains a long dash');
  if (/[:!]/.test(content)) errors.push('body contains a colon or exclamation point');
  if (/https?:\/\//i.test(content)) errors.push('body contains a URL');
  if (/^\s*(?:[-*]|\d+[.)])\s+/m.test(content)) errors.push('body contains a list');
  if ((content.match(/\?/g) || []).length !== 1) errors.push('body must ask exactly one question');
  const paragraphs = content.split(/\n\s*\n/).filter(Boolean);
  if (paragraphs.length < 2 || paragraphs.length > 3) {
    errors.push(`body has ${paragraphs.length} content paragraphs`);
  }
  const meetingRequest = [
    /\b(?:open to|available for)\s+(?:an?\s+)?(?:(?:short|brief|\d+-minute)\s+)?(?:call|conversation|meeting)\b/i,
    /\b(?:schedule|book|join|have|take)\s+(?:an?\s+)?(?:(?:short|brief|\d+-minute)\s+)?(?:call|conversation|meeting)\b/i,
    /\b(?:call|conversation|meeting)\b[^.!?\n]{0,35}\b(?:next week|with me|to discuss|to talk)\b/i,
    /\b(?:would|could|can) we\b[^.!?\n]{0,20}\b(?:call|talk|meet)\b/i,
  ].some((pattern) => pattern.test(content));
  if (meetingRequest && !/\b20-minute\b/i.test(content)) {
    errors.push('call request is not explicitly 20 minutes');
  }
  for (const [label, pattern] of BANNED) {
    if (pattern.test(content)) errors.push(`body uses ${label}`);
  }
  const unsupportedClaims = [
    ['unsupported recent-contact claim', /\bI (?:spoke|talked) with\b/i],
    ['unsupported call anecdote', /\b(?:on|during|from) (?:an? )?(?:recent )?(?:call|conversation)\b/i],
    ['unsupported third-party anecdote', /\b(?:manager|operator|owner|leader|team|customer|client|peer) (?:said|shared|described|told|mentioned)\b/i],
    ['unsupported learning claim', /\bI (?:heard|learned) (?:from|that|about)\b/i],
    ['silence-timeline framing', /\b(?:since|after) (?:I wrote|my note|my email)\b/i],
  ];
  for (const [label, pattern] of unsupportedClaims) {
    if (pattern.test(content)) errors.push(`body uses ${label}`);
  }
  if (campaign === 'wapahki') {
    if (!/\b(?:distinguish|difference|separate|before|after|downstream|once)\b/i.test(content)) {
      errors.push('Wapahki T2 must clarify one concrete process distinction');
    }
    if (/\b(?:technical|fit|automation) screen(?:ing)?\b|\b(?:qualif|disqualif)\w*\b|\bdeployment\b|\bpaid pilot\b|\bone[- ]page\b[^.!?\n]{0,40}\bsketch\b/i.test(content)) {
      errors.push('Wapahki T2 uses premature sales or screening language');
    }
    if (meetingRequest) errors.push('Wapahki T2 must not request another call');
  }

  const repeated = repeatedPhrase(contentOnly(t1Body, campaign), content);
  if (repeated) errors.push(`body repeats T1 phrase: "${repeated}"`);

  if (looksLikeIllustrativeCostAnalysis(content)) {
    errors.push(...validateIllustrativeCostAnalysis(content));
  }

  const t1Terms = meaningfulWords(contentOnly(t1Body, campaign));
  const t2Terms = meaningfulWords(content);
  const sharedTerms = [...t2Terms].filter((term) => t1Terms.has(term));
  if (sharedTerms.length < 2) {
    errors.push('body is not anchored to T1’s operational thread');
  }
  return errors;
}
