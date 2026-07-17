'use strict';

// Bootstrap: wire the real Fabric session + batcher client + runs store into the
// app and listen. All configuration comes from the environment (docs/CONTRACTS.md §7).

const { createApp } = require('./app');
const { connectFabric } = require('./fabric');
const { makeBatcherClient } = require('./batcherClient');
const { makeRunsStore } = require('./runsStore');
const { makeUsersStore } = require('./users');
const { makeSessions } = require('./sessions');
const { makeCaseRegistryClient, makeEvidenceStoreClient } = require('./serviceClients');

// User-session auth (M12) is additive: if the auth data dir is unavailable
// (e.g. a container without the gateway-auth-data volume), the gateway still
// starts and the service-token path works — only user login is disabled.
function makeAuthStores(env) {
  const authDataDir = env.AUTH_DATA_DIR || '/data/auth';
  let users;
  try {
    users = makeUsersStore(authDataDir);
  } catch (err) {
    console.warn(`[gateway] auth store unavailable (${err.message}) — user login disabled; service token unaffected`);
    return { users: undefined, sessions: undefined };
  }
  const sessions = makeSessions({ ttlSeconds: parseInt(env.SESSION_TTL_SECONDS, 10) || 28800 });
  if (env.ADMIN_USERNAME && env.ADMIN_PASSWORD) {
    const seeded = users.seedAdmin({ username: env.ADMIN_USERNAME, password: env.ADMIN_PASSWORD });
    if (seeded) console.log(`[gateway] seeded first admin user '${seeded.username}'`);
  } else if (users.list().length === 0) {
    console.warn('[gateway] no users exist and ADMIN_USERNAME/ADMIN_PASSWORD are unset — user login impossible until seeded');
  }
  return { users, sessions };
}

async function main() {
  const port = parseInt(process.env.PORT, 10) || 3000;
  const { fabric, close } = await connectFabric(process.env);
  const batcher = makeBatcherClient(process.env.BATCHER_URL || 'http://merkle-batcher:4001');
  const runsStore = makeRunsStore(process.env.RESULTS_DIR || '/results');
  const { users, sessions } = makeAuthStores(process.env);
  const internalToken = process.env.GLEIPNIR_INTERNAL_TOKEN || 'internal-dev-token';
  const caseRegistry = makeCaseRegistryClient(process.env.CASE_REGISTRY_URL || 'http://case-registry:4005', internalToken);
  const evidenceStore = makeEvidenceStoreClient(process.env.EVIDENCE_STORE_URL || 'http://evidence-store:4006', internalToken);

  const app = createApp({
    fabric,
    batcher,
    runsStore,
    users,
    sessions,
    caseRegistry,
    evidenceStore,
    config: {
      variant: process.env.VARIANT || 'standard',
      token: process.env.GLEIPNIR_TOKEN || 'dev-token',
      defaultChannel: process.env.DEFAULT_CHANNEL || 'coc-main',
      verificationUrl: process.env.VERIFICATION_URL || 'http://verification:4004',
      maxUploadBytes: parseInt(process.env.MAX_UPLOAD_BYTES, 10) || 26214400,
      loginMaxAttempts: parseInt(process.env.LOGIN_MAX_ATTEMPTS, 10) || 5,
      loginWindowSeconds: parseInt(process.env.LOGIN_WINDOW_SECONDS, 10) || 60,
    },
  });

  const server = app.listen(port, () => {
    console.log(`[gateway] listening on :${port} variant=${app.locals.config.variant} channel=${app.locals.config.defaultChannel}`);
  });

  const shutdown = () => { server.close(); try { close(); } catch { /* best effort */ } };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error(`[gateway] failed to start: ${err.stack || err.message}`);
  process.exit(1);
});
