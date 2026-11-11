import './style.css';
import { defaultConfig, newNode, suggestGrouping, suggestNodes, validateConfig, type Config, type Field, type TableMeta, type Milestone } from './model.ts';
import { getChoices, summarize, tableHTML, exportCSV, escapeHTML as e, type RecordItem, type Choices, type Summary } from './summary.ts';
import * as host from './host.ts';

let config = defaultConfig(), fields: Field[] = [], tables: TableMeta[] = [], records: RecordItem[] = [];
let choices: Choices = { months: [], companies: [] }, summary: Summary | undefined;
let viewing = false, creating = false, ready = false, loading = false, saving = false, error = '';
let closed = false, tab = 'data', savedJSON = '', loadedTableId = '', initialSuggestions = false;
let controller: AbortController | undefined, sequence = 0, refreshTimer: ReturnType<typeof setTimeout>, toastTimer: ReturnType<typeof setTimeout>;
let picker: { node: number; key: 'planFieldId' | 'actualFieldId' | 'statusFieldId' } | { key: 'monthFieldId' | 'companyFieldId' } | undefined;
let batch = false, batchSelected = new Set<string>(), batchSuggestions: Milestone[] = [];
let returnFocus: HTMLElement | null = null;
const root = document.querySelector<HTMLDivElement>('#app')!;
root.innerHTML = `<header class="topbar"><div class="identity"><span class="app-icon" aria-hidden="true">▦</span><div><strong>关键节点完成汇总表</strong><small>独立仪表盘插件 · v1.0.0</small></div><span id="state" role="status">连接中</span></div><div class="actions"><button data-action="refresh" disabled>刷新数据</button><button data-action="export" disabled>导出 CSV</button><button data-action="panel" disabled>配置</button><button data-action="save" class="primary top-save" hidden>添加到仪表盘</button></div></header>
<div class="workspace"><main class="report"><div class="report-heading"><div><span class="eyebrow">项目节点 / 月度汇总</span><h1 id="report-title"></h1><p class="description">按上市月份、产品公司汇总 · 各节点独立统计</p></div></div><div class="summary-meta"><span id="source-note">等待连接飞书</span><span id="updated"></span></div><div id="message" class="message" role="status"></div><div id="grid" class="grid" tabindex="0" aria-label="汇总表，可横向和纵向滚动" hidden></div><footer class="report-footer"><span id="totals"></span><span>时间字段排除空白与单独的 /；完成率 = 完成 ÷（完成 + 未完成）</span></footer><div id="quality-note" class="quality-note" hidden></div></main><aside class="sidebar" aria-label="汇总表配置"><div class="sidebar-heading"><strong>汇总表配置</strong><button class="icon-button" data-action="panel" aria-label="收起配置">×</button></div><nav class="tabs"><button data-action="tab" data-tab="data">数据范围</button><button data-action="tab" data-tab="nodes">节点字段</button><button data-action="tab" data-tab="appearance">表格设置</button></nav><div id="panel" class="panel"></div><footer class="panel-footer"><span id="save-status"></span><button data-action="save" class="primary">保存配置</button></footer></aside></div><dialog id="picker-dialog" aria-labelledby="picker-title"><div class="dialog-heading"><h2 id="picker-title"></h2><button class="icon-button" data-action="dialog-close" aria-label="关闭字段选择">×</button></div><input id="field-search" class="search" type="search" aria-label="搜索字段" placeholder="输入字段名称搜索"><div id="picker-list" class="picker-list"></div><footer id="picker-footer" class="dialog-footer"></footer></dialog><div class="toast" role="status" hidden></div>`;
const q = <T extends HTMLElement = HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
const dialog = q<HTMLDialogElement>('#picker-dialog');
function toast(text: string) { q('.toast').textContent = text; q('.toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { q('.toast').hidden = true; }, 4500); }
function setState(text: string) { q('#state').textContent = text; }
function saveState() {
  const dirty = JSON.stringify(config) !== savedJSON;
  q('#save-status').textContent = saving ? '提交中…' : dirty ? '有未保存的更改' : '配置已保存';
  q('#save-status').classList.toggle('dirty', dirty);
  root.querySelectorAll<HTMLButtonElement>('[data-action=save]').forEach(b => { b.disabled = !ready || saving || loading || !!error; b.textContent = saving ? '提交中…' : creating ? '添加到仪表盘' : '保存配置'; });
  q('.top-save').hidden = !creating || viewing;
  q<HTMLButtonElement>('[data-action=export]').disabled = !summary || loading || !!error;
}
function message(text: string, isError = false) { q('#message').textContent = text; q('#message').hidden = !text; q('#message').classList.toggle('error', isError); }
function renderReport() {
  q('#report-title').textContent = config.title.trim() || '关键节点完成汇总表';
  q('#source-note').textContent = loadedTableId ? (tables.find(t => t.id === loadedTableId)?.name ?? '当前多维表数据') : '等待选择数据表';
  summary = undefined; q('#grid').hidden = true; q('#totals').textContent = ''; q('#quality-note').hidden = true;
  if (!ready) { saveState(); return; }
  if (loading) { saveState(); return; }
  if (error) { message(error, true); saveState(); return; }
  choices = getChoices(records, config, fields);
  const invalid = validateConfig(config, fields);
  if (invalid) { message(invalid); setState('等待配置'); saveState(); return; }
  try {
    summary = summarize(records, config, choices);
    q('#grid').innerHTML = tableHTML(summary, config); q('#grid').hidden = false; message('');
    q('#totals').textContent = `${summary.months.length} 个月份 · ${summary.companies.length} 家公司 · ${summary.nodes.length} 个节点 · 当前范围 ${summary.includedRecords} 条记录`;
    const notes: string[] = [];
    if (summary.missingMonth) notes.push(`${summary.missingMonth} 条记录未填写上市时间`);
    if (summary.missingCompany) notes.push(`${summary.missingCompany} 条记录未填写产品公司`);
    if (summary.otherStatus) notes.push(`${summary.otherStatus} 个非空状态值既非“完成”也非“未完成”，未计入完成率`);
    if (notes.length) { q('#quality-note').hidden = false; q('#quality-note').textContent = notes.join('；') + '。'; }
    setState('已更新');
  } catch (err) { error = errorText(err); message(error, true); setState('读取失败'); }
  saveState();
}
function fieldButton(key: string, label: string, value: string, node?: number) {
  const field = fields.find(f => f.id === value);
  return `<div class="field"><span>${e(label)}</span><button class="field-button ${value && !field ? 'invalid' : ''}" data-action="pick" data-key="${key}" ${node === undefined ? '' : `data-node="${node}"`} title="${e(field?.name ?? '')}"><span>${e(field?.name ?? (value ? '字段已删除，请重选' : '点击选择字段'))}</span><span aria-hidden="true">⌄</span></button></div>`;
}
function textInput(key: string, label: string, value: string, placeholder = '') {
  return `<label class="field"><span>${e(label)}</span><input data-key="${key}" value="${e(value)}" placeholder="${e(placeholder)}" maxlength="240"></label>`;
}
function selection(kind: 'month' | 'company', label: string, options: string[]) {
  const mode = kind === 'month' ? config.monthMode : config.companyMode;
  const selected = kind === 'month' ? config.months : config.companies;
  return `<section class="section"><div class="section-title">${label}</div><div class="segmented"><button data-action="range-mode" data-kind="${kind}" data-mode="all" aria-pressed="${mode === 'all'}">全部</button><button data-action="range-mode" data-kind="${kind}" data-mode="picked" aria-pressed="${mode === 'picked'}">勾选范围</button></div>${mode === 'picked' ? `<div class="selection-actions"><button class="link" data-action="select-all" data-kind="${kind}">全选</button><button class="link" data-action="select-none" data-kind="${kind}">清空</button></div><div class="selection-list">${options.map(v => `<label class="check"><input type="checkbox" data-selection="${kind}" data-value="${e(v)}" ${selected.includes(v) ? 'checked' : ''}><span>${e(v)}</span></label>`).join('') || '<p class="hint">选择分组字段并读取数据后显示选项</p>'}</div>` : `<p class="hint">当前 ${options.length} 个选项；新出现的${kind === 'month' ? '月份' : '公司'}会自动加入。</p>`}${kind === 'company' ? `<p class="hint">所有月份都保留所选公司，没有记录时显示 0、0、—。${mode === 'picked' ? '下方可调整公司顺序。' : '公司顺序沿用源表选项／记录首次出现的顺序。'}</p>${mode === 'picked' ? orderList(config.companies, 'company') : ''}` : ''}</section>`;
}
function orderList(items: string[], kind: string) {
  return `<div class="order-list">${items.map((name, i) => `<div><span>${i + 1}. ${e(name)}</span><button data-action="move" data-kind="${kind}" data-index="${i}" data-step="-1" aria-label="上移${e(name)}" ${i === 0 ? 'disabled' : ''}>↑</button><button data-action="move" data-kind="${kind}" data-index="${i}" data-step="1" aria-label="下移${e(name)}" ${i === items.length - 1 ? 'disabled' : ''}>↓</button></div>`).join('')}</div>`;
}
function renderPanel() {
  if (viewing) return;
  const scrollTop = q('#panel').scrollTop;
  const openNodes = new Set([...root.querySelectorAll<HTMLDetailsElement>('.node-card[open]')].map(el => el.dataset.nodeId));
  root.querySelectorAll<HTMLElement>('[data-action=tab]').forEach(b => { b.classList.toggle('active', b.dataset.tab === tab); b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false'); });
  let html = '';
  if (tab === 'data') html = `<section class="section"><label class="field"><span>数据表</span><select id="table-select" aria-label="数据表"><option value="">请选择数据表</option>${tables.map(t => `<option value="${e(t.id)}" ${config.tableId === t.id ? 'selected' : ''}>${e(t.name)}</option>`).join('')}</select></label>${fieldButton('monthFieldId', '上市月份字段', config.monthFieldId)}${fieldButton('companyFieldId', '产品公司字段', config.companyFieldId)}<p class="hint">读取当前用户有权访问的全表记录。上市时间用于分组，节点日期只判断是否有效。本版使用下方范围选择，不跟随仪表盘外层筛选。</p></section>${selection('month', '上市月份范围', choices.months)}${selection('company', '产品公司范围', choices.companies)}`;
  if (tab === 'nodes') html = `<section class="section"><div class="section-title">统计节点 <span>${config.nodes.filter(n => n.enabled).length} / ${config.nodes.length}</span></div><p class="hint">每个节点对应三列。勾选启用后展示；可为每列选择不同的源字段，并修改显示名称。</p><div class="node-actions"><button class="primary" data-action="batch">批量选择节点</button><button data-action="add-node">＋ 手动添加</button></div></section><div class="node-list">${config.nodes.map((n, i) => `<details class="node-card" data-node-id="${e(n.id)}" ${openNodes.has(n.id) || !n.planFieldId || !n.actualFieldId || !n.statusFieldId ? 'open' : ''}><summary><label class="check"><input type="checkbox" data-node-enabled="${i}" ${n.enabled ? 'checked' : ''} aria-label="启用${e(n.name || `节点${i + 1}`)}"></label><span class="node-name">${e(n.name || `节点 ${i + 1}`)}</span><span class="node-marker">${n.planFieldId && n.actualFieldId && n.statusFieldId ? '已映射' : '待选字段'}</span></summary><div class="node-body"><label class="field"><span>节点名称</span><input data-node="${i}" data-node-key="name" value="${e(n.name)}" maxlength="80" placeholder="例如：产品设计"></label>${fieldButton('planFieldId', '计划完成时间字段', n.planFieldId, i)}${fieldButton('actualFieldId', '实际完成时间字段', n.actualFieldId, i)}${fieldButton('statusFieldId', '是否完成字段', n.statusFieldId, i)}<div class="header-labels"><span class="section-title">表头显示名称</span>${(['planLabel', 'actualLabel', 'rateLabel'] as const).map((k, j) => `<label class="field"><span>${['计划数量列', '实际数量列', '完成率列'][j]}</span><input data-node="${i}" data-node-key="${k}" value="${e(n[k])}" placeholder="${e(j === 2 ? '完成率' : `${n.name}${j === 0 ? '计划完成' : '实际完成'}`)}" maxlength="120"></label>`).join('')}</div><div class="node-bottom"><button data-action="move" data-kind="node" data-index="${i}" data-step="-1" ${!i ? 'disabled' : ''}>上移</button><button data-action="move" data-kind="node" data-index="${i}" data-step="1" ${i === config.nodes.length - 1 ? 'disabled' : ''}>下移</button><button class="danger" data-action="remove-node" data-index="${i}">移除节点</button></div></div></details>`).join('') || '<div class="panel-empty">先点击“批量选择节点”，根据“是否完成”字段勾选需要的节点；字段名称不同也可手动添加。</div>'}</div>`;
  if (tab === 'appearance') html = `<section class="section">${textInput('title', '汇总表标题', config.title)}${textInput('monthLabel', '月份列表头', config.monthLabel, '上市时间')}${textInput('companyLabel', '公司列表头', config.companyLabel, '产品公司')}<label class="field"><span>月份排序</span><select data-key="monthSort"><option value="asc" ${config.monthSort === 'asc' ? 'selected' : ''}>时间从早到晚</option><option value="desc" ${config.monthSort === 'desc' ? 'selected' : ''}>时间从晚到早</option></select></label><label class="field"><span>完成率小数位</span><select data-key="decimals">${[0, 1, 2].map(n => `<option value="${n}" ${n === config.decimals ? 'selected' : ''}>${n} 位小数</option>`).join('')}</select></label><label class="field"><span>表格字号</span><select data-key="fontSize">${[12, 14, 16].map(n => `<option value="${n}" ${n === config.fontSize ? 'selected' : ''}>${n}px</option>`).join('')}</select></label></section><section class="section"><div class="section-title">统计与展示口径</div><p class="hint">计划和实际数量：只排除空白、单独的 / 或 ／；其他非空内容均计为 1。<br><br>完成率：仅识别去掉首尾空格后的“完成”和“未完成”。分母为 0 时显示 —。<br><br>所有数值使用统一颜色；不随完成率变色。<br><br>日期无需与上市月份一致。源表仅被读取，修改表头不会修改源字段。</p></section>`;
  q('#panel').innerHTML = html; q('#panel').scrollTop = scrollTop;
  saveState();
}
function rangeChanged() { if (loadedTableId === config.tableId) error = ''; choices = getChoices(records, config, fields); renderReport(); renderPanel(); }
function errorText(err: unknown) { return err instanceof Error ? err.message : String(err); }
async function loadTable(autoSuggest = false) {
  if (!ready) return;
  clearTimeout(refreshTimer);
  const request = ++sequence; controller?.abort(); controller = new AbortController();
  const signal = controller.signal, id = config.tableId;
  loading = true; error = ''; summary = undefined; message('正在读取完整记录…'); setState('读取中'); renderReport();
  if (!id) { records = []; fields = []; loadedTableId = ''; choices = { months: [], companies: [] }; loading = false; renderPanel(); renderReport(); return; }
  try {
    const result = await host.readTable(id, signal, count => { if (request === sequence) message(`正在读取记录…已读取 ${count} 条`); });
    if (request !== sequence) return;
    records = result.records; fields = result.fields; loadedTableId = id;
    if (autoSuggest) { config = suggestGrouping(config, fields); initialSuggestions = false; }
    choices = getChoices(records, config, fields);
    loading = false; q('#updated').textContent = `更新于 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`;
    renderPanel(); renderReport();
    await host.watchTable(id, queueRefresh);
  } catch (err) {
    if (request !== sequence || signal.aborted) return;
    loading = false; records = []; loadedTableId = ''; error = `读取数据失败：${errorText(err)}`;
    setState('读取失败'); renderPanel(); renderReport();
  }
  if (request === sequence) void host.rendered().catch(() => {});
}
function queueRefresh() { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => { void loadTable(); }, 350); }
function closeDialog() { dialog.close(); picker = undefined; batch = false; returnFocus?.focus(); }
function openDialog(title: string) {
  returnFocus = document.activeElement as HTMLElement;
  q('#picker-title').textContent = title; q<HTMLInputElement>('#field-search').value = '';
  dialog.showModal(); renderPicker(); q('#field-search').focus();
}
function renderPicker() {
  const search = q<HTMLInputElement>('#field-search').value.trim().toLowerCase();
  if (batch) {
    const existing = new Set(config.nodes.map(n => n.statusFieldId));
    q('#picker-list').innerHTML = batchSuggestions.filter(n => n.name.toLowerCase().includes(search) || fields.find(f => f.id === n.statusFieldId)?.name.toLowerCase().includes(search)).map(n => `<label class="batch-item ${existing.has(n.statusFieldId) ? 'muted' : ''}"><input type="checkbox" data-batch-field="${e(n.statusFieldId)}" ${batchSelected.has(n.statusFieldId) || existing.has(n.statusFieldId) ? 'checked' : ''} ${existing.has(n.statusFieldId) ? 'disabled' : ''}><span><strong>${e(n.name)}</strong><small>${existing.has(n.statusFieldId) ? '已添加' : n.planFieldId && n.actualFieldId ? '已找到计划、实际和状态字段，添加后请核对' : '添加后需补选计划或实际字段'}</small></span></label>`).join('') || '<p class="hint">没有匹配的“是否完成”字段，可关闭后手动添加节点。</p>';
    q('#picker-footer').innerHTML = `<span id="batch-count">已选 ${batchSelected.size} 个新节点</span><button data-action="dialog-close">取消</button><button class="primary" data-action="batch-apply" ${!batchSelected.size ? 'disabled' : ''}>添加所选节点</button>`;
  } else {
    q('#picker-list').innerHTML = `<button class="field-choice clear-field" data-action="choose-field" data-id="">清除选择</button>${fields.filter(f => f.name.toLowerCase().includes(search)).map(f => `<button class="field-choice" data-action="choose-field" data-id="${e(f.id)}">${e(f.name)}</button>`).join('') || '<p>无匹配字段</p>'}`;
    q('#picker-footer').innerHTML = '<span class="hint">选择后返回配置，源表字段名称保持不变。</span>';
  }
}
root.addEventListener('click', async event => {
  const b = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (!b || b instanceof HTMLButtonElement && b.disabled) return;
  const action = b.dataset.action;
  if (action === 'panel') { closed = !closed; root.classList.toggle('panel-closed', closed); }
  if (action === 'tab') { tab = b.dataset.tab!; q('#panel').scrollTop = 0; renderPanel(); }
  if (action === 'refresh') void loadTable();
  if (action === 'add-node') { config.nodes.push(newNode()); renderPanel(); renderReport(); }
  if (action === 'remove-node') { config.nodes.splice(Number(b.dataset.index), 1); renderPanel(); renderReport(); }
  if (action === 'range-mode') {
    const kind = b.dataset.kind!;
    if (kind === 'month') { config.monthMode = b.dataset.mode as Config['monthMode']; if (!config.months.length) config.months = [...choices.months]; }
    else { config.companyMode = b.dataset.mode as Config['companyMode']; if (!config.companies.length) config.companies = [...choices.companies]; }
    rangeChanged();
  }
  if (action === 'select-all' || action === 'select-none') {
    const kind = b.dataset.kind!;
    if (kind === 'month') config.months = action === 'select-all' ? [...choices.months] : [];
    else config.companies = action === 'select-all' ? [...choices.companies] : [];
    rangeChanged();
  }
  if (action === 'move') {
    const list: (string | Milestone)[] = b.dataset.kind === 'company' ? config.companies : config.nodes;
    const index = Number(b.dataset.index), next = index + Number(b.dataset.step);
    if (next >= 0 && next < list.length) [list[index], list[next]] = [list[next], list[index]];
    renderPanel(); renderReport();
  }
  if (action === 'pick') {
    if (loading || !fields.length) { toast('请先选择可读取的数据表'); return; }
    picker = b.dataset.node === undefined ? { key: b.dataset.key as 'monthFieldId' | 'companyFieldId' } : { key: b.dataset.key as 'planFieldId' | 'actualFieldId' | 'statusFieldId', node: Number(b.dataset.node) };
    batch = false; openDialog('选择源表字段');
  }
  if (action === 'choose-field' && picker) {
    if ('node' in picker) config.nodes[picker.node][picker.key] = b.dataset.id!;
    else {
      config[picker.key] = b.dataset.id!;
      if (picker.key === 'monthFieldId') { config.months = []; config.monthMode = 'all'; }
      else { config.companies = []; config.companyMode = 'all'; }
    }
    closeDialog(); rangeChanged();
  }
  if (action === 'batch') {
    if (!fields.length || loading) { toast('请先选择可读取的数据表'); return; }
    batch = true; picker = undefined; batchSelected = new Set(); batchSuggestions = suggestNodes(fields); openDialog('批量选择节点');
  }
  if (action === 'batch-apply') {
    config.nodes.push(...batchSuggestions.filter(n => batchSelected.has(n.statusFieldId)));
    closeDialog(); renderPanel(); renderReport();
  }
  if (action === 'dialog-close') closeDialog();
  if (action === 'save') {
    const invalid = validateConfig(config, fields);
    if (invalid) { toast(invalid); return; }
    const snapshot = structuredClone(config); saving = true; saveState();
    try { await host.saveConfig(snapshot); savedJSON = JSON.stringify(snapshot); creating = false; toast('配置已保存，可在仪表盘中查看'); }
    catch (err) { toast(`保存失败：${errorText(err)}`); }
    finally { saving = false; saveState(); }
  }
  if (action === 'export' && summary) {
    const url = URL.createObjectURL(new Blob([exportCSV(summary, config)], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a'); a.href = url; a.download = `${(config.title || '关键节点完成汇总表').replace(/[\\/:*?"<>|]/g, '_')}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
});
root.addEventListener('input', event => {
  const input = event.target as HTMLInputElement;
  if (input.id === 'field-search') { renderPicker(); return; }
  if (input.dataset.nodeKey) {
    const node = config.nodes[Number(input.dataset.node)];
    node[input.dataset.nodeKey as 'name' | 'planLabel' | 'actualLabel' | 'rateLabel'] = input.value;
    if (input.dataset.nodeKey === 'name') input.closest('.node-card')?.querySelector('.node-name')?.replaceChildren(input.value || '未命名节点');
    renderReport(); return;
  }
  if (input instanceof HTMLInputElement && input.dataset.key && input.type !== 'checkbox') {
    const key = input.dataset.key as 'title' | 'monthLabel' | 'companyLabel'; config[key] = input.value; renderReport();
  }
});
root.addEventListener('change', event => {
  const input = event.target as HTMLInputElement | HTMLSelectElement;
  if (input.id === 'table-select') {
    config.tableId = input.value; config.monthFieldId = ''; config.companyFieldId = ''; config.nodes = [];
    config.months = []; config.companies = []; config.monthMode = 'all'; config.companyMode = 'all';
    fields = []; records = []; choices = { months: [], companies: [] }; loadedTableId = ''; renderPanel();
    void host.watchTable('', queueRefresh); void loadTable(true); return;
  }
  if (input.dataset.batchField) {
    const id = input.dataset.batchField;
    if ((input as HTMLInputElement).checked) batchSelected.add(id); else batchSelected.delete(id);
    q('#batch-count').textContent = `已选 ${batchSelected.size} 个新节点`; q<HTMLButtonElement>('[data-action=batch-apply]').disabled = !batchSelected.size; return;
  }
  if (input.dataset.nodeEnabled !== undefined) { config.nodes[Number(input.dataset.nodeEnabled)].enabled = (input as HTMLInputElement).checked; renderReport(); return; }
  if (input.dataset.selection) {
    const list = input.dataset.selection === 'month' ? config.months : config.companies, value = input.dataset.value!;
    if ((input as HTMLInputElement).checked && !list.includes(value)) list.push(value);
    else if (!(input as HTMLInputElement).checked) list.splice(list.indexOf(value), 1);
    rangeChanged(); return;
  }
  if (input instanceof HTMLSelectElement && input.dataset.key) {
    if (input.dataset.key === 'decimals') config.decimals = Number(input.value) as Config['decimals'];
    if (input.dataset.key === 'fontSize') config.fontSize = Number(input.value) as Config['fontSize'];
    if (input.dataset.key === 'monthSort') config.monthSort = input.value as Config['monthSort'];
    rangeChanged();
  }
});
dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) closeDialog(); } });
async function boot() {
  q('#report-title').textContent = config.title;
  if (!host.isFeishu) {
    closed = true; root.classList.add('panel-closed'); setState('等待连接');
    message('请在飞书多维表格的仪表盘中添加本插件。独立浏览器页面无法读取源表；上传包内含发布说明。');
    return;
  }
  try {
    const session = await host.connect();
    config = session.config; tables = session.tables; viewing = session.viewing; creating = session.creating;
    savedJSON = session.saved ? JSON.stringify(config) : ''; initialSuggestions = !session.saved; ready = true;
    root.classList.toggle('viewing', viewing); root.classList.toggle('panel-closed', viewing); closed = viewing;
    q<HTMLButtonElement>('[data-action=panel]').hidden = viewing;
    q<HTMLButtonElement>('[data-action=panel]').disabled = false; q<HTMLButtonElement>('[data-action=refresh]').disabled = false;
    renderPanel();
    void host.syncTheme().catch(() => {});
    await loadTable(initialSuggestions);
    host.subscribe(queueRefresh, next => { config = next; savedJSON = JSON.stringify(next); if (dialog.open) closeDialog(); renderPanel(); void loadTable(); });
  } catch (err) {
    error = `连接飞书失败：${errorText(err)}`; message(error, true); setState('连接失败');
    // 保留重试入口，避免临时鉴权或网络失败只能重新添加组件。
    const button = q<HTMLButtonElement>('[data-action=refresh]'); button.disabled = false;
    button.addEventListener('click', () => { if (!ready) void boot(); });
  }
}
void boot();
