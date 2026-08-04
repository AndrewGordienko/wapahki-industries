import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type OpportunityStage =
  | "seed"
  | "research"
  | "shortlisted"
  | "rejected"
  | "build_ready"
  | "building"
  | "demo_ready"
  | "published";

export type EvidenceItem = {
  claim: string;
  url: string;
  observedAt: string;
  kind: "observed" | "inference";
  sourceType: "primary" | "secondary" | "practitioner";
};

export type AccountSignal = {
  name: string;
  domain: string;
  signal: string;
  signalUrl: string;
  observedAt: string;
  buyerRoute: string;
};

export type KnowledgeTransfer = {
  relevance: "core" | "supporting" | "none";
  workforceSignal: string;
  sourceUrl: string;
  capturePlan: string;
  safeguards: string;
};

export type OpportunityScore = {
  pain: number;
  budget: number;
  data: number;
  timing: number;
  engineeringGap: number;
  access: number;
  repeatability: number;
  total: number;
  rationale: string;
};

export type Opportunity = {
  id: string;
  title: string;
  sector: string;
  geography: string;
  stage: OpportunityStage;
  summary: string;
  peopleImpact: string;
  currentWorkflow: string;
  buyer: string;
  champion: string;
  valueUnit: string;
  valueHypothesis: string;
  solutionWedge: string;
  demoConcept: string;
  dataNeeded: string[];
  risks: string[];
  evidence: EvidenceItem[];
  accounts: AccountSignal[];
  knowledgeTransfer?: KnowledgeTransfer;
  score: OpportunityScore;
  verdict?: "shortlist" | "research" | "reject";
  whyNow?: string;
  thirtyDayProof?: string;
  createdAt: string;
  updatedAt: string;
};

export type OpportunityStore = {
  version: number;
  updatedAt: string;
  opportunities: Opportunity[];
};

export type ResearchState = {
  status: "idle" | "running" | "complete" | "failed";
  runner: string | null;
  startedAt: string | null;
  completedAt: string | null;
  message: string;
  lastRunId: string | null;
  opportunitiesAdded: number;
  totalOpportunities?: number;
  pid?: number | null;
};

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

export async function readOpportunityStore(): Promise<OpportunityStore> {
  return readJson(join(process.cwd(), "data", "opportunities.json"), {
    version: 1,
    updatedAt: new Date(0).toISOString(),
    opportunities: [],
  });
}

export async function readResearchState(): Promise<ResearchState> {
  return readJson(join(process.cwd(), "data", "research-state.json"), {
    status: "idle",
    runner: null,
    startedAt: null,
    completedAt: null,
    message: "Ready for research.",
    lastRunId: null,
    opportunitiesAdded: 0,
    pid: null,
  });
}
