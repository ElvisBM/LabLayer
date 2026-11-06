# App fallback when inventory state cannot be checked

The app no longer replaces every page when the stock-state listener errors. Existing sections remain available; only inventory operations and reconciliation show a local retry/return message. When status is unavailable, the application does not route the user into the new stock-dependent quote or finance flows. The scoped release retains the official Mercado Livre category picker.

The deployment checks the current production hashes, saves rollback copies, uploads fingerprinted assets, swaps the index, restarts the app, and checks health.
