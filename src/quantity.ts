import { cellText } from './model.ts';
export function skuQuantity(value: unknown, fieldName = 'SKU数量'): number {
  if (value === null || value === undefined) return 0;
  let text: string;
  try { text = cellText(value).replaceAll('，', ','); }
  catch { throw new Error(`“${fieldName}”包含不可读取的 SKU 数量`); }
  if (!text) return 0;
  if (text.includes(',')) {
    if (!/^[+]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(text)) throw new Error(`“${fieldName}”包含无效数字，请检查源表`);
    text = text.replaceAll(',', '');
  }
  if (!/^[+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) throw new Error(`“${fieldName}”必须为非负数字，请检查源表`);
  const number = Number(text);
  if (!Number.isFinite(number) || number < 0) throw new Error(`“${fieldName}”必须为非负数字，请检查源表`);
  return number;
}
export function addQuantity(total: number, value: number): number {
  const next = total + value;
  if (!Number.isFinite(next)) throw new Error('SKU 数量合计超出可用数值范围，请检查源表');
  return next;
}
export function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(12)));
}
