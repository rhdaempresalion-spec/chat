import { IntegrationStore } from './store.js';

export class IntegrationService {
  constructor({ config, crmClient, dhrClient, now = () => new Date(), schedule = setTimeout }) {
    this.config = config;
    this.crmClient = crmClient;
    this.dhrClient = dhrClient;
    this.now = now;
    this.schedule = schedule;
    this.store = new IntegrationStore();
  }

  ingestEvent(input) {
    const event = normalizeEvent(input, this.now);
    this.store.saveEvent(event);

    this.store.upsertAcquisition(event.transaction_id, {
      order_id: event.order_id,
      amount: event.amount,
      currency: event.currency,
      customer: event.customer,
      gateway_status_code: event.status,
      paid_at: event.paid_at,
      eligible_at: new Date(new Date(event.paid_at).getTime() + this.config.paidDelayMs).toISOString(),
      status_label: statusLabel(event.status)
    });

    if (event.status !== 3) {
      return { accepted: true, scheduled: false, reason: 'status_not_paid' };
    }

    this._schedulePaidDispatch(event.transaction_id, new Date(event.paid_at));
    return { accepted: true, scheduled: true, reason: 'paid_status_scheduled' };
  }

  _schedulePaidDispatch(transactionId, paidAt) {
    const existing = this.store.jobs.get(transactionId);
    if (existing) return;

    const eligibleAt = paidAt.getTime() + this.config.paidDelayMs;
    const delay = Math.max(0, eligibleAt - this.now().getTime());

    const timer = this.schedule(async () => {
      this.store.jobs.delete(transactionId);
      try {
        await this.processDueTransaction(transactionId);
      } catch (error) {
        this.store.upsertAcquisition(transactionId, {
          last_error: String(error.message || error),
          last_attempt_at: this.now().toISOString()
        });
      }
    }, delay);

    this.store.jobs.set(transactionId, timer);
  }

  async processDueTransaction(transactionId) {
    const acq = this.store.getAcquisition(transactionId);
    if (!acq) return { skipped: true, reason: 'missing_acquisition' };
    if (acq.dispatched_to_crm_at) return { skipped: true, reason: 'already_dispatched' };

    let status = Number(acq.gateway_status_code);
    const revalidated = await this.dhrClient.revalidateTransactionStatus(transactionId);
    if (Number.isFinite(revalidated)) status = revalidated;

    if (status !== 3) {
      this.store.upsertAcquisition(transactionId, {
        gateway_status_code: status,
        status_label: statusLabel(status),
        skipped_reason: 'status_changed_before_dispatch',
        last_attempt_at: this.now().toISOString()
      });
      return { skipped: true, reason: 'status_changed_before_dispatch' };
    }

    const payload = buildCrmPayload(acq, transactionId);
    const result = await this.crmClient.sendAcquisition(payload);

    if (!result.skipped) {
      this.store.upsertAcquisition(transactionId, {
        dispatched_to_crm_at: this.now().toISOString(),
        idempotency_key: payload.metadata.idempotency_key,
        crm_webhook_url: this.config.crmWebhookUrl,
        status_label: 'paid',
        last_attempt_at: this.now().toISOString()
      });
      return { skipped: false, payload };
    }

    this.store.upsertAcquisition(transactionId, {
      skipped_reason: result.reason,
      last_attempt_at: this.now().toISOString()
    });
    return { skipped: true, reason: result.reason };
  }

  getState() {
    return this.store.listState();
  }
}

function normalizeEvent(input, now) {
  const paidAt = input.paid_at || now().toISOString();
  return {
    provider: 'dhr',
    transaction_id: String(input.transaction_id || input.id || ''),
    order_id: String(input.order_id || input.orderId || ''),
    status: Number(input.status),
    amount: Number(input.amount || 0),
    currency: String(input.currency || 'BRL'),
    paid_at: new Date(paidAt).toISOString(),
    customer: {
      name: input.customer?.name || '',
      email: input.customer?.email || '',
      phone: input.customer?.phone || ''
    },
    raw: input,
    received_at: now().toISOString()
  };
}

function statusLabel(status) {
  if (Number(status) === 3) return 'paid';
  if (Number(status) === 1) return 'pending';
  return 'reversed';
}

function buildCrmPayload(acq, transactionId) {
  return {
    event: 'paid_acquisition',
    provider: 'dhr',
    transaction_id: transactionId,
    order_id: acq.order_id,
    status: 3,
    status_label: 'paid',
    amount: acq.amount,
    currency: acq.currency || 'BRL',
    paid_at: acq.paid_at,
    confirmed_after_minutes: 5,
    customer: acq.customer || {},
    metadata: {
      source: 'gateway_dhr',
      idempotency_key: `dhr_${transactionId}_status3_paid`
    }
  };
}
