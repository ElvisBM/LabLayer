# Accept non-blocking Mercado Livre warnings

The Mercado Livre validator may return HTTP 400 with `validation_error` when its `cause` list contains warnings only. The official validation docs define warnings as informational and non-blocking. This release proceeds with approval in that case and still blocks on any `error`, untyped cause, or missing cause details.

If the warnings say ME1 is unavailable, the draft shows that notice. If the validator reports mandatory free shipping for ME2, the approved payload includes `free_shipping: true` and the draft clearly displays the seller-cost warning before the separate publish confirmation. The listing is never published by the approval step.

The category search and account-aware shipping selector are preserved. The release checks the live server, shared schema, and index hashes; creates rollback copies; deploys and verifies the app.
