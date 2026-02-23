import test from 'node:test';
import assert from 'node:assert/strict';
import { IntegrationService } from '../src/integrationService.js';

class FakeCrmClient {
  constructor() {
    this.sent = [];
  }

  async sendAcquisition(payload) {
    this.sent.push(payload);
    return { skipped: false, status: 200, body: 'ok' };
  }
}

class FakeDhrClient {
  constructor(status = null) {
    this.status = status;
  }

  async revalidateTransactionStatus() {
    return this.status;
  }
}

test('status != 3 should not schedule crm dispatch', () => {
  const timers = [];
  const service = new IntegrationService({
    config: { paidDelayMs: 1, crmWebhookUrl: 'x' },
    crmClient: new FakeCrmClient(),
    dhrClient: new FakeDhrClient(),
    schedule: (fn, ms) => {
      timers.push({ fn, ms });
      return { fn, ms };
    }
  });

  const result = service.ingestEvent({ transaction_id: 'txn_a', status: 1, amount: 100 });
  assert.equal(result.scheduled, false);
  assert.equal(timers.length, 0);
});

test('status 3 should dispatch to crm when processed', async () => {
  const crm = new FakeCrmClient();
  const timers = [];
  const service = new IntegrationService({
    config: { paidDelayMs: 1, crmWebhookUrl: 'https://crm.local' },
    crmClient: crm,
    dhrClient: new FakeDhrClient(3),
    schedule: (fn, ms) => {
      timers.push({ fn, ms });
      return { fn, ms };
    }
  });

  const result = service.ingestEvent({
    transaction_id: 'txn_paid',
    order_id: 'order_1',
    status: 3,
    amount: 19990,
    currency: 'BRL',
    customer: { name: 'Lead', email: 'lead@mail', phone: '5511' }
  });

  assert.equal(result.scheduled, true);
  assert.equal(timers.length, 1);

  await service.processDueTransaction('txn_paid');
  assert.equal(crm.sent.length, 1);
  assert.equal(crm.sent[0].transaction_id, 'txn_paid');
  assert.equal(crm.sent[0].status, 3);

  const state = service.getState();
  const acquisition = state.acquisitions.find((a) => a.transactionId === 'txn_paid');
  assert.ok(acquisition.dispatched_to_crm_at);
});

test('status changed before dispatch should skip', async () => {
  const crm = new FakeCrmClient();
  const service = new IntegrationService({
    config: { paidDelayMs: 1, crmWebhookUrl: 'https://crm.local' },
    crmClient: crm,
    dhrClient: new FakeDhrClient(4)
  });

  service.ingestEvent({ transaction_id: 'txn_flip', status: 3, amount: 10 });
  const result = await service.processDueTransaction('txn_flip');

  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'status_changed_before_dispatch');
  assert.equal(crm.sent.length, 0);
});
