"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  Opportunity,
  OpportunityStage,
  ResearchState,
} from "@/lib/opportunities";
import styles from "./lab.module.css";

type QueueFilter = "all" | "succession" | OpportunityStage;

const stages: Array<{ value: QueueFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "shortlisted", label: "Shortlist" },
  { value: "succession", label: "Succession" },
  { value: "research", label: "Research" },
  { value: "seed", label: "Seeds" },
  { value: "build_ready", label: "Build queue" },
];

const stageLabels: Record<OpportunityStage, string> = {
  seed: "Needs evidence",
  research: "Research",
  shortlisted: "Shortlisted",
  rejected: "Rejected",
  build_ready: "Build ready",
  building: "Building",
  demo_ready: "Demo ready",
  published: "Published",
};

const scoreParts = [
  ["pain", "Pain", 20],
  ["budget", "Budget", 20],
  ["data", "Data", 15],
  ["timing", "Timing", 15],
  ["engineeringGap", "Eng. gap", 15],
  ["access", "Access", 10],
  ["repeatability", "Repeat", 5],
] as const;

const researchLanes = [
  {
    value: "broad",
    label: "Broad Canadian scan",
    focus:
      "a balanced mix of Canadian construction, infrastructure, field service, healthcare operations, logistics, housing, climate adaptation and regulated business workflows",
  },
  {
    value: "succession",
    label: "Succession & knowledge",
    focus:
      "Canadian private mid-market and owner-operated industries with aggregate workforce succession evidence, concentrated tacit operational knowledge, a reachable owner or operations leader, repeatable high-value decisions and a credible 30-to-90-day knowledge-capture pilot",
  },
  {
    value: "construction",
    label: "Construction & property",
    focus:
      "Canadian construction, development, property operations, project controls, claims, permitting and building-service workflows with measurable delay, rework, occupation, dispatch or compliance cost",
  },
  {
    value: "field-service",
    label: "Field service & logistics",
    focus:
      "Canadian equipment service, facilities, cold chain, freight, dispatch, industrial distribution and maintenance workflows with avoidable downtime, truck rolls, spoilage, exception handling or service-level cost",
  },
] as const;

function dateOnly(value?: string | null) {
  return value ? value.slice(0, 10) : "—";
}

