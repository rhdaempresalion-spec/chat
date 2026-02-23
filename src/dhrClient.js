function basicAuth(publicKey, secretKey) {
  const token = Buffer.from(`${publicKey}:${secretKey}`).toString('base64');
  return `Basic ${token}`;
}

export class DhrClient {
  constructor(config) {
    this.config = config;
  }

  async revalidateTransactionStatus(transactionId) {
    if (!this.config.revalidateEnabled) return null;
    if (!this.config.dhrPublicKey || !this.config.dhrSecretKey) return null;

    const url = `${this.config.dhrBaseUrl}/v1/transactions/${encodeURIComponent(transactionId)}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: basicAuth(this.config.dhrPublicKey, this.config.dhrSecretKey)
      }
    });

    if (!response.ok) {
      throw new Error(`DHR revalidate failed ${response.status}`);
    }

    const data = await response.json();
    const status = Number(data?.status);
    return Number.isFinite(status) ? status : null;
  }
}
