# Mercado Livre category picker

The rascunho editor now uses a grouped, searchable selector backed by Mercado Livre's official Brazil category dump (`/sites/MLB/categories/all`). The server caches the category tree for 12 hours, filters to enabled leaf categories, and shows only categories that allow listing. Groups cover gifts and party favors, home and utilities, handmade/3D-printed products, toys and miniatures, pets, and electronics accessories. Category is selected by its full hierarchy; the exact valid MLB ID is stored.

The category applies to the finished item's use; 3D printing is the manufacturing method. The selector therefore includes functional categories across the relevant product families.

The dump reported by Mercado Livre when prepared for this release was generated at `2026-11-06T14:06:49Z`; the production app fetches fresh data automatically.

This scoped package replaces only `server/marketplace-drafts.ts` and the built web assets. It checks hashes of the current production server file and index before deployment and keeps a rollback copy of both.
