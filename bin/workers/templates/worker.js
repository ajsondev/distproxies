const cleanup = require('node-cleanup');
const instances = {};

module.exports = class Worker {
  constructor({ label, concurrency } = {}) {
    this.label = label || 'worker';
    this.concurrency = concurrency || 1;
    this.contexts = [];

    cleanup(async () => {
      console.info('cleaning up');
      await this.cleanup();
    });
  }

  static acceptsTag() {
    return false;
  }

  static getInstance() {
    if (!instances[this.name]) {
      instances[this.name] = new this();
    }

    return instances[this.name];
  }

  async _init() { }

  async init() {
    if (this._initialized) return;
    this._initialized = true;

    await this._init();
  }

  async _work(ctx) { }

  async run() {
    await this.init();
    for (let i = 0; i < this.concurrency; i += 1) {
      this._launch().catch(console.error);
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  async _launch() {
    const ctx = {};
    this.contexts.push(ctx);
    try {
      await this._work(ctx);
    } catch (e) {
      console.error(e);
      setImmediate(() => this._launch(ctx).catch(console.error));
    }
    this.contexts = this.contexts.filter(c => c !== ctx);
  }

  async _cleanup(ctx) { }

  async cleanup() {
    return Promise.all(this.contexts.map(c => this._cleanup(c)));
  }
};
