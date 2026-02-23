export class IntegrationStore {
  constructor() {
    this.events = [];
    this.acquisitions = new Map();
    this.jobs = new Map();
  }

  saveEvent(event) {
    this.events.push(event);
  }

  upsertAcquisition(transactionId, data) {
    const previous = this.acquisitions.get(transactionId) || {};
    const merged = { ...previous, ...data, transactionId };
    this.acquisitions.set(transactionId, merged);
    return merged;
  }

  getAcquisition(transactionId) {
    return this.acquisitions.get(transactionId) || null;
  }

  listState() {
    return {
      events: this.events,
      acquisitions: Array.from(this.acquisitions.values()),
      pendingJobs: Array.from(this.jobs.keys())
    };
  }
}
