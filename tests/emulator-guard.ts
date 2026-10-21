// Fail closed: integration tests cannot fall back to a real Firebase project.
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8088' ||
    process.env.GCLOUD_PROJECT !== 'demo-lablayer-test') {
  throw new Error('Execute npm run test:integration: requer emulador local demo-lablayer-test.');
}
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
delete process.env.FIREBASE_SERVICE_ACCOUNT;
