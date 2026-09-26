// index.js — anchor-client HTTP service (port 4003, Parallel-Anchored only).
//
// POST /roots {caseId,batchId,merkleRoot,meta}
//   -> submit CommitAnchorRoot(batchId, merkleRoot, JSON.stringify({...meta, caseId}))
//   -> 201 {txId}
// GET  /roots/:caseId/:batchId
//   -> evaluate ReadAnchorRoot(caseId, batchId) -> 200 root record | 404 not-found
//
// Root keys are (caseId, batchId): the chaincode derives scopeId from
// metaJSON.caseId, so concurrent per-case roots write distinct state keys and
// never MVCC-collide (CONTRACTS §3 root sub-key design).
//
// This file has NO static import of ./fabric.js; the real Fabric session is
// loaded only inside start(). Tests inject a fake contract via createApp().

import http from 'node:http';
import { pathToFileURL } from 'node:url';

function isNonEmptyString(v) {
  return typeof v === 'string' && v.length > 0;
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(payload);
}

function sendError(res, status, code, message) {
  sendJson(res, status, { error: code, message });
}

// req.destroy() tears down the socket; a bare throw would only detach it
// (Node nulls req.socket for server requests), leaving a half-read keep-alive socket.
async function readJsonBody(req, limitBytes = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) { req.destroy(); throw new Error('request body too large'); }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try { return JSON.parse(text); } catch (err) { throw new Error(`invalid JSON body: ${err.message}`); }
}

// chaincode/evidence/contract.go ReadAnchorRoot errors "anchor root ... not found" on an absent key.
const isNotFound = (err) => /not[\s-]?found|does not exist|no such key/i.test(String(err?.message || ''));

async function postRoot(req, res, contract, logger) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return sendError(res, 400, 'invalid-json', err.message);
  }

  const { caseId, batchId, merkleRoot, meta } = body || {};
  if (!isNonEmptyString(caseId) || !isNonEmptyString(batchId) || !isNonEmptyString(merkleRoot)) {
    return sendError(
      res,
      400,
      'invalid-request',
      'caseId, batchId and merkleRoot are required non-empty strings',
    );
  }

  // caseId is injected into metaJSON (last, so it is authoritative); the
  // chaincode reads scopeId = metaJSON.caseId to key the root record.
  const metaObj = meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : {};
  const metaJson = JSON.stringify({ ...metaObj, caseId });

  try {
    const { txId } = await contract.submit('CommitAnchorRoot', [batchId, merkleRoot, metaJson]);
    return sendJson(res, 201, { txId });
  } catch (err) {
    logger.error?.(`CommitAnchorRoot failed for ${caseId}/${batchId}: ${err.message}`);
    return sendError(res, 502, 'anchor-submit-failed', err.message);
  }
}

async function getRoot(res, contract, caseId, batchId, logger) {
  try {
    const text = Buffer.from(await contract.evaluate('ReadAnchorRoot', [caseId, batchId])).toString('utf8');
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    return res.end(text);
  } catch (err) {
    if (isNotFound(err)) {
      return sendError(res, 404, 'root-not-found', `no anchor root for ${caseId}/${batchId}`);
    }
    logger.error?.(`ReadAnchorRoot failed for ${caseId}/${batchId}: ${err.message}`);
    return sendError(res, 502, 'anchor-read-failed', err.message);
  }
}

async function route(req, res, { contract, logger }) {
  const url = new URL(req.url, 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);

  if (req.method === 'GET' && url.pathname === '/healthz') {
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === 'POST' && url.pathname === '/roots') {
    return postRoot(req, res, contract, logger);
  }
  if (req.method === 'GET' && parts[0] === 'roots' && parts.length === 3) {
    return getRoot(res, contract, decodeURIComponent(parts[1]), decodeURIComponent(parts[2]), logger);
  }
  return sendError(res, 404, 'not-found', `no route for ${req.method} ${url.pathname}`);
}

// createApp({ contract, logger }) — contract is the { submit, evaluate } adapter.
// Injected directly in tests; built by connectAnchorFabric() in start().
export function createApp({ contract, logger = console }) {
  return http.createServer((req, res) => {
    route(req, res, { contract, logger }).catch((err) => {
      logger.error?.(`unhandled error: ${err.stack || err.message}`);
      if (!res.headersSent) {
        sendError(res, 500, 'internal-error', err.message);
      }
    });
  });
}

async function start() {
  const port = Number(process.env.PORT) || 4003;
  const { connectAnchorFabric } = await import('./fabric.js');
  const { contract, close } = await connectAnchorFabric(process.env);
  const server = createApp({ contract });

  const shutdown = () => {
    server.close();
    try {
      close();
    } catch {
      // best-effort on shutdown
    }
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  server.listen(port, () => {
    console.log(`anchor-client listening on :${port} (channel ${process.env.ANCHOR_CHANNEL || 'anchor-main'})`);
  });
}

// Only start the server when run directly, not when imported by tests.
// pathToFileURL handles Windows drive letters correctly (a hand-rolled
// `file://C:/...` puts the drive in the URL host and never matches — F66).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start().catch((err) => {
    console.error(`anchor-client failed to start: ${err.stack || err.message}`);
    process.exit(1);
  });
}
