<!-- Convo-PM projector (projector.etzhayyim.com) — distinct from kyber APQC/BPMN projector (kyber-projector.etzhayyim.com, ADR-0025).
     APQC/BPMN/OCEL UI lives in the `apqc` section of Appview.svelte. -->
<script lang="ts">
  import { Button, Input, Textarea, Badge, Avatar, Chip } from '@etzhayyim/design-system';
  import { callXrpc } from '../lib/xrpc';
  import { ui } from '../lib/store.svelte';

  const nsid = {
    listProjectTree: 'com.etzhayyim.projector.listProjectTree',
    newProjectConvo: 'com.etzhayyim.projector.newProjectConvo',
    sendProjectMessage: 'com.etzhayyim.projector.sendProjectMessage',
    addConvoTask: 'com.etzhayyim.projector.addConvoTask',
    listConvoTasks: 'com.etzhayyim.projector.listConvoTasks',
    completeConvoTask: 'com.etzhayyim.projector.completeConvoTask',
    getConvoProjectStatus: 'com.etzhayyim.projector.getConvoProjectStatus',
    addReflection: 'com.etzhayyim.projector.addReflection',
    branchConvo: 'com.etzhayyim.projector.branchConvo'
  } as const;

  type Project = { id: string; name: string; emoji: string; convoId: string; children?: Project[] };

  // Stub project tree (Asana-style sidebar)
  const tree: Project[] = [
    {
      id: 'p1', name: 'Kyber FY26 Close', emoji: '📊', convoId: 'cv-fy26-close',
      children: [
        { id: 'p1a', name: 'AR aging', emoji: '💰', convoId: 'cv-ar-aging' },
        { id: 'p1b', name: 'Trial balance review', emoji: '📒', convoId: 'cv-tb-review' }
      ]
    },
    {
      id: 'p2', name: 'Vendor Onboarding Q2', emoji: '🤝', convoId: 'cv-vendor-q2',
      children: [
        { id: 'p2a', name: 'Sample Vendor Inc.', emoji: '🏭', convoId: 'cv-sample-vendor' }
      ]
    },
    { id: 'p3', name: 'Hiring — HRBP', emoji: '👤', convoId: 'cv-hire-hrbp' },
    { id: 'p4', name: 'APQC L1 mapping', emoji: '🧭', convoId: 'cv-apqc-l1' }
  ];

  type Task = { id: string; title: string; done: boolean; assignee?: string; due?: string };
  type Msg = { id: string; from: string; initial: string; text: string; time: string; type?: 'system' | 'agent' | 'human' };

  const taskMap: Record<string, Task[]> = {
    'cv-fy26-close': [
      { id: 't1', title: 'Reconcile AR aging buckets', done: false, assignee: 'AP Bot', due: 'Apr 25' },
      { id: 't2', title: 'Close month-end JE batch', done: false, assignee: 'Acc Bot', due: 'Apr 30' },
      { id: 't3', title: 'Send board pack', done: true, assignee: 'me', due: 'Apr 14' }
    ],
    'cv-ar-aging': [
      { id: 't4', title: 'Pull >60d aged invoices', done: true, assignee: 'AP Bot' },
      { id: 't5', title: 'Draft dunning letters', done: false, assignee: 'AP Bot' }
    ]
  };
  const msgMap: Record<string, Msg[]> = {
    'cv-fy26-close': [
      { id: 'm1', from: 'system', initial: 'sys', text: 'Project created. 5 actor DIDs joined.', time: '09:00', type: 'system' },
      { id: 'm2', from: 'AP Bot', initial: 'AP', text: '/status — 3 tasks · 1 done · 2 pending · 0 overdue', time: '09:12', type: 'agent' },
      { id: 'm3', from: 'me', initial: 'KY', text: 'Add task: reconcile AR aging buckets', time: '09:13', type: 'human' },
      { id: 'm4', from: 'projector', initial: 'PR', text: 'Task added: "Reconcile AR aging buckets" → AP Bot · due Apr 25', time: '09:13', type: 'system' },
      { id: 'm5', from: 'Acc Bot', initial: 'AC', text: '/think — Reflexion: prior close cycle missed 12 invoices in suspense. Recommend pre-close suspense audit step.', time: '09:30', type: 'agent' }
    ]
  };

  let activeId = $state(tree[0].convoId);
  let view = $state<'overview' | 'tasks' | 'chat' | 'reflections'>('overview');
  let expanded = $state<Set<string>>(new Set(tree.map((t) => t.id)));
  let composer = $state('');

  const flat = $derived.by(() => {
    const out: Array<Project & { depth: number }> = [];
    function walk(ns: Project[], depth: number) {
      for (const n of ns) {
        out.push({ ...n, depth });
        if (n.children && expanded.has(n.id)) walk(n.children, depth + 1);
      }
    }
    walk(tree, 0);
    return out;
  });

  const activeProject = $derived.by(() => {
    function find(ns: Project[]): Project | undefined {
      for (const n of ns) {
        if (n.convoId === activeId) return n;
        if (n.children) {
          const x = find(n.children);
          if (x) return x;
        }
      }
    }
    return find(tree);
  });

  const tasks = $derived(taskMap[activeId] ?? []);
  const msgs = $derived(msgMap[activeId] ?? []);

  async function run(kind: string, payload: Record<string, unknown> = {}) {
    ui.loading = true;
    try { ui.setResult(await callXrpc(kind, payload)); } finally { ui.loading = false; }
  }

  async function send() {
    if (!composer.trim()) return;
    await run(nsid.sendProjectMessage, { convoId: activeId, text: composer });
    composer = '';
  }

  function toggle(id: string) {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id); else next.add(id);
    expanded = next;
  }
