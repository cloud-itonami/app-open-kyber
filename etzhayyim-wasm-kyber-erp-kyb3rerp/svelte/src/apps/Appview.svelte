<script lang="ts">
  import { Button, Input, Textarea, Select, Card, Badge, Chip } from '@etzhayyim/design-system';
  import { callXrpc, periodYM } from '../lib/xrpc';
  import { ui } from '../lib/store.svelte';

  const nsid = {
    dashboard: 'com.etzhayyim.apps.kyber.dashboard',
    listInvoices: 'com.etzhayyim.apps.kyber.listInvoices',
    createInvoice: 'com.etzhayyim.apps.kyber.createInvoice',
    listEmployees: 'com.etzhayyim.apps.kyber.listEmployees',
    registerEmployee: 'com.etzhayyim.apps.kyber.registerEmployee',
    listPurchaseOrders: 'com.etzhayyim.apps.kyber.listPurchaseOrders',
    createPurchaseOrder: 'com.etzhayyim.apps.kyber.createPurchaseOrder',
    listIntegrationCatalog: 'com.etzhayyim.apps.kyber.listIntegrationCatalog',
    syncIntegrationCatalog: 'com.etzhayyim.apps.kyber.syncIntegrationCatalog',
    // APQC/BPMN projector (ADR-0025). Kyber ERP side:
    initApqcProjector: 'com.etzhayyim.apps.kyber.initApqcProjector',
    // kyber-projector side (proxied via PDS pipethrough):
    listApqcActors: 'com.etzhayyim.kyber.projector.listApqcActors',
    listBpmnTasks: 'com.etzhayyim.kyber.projector.listBpmnTasks',
    runBpmnTask: 'com.etzhayyim.kyber.projector.runBpmnTask',
    getApqcCoverage: 'com.etzhayyim.kyber.projector.getApqcCoverage'
  } as const;

  type Section = 'finance' | 'people' | 'procurement' | 'apqc';
  let section = $state<Section>('finance');

  const sectionMeta: Record<Section, { label: string; desc: string }> = {
    finance: { label: 'Finance Ops', desc: 'Invoices (AP/AR), dashboard, trial balance' },
    people: { label: 'People Ops', desc: 'Employees, hiring, department ledger' },
    procurement: { label: 'Procurement Ops', desc: 'Vendor POs, delivery, integrations' },
    apqc: { label: 'APQC / BPMN', desc: 'Projector coverage, BPMN task runs, OCEL events (ADR-0025)' }
  };

  type ApqcL1Row = {
    apqcCode: string;
    name: string;
    registered: boolean;
    subProcesses: number;
    bpmnTasks: number;
    ocelEvents: number;
  };

  let apqcCoverage = $state<{
    registeredL1: number;
    totalL1: number;
    registeredSubProcesses: number;
    totalSubProcesses: number;
    boundBpmnTasks: number;
    byL1: ApqcL1Row[];
  } | null>(null);

  let apqcPeriod = $state(`${new Date().getFullYear()}-01-01/${new Date().getFullYear()}-12-31`);
  let bpmnRunTaskId = $state('bpmn-9-journal-post');

  // Invoice form
  let direction = $state<'receivable' | 'payable'>('receivable');
  let counterparty = $state('Sample Customer KK');
  let itemJson = $state(
    '[{"description":"ERP subscription","quantity":1,"unitPrice":120000,"taxRate":0.1}]'
  );

  // Employee form
  let employeeName = $state('山田 太郎');
  let employeeDept = $state('hr');
  let employeePos = $state('HRBP');
  let employeeSalary = $state(6500000);

  // PO form
  let poVendor = $state('Sample Vendor Inc.');
  let poItems = $state('[{"description":"Notebook PC","quantity":20,"unitPrice":132000}]');

  async function run(kind: string, payload: Record<string, unknown>, method: 'GET' | 'POST' = 'POST') {
    ui.loading = true;
    try {
      const r = await callXrpc(kind, payload, method);
      ui.setResult(r);
      return r;
    } finally {
      ui.loading = false;
    }
  }

  function parseItems(json: string): unknown[] {
    const v = JSON.parse(json);
    if (!Array.isArray(v)) throw new Error('items must be a JSON array');
    return v;
  }

  async function submitInvoice() {
    try {
      await run(nsid.createInvoice, {
        direction,
        counterparty,
        items: parseItems(itemJson),
        currency: 'JPY'
      });
    } catch (e) {
      ui.logActivity(`✗ invalid JSON: ${String(e)}`);
    }
  }

  async function submitEmployee() {
    await run(nsid.registerEmployee, {
      name: employeeName,
      department: employeeDept,
      position: employeePos,
      salaryAnnual: employeeSalary,
      currency: 'JPY'
    });
  }

  async function loadApqcCoverage() {
    const r = await run(nsid.getApqcCoverage, { period: apqcPeriod }, 'GET');
    const resp = r.response as Record<string, unknown> | undefined;
    if (r.ok && resp?.byL1) {
      apqcCoverage = {
        registeredL1: Number(resp.registeredL1 ?? 0),
        totalL1: Number(resp.totalL1 ?? 13),
        registeredSubProcesses: Number(resp.registeredSubProcesses ?? 0),
        totalSubProcesses: Number(resp.totalSubProcesses ?? 183),
        boundBpmnTasks: Number(resp.boundBpmnTasks ?? 0),
        byL1: (resp.byL1 as ApqcL1Row[]) ?? []
      };
    }
  }

  async function submitPo() {
    try {
      await run(nsid.createPurchaseOrder, {
        vendor: poVendor,
        items: parseItems(poItems),
        currency: 'JPY'
      });
    } catch (e) {
      ui.logActivity(`✗ invalid JSON: ${String(e)}`);
    }
  }
