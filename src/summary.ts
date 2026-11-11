import { cellText, isValidTime, nodeHeaders, sortedMonths, unique, validateConfig, type Config, type Field, type Milestone } from './model.ts';
export interface RecordItem { recordId: string; fields: Record<string, unknown> }
export interface NodeStats { plan: number; actual: number; completed: number; unfinished: number; otherStatus: number; rate: number | null }
export interface SummaryRow { month: string; company: string; records: number; cells: NodeStats[] }
export interface Summary {
  months: string[]; companies: string[]; nodes: Milestone[]; rows: SummaryRow[];
  readRecords: number; includedRecords: number; missingMonth: number; missingCompany: number; otherStatus: number;
}
export interface Choices { months: string[]; companies: string[] }
export function getChoices(records: RecordItem[], config: Config, fields: Field[]): Choices {
  const monthOptions = fields.find(f => f.id === config.monthFieldId)?.options ?? [];
  const companyOptions = fields.find(f => f.id === config.companyFieldId)?.options ?? [];
  return {
    months: sortedMonths(unique([...monthOptions, ...records.map(r => cellText(r.fields[config.monthFieldId])), ...config.months]), config.monthSort),
    companies: unique([...companyOptions, ...records.map(r => cellText(r.fields[config.companyFieldId])), ...config.companies]),
  };
}
export function summarize(records: RecordItem[], config: Config, choices: Choices): Summary {
  const invalid = validateConfig(config);
  if (invalid) throw new Error(invalid);
  const months = sortedMonths(config.monthMode === 'picked' ? config.months : choices.months, config.monthSort);
  const companies = unique(config.companyMode === 'picked' ? config.companies : choices.companies);
  const nodes = config.nodes.filter(n => n.enabled), rows: SummaryRow[] = [];
  const groups = new Map<string, Map<string, SummaryRow>>();
  for (const month of months) {
    const group = new Map<string, SummaryRow>(); groups.set(month, group);
    for (const company of companies) {
      const row = { month, company, records: 0, cells: nodes.map(() => ({ plan: 0, actual: 0, completed: 0, unfinished: 0, otherStatus: 0, rate: null })) };
      rows.push(row); group.set(company, row);
    }
  }
  let missingMonth = 0, missingCompany = 0, includedRecords = 0, otherStatus = 0;
  const seen = new Set<string>();
  for (const record of records) {
    if (seen.has(record.recordId)) continue;
    seen.add(record.recordId);
    const month = cellText(record.fields[config.monthFieldId]), company = cellText(record.fields[config.companyFieldId]);
    if (!month) missingMonth++;
    if (!company) missingCompany++;
    if (!month || !company) continue;
    const row = groups.get(month)?.get(company);
    if (!row) continue;
    includedRecords++; row.records++;
    nodes.forEach((node, i) => {
      const stats = row.cells[i];
      if (isValidTime(record.fields[node.planFieldId])) stats.plan++;
      if (isValidTime(record.fields[node.actualFieldId])) stats.actual++;
      const status = cellText(record.fields[node.statusFieldId]);
      if (status === '完成') stats.completed++;
      else if (status === '未完成') stats.unfinished++;
      else if (status) { stats.otherStatus++; otherStatus++; }
    });
  }
  for (const row of rows) for (const cell of row.cells) {
    const denominator = cell.completed + cell.unfinished;
    cell.rate = denominator ? cell.completed / denominator : null;
  }
  return { months, companies, nodes, rows, readRecords: seen.size, includedRecords, missingMonth, missingCompany, otherStatus };
}
export function formatRate(rate: number | null, decimals: number): string { return rate === null ? '—' : `${(rate * 100).toFixed(decimals)}%`; }
export const escapeHTML = (v: unknown) => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export function tableHTML(summary: Summary, config: Config): string {
  if (!summary.rows.length) return '<div class="empty-state">当前范围没有可展示的月份或产品公司，请检查配置。</div>';
  const e = escapeHTML;
  return `<table class="summary-table" style="width:${112 + 190 + summary.nodes.length * 3 * 144}px;font-size:${config.fontSize}px" aria-label="关键节点完成汇总表"><colgroup><col style="width:112px"><col style="width:190px">${summary.nodes.map(() => '<col style="width:144px"><col style="width:144px"><col style="width:144px">').join('')}</colgroup><thead><tr><th class="month-col">${e(config.monthLabel || '上市时间')}</th><th class="company-col">${e(config.companyLabel || '产品公司')}</th>${summary.nodes.map(n => nodeHeaders(n).map((h, i) => `<th class="${i === 2 ? 'node-end' : ''}">${e(h)}</th>`).join('')).join('')}</tr></thead><tbody>${summary.rows.map((row, i) => `<tr class="${i % summary.companies.length === 0 ? 'month-start' : ''}">${i % summary.companies.length === 0 ? `<th scope="rowgroup" class="month-col" rowspan="${summary.companies.length}">${e(row.month)}</th>` : ''}<th scope="row" class="company-col">${e(row.company)}</th>${row.cells.map(s => `<td>${s.plan}</td><td>${s.actual}</td><td class="node-end" title="完成 ${s.completed} 条，未完成 ${s.unfinished} 条；分母 ${s.completed + s.unfinished}${s.otherStatus ? `；另有 ${s.otherStatus} 条其他状态未参与` : ''}">${formatRate(s.rate, config.decimals)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
// 防止公司名、标题等文本被 Excel 当作公式执行；CSV 导出不改变源表。
export function csvCell(value: string | number): string {
  let text = String(value);
  if (/^[\s]*[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
export function exportCSV(summary: Summary, config: Config): string {
  const rows: (string | number)[][] = [[config.title],
    [config.monthLabel || '上市时间', config.companyLabel || '产品公司', ...summary.nodes.flatMap(nodeHeaders)],
    ...summary.rows.map(row => [row.month, row.company, ...row.cells.flatMap(s => [s.plan, s.actual, formatRate(s.rate, config.decimals)])])];
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}
