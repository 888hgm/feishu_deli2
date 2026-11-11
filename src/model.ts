export interface Field { id: string; name: string; options?: string[] }
export interface TableMeta { id: string; name: string }
export interface Milestone {
  id: string; name: string; enabled: boolean;
  planFieldId: string; actualFieldId: string; statusFieldId: string;
  planLabel: string; actualLabel: string; rateLabel: string;
}
export interface Config {
  schemaVersion: 1; title: string; tableId: string; monthFieldId: string; companyFieldId: string;
  monthMode: 'all' | 'picked'; months: string[]; companyMode: 'all' | 'picked'; companies: string[];
  monthSort: 'asc' | 'desc'; nodes: Milestone[];
  monthLabel: string; companyLabel: string; decimals: 0 | 1 | 2; fontSize: 12 | 14 | 16;
  columnWidths: Record<string, number>;
  lowRateEnabled: boolean; lowRateThreshold: number;
}
export function defaultConfig(): Config {
  return { schemaVersion: 1, title: '各产品公司在开项目关键节点完成汇总表', tableId: '', monthFieldId: '', companyFieldId: '',
    monthMode: 'all', months: [], companyMode: 'all', companies: [], monthSort: 'asc', nodes: [],
    monthLabel: '上市时间', companyLabel: '产品公司', decimals: 0, fontSize: 14, columnWidths: {},
    lowRateEnabled: false, lowRateThreshold: 80 };
}
export function newNode(name = ''): Milestone {
  return { id: crypto.randomUUID(), name, enabled: true, planFieldId: '', actualFieldId: '', statusFieldId: '',
    planLabel: name ? `${name}计划完成` : '', actualLabel: name ? `${name}实际完成` : '', rateLabel: '完成率' };
}
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const str = (v: unknown, fallback = '') => typeof v === 'string' ? v : fallback;
const strings = (v: unknown) => Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && !!x.trim()).map(x => x.trim()))] : [];
export function hydrateConfig(value: unknown): Config {
  const raw = object(value), fallback = defaultConfig();
  const usedIds = new Set<string>();
  const nodes = (Array.isArray(raw.nodes) ? raw.nodes : []).map(item => {
    const n = object(item), node = newNode(str(n.name));
    const id = str(n.id, node.id);
    if (!usedIds.has(id)) node.id = id;
    usedIds.add(node.id);
    return { ...node, enabled: n.enabled !== false,
      planFieldId: str(n.planFieldId), actualFieldId: str(n.actualFieldId), statusFieldId: str(n.statusFieldId),
      planLabel: str(n.planLabel), actualLabel: str(n.actualLabel), rateLabel: str(n.rateLabel, '完成率') };
  });
  return { ...fallback, title: str(raw.title, fallback.title), tableId: str(raw.tableId),
    monthFieldId: str(raw.monthFieldId), companyFieldId: str(raw.companyFieldId),
    monthMode: raw.monthMode === 'picked' ? 'picked' : 'all', months: strings(raw.months),
    companyMode: raw.companyMode === 'picked' ? 'picked' : 'all', companies: strings(raw.companies),
    monthSort: raw.monthSort === 'desc' ? 'desc' : 'asc', nodes,
    monthLabel: str(raw.monthLabel, fallback.monthLabel), companyLabel: str(raw.companyLabel, fallback.companyLabel),
    decimals: raw.decimals === 1 || raw.decimals === 2 ? raw.decimals : 0,
    fontSize: raw.fontSize === 12 || raw.fontSize === 16 ? raw.fontSize : 14,
    columnWidths: sanitizeColumnWidths(raw.columnWidths, nodes),
    lowRateEnabled: raw.lowRateEnabled === true,
    lowRateThreshold: typeof raw.lowRateThreshold === 'number' && Number.isFinite(raw.lowRateThreshold) ? Math.max(0, Math.min(100, raw.lowRateThreshold)) : 80 };
}
export function validateConfig(config: Config, fields?: Field[]): string | undefined {
  if (!config.tableId) return '请选择数据表';
  if (!config.monthFieldId || !config.companyFieldId) return '请选择上市时间和产品公司字段';
  if (config.monthFieldId === config.companyFieldId) return '上市时间和产品公司需要选择不同字段';
  if (config.monthMode === 'picked' && !config.months.length) return '请至少勾选一个上市月份';
  if (config.companyMode === 'picked' && !config.companies.length) return '请至少勾选一个产品公司';
  const enabled = config.nodes.filter(n => n.enabled);
  if (!enabled.length) return '请添加并启用至少一个节点';
  for (const node of enabled) {
    if (!node.name.trim()) return '请填写节点名称';
    if (!node.planFieldId || !node.actualFieldId || !node.statusFieldId) return `请为“${node.name}”选择计划、实际和状态三个字段`;
    if (new Set([node.planFieldId, node.actualFieldId, node.statusFieldId]).size !== 3) return `“${node.name}”的三个字段不能相同`;
  }
  if (fields) {
    const required = [config.monthFieldId, config.companyFieldId, ...enabled.flatMap(n => [n.planFieldId, n.actualFieldId, n.statusFieldId])];
    if (required.some(id => !fields.some(f => f.id === id))) return '部分已选字段已删除或不可读，请重新选择字段';
  }
}
export function nodeHeaders(node: Milestone): string[] {
  return [node.planLabel.trim() || `${node.name}计划完成`, node.actualLabel.trim() || `${node.name}实际完成`, node.rateLabel.trim() || '完成率'];
}
export interface Column {
  key: string; label: string; width: number; defaultWidth: number; min: number; max: number;
}
function columnDefaults(nodes: Milestone[]): Column[] {
  return [
    { key: 'month', label: '上市时间', defaultWidth: 112, min: 72, max: 600, width: 112 },
    { key: 'company', label: '产品公司', defaultWidth: 190, min: 100, max: 800, width: 190 },
    ...nodes.flatMap(node => nodeHeaders(node).map((label, i) => ({ key: `node:${node.id}:${['plan', 'actual', 'rate'][i]}`,
      label: `${node.name} / ${label}`, defaultWidth: 144, min: 64, max: 600, width: 144 }))),
  ];
}
export function clampWidth(value: number, column: Column): number {
  return Number.isFinite(value) ? Math.round(Math.max(column.min, Math.min(column.max, value))) : column.defaultWidth;
}
export function sanitizeColumnWidths(value: unknown, nodes: Milestone[]): Record<string, number> {
  const raw = object(value), widths: Record<string, number> = {};
  for (const column of columnDefaults(nodes)) {
    const width = raw[column.key];
    if (Object.hasOwn(raw, column.key) && typeof width === 'number' && Number.isFinite(width)) {
      const valid = clampWidth(width, column);
      if (valid !== column.defaultWidth) widths[column.key] = valid;
    }
  }
  return widths;
}
export function columns(config: Config): Column[] {
  return columnDefaults(config.nodes.filter(n => n.enabled)).map(column => ({ ...column,
    label: column.key === 'month' ? config.monthLabel || '上市时间' : column.key === 'company' ? config.companyLabel || '产品公司' : column.label,
    width: config.columnWidths && Object.hasOwn(config.columnWidths, column.key) ? clampWidth(config.columnWidths[column.key], column) : column.defaultWidth,
  }));
}
export function setColumnWidth(config: Config, key: string, value: number): boolean {
  const column = columns(config).find(c => c.key === key);
  if (!column) return false;
  const next = clampWidth(value, column);
  if (next === column.width) return false;
  if (next === column.defaultWidth) delete config.columnWidths[key];
  else config.columnWidths[key] = next;
  return true;
}
export function isLowRate(rate: number | null, config: Config): boolean {
  if (!config.lowRateEnabled || rate === null || !Number.isFinite(rate)) return false;
  // 29/100 的浮点值乘以 100 可能略小于 29，避免等于阈值时被误标红。
  const tolerance = Math.max(1, Math.abs(config.lowRateThreshold)) * Number.EPSILON * 4;
  return config.lowRateThreshold - rate * 100 > tolerance;
}
export const normalizeName = (v: string) => v.replace(/[\s()（）_\-]/g, '').replace(/时间|日期/g, '');
export function suggestGrouping(config: Config, fields: Field[]): Config {
  return { ...config, monthFieldId: fields.find(f => ['上市时间', '上市月份'].includes(f.name.trim()))?.id ?? '',
    companyFieldId: fields.find(f => f.name.trim() === '产品公司')?.id ?? '' };
}
export function suggestNodes(fields: Field[]): Milestone[] {
  const nodes: Milestone[] = [];
  for (const status of fields) {
    const stem = normalizeName(status.name).replace(/是否已完成$|是否完成$|完成状态$/, '');
    if (!stem || stem === normalizeName(status.name)) continue;
    const n = newNode(stem); n.statusFieldId = status.id;
    n.planFieldId = fields.find(f => normalizeName(f.name) === `${stem}计划完成`)?.id ?? '';
    n.actualFieldId = fields.find(f => normalizeName(f.name) === `${stem}实际完成`)?.id
      ?? fields.find(f => normalizeName(f.name) === `${stem}完成`)?.id ?? '';
    nodes.push(n);
  }
  return nodes;
}
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return String(value).trim();
  if (Array.isArray(value) && value.every(v => v && typeof v.text === 'string')) return value.map(v => v.text).join('').trim();
  if (typeof value === 'object' && value && 'text' in value && typeof value.text === 'string') return value.text.trim();
  throw new Error('所选字段没有返回可读文本，请确认字段读取权限和字段类型');
}
export function isValidTime(value: unknown): boolean { const s = cellText(value); return s !== '' && s !== '/' && s !== '／'; }
export function monthKey(label: string): number | undefined {
  const match = label.match(/^\s*(\d{2}|\d{4})(?:年|[-/.])\s*(\d{1,2})\s*月?\s*$/);
  if (!match) return;
  const year = Number(match[1]) + (match[1].length === 2 ? 2000 : 0), month = Number(match[2]);
  if (month < 1 || month > 12) return;
  return year * 12 + month;
}
const collator = new Intl.Collator('zh-CN', { numeric: true });
export function sortedMonths(values: string[], direction: 'asc' | 'desc'): string[] {
  return [...new Set(values)].sort((a, b) => {
    const ka = monthKey(a), kb = monthKey(b);
    const cmp = ka !== undefined && kb !== undefined ? ka - kb || collator.compare(a, b) :
      ka !== undefined ? -1 : kb !== undefined ? 1 : collator.compare(a, b);
    return direction === 'desc' ? -cmp : cmp;
  });
}
export const unique = (values: string[]) => [...new Set(values.map(v => v.trim()).filter(Boolean))];
