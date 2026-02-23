export function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT || 3000),
    crmWebhookUrl: env.CRM_WEBHOOK_URL || '',
    crmWebhookEnabled: env.CRM_WEBHOOK_ENABLED !== 'false',
    crmWebhookTimeoutMs: Number(env.CRM_WEBHOOK_TIMEOUT_MS || 10000),
    paidDelayMs: Number(env.PAID_DELAY_MS || 300000),
    revalidateEnabled: env.DHR_REVALIDATE_ENABLED === 'true',
    dhrBaseUrl: env.DHR_BASE_URL || 'https://api.dhrtecnologialtda.com',
    dhrPublicKey: env.DHR_PUBLIC_KEY || '',
    dhrSecretKey: env.DHR_SECRET_KEY || ''
  };
}
