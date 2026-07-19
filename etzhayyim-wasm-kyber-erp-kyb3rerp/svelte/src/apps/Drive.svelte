<script lang="ts">
  import { Button, Input, Badge, Avatar } from '@etzhayyim/design-system';
  import { callXrpc } from '../lib/xrpc';
  import { ui } from '../lib/store.svelte';

  const nsid = {
    listFiles: 'com.etzhayyim.apps.drive.listFiles',
    createFolder: 'com.etzhayyim.apps.drive.createFolder',
    uploadFile: 'com.etzhayyim.apps.drive.uploadFile',
    deleteFile: 'com.etzhayyim.apps.drive.deleteFile',
    getFile: 'com.etzhayyim.apps.drive.getFile'
  } as const;

  type Section = 'my-drive' | 'shared' | 'recent' | 'starred' | 'trash';
  let section = $state<Section>('my-drive');
  let view = $state<'grid' | 'list'>('list');
  let cwd = $state('/');
  let files = $state<File[]>([]);
  let uploading = $state(false);
  let showNewMenu = $state(false);
  let showFolderInput = $state(false);
  let folderName = $state('');

  type Item = {
    name: string;
    kind: 'folder' | 'doc' | 'sheet' | 'pdf' | 'image' | 'audio' | 'file';
    owner: string;
    modified: string;
    size: string;
    starred?: boolean;
    shared?: boolean;
  };

  // Stub items — listFiles backend not wired yet. UI mirrors Drive layout.
  const stub: Item[] = [
    { name: 'Q1 Reports', kind: 'folder', owner: 'me', modified: 'Apr 12', size: '—' },
    { name: 'Receipts 2026', kind: 'folder', owner: 'me', modified: 'Apr 10', size: '—', starred: true },
    { name: 'Vendor Contracts', kind: 'folder', owner: 'Yamada T.', modified: 'Apr 8', size: '—', shared: true },
    { name: 'FY26-budget.xlsx', kind: 'sheet', owner: 'me', modified: 'Apr 14', size: '128 KB', starred: true },
    { name: 'board-deck-2026Q1.pdf', kind: 'pdf', owner: 'me', modified: 'Apr 13', size: '4.2 MB' },
    { name: 'employee-handbook.docx', kind: 'doc', owner: 'HR Bot', modified: 'Apr 11', size: '312 KB', shared: true },
    { name: 'invoice-INV-0042.pdf', kind: 'pdf', owner: 'AP Bot', modified: 'Apr 14', size: '88 KB' },
    { name: 'logo-mark.png', kind: 'image', owner: 'Design', modified: 'Mar 30', size: '512 KB' }
  ];

  let selected = $state<Item | null>(null);

  const sectionMeta: Record<Section, { label: string; icon: string }> = {
    'my-drive': { label: 'My Drive', icon: '📁' },
    shared: { label: 'Shared with me', icon: '👥' },
    recent: { label: 'Recent', icon: '🕒' },
    starred: { label: 'Starred', icon: '⭐' },
    trash: { label: 'Trash', icon: '🗑' }
  };

  const filtered = $derived.by(() => {
    let xs = stub;
    if (section === 'starred') xs = xs.filter((x) => x.starred);
    if (section === 'shared') xs = xs.filter((x) => x.shared);
    if (section === 'trash') xs = [];
    return xs;
  });

  const breadcrumbs = $derived(cwd.split('/').filter(Boolean));

  function iconFor(kind: Item['kind']) {
    return {
      folder: '📁',
      doc: '📄',
      sheet: '📊',
      pdf: '📕',
      image: '🖼',
      audio: '🎵',
      file: '📎'
    }[kind];
  }

  async function run(kind: string, payload: Record<string, unknown> = {}) {
    ui.loading = true;
    try {
      ui.setResult(await callXrpc(kind, payload));
    } finally {
      ui.loading = false;
    }
  }

  async function upload() {
    if (!files.length) return;
    uploading = true;
    try {
      for (const f of files) {
        const fd = new FormData();
        fd.append('path', cwd);
        fd.append('file', f, f.name);
        const res = await fetch(`/xrpc/${nsid.uploadFile}`, { method: 'POST', body: fd });
        const body = await res.json().catch(() => ({}));
        ui.setResult({
          ok: res.ok,
          status: res.status,
          nsid: nsid.uploadFile,
          request: { path: cwd, file: f.name, size: f.size },
          response: body
        });
      }
      files = [];
    } finally {
      uploading = false;
      showNewMenu = false;
    }
  }

  function onFiles(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    files = input.files ? Array.from(input.files) : [];
  }

  async function submitFolder() {
    if (!folderName.trim()) return;
    await run(nsid.createFolder, { path: cwd, name: folderName });
    folderName = '';
    showFolderInput = false;
    showNewMenu = false;
  }
</script>