</script>

<div class="grid grid-cols-[260px_minmax(0,1fr)] gap-0 -m-5 min-h-[calc(100vh-160px)]">
  <!-- Left: project tree -->
  <aside class="border-r border-etzhayyim-border bg-etzhayyim-sidebar p-3 flex flex-col gap-3 overflow-y-auto">
    <Button size="md" variant="solid-fill"
      onclick={() => run(nsid.newProjectConvo, { name: 'New Project ' + new Date().toLocaleDateString() })}>
      ＋ New project
    </Button>
    <div class="text-[11px] uppercase tracking-wider text-etzhayyim-muted px-2">Projects</div>
    <ul class="text-sm">
      {#each flat as n}
        <li
          class="flex items-center gap-1 py-1.5 rounded-md hover:bg-etzhayyim-hover"
          class:bg-etzhayyim-hover={activeId === n.convoId}
          class:font-semibold={activeId === n.convoId}
          style={`padding-left: ${n.depth * 14 + 8}px`}
        >
          {#if n.children?.length}
            <button type="button" class="w-4 text-xs text-etzhayyim-muted" onclick={() => toggle(n.id)}>
              {expanded.has(n.id) ? '▾' : '▸'}
            </button>
          {:else}
            <span class="w-4"></span>
          {/if}
          <button
            type="button"
            class="min-w-0 flex-1 flex items-center gap-1 text-left"
            onclick={() => (activeId = n.convoId)}
          >
            <span>{n.emoji}</span>
            <span class="truncate">{n.name}</span>
          </button>
        </li>
      {/each}
    </ul>

    <div class="mt-auto border-t border-etzhayyim-border pt-3 text-[11px] text-etzhayyim-muted">
      <p class="font-semibold text-etzhayyim-secondary mb-1">Reasoning</p>
      <p>CoT · Self-Consistency · Tree-of-Thoughts · Reflexion</p>
    </div>
  </aside>

  <!-- Main: project view -->
  <section class="flex flex-col min-w-0">
    <header class="px-5 py-3 border-b border-etzhayyim-border flex items-center gap-3">
      <div class="h-9 w-9 rounded-xl bg-gradient-to-br from-fuchsia-500 to-pink-500 grid place-items-center text-white">
        {activeProject?.emoji ?? '?'}
      </div>
      <div class="flex-1 min-w-0">
        <h2 class="text-base font-semibold truncate">{activeProject?.name ?? '—'}</h2>
        <p class="text-[11px] text-etzhayyim-muted">convoId: {activeId}</p>
      </div>
      <Button size="xs" variant="outline"
        onclick={() => run(nsid.getConvoProjectStatus, { convoId: activeId })}>Status</Button>
      <Button size="xs" variant="outline"
        onclick={() => run(nsid.branchConvo, { convoId: activeId })}>Branch</Button>
    </header>

    <nav class="flex gap-1 px-5 py-2 border-b border-etzhayyim-border text-sm">
      {#each (['overview', 'tasks', 'chat', 'reflections'] as const) as v}
        <button
          type="button"
          class="px-3 py-1.5 rounded-md transition"
          class:bg-etzhayyim-hover={view === v}
          class:font-semibold={view === v}
          onclick={() => (view = v)}
        >{v}</button>
      {/each}
    </nav>

    <div class="flex-1 overflow-auto">
      {#if view === 'overview'}
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 p-5">
          <div class="rounded-xl border border-etzhayyim-border bg-etzhayyim-card p-4">
            <p class="text-[11px] uppercase tracking-wider text-etzhayyim-muted">Tasks</p>
            <p class="text-3xl font-semibold mt-1">{tasks.length}</p>
            <p class="text-xs text-etzhayyim-secondary">{tasks.filter(t => t.done).length} done · {tasks.filter(t => !t.done).length} open</p>
          </div>
          <div class="rounded-xl border border-etzhayyim-border bg-etzhayyim-card p-4">
            <p class="text-[11px] uppercase tracking-wider text-etzhayyim-muted">Messages</p>
            <p class="text-3xl font-semibold mt-1">{msgs.length}</p>
            <p class="text-xs text-etzhayyim-secondary">across {new Set(msgs.map(m => m.from)).size} actor(s)</p>
          </div>
          <div class="rounded-xl border border-etzhayyim-border bg-etzhayyim-card p-4">
            <p class="text-[11px] uppercase tracking-wider text-etzhayyim-muted">Reflections</p>
            <p class="text-3xl font-semibold mt-1">3</p>
            <p class="text-xs text-etzhayyim-secondary">last: 09:30 (Acc Bot)</p>
          </div>

          <div class="md:col-span-3 rounded-xl border border-etzhayyim-border bg-etzhayyim-card p-4">
            <p class="text-sm font-semibold mb-3">Members</p>
            <div class="flex flex-wrap gap-2">
              {#each ['AP Bot', 'Acc Bot', 'HR Bot', 'me'] as m}
                <div class="flex items-center gap-2 rounded-full border border-etzhayyim-border px-3 py-1 text-xs">
                  <Avatar fallback={m.slice(0, 2).toUpperCase()} size="sm" />
                  {m}
                </div>
              {/each}
            </div>
          </div>
        </div>

      {:else if view === 'tasks'}
        <div class="px-5 py-4 flex flex-col gap-2">
          <div class="flex items-center justify-between mb-2">
            <p class="text-sm font-semibold">Tasks</p>
            <Button size="xs" variant="solid-fill"
              onclick={() => run(nsid.addConvoTask, { convoId: activeId, title: 'New task' })}>＋ Add task</Button>
          </div>
          <ul class="flex flex-col gap-1">
            {#each tasks as t}
              <li class="flex items-center gap-3 rounded-lg border border-etzhayyim-border bg-etzhayyim-card px-3 py-2 hover:bg-etzhayyim-hover">
                <input
                  type="checkbox"
                  checked={t.done}
                  onclick={() => run(nsid.completeConvoTask, { convoId: activeId, taskId: t.id })}
                />
                <span class="flex-1 text-sm" class:line-through={t.done} class:text-etzhayyim-muted={t.done}>{t.title}</span>
                {#if t.assignee}<Badge value={t.assignee} variant="default" />{/if}
                {#if t.due}<span class="text-[11px] text-etzhayyim-secondary">{t.due}</span>{/if}
              </li>
            {:else}
              <li class="text-center py-12 text-sm text-etzhayyim-muted">No tasks. Use /task in chat.</li>
            {/each}
          </ul>
        </div>

      {:else if view === 'chat'}
        <div class="flex flex-col h-full">
          <div class="flex-1 overflow-auto px-5 py-4 space-y-3">
            {#each msgs as m}
              {#if m.type === 'system'}
                <div class="text-center text-[11px] text-etzhayyim-muted">— {m.text} ({m.time}) —</div>
              {:else}
                <div class="flex gap-3" class:flex-row-reverse={m.type === 'human'}>
                  <div class="h-8 w-8 rounded-full bg-etzhayyim-accent grid place-items-center text-[10px] font-bold text-white flex-shrink-0">
                    {m.initial}
                  </div>
                  <div
                    class="max-w-[70%] rounded-2xl px-3 py-2"
                    class:bg-etzhayyim-accent={m.type === 'human'}
                    class:text-white={m.type === 'human'}
                    class:bg-etzhayyim-card={m.type !== 'human'}
                    class:border={m.type !== 'human'}
                    class:border-etzhayyim-border={m.type !== 'human'}
                  >
                    <div class="flex items-baseline gap-2 text-[11px]" class:opacity-80={m.type === 'human'}>
                      <span class="font-semibold">{m.from}</span>
                      <span>{m.time}</span>
                    </div>
                    <p class="text-sm whitespace-pre-wrap mt-0.5">{m.text}</p>
                  </div>
                </div>
              {/if}
            {/each}
          </div>
          <div class="border-t border-etzhayyim-border p-3">
            <div class="flex gap-1 mb-2 text-xs">
              <Chip label="/task" onclick={() => (composer = '/task ')} />
              <Chip label="/done" onclick={() => (composer = '/done ')} />
              <Chip label="/status" onclick={() => (composer = '/status')} />
              <Chip label="/branch" onclick={() => (composer = '/branch ')} />
              <Chip label="/think" onclick={() => (composer = '/think ')} />
              <Chip label="/reflect" onclick={() => (composer = '/reflect ')} />
            </div>
            <div class="flex gap-2 items-end">
              <Textarea bind:value={composer} rows={2} />
              <Button size="md" variant="solid-fill" onclick={send}>Send</Button>
            </div>
          </div>
        </div>

      {:else if view === 'reflections'}
        <div class="px-5 py-4 flex flex-col gap-3">
          <div class="rounded-xl border border-etzhayyim-border bg-etzhayyim-card p-4">
            <div class="flex items-center gap-2 text-xs text-etzhayyim-muted mb-2">
              <Badge value="Reflexion" variant="accent" /> Acc Bot · 09:30
            </div>
            <p class="text-sm">Prior close cycle missed 12 invoices in suspense. Recommend pre-close suspense audit step.</p>
          </div>
          <div class="rounded-xl border border-etzhayyim-border bg-etzhayyim-card p-4">
            <div class="flex items-center gap-2 text-xs text-etzhayyim-muted mb-2">
              <Badge value="Self-Consistency" variant="accent" /> AP Bot · 08:50
            </div>
            <p class="text-sm">3-path sampling on AR-aging cutoff date converged on 60d threshold (consistent across 3/3 paths).</p>
          </div>
          <div>
            <Button size="sm" variant="outline"
              onclick={() => run(nsid.addReflection, { convoId: activeId, text: 'Captured manually' })}>＋ Add reflection</Button>
          </div>
        </div>
      {/if}
    </div>
  </section>
</div>
