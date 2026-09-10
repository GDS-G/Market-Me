# Cloud continuous integration

## 1.23 verification in progress

Exact-preview finalization is being verified locally. A 1.23 cloud run has not yet been published; do not treat the prior 1.22 run below as evidence for changed source. The same clean Linux workflow will run all migrations, test suites, types, lint, frontend builds and audits before main promotion.

## Historical 1.22 checkpoint

The **1.22 source** [`f174493cbb7621e367a81caddd2261907a001377`](https://github.com/GDS-G/Market-Me/commit/f174493cbb7621e367a81caddd2261907a001377) passed [Linux cloud CI](https://github.com/GDS-G/Market-Me/actions/runs/34435564818) in 3 minutes 30 seconds. All **864 tests across 90 files passed without skips**, including 111-migration PostgreSQL integration, atomic preparation/retry/authority races, exact raw preview capability regressions and three actual Temporal history replays. Package counts: web 274, workflow-worker 60, companion protocol 4, connectors 166, database 188, domain 65, generation 29, ingestion 11, media 24 and workflows 43. Clean locked installation, native dependency smoke, generated types, all workspace typechecks, lint, the 93-page web/companion frontend builds and both zero-vulnerability audits passed. No cloud-only source fix was required. Exact tested source was fast-forwarded to main; no production deployment or native installer distribution occurred.

## Historical 1.21 checkpoint

The **1.21 source** `2640b75ee6635f0c020259bf864d81eaccf8bdde` passed [Linux cloud CI](https://github.com/GDS-G/Market-Me/actions/runs/34433881287) in 3 minutes 19 seconds. All **695 tests across 83 files passed without skips**, including 110-migration PostgreSQL integration, immutable draft evidence refresh/revision checks and three actual Temporal history replays. Clean locked installation, native dependency smoke, generated types, workspace typecheck, lint, web/companion frontend builds and both zero-vulnerability audits passed. Exact tested source was fast-forwarded to main; no production deployment or native installer distribution occurred.

The initial 1.21 run failed a legacy pause test. Deterministic startup coverage established that frozen 1.19 can overwrite an early pause's display status with `active` while its pause flag still prevents dispatch. The test-only correction synchronizes steady-state assertions and adds early-signal cases proving both legacy blocking and correct current-workflow reporting. Frozen production workflow code/hashes were preserved; this is not a claim that the historical display limitation was removed.

## Historical 1.20 checkpoint

The **1.20 source** `d38ae585aecb02cf8ea7fbf1916648c41e1a5995` passed [Linux cloud CI](https://github.com/GDS-G/Market-Me/actions/runs/34432169675) in 3 minutes 7 seconds. All **682 tests across 81 files passed without skips**, including 109-migration PostgreSQL integration and three actual Temporal history replays. Clean locked installation, native dependency smoke, generated types, workspace typecheck, lint, web/companion frontend builds and both zero-vulnerability audits passed. This run tested the source branch before its fast-forward to main; no production deployment or native installer distribution occurred.

## Historical initial baseline

`.github/workflows/ci.yml` passed its [first cloud run](https://github.com/GDS-G/Market-Me/actions/runs/34429425049) on source commit `8e7c3dfd69b788204caf3478c0966dc41f876052` in 2 minutes 44 seconds. The clean Ubuntu/Node 22/PostgreSQL 18 job passed installation, native dependency loading, migrations, type generation, typecheck, lint, all **400 tests across 72 files without skips**, the web/companion frontend builds, and both audits with zero vulnerabilities. No cloud-only fixes were required. This is Linux build/test evidence, not native desktop or production deployment acceptance.

## Scope and isolation

Branch pushes, pull requests, and manual dispatch run one Ubuntu 24.04 / Node.js 22 job. The job has a 30-minute limit and cancels superseded runs on the same branch or pull request. It grants only `contents: read`, does not persist checkout credentials, disables package caching, and does not use repository secrets. There is no `pull_request_target`, deployment, package publication, release upload, tag creation, or native installer build.

Each job creates a disposable PostgreSQL 18 service with pgvector 0.8.6. The service has no persistent volume and binds port 5432 to the runner's loopback interface. `DATABASE_URL` points only to database `market_me_ci`, with CI-only user `market_me_ci` and password `market_me_ci_only`. These are public synthetic test credentials, not application or provider credentials. Never replace this URL with a development or production database: migrations and integration fixtures write to it.

## Checks

1. `npm ci --ignore-scripts --no-fund` installs the committed lockfile, including development and platform-optional dependencies. Do not use `--omit=optional` or copy Windows `node_modules` into Linux.
2. Native smoke checks resolve dependencies from their owning workspace: Temporal bridge, sharp, canvas, Tailwind oxide, Lightning CSS, and an esbuild transform. The Temporal bridge includes Linux prebuilts; the other libraries provide platform packages. No lifecycle-script exception is currently required by the inspected dependency packages. A smoke failure must be investigated, not bypassed by enabling all install scripts.
3. `npm run db:migrate` replays migrations against the isolated service.
4. Workspace-local `next typegen` generates `.next/types` and `next-env.d.ts` before type-checking. A clean checkout cannot rely on files left by a previous local build.
5. `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` check all workspace types, web lint, unit/workflow/database tests, the Next.js production build, and the companion frontend build. The root build command does not compile Rust or create a native installer.
6. Both `npm audit --omit=dev` and `npm audit` run, including after an earlier non-cancellation failure; any reported vulnerability fails its audit step. Registry unavailability is a failed check, not a clean audit.

Workflow tests call `TestWorkflowEnvironment.createTimeSkipping()` and download a Temporal test-server executable at runtime, then start and tear down that local server. They do not require a production Temporal endpoint or the Compose Temporal services. The runner therefore needs outbound access to the npm registry, GitHub/Node distribution downloads, the container registry, and Temporal's test-server download service. No live marketing-provider accounts are configured or exercised.

The lockfile includes all twelve Tailwind oxide 4.3.3 platform entries, including Linux x64 glibc, and the optional WASM support dependencies. This repairs a Windows-generated optional-package omission without changing Tailwind's version. Keep platform metadata and registry integrity hashes when regenerating the lock.

## Pinned dependencies and maintenance

The action revisions were verified against official release commits on September 9, 2026: [checkout v7.0.1](https://github.com/actions/checkout/commit/3d3c42e5aac5ba805825da76410c181273ba90b1) and [setup-node v7.0.0](https://github.com/actions/setup-node/commit/820762786026740c76f36085b0efc47a31fe5020). Their internal Node 24 action runtime is separate from the application's selected Node 22 runtime.

The [pgvector image](https://github.com/pgvector/pgvector#docker) is pinned to the verified `0.8.6-pg18-trixie` manifest digest in the workflow. Upgrade action SHAs, image digests, and npm packages through reviewed changes and repeat CI; do not silently replace immutable pins with floating tags.

This workflow does not validate desktop permissions, Windows installer behavior, macOS/Linux native packaging, browser end-to-end flows, live OAuth/provider connections, or production deployment readiness. Those remain separate release checks. Cloud verification becomes evidence only when a run completes successfully.
