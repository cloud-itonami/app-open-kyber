<script lang="ts">
  import { Button, Input, Card, Badge, Chip } from '@etzhayyim/design-system';
  import { callXrpc } from '../lib/xrpc';
  import { ui } from '../lib/store.svelte';

  // organizer.etzhayyim.com is a separate Worker; calls go cross-origin (CORS-enabled XRPC).
  const BASE = 'https://organizer.etzhayyim.com';

  const nsid = {
    listItems: 'com.etzhayyim.apps.organizer.listItems',
    searchItems: 'com.etzhayyim.apps.organizer.searchItems',
    getVaultStats: 'com.etzhayyim.apps.organizer.getVaultStats',
    listCollections: 'com.etzhayyim.apps.organizer.listCollections',
    createCollection: 'com.etzhayyim.apps.organizer.createCollection',
    suggestRules: 'com.etzhayyim.apps.organizer.suggestRules',
    analyzeSubscriptions: 'com.etzhayyim.apps.organizer.analyzeSubscriptions',
    getRecommendations: 'com.etzhayyim.apps.organizer.getRecommendations',
    requestCancellation: 'com.etzhayyim.apps.organizer.requestCancellation'
  } as const;

  let query = $state('');
  let collectionName = $state('Q1 Receipts');
  let cancelTarget = $state('');

  async function run(kind: string, payload: Record<string, unknown> = {}) {
    ui.loading = true;
    try {
      // Cross-origin call to organizer.etzhayyim.com
      const res = await fetch(`${BASE}/xrpc/${kind}`, {
        method: 'POST',
        mode: 'cors',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const text = await res.text();
      let response: unknown = text;
      try { response = text ? JSON.parse(text) : {}; } catch { response = { raw: text }; }
      ui.setResult({ ok: res.ok, status: res.status, nsid: kind, request: payload, response: response as Record<string, unknown> });
    } catch (err) {
      // Fallback: try same-origin (in case kyber proxies organizer)
      ui.setResult(await callXrpc(kind, payload));
    } finally {
      ui.loading = false;
    }
  }
</script>

<div class="flex flex-col gap-4">
  <div class="flex flex-wrap items-center gap-2">
    <Badge value="organizer.etzhayyim.com" variant="accent" />
    <span class="text-xs text-etzhayyim-muted">
      Upload anything · Blake3 dedup · AI auto-classify · subscription recommender
    </span>
  </div>

  <div class="grid gap-4 md:grid-cols-2">
    <Card>
      <div class="p-4 flex flex-col gap-3">
        <h3 class="text-sm font-semibold text-etzhayyim-text">Vault</h3>
        <div class="flex flex-wrap gap-2">
          <Button size="sm" variant="solid-fill"
            onclick={() => run(nsid.getVaultStats)}>Stats</Button>
          <Button size="sm" variant="outline"
            onclick={() => run(nsid.listItems, { limit: 30 })}>List Items</Button>
          <Button size="sm" variant="outline"
            onclick={() => run(nsid.listCollections, { limit: 30 })}>Collections</Button>
          <Button size="sm" variant="outline"
            onclick={() => run(nsid.suggestRules, { limit: 10 })}>Suggest Rules</Button>
        </div>
      </div>
    </Card>

    <Card>
      <div class="p-4 flex flex-col gap-3">
        <h3 class="text-sm font-semibold text-etzhayyim-text">Search</h3>
        <Input bind:value={query} blockSize="md" placeholder="invoice / receipt / contract …" />
        <div>
          <Button size="md" variant="solid-fill"
            onclick={() => run(nsid.searchItems, { query, limit: 30 })}>Search</Button>
        </div>
        <div class="flex flex-wrap gap-2">
          <Chip label="receipt" onclick={() => (query = 'receipt')} />
          <Chip label="invoice" onclick={() => (query = 'invoice')} />
          <Chip label="contract" onclick={() => (query = 'contract')} />
          <Chip label="passport" onclick={() => (query = 'passport')} />
        </div>
      </div>
    </Card>

    <Card>
      <div class="p-4 flex flex-col gap-3">
        <h3 class="text-sm font-semibold text-etzhayyim-text">New Collection</h3>
        <Input bind:value={collectionName} blockSize="md" placeholder="collection name" />
        <div>
          <Button size="md" variant="solid-fill"
            onclick={() => run(nsid.createCollection, { name: collectionName })}>Create</Button>
        </div>
      </div>
    </Card>

    <Card>
      <div class="p-4 flex flex-col gap-3">
        <h3 class="text-sm font-semibold text-etzhayyim-text">Subscriptions</h3>
        <div class="flex flex-wrap gap-2">
          <Button size="sm" variant="solid-fill"
            onclick={() => run(nsid.analyzeSubscriptions, {})}>Analyze</Button>
          <Button size="sm" variant="outline"
            onclick={() => run(nsid.getRecommendations, { limit: 20 })}>Recommendations</Button>
        </div>
        <Input bind:value={cancelTarget} blockSize="md" placeholder="subscriptionItemId" />
        <div>
          <Button size="md" variant="outline"
            onclick={() => run(nsid.requestCancellation, { subscriptionItemId: cancelTarget })}
            >Request Cancel via kaiyaku</Button>
        </div>
      </div>
    </Card>
  </div>

  <p class="text-[11px] text-etzhayyim-muted">
    Cross-origin XRPC to <code>organizer.etzhayyim.com</code>. If browser blocks CORS the call falls back to same-origin (kyber proxy not implemented).
  </p>
</div>
