'use strict';

// Bootstrap: wire the real Fabric session + batcher client + runs store into the
// app and listen. All configuration comes from the environment (docs/CONTRACTS.md §7).

const { createApp } = require('./app');
const { connectFabric } = require('./fabric');
const { makeBatcherClient } = require('./batcherClient');
const { makeRunsStore } = require('./runsStore');

async function main() {
  const port = parseInt(process.env.PORT, 10) || 3000;
  const { fabric, close } = await connectFabric(process.env);
  const batcher = makeBatcherClient(process.env.BATCHER_URL || 'http://merkle-batcher:4001');
  const runsStore = makeRunsStore(process.env.RESULTS_DIR || '/results');

  const app = createApp({
    fabric,
    batcher,
    runsStore,
    config: {
      variant: process.env.VARIANT || 'standard',
      token: process.env.GLEIPNIR_TOKEN || 'dev-token',
      defaultChannel: process.env.DEFAULT_CHANNEL || 'coc-main',
      verificationUrl: process.env.VERIFICATION_URL || 'http://verification:4004',
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
