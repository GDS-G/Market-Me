# Server database pool lifecycle

Implemented for 1.36.0; see [release evidence](RELEASES.md) and [original plan](DATABASE_POOL_LIFECYCLE_PLAN.md). This changes resource reuse, not authorization or query-result caching.

## Defect and correction

The previous `apps/web/src/server/database.ts` factory checked `globalThis.marketMeDatabase` before every accessor, but assigned it only outside production. Production therefore constructed one postgres client and an entire repository bundle per accessor call. Since each pool independently permits up to ten connections, repeated/concurrent requests could multiply backend connections before the twenty-second idle timeout.

The correction assigns the fully constructed bundle in every environment. Initialization stays synchronous and lazy: importing the module performs no configuration read, client construction or query. The first accessor validates database configuration, constructs one client/bundle, saves it and returns the chosen repository. Later accessors in the same JavaScript runtime/global environment return that bundle, including after module reimport. No awaited operation separates check and assignment, so concurrent request continuations cannot interleave a second construction in this runtime. The driver itself opens a socket only when a query executes.

`import "server-only"` remains mandatory. This handle must never move into a Client Component, React props, API response or browser global. It contains the SQL client and server configuration, not user-selectable connection information. Initialization/configuration failures throw; no failed or partial bundle is cached. Query failures propagate normally without replacing the client or replaying writes; the driver handles connection availability on later ordinary queries. No automatic mutation retry is introduced.

## Important variables, fields and lifetimes

| Name | Purpose and lifetime |
| --- | --- |
| `databaseGlobal` | Typed view of server `globalThis`; module-local alias, not a second cache. |
| `marketMeDatabase` | Optional process/isolate-global repository bundle. Absent until successful initialization; retained in production/development/test. Holds no actor, membership, page snapshot, query result or approval grant. |
| `getRepositories()` | Private synchronous lazy factory returning the existing complete bundle or creating it once. |
| `databaseUrl` | Local value read from server configuration only during initialization; absent value throws `DatabaseUnavailableError`. Never logged or sent to the browser. |
| `sql` | One `createDatabaseClient(databaseUrl)` result shared by all 22 repositories. Driver pool lazily opens/reuses connections. |
| `repositories` | Local complete object assigned to the global only after construction. Repository objects retain SQL and, in three cases, application-origin options. |
| `DatabaseUnavailableError` | Existing configuration failure; preserves fail-closed behavior without poisoning later initialization. |

The bundle fields/accessors are: `core`/`getRepository`; `campaigns`/`getCampaignRepository`; `preparations`/`getCampaignPreparationRepository`; `finalizations`/`getCampaignFinalizationRepository`; `packageReviews`/`getContentPackageReviewRepository`; `publishing`/`getPublishingRepository`; `companion`/`getCompanionRepository`; `profiles`/`getProfileRepository`; `drafts`/`getDraftRepository`; `relationships`/`getRelationshipRepository`; `conversations`/`getConversationRepository`; `conversationAssistant`/`getConversationAssistantRepository`; `conversationComposer`/`getConversationComposerRepository`; `ai`/`getAiRepository`; `sourcePreparations`/`getSourcePreparationRepository`; `sourceSetups`/`getSourceSetupRepository`; `sourceSamples`/`getSourceSampleRepository`; `preparationPresets`/`getPreparationPresetRepository`; `workspaceManagement`/`getWorkspaceManagementRepository`; `workspaceMemberRoles`/`getWorkspaceMemberRoleRepository`; `workspaceStart`/`getWorkspaceStartRepository`; `packageWork`/`getPackageWorkRepository`.

These are repository service handles, not dictionaries keyed by user or workspace. Campaign, finalization and publishing repositories retain initialization-time `appBaseUrl` options; other repository constructors retain SQL only. Authorization and domain values remain method-local SQL results. Existing repositories already support concurrent usage in development; transactions and query parameters, not a mutable per-user repository field, carry request scope. Helpers' Maps/Sets for graph/identity processing remain operation-local, not new global caches.

