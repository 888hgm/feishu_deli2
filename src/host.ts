import { defaultConfig, hydrateConfig, type Config, type TableMeta } from './model.ts';
import { readFields, readRecords } from './records.ts';
type SDK = typeof import('@lark-base-open/js-sdk');
let sdk: SDK;
const tables = new Map<string, ReturnType<SDK['bitable']['base']['getTableById']>>();
export const isFeishu = window.parent !== window || new URLSearchParams(location.search).get('mode') === 'feishu';
function tableById(id: string) {
  let promise = tables.get(id);
  if (!promise) {
    promise = sdk.bitable.base.getTableById(id).catch(error => { tables.delete(id); throw error; });
    tables.set(id, promise);
  }
  return promise;
}
export async function connect(): Promise<{ config: Config; tables: TableMeta[]; viewing: boolean; creating: boolean; saved: boolean }> {
  sdk = await import('@lark-base-open/js-sdk');
  const { dashboard, base } = sdk.bitable;
  const creating = dashboard.state === 'Create', viewing = ['View', 'FullScreen'].includes(dashboard.state);
  // 创建阶段尚无组件配置，不能调用 getConfig。
  const saved = creating ? undefined : (await dashboard.getConfig()).customConfig?.milestoneTable;
  const config = saved ? hydrateConfig(saved) : defaultConfig();
  const metas = viewing ? [] : await base.getTableMetaList();
  if (!saved && metas.length) config.tableId = metas[0].id;
  return { config, tables: metas, viewing, creating, saved: !!saved };
}
export async function readTable(id: string, signal: AbortSignal, progress: (count: number) => void) {
  const table = await tableById(id);
  signal.throwIfAborted();
  const fields = await readFields(table);
  const records = await readRecords(table, signal, progress);
  return { fields, records };
}
export async function saveConfig(config: Config): Promise<void> {
  const success = await sdk.bitable.dashboard.saveConfig({
    // 只提交一个月份分组作数据源声明，所有节点在完整记录上分别计算。
    dataConditions: [{ tableId: config.tableId, dataRange: { type: sdk.SourceType.ALL },
      groups: [{ fieldId: config.monthFieldId, mode: sdk.GroupMode.INTEGRATED,
        sort: { sortType: sdk.DATA_SOURCE_SORT_TYPE.VIEW } }], series: 'COUNTA' }],
    customConfig: { milestoneTable: structuredClone(config) },
  });
  if (!success) throw new Error('飞书未确认保存成功，请重试');
}
let recordStops: (() => void)[] = [], watchSequence = 0;
export async function watchTable(id: string, refresh: () => void): Promise<void> {
  const sequence = ++watchSequence;
  recordStops.forEach(stop => stop()); recordStops = [];
  if (!id) return;
  const table = await tableById(id);
  if (sequence !== watchSequence) return;
  for (const method of ['onRecordAdd', 'onRecordDelete', 'onRecordModify', 'onFieldAdd', 'onFieldDelete', 'onFieldModify'] as const) {
    try { recordStops.push(table[method](refresh)); } catch { /* 仍可手动刷新及定时刷新。 */ }
  }
}
export function subscribe(onData: () => void, onConfig: (config: Config) => void): () => void {
  const { dashboard } = sdk.bitable;
  const stops = [dashboard.onDataChange(onData), dashboard.onConfigChange(event => {
    onConfig(hydrateConfig(event.data.customConfig?.milestoneTable));
  })];
  const periodic = setInterval(() => { if (document.visibilityState !== 'hidden') onData(); }, 30000);
  return () => { ++watchSequence; stops.forEach(stop => stop()); recordStops.forEach(stop => stop()); clearInterval(periodic); };
}
export async function syncTheme(): Promise<() => void> {
  const { dashboard } = sdk.bitable;
  const apply = (theme: Awaited<ReturnType<typeof dashboard.getTheme>>) => {
    document.documentElement.dataset.theme = theme.theme === 'DARK' ? 'dark' : 'light';
  };
  apply(await dashboard.getTheme());
  return dashboard.onThemeChange(event => apply(event.data));
}
export async function rendered(): Promise<void> { await sdk.bitable.dashboard.setRendered(); }
