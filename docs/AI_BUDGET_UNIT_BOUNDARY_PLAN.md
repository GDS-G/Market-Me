# Quote and budget monetary-unit boundary

Status: independently reproduced after the accepted release-1.42 runtime; not part of its gates. Four synthetic live regressions demonstrate that exponent-0/1/3/4 quotes are accepted into a legacy hundredths ledger without unit compatibility checks. For one major currency unit and a half-unit cap, exponents0/1 incorrectly create active reservations; exponents3/4 create differently scaled denial records. An initial invalid fixture failover enum was corrected before this evidence. No real provider, credential, charge or user data is involved.

## Intent and safety contract

Preserve every historical integer, currency tag, quote hash, immutable policy receipt and timestamp. Do not silently reinterpret saved policy amounts, infer historical intent from a currency code, convert currencies, or rewrite incompatible ledger history. Existing budget editor/ledger values use hundredths; quote/rate-card records independently carry their exponent. A currency-code match alone is insufficient for arithmetic or authorization.

The next bounded correction will make the existing ledger scale explicit, reject incompatible quote-to-ledger writes before any state change, and remove misleading reservability in the UI. Cover subsequent exception-consumption and provider prepare/claim/settlement boundaries so older incompatible evidence cannot bypass the new gate. Historical incompatible records must remain inspectable and visibly distinguished; their raw integer totals must not be represented as verified ordinary-money totals. New authorization against affected history must fail closed until an explicit, separately designed reconciliation can establish correct units. Do not disable recovery, release or inspection merely to conceal the problem.

Consistently render the preserved hundredths policy values without locale-default rounding that could make a small balance disappear. The user-facing explanation must distinguish the application's ledger scale from the quote's explicit scale and from general ISO currency support. Broad multi-precision ledger support would need a separate versioned schema/protocol and explicit historical reconciliation; this correction must not claim to implement it.

## Verification and handoff

First reproduce the mismatch against unchanged 1.42. Add bounded pure-contract, component/route and live persistence cases, including compatible exponent2 unchanged, unsupported exponents and malformed values rejected, no incidental expirations/audits, old reservations/exception lineage, expired/released history, role/workspace boundaries and prepare/claim/settlement denial before provider transport. Use synthetic isolated fixtures only. Check historical rows and frozen migrations/receipts remain exact, and keep release1.42 evidence independent.

Document all constants, units, structures, status/reason fields, query/lock ordering, UI boundaries and recovery implications in the repository and six existing Google development sections. Run full local/cloud/native gates and separate browser/mobile/production acceptance before publication. No new user input is required to investigate or implement these deterministic safety corrections.
