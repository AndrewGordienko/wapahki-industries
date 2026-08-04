const NUMBER_TOKEN = /(?:[$£€]\s*)?\d[\d,.]*(?:\s*%|\s*(?:hours?|minutes?|days?|weeks?|months?|years?|people|staff|sites?|locations?|claims?|projects?|actions?))?/gi;

const ECONOMIC_OUTPUT = /(?:[$£€]\s*\d|\b(?:CAD|USD)\s*\d|\d[\d,.]*\s*(?:management|staff|labou?r)[ -]?hours?\b|\b\d[\d,.]*\s*%[^.!?\n]{0,160}\b(?:revenue|cost|saving|margin|actions?|conversion)\b|\b(?:cost|saving|revenue|margin|exposure|burden)\b[^.!?\n]{0,80}(?:[$£€]\s*\d|\d[\d,.]*\s*%))/i;

const ASSUMPTION_LANGUAGE = /\b(?:if|suppose|assuming|assume|assumption|for illustration|illustrative|using a round|at a blended|at an? loaded)\b/i;

const CALCULATION_LANGUAGE = /(?:\b(?:that (?:is|would be|represents)|works? out to|comes? to|equals?|roughly|approximately|about|around|more than|less than)\b|[=≈×]|\bx\b)/i;

const CALIBRATION_QUESTION = /(?:\border of magnitude\b|\b(?:numbers?|assumptions?|model)\b[^?]{0,80}\b(?:right|wrong|different|close)\b|\bdoes (?:most|more) of (?:the )?(?:cost|effort|value|burden)\b[^?]{0,80}\b(?:sit|happen|come from)\b|\bwhere\b[^?]{0,80}\b(?:cost|effort|value|burden)\b[^?]{0,40}\b(?:sit|happen|come from)\b)/i;

const COST_OR_VALUE_LANGUAGE = /\b(?:costs?|spends?|spent|saving|savings|save|saved|revenue|margin|burden|effort|labou?r|staff[ -]?hours?|management[ -]?hours?|lost actions?|missed actions?)\b/i;
const MONEY_TOKEN = /(?:[$£€]\s*\d[\d,.]*|\b(?:CAD|USD)\s*\d[\d,.]*)/gi;

export function hasQuantifiedEconomics(value) {
  return ECONOMIC_OUTPUT.test(String(value || ''));
}

export function looksLikeIllustrativeCostAnalysis(value) {
  const text = String(value || '');
  if (!hasQuantifiedEconomics(text)) return false;
  const numberCount = (text.match(NUMBER_TOKEN) || []).length;
  const moneyCount = (text.match(MONEY_TOKEN) || []).length;
  return (ASSUMPTION_LANGUAGE.test(text) && numberCount >= 3)
    || (CALCULATION_LANGUAGE.test(text) && COST_OR_VALUE_LANGUAGE.test(text) && numberCount >= 3)
    || (moneyCount >= 2 && COST_OR_VALUE_LANGUAGE.test(text));
}

export function validateIllustrativeCostAnalysis(value, {
  requireCalibration = true,
  requireOutput = true,
} = {}) {
  const text = String(value || '');
  const errors = [];
  const numbers = text.match(NUMBER_TOKEN) || [];

  if (requireOutput && !hasQuantifiedEconomics(text)) {
    errors.push('cost analysis has no quantified economic output');
  }
  if (numbers.length < 3) {
    errors.push('cost analysis does not show enough numeric inputs and output');
  }
  if (!ASSUMPTION_LANGUAGE.test(text)) {
    errors.push('cost analysis does not label its assumptions');
  }
  if (!CALCULATION_LANGUAGE.test(text)) {
    errors.push('cost analysis does not show the arithmetic bridge');
  }
  if (requireCalibration && !CALIBRATION_QUESTION.test(text)) {
    errors.push('cost analysis does not ask for an order-of-magnitude calibration');
  }
  return errors;
}
