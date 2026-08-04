# Things I wish someone told me before I tried to automate LinkedIn outreach with OpenClaw

**Type:** Reference — community discussion post (saved as context for our upcoming OpenClaw LinkedIn outreach build)
**Saved:** 2026-07-27

> Captured verbatim as source material. The author spent three weeks getting OpenClaw
> to do LinkedIn outreach and documented what worked and what didn't.

---

I spent three weeks trying to get OpenClaw to do LinkedIn outreach properly. Almost gave up twice. Here's everything I learned the hard way.

## The obvious approach doesn't work

First instinct: give the agent browser access, let it navigate LinkedIn, send connection requests. Sounds clean. In practice LinkedIn detects automation at the session level almost instantly. Two days in, my account was restricted. The problem isn't the agent, it's treating LinkedIn like a normal website you can just scrape and click through.

## What actually works: warm-up first, volume later

LinkedIn accounts have trust scores. A fresh account or one that suddenly sends 40 connection requests in a day gets flagged regardless of how "human" the behavior looks. You need a progressive warm-up period, 2-3 weeks minimum, before you touch any real volume. This isn't optional. Skip it and you're burning your account.

## The ICP scoring problem

My agent was connecting with everyone who matched a broad keyword search. Terrible results. The fix was adding a scoring layer before any outreach happens: engagement signals (did this person post recently, comment on relevant content, change jobs in the last 90 days), not just title and company. Once I added intent signals to the filtering step, reply rates went from noise to something actually useful.

## Rate limiting is more nuanced than you think

Free LinkedIn accounts, Premium, and Sales Navigator have completely different safe thresholds. Running the same rate limits across account types is a fast way to get restricted. The agent needs to know what kind of account it's operating on and adjust accordingly.

## The conversation flow is where most people stop

Getting a connection accepted is easy. Having the agent handle the follow-up conversation through to a booked call is the hard part. You need explicit decision trees: what to say if they reply with a question, what to say if they go silent, when to escalate to a calendar link. Most agent setups I've seen stop at "send connection request + first message" and call it done. That's maybe 20% of the workflow.

## Model routing matters here too

ICP scoring and intent signal detection can run on Haiku or Sonnet, cheap and fast. The actual conversation drafting, where tone and timing matter, that's where you want a stronger model. Same principle as everything else in OpenClaw: don't run Opus on the parts that don't need it.

## Where I ended up

Running a full loop now: agent finds leads based on intent signals, scores them against my ICP, handles the conversation from connection request to demo booked. Cost per lead is essentially zero beyond tokens.

Happy to go deeper on any of these if useful, especially the intent signal detection part — that was the biggest unlock for me.

---

*Post engagement at time of capture: 19 upvotes, 35 comments.*
