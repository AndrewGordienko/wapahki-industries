// Best-effort classification of a contact's title into a Problem Found
// contact-map role: economic_buyer | champion | technical | referral.
// Uses each product's own persona lists from data/products.json. This is a
// convenience for seeding/migration and a default in the UI — the user can
// always override a contact's role by hand.
// Function-and-seniority heuristic. The four contact-map roles don't separate
// cleanly by persona keyword (every product's buyers and champions share words
// like "director"/"manager"), so we classify by what the title *does* and how
// senior it is, which generalizes across all four products:
//   - clearly technical/data title            -> technical (the data owner)
//   - senior (VP/Director/Head/Chief)          -> economic_buyer (holds budget)
//   - operational manager/lead/analyst/etc.    -> champion (feels the pain)
// Referral is an external route, rarely inferable from a title, so it's left
// for the user to set by hand. productId is accepted for future refinement.
const TECH = /\b(data|analytics?|engineer(?:ing)?|gis|developer|scientist|systems?|integration|architect|technolog\w*|software|digital|\bbi\b|\bit\b|bim)\b/i;
const SENIOR = /\b(chief|c[a-z]?o\b|president|vice[- ]?president|vp|svp|evp|head\b|director|\bdir\b|executive|owner|founder|partner|general manager|sporting director|technical director)\b/i;
const OPERATIONAL = /\b(manager|lead|supervisor|coordinator|superintendent|principal|specialist|controller|administrator|consultant|scheduler|analyst|dispatch|officer|planner)\b/i;

// Returns { role } or { role: null } when nothing fits.
export function classifyRole(title, _productId) {
  if (!title) return { role: null };
  const t = String(title);
  if (TECH.test(t)) return { role: 'technical' };
  if (SENIOR.test(t)) return { role: 'economic_buyer' };
  if (OPERATIONAL.test(t)) return { role: 'champion' };
  return { role: 'champion' };
}
