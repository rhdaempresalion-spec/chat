import http from 'node:http';
import { loadConfig } from './config.js';
import { CrmClient } from './crmClient.js';
import { DhrClient } from './dhrClient.js';
import { IntegrationService } from './integrationService.js';

const config = loadConfig();
const service = new IntegrationService({
  config,
  crmClient: new CrmClient(config),
  dhrClient: new DhrClient(config)
});

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') {
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'GET' && req.url === '/state') {
      return sendJson(res, 200, service.getState());
    }

    if (req.method === 'POST' && req.url === '/webhooks/dhr') {
      const payload = await readBody(req);
      if (!payload.transaction_id || typeof payload.status === 'undefined') {
        return sendJson(res, 400, { error: 'transaction_id and status are required' });
      }
      const result = service.ingestEvent(payload);
      return sendJson(res, 202, result);
    }

    if (req.method === 'POST' && req.url === '/jobs/process-now') {
      const payload = await readBody(req);
      if (!payload.transaction_id) {
        return sendJson(res, 400, { error: 'transaction_id is required' });
      }
      const result = await service.processDueTransaction(payload.transaction_id);
      return sendJson(res, 200, result);
    }

    return sendJson(res, 404, { error: 'not_found' });
  } catch (error) {
    return sendJson(res, 500, { error: String(error.message || error) });
  }
});

server.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`Server running on :${config.port}`);
});
