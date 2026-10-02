# Workspace analytics: measured activity and outcomes

Status: next independent product increment after the1.44 preparation preview. Specification sections01 and17 call for an Analytics destination that distinguishes activity from business outcomes, identifies metric sources/availability and avoids unnecessary personal tracking. Existing measurements and correction-aware provider totals are visible only inside individual Campaign runs; no workspace Analytics page exists.

## First usable slice

Add a read-only, current-membership-authorized Analytics page in shared desktop/mobile navigation. Show recorded run/publication status counts separately from observed first-party/ingested events and latest provider aggregate measurements. Include optional current-workspace Campaign filtering and links to actual Campaign runs. Explicitly label all-time scope, latest provider observations and bounded detail lists; absence of observations means not measured, not proof of zero real-world activity or failure.

Keep first-party event counts, nonmonetary values and per-currency recorded amounts distinct. Do not combine provider lifetime totals with time-window event counts, add repeated snapshots, count a publication as a conversion, or label engagement as business success. Use latest correction-aware campaign_provider_metric_total rows rather than summing historical report snapshots. Retain provider-specific metric names and source labels. Never infer unique people, reach, attribution, conversion rate, ROI, consent or provider freshness from stored aggregates alone.

## Data and authority design

Use a new focused read repository/projection, not the existing run-success summary that merges measurement kinds for workflow criteria evaluation. Existing workflow evaluation and provider collectors are untouched. Query the current workspace only, enforce authenticated membership independently of client input and verify optional Campaign ownership. Obtain one coherent transaction snapshot for all aggregates. No row, audit, provider request, workflow signal or synchronization action is created.

Keep PostgreSQL count/bigint/numeric sums as exact decimal strings; never round through JavaScript Number. Currency groups remain separate, including negative adjustments and values beyond safe integer precision. Null/no recorded value is not manufactured zero. No foreign currencies are converted and this view does not reinterpret the separate AI budget hundredths ledger.

Minimize data to aggregates, statuses, timestamps and necessary Campaign/run display identities. Do not return event keys, external personal identifiers, arbitrary properties, raw provider payloads or credentials. Bound detailed groups and recent runs with truthful coverage metadata; global headline counts must not silently describe only the bounded subset. Reject unknown/duplicate filters and invalid scope, and disable speculative navigation prefetch. Keep no-data states useful and honest.

## Acceptance and next boundaries

Prove empty and mixed datasets, current/revoked membership, foreign Campaign isolation, exact large/negative/mixed-currency values, correction replacement without double counting, source separation, bounded-list coverage and no-write behavior. Run desktop/mobile/keyboard, production authentication/readiness, full local/cloud and release/documentation gates. Browser acceptance uses isolated synthetic data and cannot trigger provider synchronization.

This slice does not implement controlled experiments, recommendations, multi-touch attribution, commerce integrations, full cost accounting, CSV/BI exports or a claim that all analytics requirements are complete. Those remain separate explicit increments. No provider credentials or user decision are required for this read-only reporting work.
