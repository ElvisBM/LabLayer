# LabLayer approval and orders UI release

Scoped deployment package for the seller assistant approval review and the Encomendas e Orçamentos search/filter layout.

- Assistant approval by quantity opens a review step for price, delivery date, and payment before production.
- The orders screen uses a wider search field, compact view controls, and one simpler status filter row below the search.
- The package includes only the assistant workflow files and frontend build needed for this change.
- SHA-256: `2a51b0cfdc14059435ec232faa6e20938e0252433e8b674aa5fda81219d706ae`
- The remote script checks the current deployed file hashes, creates a backup, restarts the app, checks health, and keeps the previous page active until the app is healthy.

The release was built from the isolated production snapshot. TypeScript and the production build completed successfully.