`packages/database/src/client.ts` options remain unchanged: `max=10`, `idle_timeout=20` seconds, `connect_timeout=10` seconds and `transform=postgres.camel`. The exported `DatabaseOptions` optional overrides (`max`, `idleTimeoutSeconds`, `connectTimeoutSeconds`) and generic `DatabaseClient` type are unchanged. Web factory supplies no override. Driver transactions reserve a pool connection and return it after completion; normal concurrent queries queue at the pool cap. Query order still requires explicit awaiting/transactions where relevant.

## Security and capacity boundaries

Pooling does not memoize membership, tenant scope, roles, labels, approvals or read results. Every repository call still executes its normal validation/current-state query. A removed member must lose access on the next read; a changed role/name must be observed through the same cached repository. No organization-owner fallback, session setting, credential, permission, endpoint or worker is added. Never use persistent connection session state to carry tenant/actor authority; retain explicit SQL parameters and existing transaction-local checks.

The ten-connection limit is per client in one JavaScript runtime/global environment, not a fleet-wide limit. Separate Node processes, serverless isolates, replicas, build workers, ingestion/workflow workers, readiness probes or explicit other clients have their own pools. The correction addresses this web repository factory only. Budget database capacity across every service and rolling-deploy overlap before deployment; this bounded regression is not a throughput or production-scale capacity certification.

## Configuration, deployment and recovery

Database URL/credentials and constructor-captured origin changes require a controlled process restart. A changed environment variable does not hot-swap the existing pool. Do not clear/overwrite the global while requests are running: that can strand old pools and multiply connections again. Development must also restart when changing repository shape/classes. No browser refresh is a pool reset.

Retain all 120 frozen migrations; there is no schema, dependency, environment-variable, provider-scope or secret addition. Deploy matching web code, drain existing requests and replace old processes normally. Process termination closes its sockets; idle connections can close and reconnect under the unchanged driver policy. This increment does not add custom OS-signal handlers or a public shutdown endpoint. Hosts that need explicit graceful database drain must coordinate `sql.end()` with HTTP/request shutdown; calling it while still accepting work rejects new queries. Rollback restores the older resource-multiplication risk and is not a data rollback. Never erase domain records to resolve connection saturation.

## Regression proof and fixture collections

The pre-fix production unit suite has seven expected failures and four passes: production reuse/reimports/recovery/query-failure/config-change invariants fail while development reuse and lazy import work. A separate isolated read-only probe makes twelve sequential and sixteen concurrent getter/query calls: before correction, 28 client objects, twelve sequential backend IDs and sixteen concurrent backend IDs; afterward, one client, one sequential backend and ten concurrent backends. Every probe client is closed afterward.

`database-lifecycle.test.ts` uses hoisted mock `sql`, `createClient`, `config` functions, reset modules and isolated global/environment stubs; teardown restores them. The request-local `getters` array enumerates all 22 exported repository accessors. Tests cover production/development/test reuse, production/development reimports, no eager initialization, missing configuration/client-construction failures, restart-only configuration changes, fresh per-actor reads and subsequent query recovery without write retry. Mock response arrays are synthetic, not production data.

`database-lifecycle.integration.test.ts` permits only `market_me_ci` or `market_me_qa_136_*`; absent configuration skips but is not release acceptance. Its `clients` Set tracks actual handles for deterministic `sql.end({timeout:5})` cleanup, never production runtime. `sequential` Set contains backend IDs from twelve serial reads; `concurrent` array contains sixteen backend IDs after bounded 25-ms read-only server delays. At most ten distinct concurrent backends is required. Test-only private SQL inspection adds no runtime export.

The second live case bootstraps one uniquely named synthetic user/workspace, then uses the same repository to observe owner→viewer, renamed workspace, denied unrelated actor and removed membership. Its name update advances existing `settings_revision`; the initial fixture omission correctly failed the database guard and was repaired without changing runtime constraints. Finally it removes only its synthetic organization/user and closes every captured client. This proves current data/authority stays uncached while pool objects persist. Final focused coverage is eleven unit and two live cases; full/cloud/production results belong in [Releases](RELEASES.md).
