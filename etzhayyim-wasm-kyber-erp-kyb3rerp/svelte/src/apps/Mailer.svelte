<script lang="ts">
  import { Button, Input, Textarea, Badge, Avatar } from '@etzhayyim/design-system';
  import { callXrpc } from '../lib/xrpc';
  import { ui } from '../lib/store.svelte';

  const nsid = {
    listThreads: 'com.etzhayyim.apps.mailer.listThreads',
    listMessages: 'com.etzhayyim.apps.mailer.listMessages',
    sendMail: 'com.etzhayyim.apps.mailer.sendMail',
    classifyMail: 'com.etzhayyim.apps.mailer.classifyMail',
    listBecAlerts: 'com.etzhayyim.apps.mailer.listBecAlerts'
  } as const;

  type Folder = 'inbox' | 'starred' | 'sent' | 'drafts' | 'alerts' | 'archive' | 'trash';
  let folder = $state<Folder>('inbox');

  const folders: Array<{ id: Folder; label: string; icon: string; count?: number }> = [
    { id: 'inbox', label: 'Inbox', icon: '📥', count: 4 },
    { id: 'starred', label: 'Starred', icon: '⭐' },
    { id: 'sent', label: 'Sent', icon: '📤' },
    { id: 'drafts', label: 'Drafts', icon: '📝', count: 1 },
    { id: 'alerts', label: 'BEC Alerts', icon: '🛡', count: 2 },
    { id: 'archive', label: 'Archive', icon: '📦' },
    { id: 'trash', label: 'Trash', icon: '🗑' }
  ];

  type Thread = {
    id: string;
    from: string;
    fromInitial: string;
    subject: string;
    snippet: string;
    time: string;
    unread?: boolean;
    starred?: boolean;
    labels?: string[];
    folder: Folder;
    body: string;
  };

  // Stub threads — listThreads not wired yet.
  const threads: Thread[] = [
    {
      id: 't1', from: 'AP Bot · vendor.example', fromInitial: 'AP', subject: '[Kyber] Invoice INV-2026-042 due Apr 30',
      snippet: 'Net-30 payment due. PDF attached. Vendor: Sample Vendor Inc.',
      time: '10:42', unread: true, labels: ['finance', 'invoice'], folder: 'inbox',
      body: 'Net-30 payment due Apr 30. Vendor: Sample Vendor Inc.\nLine items:\n- Notebook PC × 20 @ ¥132,000 = ¥2,640,000\n\nClassification: legitimate (high confidence).'
    },
    {
      id: 't2', from: 'HR Bot', fromInitial: 'HR', subject: 'Onboarding checklist — 山田 太郎',
      snippet: 'Probation start 2026-04-15. Dept: hr. Issued laptop, badge, slack invite.',
      time: '09:18', labels: ['hr'], folder: 'inbox',
      body: 'Probation start 2026-04-15.\nDept: hr\nPosition: HRBP\nSalary: ¥6,500,000\n— Tasks ready in projector convo.'
    },
    {
      id: 't3', from: 'Calendar Bot', fromInitial: 'CA', subject: 'Monthly Close Review — 2026-04-30 17:00',
      snippet: 'Recurring (FREQ=MONTHLY;BYMONTHDAY=-1). 2 attendees confirmed.',
      time: 'Yesterday', starred: true, labels: ['calendar'], folder: 'inbox',
      body: 'Event: Monthly Close Review\nWhen: 2026-04-30 17:00 → 18:00 (Asia/Tokyo)\nRRULE: FREQ=MONTHLY;BYMONTHDAY=-1\nAttendees: dept:accounting, dept:hr'
    },
    {
      id: 't4', from: 'AI Sec — Mailer', fromInitial: '⚠', subject: '⚠ Possible BEC: ceo@kybеr.etzhayyim.com',
      snippet: 'Domain spoof detected (Cyrillic "е"). Wire transfer request flagged.',
      time: 'Mon', unread: true, labels: ['security', 'bec'], folder: 'alerts',
      body: 'Sender: ceo@kybеr.etzhayyim.com (note Cyrillic "е" U+0435 vs ASCII "e" U+0065).\nSubject: Urgent wire transfer.\nClassification: BEC (high confidence). Action: quarantine + alert finance.'
    },
    {
      id: 't5', from: 'Procurement Bot', fromInitial: 'PR', subject: 'PO PO-0099 acknowledged by vendor',
      snippet: 'Sample Vendor Inc. confirmed delivery 2026-04-25.',
      time: 'Mon', labels: ['procurement'], folder: 'inbox',
      body: 'PO-0099 ack received.\nVendor: Sample Vendor Inc.\nDelivery date: 2026-04-25\nLine items: Notebook PC × 20'
    }
  ];

  const filtered = $derived.by(() => {
    if (folder === 'starred') return threads.filter((t) => t.starred);
    return threads.filter((t) => t.folder === folder || (folder === 'inbox' && !t.folder));
  });

  let selected = $state<Thread | null>(threads[0]);
  let composing = $state(false);
  let cTo = $state('ap@vendor.example');
  let cSubject = $state('[Kyber] Invoice INV-2026-042');
  let cBody = $state('Attached invoice. Payment due 2026-05-31.');

  async function run(kind: string, payload: Record<string, unknown> = {}) {
    ui.loading = true;
    try { ui.setResult(await callXrpc(kind, payload)); } finally { ui.loading = false; }
  }

  async function sendCompose() {
    await run(nsid.sendMail, { to: cTo, subject: cSubject, body: cBody });
    composing = false;
  }
