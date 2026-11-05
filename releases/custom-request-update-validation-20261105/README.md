# Custom request update validation

This release makes `customRequests` updates validate only the fields changed by the operation. It preserves tenant membership, allowed status values, field type and size checks for modified values, and immutable `createdAt`. Unchanged legacy fields no longer block a status change. Creates still use the complete `isValidCustomRequest()` validator; deletions remain administrator-only.

Previous active ruleset: `projects/lablayer-493220/rulesets/1afb2dbc-dcc1-4002-a220-3eb06abbee49`
Previous active SHA-256: `da615705902a075761cd0c88919ed24565e55b91c75492748f1222f4ee8abf1d`
Release SHA-256: `a68804009b201a6451c8d00fa1e921acadf16a3a2aed932c8539b7fd5091bd62`

Published as Firestore ruleset `projects/lablayer-493220/rulesets/83d7ea20-75e0-4814-a83e-0a7d2e056326`. The active source was fetched after deployment and matched this snapshot.
