# Keep LabLayer pages available when inventory status cannot be read

This release changes the app shell so an inventory status read error no longer replaces every page with a single error. Existing pages remain usable. Only inventory operations and inventory-based reconciliation show a local recovery message with retry and return-to-dashboard actions. When the inventory state is unknown, the UI routes other sections through the legacy views; server-side authorization remains in effect.

The package also retains the Mercado Livre category picker and its official category endpoint.

The deploy script checks the exact production server and index hashes, backs them up, uploads the current built assets, swaps the index, restarts the app, and verifies health.