export function LabDashboard({
  initialOpportunities,
  initialResearchState,
  updatedAt,
}: {
  initialOpportunities: Opportunity[];
  initialResearchState: ResearchState;
  updatedAt: string;
}) {
  const [opportunities, setOpportunities] = useState(initialOpportunities);
  const [selectedId, setSelectedId] = useState(
    initialOpportunities[0]?.id || "",
  );
  const [stage, setStage] = useState<QueueFilter>("all");
  const [query, setQuery] = useState("");
  const [researchState, setResearchState] = useState(initialResearchState);
  const [researchLane, setResearchLane] = useState("broad");
  const [actionMessage, setActionMessage] = useState("");
  const [preparing, setPreparing] = useState(false);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return opportunities.filter((item) => {
      const stageMatches =
        stage === "all" ||
        (stage === "succession"
          ? item.knowledgeTransfer?.relevance === "core" ||
            item.knowledgeTransfer?.relevance === "supporting"
          : item.stage === stage);
      const queryMatches =
        !normalized ||
        [
          item.title,
          item.sector,
          item.geography,
          item.summary,
          item.buyer,
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalized);
      return stageMatches && queryMatches;
    });
  }, [opportunities, query, stage]);

  const selected =
    opportunities.find((item) => item.id === selectedId) || filtered[0];
  const qualified = opportunities.filter(
    (item) => item.score.total >= 65 && item.stage !== "rejected",
  ).length;
  const evidenceCount = opportunities.reduce(
    (total, item) => total + item.evidence.length,
    0,
  );
  const accountCount = opportunities.reduce(
    (total, item) => total + item.accounts.length,
    0,
  );
  const successionCount = opportunities.filter(
    (item) =>
      item.knowledgeTransfer?.relevance === "core" ||
      item.knowledgeTransfer?.relevance === "supporting",
  ).length;

  useEffect(() => {
    if (researchState.status !== "running") return;
    const timer = window.setInterval(async () => {
      const response = await fetch("/api/research", { cache: "no-store" });
      if (!response.ok) return;
      const next = (await response.json()) as ResearchState;
      setResearchState(next);
      if (next.status === "complete") {
        window.clearInterval(timer);
        window.location.reload();
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [researchState.status]);

  async function runResearch() {
    setActionMessage("");
    setResearchState((current) => ({
      ...current,
      status: "running",
      message: "Starting Problem Radar…",
    }));
    const response = await fetch("/api/research", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        count: 4,
        focus:
          researchLanes.find((lane) => lane.value === researchLane)?.focus ||
          researchLanes[0].focus,
      }),
    });
    const result = (await response.json()) as {
      error?: string;
      message?: string;
    };
    if (!response.ok) {
      setResearchState((current) => ({ ...current, status: "failed" }));
      setActionMessage(result.error || "Could not start research.");
      return;
    }
    setActionMessage(result.message || "Research started.");
  }

  async function prepareBuild() {
    if (!selected) return;
    setPreparing(true);
    setActionMessage("");
    const response = await fetch(
      `/api/opportunities/${selected.id}/prepare`,
      { method: "POST" },
    );
    const result = (await response.json()) as {
      error?: string;
      message?: string;
    };
    setPreparing(false);
    if (!response.ok) {
      setActionMessage(result.error || "Could not prepare the build.");
      return;
    }
    setOpportunities((items) =>
      items.map((item) =>
        item.id === selected.id ? { ...item, stage: "build_ready" } : item,
      ),
    );
    setActionMessage(
      "Build packet created. Claude and Codex now have a bounded, human-approved handoff.",
    );
  }

  return (
    <div className={styles.lab}>
      <header className={styles.hero}>
        <div>
          <p className={styles.kicker}>Internal / Canada / Opportunity engine</p>
          <h1>
            Find the cost.
            <br />
            Build the proof.
          </h1>
        </div>
        <div className={styles.heroAside}>
          <p>
            Research expensive operational workflows, underwrite the wedge, then
            hand one approved problem to the build agents.
          </p>
          <label className={styles.lanePicker}>
            <span>Research lane</span>
            <select
              value={researchLane}
              onChange={(event) => setResearchLane(event.target.value)}
              disabled={researchState.status === "running"}
            >
              {researchLanes.map((lane) => (
                <option key={lane.value} value={lane.value}>
                  {lane.label}
                </option>
              ))}
            </select>
          </label>
          <button
            className={styles.runButton}
            type="button"
            onClick={runResearch}
            disabled={researchState.status === "running"}
          >
            <span
              className={
                researchState.status === "running" ? styles.spinner : undefined
              }
              aria-hidden="true"
            />
            {researchState.status === "running"
              ? "Researching Canada"
              : "Run Problem Radar"}
          </button>
          <p className={styles.runNote}>
            Codex web research · succession lens · OpenClaw opt-in
          </p>
        </div>
      </header>

      <section className={styles.statusStrip} aria-live="polite">
        <div>
          <span
            className={styles.statusLight}
            data-status={researchState.status}
            aria-hidden="true"
          />
          <strong>{researchState.status}</strong>
          <span>{researchState.message}</span>
        </div>
        <span>Queue updated {dateOnly(updatedAt)}</span>
      </section>

      {actionMessage ? (
        <p className={styles.actionMessage} role="status">
          {actionMessage}
        </p>
      ) : null}

      <section className={styles.metrics} aria-label="Research queue summary">
        <Metric label="Problems tracked" value={opportunities.length} />
        <Metric label="Qualified 65+" value={qualified} />
        <Metric label="Evidence records" value={evidenceCount} />
        <Metric label="Account signals" value={accountCount} />
        <Metric label="Succession fits" value={successionCount} />
      </section>

      <section className={styles.workspace}>
        <div className={styles.queue}>
          <div className={styles.queueHeader}>
            <div>
              <p className={styles.kicker}>Research queue</p>
              <h2>Expensive problems</h2>
            </div>
            <label className={styles.search}>
              <span>Search</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Sector, buyer, workflow…"
              />
            </label>
          </div>

          <div className={styles.filters} aria-label="Filter by stage">
            {stages.map((item) => (
              <button
                key={item.value}
                type="button"
                className={stage === item.value ? styles.activeFilter : ""}
                onClick={() => setStage(item.value)}
              >
                {item.label}
                <span>
                  {item.value === "all"
                    ? opportunities.length
                    : item.value === "succession"
                      ? successionCount
                    : opportunities.filter(
                        (opportunity) => opportunity.stage === item.value,
                      ).length}
                </span>
              </button>
            ))}
          </div>

          <div className={styles.rows}>
            {filtered.length ? (
              filtered.map((item, index) => (
                <button
                  className={`${styles.row} ${selected?.id === item.id ? styles.selectedRow : ""}`}
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  aria-pressed={selected?.id === item.id}
                >
                  <span className={styles.rowIndex}>
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className={styles.rowMain}>
                    <span>
                      <i
                        className={styles.stageDot}
                        data-stage={item.stage}
                        aria-hidden="true"
                      />
                      {stageLabels[item.stage]}
                    </span>
                    <strong>{item.title}</strong>
                    <small>
                      {item.sector} · {item.geography}
                    </small>
                  </span>
                  <span className={styles.rowScore}>
                    <strong>{item.score.total}</strong>
                    <small>/ 100</small>
                  </span>
                </button>
              ))
            ) : (
              <p className={styles.empty}>
                No opportunities match this view. Broaden the filter or run a
                new research pass.
              </p>
            )}
          </div>
        </div>

        <aside className={styles.inspector}>
          {selected ? (
            <OpportunityInspector
              opportunity={selected}
              preparing={preparing}
              onPrepare={prepareBuild}
            />
          ) : (
            <p className={styles.empty}>Select an opportunity to inspect it.</p>
          )}
        </aside>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{String(value).padStart(2, "0")}</strong>
    </div>
  );
}

