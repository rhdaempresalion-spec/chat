export class CrmClient {
  constructor(config) {
    this.config = config;
  }

  async sendAcquisition(payload) {
    if (!this.config.crmWebhookEnabled || !this.config.crmWebhookUrl) {
      return { skipped: true, reason: 'crm_webhook_disabled_or_missing' };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.crmWebhookTimeoutMs);

    try {
      const response = await fetch(this.config.crmWebhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': payload?.metadata?.idempotency_key || ''
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      const body = await response.text();
      if (!response.ok) {
        throw new Error(`CRM webhook failed ${response.status}: ${body}`);
      }

      return { skipped: false, status: response.status, body };
    } finally {
      clearTimeout(timer);
    }
  }
}
