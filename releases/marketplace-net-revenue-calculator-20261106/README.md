# Mercado Livre payout estimator

Adds an estimated per-unit net payout to the ad price editor. It reads the current sale fee from Mercado Livre Listing Prices and, when free shipping is selected for ME2, requests a seller shipping estimate using the entered package dimensions and the account logistics type. Published drafts can simulate a different price locally without changing the listing.

The estimate subtracts the sale fee and seller shipping estimate from the price. Any listing fee is shown separately because it is a one-time publishing fee, not a per-unit sale deduction. The screen labels the result as an estimate; final settlement can vary with shipping subsidies and account conditions.

This is a scoped release: it replaces only the drafts API module, the existing Marketplace Listings bundle in place, and identical index/shared-schema files needed by the release script. It preserves the live React/App/assistant bundles and their dependency filenames.
