// Seed a few illustrative GnK problems (safe to delete/edit in the UI).
import { db, createGnkProject, listGnkProjects } from '../src/db.js';

if (listGnkProjects().length) {
  console.log(`gnk_projects already has ${listGnkProjects().length} rows — not seeding.`);
} else {
  const seeds = [
    {
      title: 'Where ocean plastic actually collects', domain: 'climate',
      problem: 'Cleanup crews and NGOs waste fuel and time searching for plastic that has already drifted somewhere else.',
      who_affected: 'Ocean-cleanup orgs, coastal communities, marine ecosystems worldwide.',
      why_it_matters: 'Targeting the real accumulation zones could multiply how much plastic each cleanup dollar removes.',
      what_we_build: 'A model that fuses currents, wind, and river-outflow data to predict weekly plastic hotspots on a map, with an API cleanup fleets can route against.',
      interest: 5, feasibility: 3, status: 'idea',
    },
    {
      title: 'Food-bank demand forecasting', domain: 'food / social',
      problem: 'Food banks over- or under-stock because demand swings with weather, paydays, rent cycles, and local layoffs.',
      who_affected: 'Food banks and the families who rely on them, especially at month-end.',
      why_it_matters: 'Better forecasts mean less spoilage and fewer empty shelves when demand spikes.',
      what_we_build: 'A simple forecasting tool per branch that predicts next-week demand by category and flags when to request specific donations.',
      interest: 4, feasibility: 4, status: 'scoping',
    },
    {
      title: 'ER load balancing for a city', domain: 'health',
      problem: 'One ER is overrun while another nearby sits half-empty, and patients have no way to know before they arrive.',
      who_affected: 'Patients in urgent (not critical) situations, and the ER staff absorbing the surges.',
      why_it_matters: 'Shifting even a fraction of walk-ins cuts wait times and the risk that comes with them.',
      what_we_build: 'A live estimated-wait map across a region plus a model that nudges non-critical patients toward the shorter queue.',
      interest: 4, feasibility: 3, status: 'idea',
    },
    {
      title: 'Draft & scouting models for a pro team', domain: 'sports',
      problem: 'Smaller pro teams make draft and lineup calls on intuition because they lack an analytics group.',
      who_affected: 'Mid-market pro and semi-pro teams competing against richer analytics departments.',
      why_it_matters: 'A well-scoped model can find undervalued players and even out a lopsided budget.',
      what_we_build: 'A scouting model tuned to one league that ranks prospects and simulates draft scenarios before the pick.',
      interest: 4, feasibility: 4, status: 'idea',
    },
  ];
  for (const s of seeds) createGnkProject(s);
  console.log(`seeded ${seeds.length} GnK problems`);
}
