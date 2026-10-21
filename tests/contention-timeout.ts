// Firestore Emulator can hold locks ~30s per attempt; Admin SDK retries add up.
// Only actual contention tests use this budget. Assertions and concurrency stay intact.
// https://firebase.google.com/docs/emulator-suite/connect_firestore#transactions
export const CONTENTION_TIMEOUT_MS = 240_000;