<div class="grid grid-cols-[220px_minmax(0,1fr)] gap-0 -m-5 min-h-[calc(100vh-160px)]">
  <!-- Left rail -->
  <aside class="border-r border-etzhayyim-border bg-etzhayyim-sidebar p-3 flex flex-col gap-3">
    <div class="relative">
      <button
        type="button"
        class="w-full flex items-center justify-center gap-2 rounded-2xl bg-white text-etzhayyim-bg shadow-md hover:shadow-lg px-4 py-3 font-semibold text-sm"
        onclick={() => (showNewMenu = !showNewMenu)}
      >
        <span class="text-xl leading-none">＋</span> New
      </button>
      {#if showNewMenu}
        <div class="absolute z-20 mt-2 w-full rounded-xl border border-etzhayyim-border bg-etzhayyim-card shadow-xl py-1 text-sm">
          <button
            type="button"
            class="w-full text-left px-3 py-2 hover:bg-etzhayyim-hover flex items-center gap-2"
            onclick={() => { showFolderInput = true; }}
          >📁 New folder</button>
          <label class="block w-full text-left px-3 py-2 hover:bg-etzhayyim-hover cursor-pointer flex items-center gap-2">
            ⬆️ File upload
            <input type="file" multiple class="hidden" onchange={onFiles} />
          </label>
          <div class="border-t border-etzhayyim-border my-1"></div>
          <button type="button" class="w-full text-left px-3 py-2 hover:bg-etzhayyim-hover flex items-center gap-2">📄 Doc</button>
          <button type="button" class="w-full text-left px-3 py-2 hover:bg-etzhayyim-hover flex items-center gap-2">📊 Sheet</button>
          <button type="button" class="w-full text-left px-3 py-2 hover:bg-etzhayyim-hover flex items-center gap-2">📑 Slide</button>
        </div>
      {/if}
      {#if showFolderInput}
        <div class="absolute z-30 mt-2 w-full rounded-xl border border-etzhayyim-border bg-etzhayyim-card shadow-xl p-3 flex flex-col gap-2">
          <Input bind:value={folderName} blockSize="md" placeholder="Folder name" />
          <div class="flex gap-2 justify-end">
            <Button size="xs" variant="text" onclick={() => (showFolderInput = false)}>Cancel</Button>
            <Button size="xs" variant="solid-fill" onclick={submitFolder}>Create</Button>
          </div>
        </div>
      {/if}
    </div>

    <nav class="flex flex-col gap-0.5 text-sm">
      {#each Object.entries(sectionMeta) as [id, m]}
        <button
          type="button"
          class="flex items-center gap-3 px-3 py-2 rounded-r-full transition"
          class:bg-etzhayyim-accent={section === id}
          class:text-white={section === id}
          class:font-semibold={section === id}
          class:hover:bg-etzhayyim-hover={section !== id}
          onclick={() => (section = id as Section)}
        >
          <span class="text-base">{m.icon}</span>
          <span>{m.label}</span>
        </button>
      {/each}
    </nav>

    <div class="mt-auto rounded-xl border border-etzhayyim-border p-3 text-[11px] text-etzhayyim-muted">
      <p class="font-semibold text-etzhayyim-secondary mb-1">Storage</p>
      <div class="h-1.5 bg-etzhayyim-input rounded-full overflow-hidden mb-1">
        <div class="h-full bg-etzhayyim-accent" style="width: 12%"></div>
      </div>
      <p>1.2 GB of 10 GB used</p>
    </div>
  </aside>

  <!-- Main -->
  <section class="flex flex-col min-w-0">
    <!-- Toolbar -->
    <div class="flex items-center justify-between gap-3 px-5 py-3 border-b border-etzhayyim-border">
      <div class="flex items-center gap-2 text-sm">
        <button type="button" class="hover:bg-etzhayyim-hover px-2 py-1 rounded" onclick={() => (cwd = '/')}>
          {sectionMeta[section].label}
        </button>
        {#each breadcrumbs as crumb, i}
          <span class="text-etzhayyim-muted">›</span>
          <button
            type="button"
            class="hover:bg-etzhayyim-hover px-2 py-1 rounded"
            onclick={() => (cwd = '/' + breadcrumbs.slice(0, i + 1).join('/'))}
          >{crumb}</button>
        {/each}
      </div>
      <div class="flex items-center gap-2">
        <Input bind:value={cwd} blockSize="sm" placeholder="/path" class="w-48" />
        <button type="button"
          class="p-2 rounded hover:bg-etzhayyim-hover"
          class:bg-etzhayyim-hover={view === 'list'}
          onclick={() => (view = 'list')} title="List view">☰</button>
        <button type="button"
          class="p-2 rounded hover:bg-etzhayyim-hover"
          class:bg-etzhayyim-hover={view === 'grid'}
          onclick={() => (view = 'grid')} title="Grid view">▦</button>
        <Button size="xs" variant="outline"
          onclick={() => run(nsid.listFiles, { path: cwd })}>Reload</Button>
      </div>
    </div>

    <!-- File area -->
    <div class="flex-1 overflow-auto p-5">
      {#if files.length > 0}
        <div class="mb-4 rounded-lg border border-etzhayyim-border bg-etzhayyim-input p-3 flex items-center justify-between">
          <div class="text-xs">
            <p class="font-semibold">{files.length} file(s) ready</p>
            <p class="text-etzhayyim-muted">{files.map(f => f.name).join(', ')}</p>
          </div>
          <div class="flex gap-2">
            <Button size="sm" variant="outline" onclick={() => (files = [])}>Clear</Button>
            <Button size="sm" variant="solid-fill" onclick={upload}>{uploading ? 'Uploading…' : 'Upload'}</Button>
          </div>
        </div>
      {/if}

      {#if section === 'trash'}
        <div class="text-center py-20 text-etzhayyim-muted text-sm">Trash is empty.</div>
      {:else if view === 'list'}
        <table class="w-full text-sm">
          <thead class="text-left text-[11px] uppercase tracking-wider text-etzhayyim-muted border-b border-etzhayyim-border">
            <tr>
              <th class="py-2 px-2 font-semibold">Name</th>
              <th class="py-2 px-2 font-semibold w-32">Owner</th>
              <th class="py-2 px-2 font-semibold w-32">Last modified</th>
              <th class="py-2 px-2 font-semibold w-24 text-right">Size</th>
            </tr>
          </thead>
          <tbody>
            {#each filtered as it}
              <tr
                class="border-b border-etzhayyim-border/40 hover:bg-etzhayyim-hover cursor-pointer"
                class:bg-etzhayyim-hover={selected === it}
                onclick={() => (selected = it)}
              >
                <td class="py-2 px-2 flex items-center gap-2">
                  <span>{iconFor(it.kind)}</span>
                  <span class="truncate">{it.name}</span>
                  {#if it.starred}<span class="text-yellow-400">★</span>{/if}
                  {#if it.shared}<span class="text-etzhayyim-muted text-xs">shared</span>{/if}
                </td>
                <td class="py-2 px-2 text-etzhayyim-secondary">{it.owner}</td>
                <td class="py-2 px-2 text-etzhayyim-secondary">{it.modified}</td>
                <td class="py-2 px-2 text-etzhayyim-secondary text-right">{it.size}</td>
              </tr>
            {:else}
              <tr><td colspan="4" class="text-center py-12 text-etzhayyim-muted">No items.</td></tr>
            {/each}
          </tbody>
        </table>
      {:else}
        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {#each filtered as it}
            <button
              type="button"
              class="text-left rounded-xl border border-etzhayyim-border bg-etzhayyim-card hover:shadow-lg transition p-3 flex flex-col gap-2"
              onclick={() => (selected = it)}
            >
              <div class="aspect-video rounded-lg bg-etzhayyim-input grid place-items-center text-3xl">
                {iconFor(it.kind)}
              </div>
              <div class="flex items-center gap-1">
                <span class="text-sm truncate flex-1">{it.name}</span>
                {#if it.starred}<span class="text-yellow-400 text-xs">★</span>{/if}
              </div>
              <p class="text-[11px] text-etzhayyim-muted">{it.owner} · {it.modified}</p>
            </button>
          {/each}
        </div>
      {/if}
    </div>

    <div class="border-t border-etzhayyim-border px-5 py-2 text-[11px] text-etzhayyim-muted flex items-center gap-3">
      <Badge value="drive.etzhayyim.com" variant="default" />
      <span>SHA-256 content-addressed · E2EE blob storage</span>
      <span class="ml-auto">{filtered.length} item(s) — stub data; <code>listFiles</code> XRPC pending</span>
    </div>
  </section>
</div>

{#if selected}
  <div
    role="presentation"
    class="fixed inset-0 z-40 bg-black/40"
    onclick={() => (selected = null)}
  >
    <div
      role="dialog"
      tabindex="-1"
      class="absolute right-0 top-0 h-full w-80 bg-etzhayyim-card border-l border-etzhayyim-border p-4 flex flex-col gap-3"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
    >
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold">Details</h3>
        <button type="button" class="text-etzhayyim-muted" onclick={() => (selected = null)}>✕</button>
      </div>
      <div class="aspect-video rounded-lg bg-etzhayyim-input grid place-items-center text-5xl">
        {iconFor(selected.kind)}
      </div>
      <p class="text-sm font-semibold truncate">{selected.name}</p>
      <dl class="text-xs text-etzhayyim-secondary space-y-1">
        <div class="flex justify-between"><dt class="text-etzhayyim-muted">Owner</dt><dd>{selected.owner}</dd></div>
        <div class="flex justify-between"><dt class="text-etzhayyim-muted">Modified</dt><dd>{selected.modified}</dd></div>
        <div class="flex justify-between"><dt class="text-etzhayyim-muted">Size</dt><dd>{selected.size}</dd></div>
        <div class="flex justify-between"><dt class="text-etzhayyim-muted">Type</dt><dd>{selected.kind}</dd></div>
      </dl>
      <div class="mt-auto flex gap-2">
        <Button size="sm" variant="outline">Open</Button>
        <Button size="sm" variant="outline">Share</Button>
        <Button size="sm" variant="outline"
          onclick={() => run(nsid.deleteFile, { path: cwd, name: selected!.name })}>Delete</Button>
      </div>
    </div>
  </div>
{/if}
