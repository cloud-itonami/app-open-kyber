import type { XrpcResult } from './xrpc';

class UiStore {
  loading = $state(false);
  lastResult = $state<XrpcResult | null>(null);
  activity = $state<string[]>([]);

  logActivity(msg: string): void {
    const stamp = new Date().toLocaleTimeString('ja-JP', {
      hour: '2-digit',
      minute: '2-digit'
    });
    this.activity = [`${stamp} ${msg}`, ...this.activity].slice(0, 20);
  }

  setResult(result: XrpcResult): void {
    this.lastResult = result;
    const tag = result.ok ? '✓' : '✗';
    this.logActivity(`${tag} ${result.nsid} (${result.status})`);
  }
}

export const ui = new UiStore();
