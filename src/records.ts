import type { Field } from './model.ts';
import type { RecordItem } from './summary.ts';
export interface RecordPage { records: RecordItem[]; hasMore: boolean; pageToken?: number }
export interface ReadableTable {
  getFieldMetaList(): Promise<{ id: string; name: string; property?: unknown }[]>;
  getActiveView?(): Promise<{ getFieldMetaList(): Promise<{ id: string; name: string }[]> }>;
  getRecordsByPage(params: { pageSize: number; stringValue: boolean; pageToken?: number }): Promise<RecordPage>;
}
export async function readFields(table: ReadableTable): Promise<Field[]> {
  const metas = await table.getFieldMetaList();
  let order = metas.map(f => f.id);
  try {
    const view = await table.getActiveView?.();
    if (view) order = [...(await view.getFieldMetaList()).map(f => f.id), ...order];
  } catch { /* 某些仪表盘上下文没有活动视图，保留字段元信息顺序。 */ }
  return [...new Set(order)].flatMap(id => {
    const field = metas.find(f => f.id === id);
    if (!field) return [];
    const property = field.property as { options?: { name?: unknown }[] } | undefined;
    return [{ id: field.id, name: field.name, options: Array.isArray(property?.options) ? property.options.flatMap(o => typeof o.name === 'string' ? [o.name] : []) : [] }];
  });
}
export async function readRecords(table: ReadableTable, signal?: AbortSignal, progress?: (count: number) => void): Promise<RecordItem[]> {
  const records = new Map<string, RecordItem>(), tokens = new Set<number>();
  let pageToken: number | undefined;
  while (true) {
    signal?.throwIfAborted();
    const page = await table.getRecordsByPage({ pageSize: 200, stringValue: true, ...(pageToken === undefined ? {} : { pageToken }) });
    signal?.throwIfAborted();
    if (!page || !Array.isArray(page.records) || typeof page.hasMore !== 'boolean') throw new Error('飞书返回的分页数据格式不正确，请刷新重试');
    for (const record of page.records) {
      if (!record || typeof record.recordId !== 'string' || !record.recordId || !record.fields || typeof record.fields !== 'object' || Array.isArray(record.fields)) throw new Error('飞书返回了无法读取的记录');
      // 同一条记录在分页边界重复时只统计一次。
      if (!records.has(record.recordId)) records.set(record.recordId, record);
    }
    progress?.(records.size);
    if (!page.hasMore) return [...records.values()];
    if (typeof page.pageToken !== 'number' || !Number.isFinite(page.pageToken) || tokens.has(page.pageToken)) throw new Error('分页标记异常，请重试；本次不展示不完整统计');
    tokens.add(page.pageToken); pageToken = page.pageToken;
  }
}
