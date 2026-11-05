# Custom request member writes

This release starts from the active LabLayer Firestore rules snapshot and changes only `customRequests` create/update authorization. Every authenticated tenant member may create or update a request whose full document passes `isValidCustomRequest()`. Updates still preserve `createdAt`; deletion remains limited to tenant administrators.

This lets sales staff record validated requests directly in any supported workflow status.

Previous active rules SHA-256: `6f7b0d8b825c2f4b372aacf06318be4ea4f4f8cf7082beddc538461aa482b195`
Release rules SHA-256: `da615705902a075761cd0c88919ed24565e55b91c75492748f1222f4ee8abf1d`

Published Firestore ruleset: `projects/lablayer-493220/rulesets/1afb2dbc-dcc1-4002-a220-3eb06abbee49`. The active release was read back after deployment and its source SHA matched this snapshot.
