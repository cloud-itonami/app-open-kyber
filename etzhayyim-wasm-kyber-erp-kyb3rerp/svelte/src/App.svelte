<script lang="ts">
  import { Avatar, Badge, Button } from '@etzhayyim/design-system';
  import { apps, appMap, type AppId } from './lib/apps';
  import { ui } from './lib/store.svelte';
  import Overview from './apps/Overview.svelte';
  import Appview from './apps/Appview.svelte';
  import Projector from './apps/Projector.svelte';
  // Calendar UI imported as a workspace package from 60-apps/etzhayyim-project-calendar
  import CalendarApp from '@etzhayyim/kyber-calendar-frontend';
  import Drive from './apps/Drive.svelte';
  import Mailer from './apps/Mailer.svelte';
  import Organizer from './apps/Organizer.svelte';

  let active = $state<AppId>('overview');
  let theme = $state<'dark' | 'light'>('dark');

  function setTheme(t: 'dark' | 'light') {
    theme = t;
    document.documentElement.setAttribute('data-theme', t);
  }

  const current = $derived(appMap[active]);
  const resultPretty = $derived(
    ui.lastResult ? JSON.stringify(ui.lastResult, null, 2) : 'No XRPC call yet.'
  );
</script>

<div class="h-full grid grid-rows-[auto_1fr] bg-etzhayyim-bg text-etzhayyim-text">
  <!-- Top bar -->
  <header
    class="flex items-center justify-between gap-3 px-4 border-b border-etzhayyim-border bg-etzhayyim-sidebar"
    style="height: var(--gv2-header-height);"
  >
    <div class="flex items-center gap-3">
      <div class="h-9 w-9 rounded-xl bg-gradient-to-br from-indigo-500 to-sky-400 grid place-items-center text-white font-bold">K</div>
      <div class="leading-tight">
        <h1 class="text-sm font-semibold">Kyber Command Center</h1>
        <p class="text-[11px] text-etzhayyim-muted">kyber.etzhayyim.com · designsystem + etzhayyimuikit</p>
      </div>
    </div>
    <div class="flex items-center gap-2">
      <Badge value={ui.loading ? 'syncing…' : 'live'} variant={ui.loading ? 'warning' : 'success'} />
      <div class="hidden sm:flex gap-1 rounded-full border border-etzhayyim-border p-0.5">
        <button
          type="button"
          class="px-2 py-0.5 text-xs rounded-full"
          class:bg-etzhayyim-accent={theme === 'dark'}
          class:text-white={theme === 'dark'}
          onclick={() => setTheme('dark')}
        >Dark</button>
        <button
          type="button"
          class="px-2 py-0.5 text-xs rounded-full"
          class:bg-etzhayyim-accent={theme === 'light'}
          class:text-white={theme === 'light'}
          onclick={() => setTheme('light')}
        >Light</button>
      </div>
      <Avatar fallback="KY" size="sm" ring />
    </div>
  </header>

  <div class="grid grid-cols-[72px_minmax(0,1fr)] lg:grid-cols-[72px_minmax(0,1fr)_360px] min-h-0">
    <!-- Left rail: apps -->
    <nav class="flex flex-col items-center gap-1 py-3 border-r border-etzhayyim-border bg-etzhayyim-sidebar overflow-y-auto">
      {#each apps as a}
        <button
          type="button"
          class="w-14 h-14 rounded-2xl grid place-items-center text-[11px] font-semibold transition"
          class:bg-etzhayyim-hover={active === a.id}
          class:text-etzhayyim-text={active === a.id}
          class:text-etzhayyim-secondary={active !== a.id}
          class:hover:bg-etzhayyim-hover={true}
          title={a.label}
          onclick={() => (active = a.id)}
        >
          <div class="flex flex-col items-center gap-0.5">
            <span class={`h-8 w-8 rounded-xl bg-gradient-to-br ${a.accent} grid place-items-center text-white text-[10px]`}>
              {a.short}
            </span>
            <span class="text-[10px]">{a.label}</span>
          </div>
        </button>
      {/each}
    </nav>

    <!-- Main content -->
    <main class="min-w-0 min-h-0 overflow-y-auto">
      <div class="sticky top-0 z-10 border-b border-etzhayyim-border bg-etzhayyim-bg/95 backdrop-blur px-5 py-3">
        <div class="flex items-baseline justify-between gap-3">
          <div>
            <div class="flex items-center gap-2">
              <h2 class="text-base font-semibold">#{current.label}</h2>
              <span class="text-xs text-etzhayyim-muted">· {current.description}</span>
            </div>
          </div>
          <div class="flex gap-2">
            {#if active !== 'overview'}
              <Button size="xs" variant="text" onclick={() => (active = 'overview')}>← Overview</Button>
            {/if}
          </div>
        </div>
      </div>

      <div class="p-5">
        {#if active === 'overview'}
          <Overview onSelect={(id) => (active = id)} />
        {:else if active === 'appview'}
          <Appview />
        {:else if active === 'projector'}
          <Projector />
        {:else if active === 'calendar'}
          <CalendarApp
            xrpcBase="https://calendar.etzhayyim.com"
            embed
            onResult={(r) => ui.setResult(r)}
          />
        {:else if active === 'drive'}
          <Drive />
        {:else if active === 'mailer'}
          <Mailer />
        {:else if active === 'organizer'}
          <Organizer />
        {/if}
      </div>
    </main>

    <!-- Right inspector (lg+) -->
    <aside class="hidden lg:flex flex-col gap-4 border-l border-etzhayyim-border bg-etzhayyim-sidebar p-4 overflow-y-auto">
      <div>
        <h3 class="text-xs font-semibold uppercase tracking-wider text-etzhayyim-muted mb-2">Response Inspector</h3>
        <pre class="text-[11px] leading-snug bg-etzhayyim-input rounded-lg p-3 overflow-auto max-h-[45vh] border border-etzhayyim-border">{resultPretty}</pre>
      </div>
      <div>
        <h3 class="text-xs font-semibold uppercase tracking-wider text-etzhayyim-muted mb-2">Activity</h3>
        <ul class="text-[11px] space-y-1 text-etzhayyim-secondary">
          {#each ui.activity as line}
            <li class="truncate">{line}</li>
          {:else}
            <li class="text-etzhayyim-muted">No activity yet.</li>
          {/each}
        </ul>
      </div>
      <div class="mt-auto text-[11px] text-etzhayyim-muted">
        <p>AT URI deep-links: <code>/at/{'{'}authority{'}'}/{'{'}collection{'}'}/{'{'}rkey{'}'}</code></p>
      </div>
    </aside>
  </div>
</div>
