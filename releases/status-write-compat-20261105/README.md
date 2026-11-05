# Firestore status write compatibility

This release starts from the currently active ruleset `202318bf-45df-43a8-972d-bb49e316b11a` for the named LabLayer database. It preserves the active authorization and validation rules, while allowing the `customRequests` fields already written by the application: `code`, `requestNumber`, `requestedDeliveryDate`, `isGift`, and `provisionalQuantity`.

The rules still validate those fields by type and bounds. This prevents the full-document validator from rejecting status updates solely because a document contains fields introduced after the earlier rules version.

SHA-256: `6f7b0d8b825c2f4b372aacf06318be4ea4f4f8cf7082beddc538461aa482b195`
