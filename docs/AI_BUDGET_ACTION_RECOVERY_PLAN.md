# Budget-action recovery plan

Status: independently reproduced; not included in release 1.41 acceptance. Six handler regressions fail against that source: alert acknowledgement and exception approval each reject on lost responses, refresh on malformed successful JSON, and send twice on same-tick submission.

## Scope and intent

Complete response-safe handling for alert acknowledgement, exception requests and exception decisions. These controls must never imply that an exception was approved merely because HTTP succeeded: the existing repository can return an expired or already-resolved record. They must not clear an explanation or admit another action while an uncertain request remains.

Retain a closed account/workspace action in browser-tab storage before sending, with a synchronous duplicate-submit fence, bounded transport and `finally` pending cleanup. Restore without automatic writes or reads. Provide explicit read-only recovery against the exact alert, denied estimate or exception, rechecking current role. Show the current persisted state and original actor rather than claiming an immutable new receipt. Missing/pending state is not proof of failure. Do not silently retry, reinterpret changed input or create a new spending reservation. Clearing the local copy requires acknowledgement, exact-byte comparison and reload.

The existing database uses one exception per denied reservation and locked terminal decisions/alert acknowledgements. Preserve those semantics and compatibility; add narrow membership locks to these three mutation paths and their new exact lookup, not every unrelated AI operation. Recovery reports a different author's acknowledgement/decision or different saved explanation as an existing result, not this action's success. No migration, rewritten monetary values, broadened approval role, provider call or actual spend is intended.

## Verification and documentation

Add transport/schema and handler cases for all three actions, malformed/foreign/oversized responses, same-tick conflicts, storage failure, reload, expiry, mismatched saved payload, role changes and read-only lookup. Live database tests must prove tenant/current-role controls, no duplicate audits or reservations, and mutation/role-demotion ordering with observed locks. Separate synthetic browser/mobile/production acceptance from unit evidence; no live provider or charge acceptance is implied.

Inventory action union fields, response projection, status/permission dictionaries, bounds, storage keys, refs/state lifetime, endpoints and rollout/recovery limits in the programmer reference and six existing Google development sections. Full local/cloud/native gates follow implementation; release 1.41 evidence remains frozen and separate.