</script>

<div class="grid grid-cols-[200px_320px_minmax(0,1fr)] gap-0 -m-5 min-h-[calc(100vh-160px)]">
  <!-- Left rail -->
  <aside class="border-r border-etzhayyim-border bg-etzhayyim-sidebar p-3 flex flex-col gap-3">
    <Button size="md" variant="solid-fill" onclick={() => (composing = true)}>
      ✏️ Compose
    </Button>
    <nav class="flex flex-col gap-0.5 text-sm">
      {#each folders as f}
        <button
          type="button"
          class="flex items-center justify-between px-3 py-2 rounded-r-full transition"
          class:bg-etzhayyim-accent={folder === f.id}
          class:text-white={folder === f.id}
          class:font-semibold={folder === f.id}
          class:hover:bg-etzhayyim-hover={folder !== f.id}
          onclick={() => { folder = f.id; selected = null; }}
        >
          <span class="flex items-center gap-3"><span>{f.icon}</span>{f.label}</span>
          {#if f.count}<span class="text-[11px] opacity-80">{f.count}</span>{/if}
        </button>
      {/each}
    </nav>
    <div class="border-t border-etzhayyim-border pt-3 text-[11px] text-etzhayyim-muted">
      <p class="font-semibold text-etzhayyim-secondary mb-1">Labels</p>
      <ul class="space-y-1">
        <li>● <span class="ml-1">finance</span></li>
        <li>● <span class="ml-1">hr</span></li>
        <li>● <span class="ml-1">procurement</span></li>
        <li>● <span class="ml-1">security</span></li>
      </ul>
    </div>
  </aside>

  <!-- Thread list -->
  <section class="border-r border-etzhayyim-border flex flex-col min-w-0">
    <div class="flex items-center gap-2 px-3 py-2 border-b border-etzhayyim-border">
      <Input bind:value={cSubject} blockSize="sm" placeholder="Search mail" class="flex-1" />
      <Button size="xs" variant="outline" onclick={() => run(nsid.listThreads, { box: folder, limit: 50 })}>↻</Button>
    </div>
    <div class="flex-1 overflow-auto">
      {#each filtered as t}
        <button
          type="button"
          class="w-full text-left px-3 py-2 border-b border-etzhayyim-border/40 hover:bg-etzhayyim-hover flex flex-col gap-0.5"
          class:bg-etzhayyim-hover={selected?.id === t.id}
          onclick={() => (selected = t)}
        >
          <div class="flex items-center gap-2">
            <div class="h-7 w-7 rounded-full bg-etzhayyim-accent grid place-items-center text-[10px] font-bold text-white">
              {t.fromInitial}
            </div>
            <span class="text-xs flex-1 truncate" class:font-bold={t.unread}>{t.from}</span>
            <span class="text-[10px] text-etzhayyim-muted">{t.time}</span>
          </div>
          <p class="text-sm truncate" class:font-semibold={t.unread}>{t.subject}</p>
          <p class="text-[11px] text-etzhayyim-muted truncate">{t.snippet}</p>
          <div class="flex gap-1 mt-0.5">
            {#each (t.labels ?? []) as l}<Badge value={l} variant="default" />{/each}
          </div>
        </button>
      {:else}
        <div class="text-center py-12 text-sm text-etzhayyim-muted">No mail in {folder}.</div>
      {/each}
    </div>
  </section>

  <!-- Reading pane -->
  <section class="flex flex-col min-w-0">
    {#if selected}
      <div class="px-5 py-3 border-b border-etzhayyim-border flex items-center gap-2">
        <Button size="xs" variant="text" onclick={() => (selected = null)}>← Back</Button>
        <Button size="xs" variant="outline">Archive</Button>
        <Button size="xs" variant="outline">Snooze</Button>
        <Button size="xs" variant="outline"
          onclick={() => run(nsid.classifyMail, { subject: selected!.subject, body: selected!.body })}>Classify</Button>
        <span class="ml-auto text-[11px] text-etzhayyim-muted">{selected.time}</span>
      </div>
      <div class="px-5 py-4 border-b border-etzhayyim-border">
        <h2 class="text-xl font-semibold">{selected.subject}</h2>
        <div class="flex gap-1 mt-1">
          {#each (selected.labels ?? []) as l}<Badge value={l} variant="default" />{/each}
        </div>
      </div>
      <div class="px-5 py-4 flex items-start gap-3 border-b border-etzhayyim-border">
        <div class="h-10 w-10 rounded-full bg-etzhayyim-accent grid place-items-center text-xs font-bold text-white">
          {selected.fromInitial}
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-semibold">{selected.from}</p>
          <p class="text-[11px] text-etzhayyim-muted">to me</p>
        </div>
      </div>
      <div class="flex-1 overflow-auto px-5 py-4 text-sm whitespace-pre-wrap leading-relaxed">{selected.body}</div>
      <div class="px-5 py-3 border-t border-etzhayyim-border flex gap-2">
        <Button size="sm" variant="outline" onclick={() => { composing = true; cTo = selected!.from; cSubject = 'Re: ' + selected!.subject; cBody = `\n\n— On ${selected!.time} ${selected!.from} wrote:\n${selected!.body}`; }}>Reply</Button>
        <Button size="sm" variant="outline">Reply all</Button>
        <Button size="sm" variant="outline">Forward</Button>
      </div>
    {:else}
      <div class="flex-1 grid place-items-center text-sm text-etzhayyim-muted">
        Select a conversation.
      </div>
    {/if}
  </section>
</div>

{#if composing}
  <div role="presentation" class="fixed inset-0 z-40 bg-black/40" onclick={() => (composing = false)}>
    <div
      role="dialog"
      tabindex="-1"
      class="absolute right-6 bottom-6 w-[520px] max-w-[calc(100vw-3rem)] rounded-t-xl rounded-b-xl bg-etzhayyim-card border border-etzhayyim-border shadow-2xl flex flex-col max-h-[80vh]"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
    >
      <header class="px-4 py-2 bg-etzhayyim-sidebar rounded-t-xl flex items-center justify-between">
        <span class="text-sm font-semibold">New message</span>
        <button type="button" class="text-etzhayyim-muted" onclick={() => (composing = false)}>✕</button>
      </header>
      <div class="px-4 py-3 flex flex-col gap-2 flex-1 overflow-auto">
        <Input bind:value={cTo} blockSize="sm" placeholder="To (email or DID)" />
        <Input bind:value={cSubject} blockSize="sm" placeholder="Subject" />
        <Textarea bind:value={cBody} rows={10} />
      </div>
      <footer class="px-4 py-3 border-t border-etzhayyim-border flex items-center gap-2">
        <Button size="sm" variant="solid-fill" onclick={sendCompose}>Send</Button>
        <Button size="sm" variant="outline">Save draft</Button>
        <span class="ml-auto text-[11px] text-etzhayyim-muted">Signal E2E available</span>
      </footer>
    </div>
  </div>
{/if}