</script>

<div class="flex flex-col gap-4">
  <div class="flex flex-wrap items-center gap-2">
    {#each (['finance', 'people', 'procurement', 'apqc'] as Section[]) as s}
      <button
        type="button"
        class="rounded-full border px-3 py-1.5 text-xs font-semibold transition"
        class:border-etzhayyim-border={section !== s}
        class:text-etzhayyim-secondary={section !== s}
        class:border-transparent={section === s}
        class:bg-etzhayyim-accent={section === s}
        class:text-white={section === s}
        onclick={() => (section = s)}
      >
        #{s}
      </button>
    {/each}
    <span class="ml-auto text-xs text-etzhayyim-muted">{sectionMeta[section].desc}</span>
  </div>

  <div class="grid gap-4 md:grid-cols-2">
    <Card>
      <div class="p-4 flex flex-col gap-3">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-semibold text-etzhayyim-text">Quick Queries</h3>
          <Badge value="XRPC" variant="accent" />
        </div>
        <div class="flex flex-wrap gap-2">
          <Button size="sm" variant="solid-fill"
            onclick={() => run(nsid.dashboard, { period: periodYM() })}>Dashboard</Button>
          <Button size="sm" variant="outline"
            onclick={() => run(nsid.listInvoices, { limit: 20 })}>Invoices</Button>
          <Button size="sm" variant="outline"
            onclick={() => run(nsid.listEmployees, { limit: 20 })}>Employees</Button>
          <Button size="sm" variant="outline"
            onclick={() => run(nsid.listPurchaseOrders, { limit: 20 })}>Purchase Orders</Button>
          <Button size="sm" variant="outline"
            onclick={() => run(nsid.listIntegrationCatalog, { includeApqc: true })}>Integrations</Button>
          <Button size="sm" variant="outline"
            onclick={() => run(nsid.syncIntegrationCatalog, { includeApqc: true })}>Sync</Button>
        </div>
        <p class="text-xs text-etzhayyim-muted">
          period={periodYM()} · dept DIDs: accounting / hr / procurement / inventory / sales
        </p>
      </div>
    </Card>

    {#if section === 'finance'}
      <Card>
        <div class="p-4 flex flex-col gap-3">
          <h3 class="text-sm font-semibold text-etzhayyim-text">Create Invoice</h3>
          <div class="flex flex-col gap-2">
            <span class="text-xs text-etzhayyim-secondary">Direction</span>
            <Select bind:value={direction}>
              <option value="receivable">receivable (AR)</option>
              <option value="payable">payable (AP)</option>
            </Select>
            <span class="text-xs text-etzhayyim-secondary">Counterparty</span>
            <Input bind:value={counterparty} blockSize="md" placeholder="counterparty" />
            <span class="text-xs text-etzhayyim-secondary">Items (JSON)</span>
            <Textarea bind:value={itemJson} rows={4} />
          </div>
          <div>
            <Button size="md" variant="solid-fill" onclick={submitInvoice}>Create Invoice</Button>
          </div>
        </div>
      </Card>
    {/if}

    {#if section === 'people'}
      <Card>
        <div class="p-4 flex flex-col gap-3">
          <h3 class="text-sm font-semibold text-etzhayyim-text">Register Employee</h3>
          <Input bind:value={employeeName} blockSize="md" placeholder="name" />
          <Input bind:value={employeeDept} blockSize="md" placeholder="department" />
          <Input bind:value={employeePos} blockSize="md" placeholder="position" />
          <Input
            bind:value={employeeSalary}
            blockSize="md"
            type="number"
            min="0"
            step="1000"
            placeholder="salaryAnnual"
          />
          <div>
            <Button size="md" variant="solid-fill" onclick={submitEmployee}>Register</Button>
          </div>
        </div>
      </Card>
    {/if}

    {#if section === 'procurement'}
      <Card>
        <div class="p-4 flex flex-col gap-3">
          <h3 class="text-sm font-semibold text-etzhayyim-text">Create Purchase Order</h3>
          <Input bind:value={poVendor} blockSize="md" placeholder="vendor" />
          <Textarea bind:value={poItems} rows={4} />
          <div>
            <Button size="md" variant="solid-fill" onclick={submitPo}>Create PO</Button>
          </div>
        </div>
      </Card>
    {/if}

    {#if section === 'apqc'}
      <Card>
        <div class="p-4 flex flex-col gap-3">
          <div class="flex items-center justify-between">
            <h3 class="text-sm font-semibold text-etzhayyim-text">APQC / BPMN Projector</h3>
            <Badge value="ADR-0025" variant="accent" />
          </div>
          <div class="flex flex-wrap gap-2">
            <Button size="sm" variant="solid-fill"
              onclick={() => run(nsid.initApqcProjector, { scope: 'all' })}>Bootstrap Projector</Button>
            <Button size="sm" variant="outline"
              onclick={() => run(nsid.listApqcActors, { limit: 20 }, 'GET')}>List L1 Actors</Button>
            <Button size="sm" variant="outline"
              onclick={() => run(nsid.listBpmnTasks, { limit: 50 }, 'GET')}>List BPMN Tasks</Button>
            <Button size="sm" variant="outline" onclick={loadApqcCoverage}>Refresh Coverage</Button>
          </div>
          <div class="flex flex-col gap-2">
            <span class="text-xs text-etzhayyim-secondary">OCEL period (from/to)</span>
            <Input bind:value={apqcPeriod} blockSize="md" placeholder="2026-01-01/2026-12-31" />
            <span class="text-xs text-etzhayyim-secondary">BPMN taskId to run</span>
            <Input bind:value={bpmnRunTaskId} blockSize="md" placeholder="bpmn-9-journal-post" />
            <div>
              <Button size="sm" variant="solid-fill"
                onclick={() => run(nsid.runBpmnTask, { taskId: bpmnRunTaskId, input: {} })}>
                Run BPMN Task
              </Button>
            </div>
          </div>
          <p class="text-xs text-etzhayyim-muted">
            Projector: <code>did:web:kyber-projector.etzhayyim.com</code> · 13 L1 path DIDs · 183 sub-processes · 28 BPMN bindings
          </p>
        </div>
      </Card>

      {#if apqcCoverage}
        <Card>
          <div class="p-4 flex flex-col gap-3">
            <div class="flex items-center justify-between">
              <h3 class="text-sm font-semibold text-etzhayyim-text">Coverage</h3>
              <div class="flex gap-2">
                <Chip label={`L1 ${apqcCoverage.registeredL1}/${apqcCoverage.totalL1}`} />
                <Chip label={`Sub ${apqcCoverage.registeredSubProcesses}/${apqcCoverage.totalSubProcesses}`} />
                <Chip label={`BPMN ${apqcCoverage.boundBpmnTasks}`} />
              </div>
            </div>
            <div class="overflow-x-auto">
              <table class="w-full text-xs">
                <thead class="text-etzhayyim-secondary">
                  <tr>
                    <th class="text-left py-1 pr-3">Code</th>
                    <th class="text-left py-1 pr-3">L1 Domain</th>
                    <th class="text-right py-1 pr-3">Sub</th>
                    <th class="text-right py-1 pr-3">BPMN</th>
                    <th class="text-right py-1 pr-3">OCEL</th>
                    <th class="text-center py-1">State</th>
                  </tr>
                </thead>
                <tbody>
                  {#each apqcCoverage.byL1 as row (row.apqcCode)}
                    <tr class="border-t border-etzhayyim-border">
                      <td class="py-1 pr-3 font-mono">{row.apqcCode}</td>
                      <td class="py-1 pr-3">{row.name}</td>
                      <td class="py-1 pr-3 text-right">{row.subProcesses}</td>
                      <td class="py-1 pr-3 text-right">{row.bpmnTasks}</td>
                      <td class="py-1 pr-3 text-right">{row.ocelEvents}</td>
                      <td class="py-1 text-center">
                        <Badge value={row.registered ? 'active' : 'pending'}
                          variant={row.registered ? 'accent' : 'default'} />
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          </div>
        </Card>
      {/if}
    {/if}
  </div>

  <div class="flex flex-wrap gap-2 text-xs">
    <Chip label="journalEntry" />
    <Chip label="invoice" />
    <Chip label="employee" />
    <Chip label="purchaseOrder" />
    <Chip label="inventoryItem" />
    <Chip label="salesOrder" />
  </div>
</div>
