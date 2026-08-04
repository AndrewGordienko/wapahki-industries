const GENERIC = [
  /\bquick question\b/i,
  /\bfollowing up\b/i,
  /\bchecking in\b/i,
  /\btouching base\b/i,
  /\bcircling back\b/i,
  /\byour thoughts\b/i,
  /\bidea for\b/i,
  /\bquestion about\b/i,
  /\bintroduction\b/i,
  /^(?:re|fw|fwd)\b/i,
  /^(?:an? )?opportunity(?: for you)?$/i,
  /^(?:a )?partnership(?: opportunity)?$/i,
];

const SALESY = /\b(?:ai|automation|solution|platform|optimi[sz]e|transform|unlock|revolutioni[sz]e|streamline)\b/i;
const STOP = new Set([
  'a', 'an', 'and', 'are', 'at', 'be', 'by', 'for', 'from', 'in', 'into', 'is',
  'of', 'on', 'or', 'our', 'the', 'their', 'this', 'to', 'with', 'your',
]);

// Normalization is deliberately conservative. It fixes transport noise without
// flattening API, ERP, product names, or other meaningful capitalization.
export function normalizeSubject(value) {
  const cleaned = String(value || '')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[:!?]+$/g, '');
  // Capitalize an ordinary lowercase opening word, while leaving supplied
  // stylings such as iPhone and acronyms such as API untouched.
  return cleaned.replace(
    /^(\p{Ll})(?=[\p{Ll}\p{N}'’-]*(?:\s|$))/u,
    (letter) => letter.toLocaleUpperCase('en-GB'),
  );
}

export function subjectKey(value) {
  return normalizeSubject(value).toLocaleLowerCase('en-GB');
}

export function subjectWords(value) {
  return normalizeSubject(value).match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || [];
}

function stem(word) {
  return word
    .toLocaleLowerCase('en-GB')
    .replace(/[’']/g, '')
    .replace(/(?:ing|ers?|ies|ied|ed|es|s)$/i, '')
    .slice(0, 12);
}

function contentStems(value) {
  return new Set(subjectWords(value)
    .filter((word) => word.length >= 4 && !STOP.has(word.toLocaleLowerCase('en-GB')))
    .map(stem)
    .filter((word) => word.length >= 3));
}

function overlap(left, right) {
  return [...left].filter((token) => right.has(token));
}

function exactTokens(value) {
  return new Set(subjectWords(value));
}

function isAcronym(word) {
  return /[\p{Lu}]/u.test(word)
    && !/[\p{Ll}]/u.test(word)
    && /^[\p{L}\p{N}-]+$/u.test(word);
}

function sentenceCaseErrors(subject, context) {
  const errors = [];
  const words = subjectWords(subject);
  if (!words.length) return errors;
  const suppliedTokens = exactTokens([
    context.sourceText,
    context.messageText,
    context.recipientText,
  ].filter(Boolean).join('\n'));
  const [first, ...rest] = words;
  const firstIsNaturallyCased = /^[\p{Lu}\p{Lt}\p{N}]/u.test(first)
    || (suppliedTokens.has(first) && /^[\p{Ll}]/u.test(first));
  if (!firstIsNaturallyCased) {
    errors.push('subject must start in sentence case');
  }
  const unexplainedCapitals = rest.filter((word) => (
    /^\p{Lu}\p{Ll}+/u.test(word)
    && !suppliedTokens.has(word)
    && !isAcronym(word)
  ));
  if (unexplainedCapitals.length) {
    errors.push('subject uses forced Title Case instead of natural sentence case');
  }
  return errors;
}

export function validatePersonalizedSubject(subject, context = {}) {
  const errors = [];
  const normalized = normalizeSubject(subject);
  const words = subjectWords(normalized);
  if (!normalized) errors.push('missing subject');
  if (String(subject || '').trim() !== normalized) {
    errors.push('subject must already use natural sentence capitalization and normalized spacing');
  }
  if (words.length < 2 || words.length > 5) errors.push('subject must contain 2-5 words');
  if (/[:!?]/.test(String(subject || ''))) errors.push('subject contains salesy punctuation');
  if (/[^\p{L}\p{N}'’\-\s]/u.test(normalized)) errors.push('subject contains unsupported punctuation');
  if (GENERIC.some((pattern) => pattern.test(normalized))) errors.push('subject is generic curiosity or follow-up bait');
  if (SALESY.test(normalized)) errors.push('subject leads with the seller or technology');
  errors.push(...sentenceCaseErrors(normalized, context));

  const subjectContent = contentStems(normalized);
  const personIdentity = contentStems(context.contactName || '');
  const companyIdentity = contentStems(context.company || '');
  const usesPersonName = [...subjectContent].some((token) => personIdentity.has(token));
  const usesWholeCompanyName = companyIdentity.size > 0
    && [...companyIdentity].every((token) => subjectContent.has(token));
  if (usesPersonName || usesWholeCompanyName) {
    errors.push('subject uses a person or the whole company name as fake personalization');
  }

  const source = contentStems(context.sourceText || '');
  if (source.size && !overlap(subjectContent, source).length) {
    errors.push('subject is not grounded in the supplied role, evidence, or account context');
  }
  const message = contentStems(context.messageText || '');
  if (message.size && !overlap(subjectContent, message).length) {
    errors.push('subject does not accurately preview this email');
  }
  const recipient = contentStems(context.recipientText || '');
  if (context.requireRecipientGrounding && recipient.size && !overlap(subjectContent, recipient).length) {
    errors.push('subject is not specific to this recipient’s role or account evidence');
  }
  return [...new Set(errors)];
}

export function isGenericSubject(subject) {
  const normalized = subjectKey(subject);
  return !normalized || GENERIC.some((pattern) => pattern.test(normalized)) || SALESY.test(normalized);
}

export function sourcePhraseIsGrounded(phrase, sourceText) {
  const normalizedPhrase = String(phrase || '').replace(/\s+/g, ' ').trim();
  const phraseWords = subjectWords(normalizedPhrase);
  if (phraseWords.length < 2 || phraseWords.length > 12) return false;
  const normalizedSource = String(sourceText || '').replace(/\s+/g, ' ').trim();
  return normalizedSource.toLocaleLowerCase('en-GB')
    .includes(normalizedPhrase.toLocaleLowerCase('en-GB'));
}

export function areDistinctSubjectThreads(first, second) {
  const firstKey = subjectKey(first);
  const secondKey = subjectKey(second);
  if (!firstKey || !secondKey || firstKey === secondKey) return false;
  const canonicalThreadTerms = (value) => new Set(
    [...contentStems(value)].map((token) => token.replace(/e$/i, '')),
  );
  const firstTerms = canonicalThreadTerms(first);
  const secondTerms = canonicalThreadTerms(second);
  if (!firstTerms.size || !secondTerms.size) return true;
  const shared = overlap(firstTerms, secondTerms).length;
  const union = new Set([...firstTerms, ...secondTerms]).size;
  // A synonym can still evade a lexical test, so this is only a deterministic
  // backstop; the independent editor remains responsible for semantic novelty.
  return shared / union < 0.6;
}
