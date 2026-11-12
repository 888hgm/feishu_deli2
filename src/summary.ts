import { cellText, nodeHeaders, sortedMonths, unique, validateConfig, columns, isLowRate, type Config, type Field, type Milestone } from './model.ts';
import { addQuantity, skuQuantity, formatQuantity } from './quantity.ts';
export interface RecordItem { recordId: string; fields: Record<string, unknown> }
export interface NodeStats {
  plan: number; actual: number; completed: number; unfinished: number;
  validRecords: number; blankStatus: number; otherStatus: number; rate: number | null;
}
export interface SummaryRow { month: string; company: string; kind: 'company' | 'subtotal'; records: number; cells: NodeStats[] }
export interface Summary {
  months: string[]; companies: string[]; nodes: Milestone[]; rows: SummaryRow[]; subtotals: SummaryRow[];
  readRecords: number; includedRecords: number; missingMonth: number; missingCompany: number;
  otherStatus: number; blankStatus: number; zeroSkuRecords: number; excludedProjectStatus: number;
}
export interface Choices { months: string[]; companies: string[] }
export function matchesProjectStatus(record: RecordItem, config: Config): boolean {
  if (!config.projectStatusOnly) return true;
  const status = cellText(record.fields[config.projectStatusFieldId]);
  return status === '进行中' || status === '延期';
}
export function getChoices(records: RecordItem[], config: Config, fields: Field[]): Choices {
  records = records.filter(record => matchesProjectStatus(record, config));
  const monthOptions = fields.find(f => f.id === config.monthFieldId)?.options ?? [];
  const companyOptions = fields.find(f => f.id === config.companyFieldId)?.options ?? [];
  return {
    months: sortedMonths(unique([...monthOptions, ...records.map(r => cellText(r.fields[config.monthFieldId])), ...config.months]), config.monthSort),
    companies: unique([...companyOptions, ...records.map(r => cellText(r.fields[config.companyFieldId])), ...config.companies]),
  };
}
function emptyStats(): NodeStats { return { plan: 0, actual: 0, completed: 0, unfinished: 0, validRecords: 0, blankStatus: 0, otherStatus: 0, rate: null }; }
function setRate(cell: NodeStats) {
  const denominator = addQuantity(cell.completed, cell.unfinished);
  cell.rate = denominator > 0 ? cell.completed / denominator : null;
}
export function summarize(records: RecordItem[], config: Config, choices: Choices, fields?: Field[]): Summary {
  const invalid = validateConfig(config, fields);
  if (invalid) throw new Error(invalid);
  const months = sortedMonths(config.monthMode === 'picked' ? config.months : choices.months, config.monthSort);
  const companies = unique(config.companyMode === 'picked' ? config.companies : choices.companies);
  const nodes = config.nodes.filter(n => n.enabled), rows: SummaryRow[] = [];
  const groups = new Map<string, Map<string, SummaryRow>>();
  for (const month of months) {
    const group = new Map<string, SummaryRow>(); groups.set(month, group);
    for (const company of companies) {
      const row: SummaryRow = { month, company, kind: 'company', records: 0, cells: nodes.map(emptyStats) };
      rows.push(row); group.set(company, row);
    }
  }
  let missingMonth = 0, missingCompany = 0, includedRecords = 0, otherStatus = 0, blankStatus = 0, zeroSkuRecords = 0, excludedProjectStatus = 0;
  const seen = new Set<string>(), metricName = fields?.find(f => f.id === config.skuFieldId)?.name ?? 'SKU数量';
  for (const record of records) {
    if (seen.has(record.recordId)) continue;
    seen.add(record.recordId);
    // 项目状态先筛选，排除记录不参与分组、节点统计、SKU校验及完成率。
    if (!matchesProjectStatus(record, config)) { excludedProjectStatus++; continue; }
    const month = cellText(record.fields[config.monthFieldId]), company = cellText(record.fields[config.companyFieldId]);
    if (!month) missingMonth++;
    if (!company) missingCompany++;
    if (!month || !company) continue;
    const row = groups.get(month)?.get(company);
    if (!row) continue;
    includedRecords++; row.records++;
    let quantity: number | undefined;
    nodes.forEach((node, i) => {
      const stats = row.cells[i], status = cellText(record.fields[node.statusFieldId]);
      if (!status) { stats.blankStatus++; blankStatus++; return; }
      // 状态非空是参与前提；时间内容只影响数量，不影响完成率分子、分母。
      if (quantity === undefined) {
        quantity = config.statistic === 'sku' ? skuQuantity(record.fields[config.skuFieldId], metricName) : 1;
        if (config.statistic === 'sku' && quantity === 0) zeroSkuRecords++;
      }
      stats.validRecords++;
      const plan = cellText(record.fields[node.planFieldId]), actual = cellText(record.fields[node.actualFieldId]);
      if (plan !== '/' && plan !== '／') stats.plan = addQuantity(stats.plan, quantity);
      if (actual !== '' && actual !== '/' && actual !== '／') stats.actual = addQuantity(stats.actual, quantity);
      if (status === '完成') stats.completed = addQuantity(stats.completed, quantity);
      else if (status === '未完成') stats.unfinished = addQuantity(stats.unfinished, quantity);
      else { stats.otherStatus++; otherStatus++; }
    });
  }
  for (const row of rows) for (const cell of row.cells) setRate(cell);
  const subtotals: SummaryRow[] = months.map(month => {
    const total: SummaryRow = { month, company: '合计', kind: 'subtotal', records: 0, cells: nodes.map(emptyStats) };
    for (const row of groups.get(month)?.values() ?? []) {
      total.records += row.records;
      row.cells.forEach((cell, i) => {
        const target = total.cells[i];
        for (const key of ['plan', 'actual', 'completed', 'unfinished'] as const) target[key] = addQuantity(target[key], cell[key]);
        target.validRecords += cell.validRecords; target.blankStatus += cell.blankStatus; target.otherStatus += cell.otherStatus;
      });
    }
    // 先合并分子、分母，不平均各公司已经计算或四舍五入的百分比。
    for (const cell of total.cells) setRate(cell);
    return total;
  });
  return { months, companies, nodes, rows, subtotals, readRecords: seen.size, includedRecords, missingMonth, missingCompany, otherStatus, blankStatus, zeroSkuRecords, excludedProjectStatus };
}
export function displayRows(summary: Summary, config: Config): SummaryRow[] {
  if (!summary.companies.length) return [];
  const byMonth = new Map<string, SummaryRow[]>();
  for (const row of summary.rows) { const items = byMonth.get(row.month) ?? []; items.push(row); byMonth.set(row.month, items); }
  const totals = new Map(summary.subtotals.map(row => [row.month, row]));
  return summary.months.flatMap(month => [
    ...(config.showMonthlyTotal && totals.has(month) ? [totals.get(month)!] : []), ...(byMonth.get(month) ?? []),
  ]);
}
export function formatRate(rate: number | null, decimals: number): string { return rate === null ? '—' : `${(rate * 100).toFixed(decimals)}%`; }
export const escapeHTML = (v: unknown) => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export function tableHTML(summary: Summary, config: Config): string {
  const rows = displayRows(summary, config);
  if (!rows.length) return '<div class="empty-state">当前范围没有可展示的月份或产品公司，请检查配置。</div>';
  const e = escapeHTML, specs = columns(config), unit = config.statistic === 'sku' ? 'SKU' : '条';
  const resizeHandle = (index: number) => {
    const column = specs[index];
    return `<span class="column-resizer" data-column-key="${e(column.key)}" role="separator" tabindex="0" aria-orientation="vertical" aria-label="调整${e(column.label)}列宽" aria-valuenow="${column.width}" aria-valuemin="${column.min}" aria-valuemax="${column.max}" aria-valuetext="${column.width} 像素" title="拖动调整列宽；双击恢复该列默认宽度"></span>`;
  };
  const blockSize = summary.companies.length + (config.showMonthlyTotal ? 1 : 0);
  return `<table class="summary-table" style="width:${specs.reduce((sum, c) => sum + c.width, 0)}px;--month-width:${specs[0].width}px;--company-width:${specs[1].width}px;font-size:${config.fontSize}px" aria-label="关键节点完成汇总表"><colgroup>${specs.map(c => `<col style="width:${c.width}px">`).join('')}</colgroup><thead><tr><th class="month-col">${e(config.monthLabel || '上市时间')}${resizeHandle(0)}</th><th class="company-col">${e(config.companyLabel || '产品公司')}${resizeHandle(1)}</th>${summary.nodes.map((n, nodeIndex) => nodeHeaders(n).map((h, i) => `<th class="${i === 2 ? 'node-end' : ''}">${e(h)}${resizeHandle(2 + nodeIndex * 3 + i)}</th>`).join('')).join('')}</tr></thead><tbody>${rows.map((row, i) => `<tr data-row-kind="${row.kind}" class="${i % blockSize === 0 ? 'month-start' : ''}${row.kind === 'subtotal' ? ' monthly-total' : ''}">${i % blockSize === 0 ? `<th scope="rowgroup" class="month-col" rowspan="${blockSize}">${e(row.month)}</th>` : ''}<th scope="row" class="company-col">${e(row.company)}</th>${row.cells.map(s => `<td>${formatQuantity(s.plan)}</td><td>${formatQuantity(s.actual)}</td><td class="node-end${isLowRate(s.rate, config) ? ' low-rate' : ''}" title="${row.kind === 'subtotal' ? '所选公司汇总；' : ''}完成 ${formatQuantity(s.completed)} ${unit}，未完成 ${formatQuantity(s.unfinished)} ${unit}；分母 ${formatQuantity(s.completed + s.unfinished)}；状态非空 ${s.validRecords} 条${s.blankStatus ? `；排除空白状态 ${s.blankStatus} 条` : ''}${s.otherStatus ? `；另有 ${s.otherStatus} 条其他状态未参与完成率` : ''}">${formatRate(s.rate, config.decimals)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
export function csvCell(value: string | number): string {
  let text = String(value);
  if (/^[\s]*[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
export function exportCSV(summary: Summary, config: Config): string {
  const rows: (string | number)[][] = [[config.title],
    [config.monthLabel || '上市时间', config.companyLabel || '产品公司', ...summary.nodes.flatMap(nodeHeaders)],
    ...displayRows(summary, config).map(row => [row.month, row.company, ...row.cells.flatMap(s => [formatQuantity(s.plan), formatQuantity(s.actual), formatRate(s.rate, config.decimals)])])];
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}
