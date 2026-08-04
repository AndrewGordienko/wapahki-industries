import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LabDashboard } from "./LabDashboard";
import { readOpportunityStore, readResearchState } from "@/lib/opportunities";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Opportunity Lab",
  description:
    "Internal research queue for evidence-backed Canadian operational problems.",
  robots: { index: false, follow: false },
};

export default async function LabPage() {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.ENABLE_LAB_DASHBOARD !== "1"
  ) {
    notFound();
  }

  const [store, researchState] = await Promise.all([
    readOpportunityStore(),
    readResearchState(),
  ]);

  return (
    <LabDashboard
      initialOpportunities={store.opportunities}
      initialResearchState={researchState}
      updatedAt={store.updatedAt}
    />
  );
}
