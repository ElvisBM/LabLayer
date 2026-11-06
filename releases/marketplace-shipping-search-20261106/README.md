# Mercado Livre category search and shipping validation

The draft review shows an explicit full-width search over the official MLB Brazil category list. Before approval, the app loads the seller's official `/users/{seller_id}/shipping_preferences` and offers only the account's enabled modes. The server validates the selected mode again before calling `/items/validate`.

Marketplace validation errors now separate blocking causes from non-blocking warnings. If the Mercado Livre validator adds mandatory free shipping, the approved draft displays a cost warning before the seller confirms publication. No listing is published by this release.

The package checks production hashes for the current draft handler, shared draft schema, and app index; it backs up those files, installs fingerprinted assets, restarts the app, verifies file matches, and checks health.