function OpportunityInspector({
  opportunity,
  preparing,
  onPrepare,
}: {
  opportunity: Opportunity;
  preparing: boolean;
  onPrepare: () => void;
}) {
  const canPrepare =
    opportunity.score.total >= 65 &&
    (opportunity.stage === "shortlisted" ||
      opportunity.stage === "build_ready");

  return (
    <>
      <div className={styles.inspectorTop}>
        <p className={styles.kicker}>Opportunity dossier</p>
        <span className={styles.stagePill}>
          {stageLabels[opportunity.stage]}
        </span>
      </div>
      <h2>{opportunity.title}</h2>
      <p className={styles.summary}>{opportunity.summary}</p>

      <div className={styles.scorePanel}>
        <div
          className={styles.scoreDial}
          style={
            {
              "--score": opportunity.score.total,
            } as React.CSSProperties
          }
          aria-label={`Score ${opportunity.score.total} out of 100`}
        >
          <strong>{opportunity.score.total}</strong>
          <span>/100</span>
        </div>
        <div className={styles.scoreBreakdown}>
          {scoreParts.map(([key, label, maximum]) => (
            <div key={key}>
              <span>{label}</span>
              <i>
                <b
                  style={{
                    width: `${(opportunity.score[key] / maximum) * 100}%`,
                  }}
                />
              </i>
              <strong>
                {opportunity.score[key]}/{maximum}
              </strong>
            </div>
          ))}
        </div>
      </div>
      <p className={styles.rationale}>{opportunity.score.rationale}</p>

      <DossierBlock title="Who feels it">
        <p>{opportunity.peopleImpact}</p>
        <dl className={styles.roles}>
          <div>
            <dt>Economic buyer</dt>
            <dd>{opportunity.buyer}</dd>
          </div>
          <div>
            <dt>Operational champion</dt>
            <dd>{opportunity.champion}</dd>
          </div>
        </dl>
      </DossierBlock>

      <DossierBlock title="Current workflow">
        <p>{opportunity.currentWorkflow}</p>
      </DossierBlock>

      <DossierBlock title="Value pool">
        <p className={styles.factLabel}>Inspectable unit</p>
        <p>{opportunity.valueUnit}</p>
        <p className={styles.muted}>{opportunity.valueHypothesis}</p>
      </DossierBlock>

      <DossierBlock title="Smallest useful wedge">
        <p>{opportunity.solutionWedge}</p>
        <div className={styles.demoCallout}>
          <span>Two-minute demo</span>
          <p>{opportunity.demoConcept}</p>
        </div>
      </DossierBlock>

      <DossierBlock title={`Evidence · ${opportunity.evidence.length}`}>
        {opportunity.evidence.length ? (
          <ul className={styles.evidenceList}>
            {opportunity.evidence.map((item, index) => (
              <li key={`${item.url}-${index}`}>
                <div>
                  <span>{item.kind}</span>
                  <span>{item.sourceType}</span>
                  <time>{dateOnly(item.observedAt)}</time>
                </div>
                <p>{item.claim}</p>
                <a href={item.url} target="_blank" rel="noreferrer">
                  Inspect source ↗
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.emptyInline}>
            Seed hypothesis only. No score or outreach until live evidence is
            attached.
          </p>
        )}
      </DossierBlock>

      <DossierBlock title={`Design-partner signals · ${opportunity.accounts.length}`}>
        {opportunity.accounts.length ? (
          <ul className={styles.accountList}>
            {opportunity.accounts.map((account) => (
              <li key={`${account.name}-${account.signalUrl}`}>
                <div>
                  <strong>{account.name}</strong>
                  <span>{account.domain}</span>
                </div>
                <p>{account.signal}</p>
                <small>{account.buyerRoute}</small>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.emptyInline}>
            Problem Radar must find three plausible Canadian design partners.
          </p>
        )}
      </DossierBlock>

      {opportunity.knowledgeTransfer &&
      opportunity.knowledgeTransfer.relevance !== "none" ? (
        <DossierBlock title="Succession & knowledge transfer">
          <p className={styles.factLabel}>
            {opportunity.knowledgeTransfer.relevance} fit
          </p>
          <p>{opportunity.knowledgeTransfer.workforceSignal}</p>
          <div className={styles.demoCallout}>
            <span>Capture plan</span>
            <p>{opportunity.knowledgeTransfer.capturePlan}</p>
          </div>
          <p className={styles.muted}>
            {opportunity.knowledgeTransfer.safeguards}
          </p>
          <a
            className={styles.sourceLink}
            href={opportunity.knowledgeTransfer.sourceUrl}
            target="_blank"
            rel="noreferrer"
          >
            Inspect workforce source ↗
          </a>
        </DossierBlock>
      ) : null}

      <div className={styles.buildGate}>
        <p className={styles.kicker}>Human gate / Build</p>
        <h3>
          {canPrepare
            ? "Turn this into a build packet."
            : "Research must clear 65 before build."}
        </h3>
        <p>
          Approval prepares a bounded Claude + Codex handoff. It does not run
          agents, publish, push, or contact anyone.
        </p>
        <button
          type="button"
          onClick={onPrepare}
          disabled={!canPrepare || preparing || opportunity.stage === "build_ready"}
        >
          {opportunity.stage === "build_ready"
            ? "Build packet ready"
            : preparing
              ? "Preparing handoff…"
              : "Approve & prepare MVP"}
        </button>
      </div>
    </>
  );
}

function DossierBlock({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className={styles.dossierBlock}>
      <h3>{title}</h3>
      <div>{children}</div>
    </section>
  );
}
