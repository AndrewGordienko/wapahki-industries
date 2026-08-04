const evidence = {
  type: "object",
  additionalProperties: false,
  required: ["claim", "url", "observedAt", "kind", "sourceType"],
  properties: {
    claim: { type: "string" },
    url: { type: "string" },
    observedAt: { type: "string" },
    kind: { type: "string", enum: ["observed", "inference"] },
    sourceType: {
      type: "string",
      enum: ["primary", "secondary", "practitioner"],
    },
  },
};

const account = {
  type: "object",
  additionalProperties: false,
  required: [
    "name",
    "domain",
    "signal",
    "signalUrl",
    "observedAt",
    "buyerRoute",
  ],
  properties: {
    name: { type: "string" },
    domain: { type: "string" },
    signal: { type: "string" },
    signalUrl: { type: "string" },
    observedAt: { type: "string" },
    buyerRoute: { type: "string" },
  },
};

const knowledgeTransfer = {
  type: "object",
  additionalProperties: false,
  required: [
    "relevance",
    "workforceSignal",
    "sourceUrl",
    "capturePlan",
    "safeguards",
  ],
  properties: {
    relevance: {
      type: "string",
      enum: ["core", "supporting", "none"],
    },
    workforceSignal: { type: "string" },
    sourceUrl: { type: "string" },
    capturePlan: { type: "string" },
    safeguards: { type: "string" },
  },
};

const candidateProperties = {
  id: { type: "string" },
  title: { type: "string" },
  sector: { type: "string" },
  geography: { type: "string" },
  summary: { type: "string" },
  peopleImpact: { type: "string" },
  currentWorkflow: { type: "string" },
  buyer: { type: "string" },
  champion: { type: "string" },
  valueUnit: { type: "string" },
  valueHypothesis: { type: "string" },
  solutionWedge: { type: "string" },
  demoConcept: { type: "string" },
  dataNeeded: {
    type: "array",
    minItems: 2,
    items: { type: "string" },
  },
  risks: {
    type: "array",
    minItems: 1,
    items: { type: "string" },
  },
  evidence: {
    type: "array",
    minItems: 2,
    items: evidence,
  },
  accounts: {
    type: "array",
    minItems: 3,
    items: account,
  },
  knowledgeTransfer,
};

const candidateRequired = Object.keys(candidateProperties);

export const radarSchema = {
  type: "object",
  additionalProperties: false,
  required: ["researchSummary", "candidates", "searchNotes"],
  properties: {
    researchSummary: { type: "string" },
    candidates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: candidateRequired,
        properties: candidateProperties,
      },
    },
    searchNotes: {
      type: "array",
      items: { type: "string" },
    },
  },
};

const score = {
  type: "object",
  additionalProperties: false,
  required: [
    "pain",
    "budget",
    "data",
    "timing",
    "engineeringGap",
    "access",
    "repeatability",
    "total",
    "rationale",
  ],
  properties: {
    pain: { type: "integer", minimum: 0, maximum: 20 },
    budget: { type: "integer", minimum: 0, maximum: 20 },
    data: { type: "integer", minimum: 0, maximum: 15 },
    timing: { type: "integer", minimum: 0, maximum: 15 },
    engineeringGap: { type: "integer", minimum: 0, maximum: 15 },
    access: { type: "integer", minimum: 0, maximum: 10 },
    repeatability: { type: "integer", minimum: 0, maximum: 5 },
    total: { type: "integer", minimum: 0, maximum: 100 },
    rationale: { type: "string" },
  },
};

export const underwritingSchema = {
  type: "object",
  additionalProperties: false,
  required: ["underwritingSummary", "opportunities", "rejected"],
  properties: {
    underwritingSummary: { type: "string" },
    opportunities: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          ...candidateRequired,
          "verdict",
          "whyNow",
          "thirtyDayProof",
          "score",
        ],
        properties: {
          ...candidateProperties,
          verdict: {
            type: "string",
            enum: ["shortlist", "research", "reject"],
          },
          whyNow: { type: "string" },
          thirtyDayProof: { type: "string" },
          score,
        },
      },
    },
    rejected: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "reason"],
        properties: {
          id: { type: "string" },
          reason: { type: "string" },
        },
      },
    },
  },
};
