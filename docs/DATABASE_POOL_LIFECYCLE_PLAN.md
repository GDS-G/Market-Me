# Production database pool lifecycle correction

Status: identified follow-up after 1.35, not part of its runtime evidence.

## Observed defect

`apps/web/src/server/database.ts` first checks `globalThis.marketMeDatabase`, but only assigns it outside production. In production every repository accessor constructs a new postgres client plus all repository instances. Each client permits up to ten connections, with a twenty-second idle timeout; multiple accesses and concurrent requests can create many independent pools. This is not a result/authorization cache and is unnecessary resource multiplication. The related-work increment exposed this during final code review, without changing it.

## Bounded correction

Retain one lazily initialized server-only database/repository bundle per runtime process/isolate in production as well as development, shared across every accessor and module reload in that runtime. Keep the current configuration fail-closed behavior, no eager database connection on import, existing repository interfaces and database-client timeouts/cap. Do not retain user, membership, results, query authority or page snapshots. Every repository method continues to query current state. Configuration/credential changes require a process restart; do not log or expose connection strings. Each worker/process/isolate has its own independent cap, not a fleet-wide connection budget.

## Acceptance

Add focused tests for all accessors sharing one client/bundle, production and development module reimports, no eager creation, absent-configuration failure without poisoning later initialization, and continued fresh data/authorization reads. Verify against an isolated live database that repeated/concurrent getter use does not create an unbounded set of backend connections and that existing state changes are observed, with cleanup and no production data. Record pre-fix failure before the minimal correction. Repeat full static/test/build/native checks and production health/authentication smoke; no UI redesign or browser stored state is expected.

Document the cache variable/type, initialization lifetime, SQL options, process boundaries, restart/shutdown/rolling-deploy requirements and remaining capacity-testing limits in repository and existing Google development tabs. No new secret, environment variable, schema, provider capability or deployment is authorized by this plan. Large-scale capacity testing and deployment-specific total connection budgets remain separate from the bounded regression proof.
