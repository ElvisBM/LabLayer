# Mercado Livre validation feedback

This scoped release changes only the Mercado Livre validation error formatter in `server/marketplace-drafts.ts`. It shows up to five blocking validation causes with their code, references, and message, or the provider's top-level error/message when the cause list is empty. Provider content is limited and control characters are removed.

Production file baseline SHA-256: `4d60d8982a2f77e330415ef0d34cda9babdba39205cf45bc5e98f14d550a6ead`
