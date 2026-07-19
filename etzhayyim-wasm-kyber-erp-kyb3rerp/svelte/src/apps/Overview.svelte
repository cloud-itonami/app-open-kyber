<script lang="ts">
  import { Button, Card, Badge } from '@etzhayyim/design-system';
  import { callXrpc, periodYM } from '../lib/xrpc';
  import { ui } from '../lib/store.svelte';
  import { apps, type AppId } from '../lib/apps';

  interface Props {
    onSelect: (id: AppId) => void;
  }
  let { onSelect }: Props = $props();

  async function refresh() {
    ui.loading = true;
    try {
      ui.setResult(await callXrpc('com.etzhayyim.apps.kyber.dashboard', { period: periodYM() }));
    } finally {
      ui.loading = false;
    }
  }

  const tiles = apps.filter((a) => a.id !== 'overview');
</script>

<div class="flex flex-col gap-6">
  <div class="flex flex-col gap-1">
    <div class="flex items-center gap-2">
      <Badge value="kyber.etzhayyim.com" variant="accent" />
      <Badge value="AT Protocol" />
      <Badge value="Design E · 3-Tier Write" />
    </div>
    <h2 class="text-xl font-semibold text-etzhayyim-text">Corporate ERP Intelligence</h2>
    <p class="text-sm text-etzhayyim-secondary">
      1 PDS gateway · 5 department DIDs · 18 XRPC commands · integrated with projector / calendar / drive / mailer.
    </p>
    <div class="mt-2">
      <Button size="md" variant="solid-fill" onclick={refresh}>
        Refresh Dashboard ({periodYM()})
      </Button>
    </div>
  </div>

  <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
    {#each tiles as t}
      <Card onclick={() => onSelect(t.id)}>
        <div class="p-5 flex flex-col gap-3">
          <div class="flex items-center gap-3">
            <div class={`h-10 w-10 rounded-xl bg-gradient-to-br ${t.accent} grid place-items-center text-white font-bold`}>
              {t.short}
            </div>
            <div>
              <h3 class="text-sm font-semibold text-etzhayyim-text">{t.label}</h3>
              <p class="text-xs text-etzhayyim-muted">com.etzhayyim.apps.{t.id}.*</p>
            </div>
          </div>
          <p class="text-xs text-etzhayyim-secondary leading-relaxed">{t.description}</p>
          <div class="mt-auto">
            <Button size="sm" variant="outline" onclick={() => onSelect(t.id)}>Open</Button>
          </div>
        </div>
      </Card>
    {/each}
  </div>
</div>
