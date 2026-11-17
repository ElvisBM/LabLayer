export function requestNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : null;
  if (typeof value !== 'string') return null;
  const digits = value.trim().match(/^(?:ORC\s*-?\s*)?(\d+)$/i)?.[1];
  const number = digits ? Number(digits) : NaN;
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}
export function existingRequestNumber(row: { code?: unknown; requestNumber?: unknown; title?: unknown; id?: unknown }): number | null {
  return requestNumber(row.code) ?? requestNumber(row.requestNumber)
    ?? requestNumber(typeof row.title === 'string' ? row.title.match(/\bORC\s*-?\s*\d+\b/i)?.[0] : null)
    ?? requestNumber(typeof row.id === 'string' && /^ORC\s*-?\s*\d+$/i.test(row.id) ? row.id : null);
}
export const formatRequestCode = (number: number) => `ORC-${String(number).padStart(3, '0')}`;
export function requestCode(row: Parameters<typeof existingRequestNumber>[0]) {
  const number = existingRequestNumber(row);
  return number == null ? undefined : formatRequestCode(number);
}
export const withoutRequestCode = (title: string) => title.replace(/^\s*ORC\s*-?\s*\d+\b\s*[-—–·:]?\s*/i, '').trim();

export type RequestSortDirection = 'asc' | 'desc';
export function compareRequestNumbers(
  a: Parameters<typeof existingRequestNumber>[0] & { id: string },
  b: Parameters<typeof existingRequestNumber>[0] & { id: string },
  direction: RequestSortDirection,
) {
  const left = existingRequestNumber(a), right = existingRequestNumber(b);
  if (left !== right) {
    if (left === null) return 1;
    if (right === null) return -1;
    return direction === 'asc' ? left - right : right - left;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export type RequestListSort = RequestSortDirection | 'delivery-asc' | 'delivery-desc';
type SortableRequest = Parameters<typeof compareRequestNumbers>[0] & { requestedDeliveryDate?: unknown };
export function compareRequestList(a: SortableRequest, b: SortableRequest, sort: RequestListSort) {
  if (sort === 'asc' || sort === 'desc') return compareRequestNumbers(a, b, sort);
  const day = (v: unknown) => typeof v === 'string' ? /^\d{4}-\d{2}-\d{2}(?=$|T)/.exec(v)?.[0] : undefined;
  const left = day(a.requestedDeliveryDate), right = day(b.requestedDeliveryDate);
  if (left === right) return compareRequestNumbers(a, b, 'asc');
  if (!left) return 1;
  if (!right) return -1;
  return (left < right ? -1 : 1) * (sort === 'delivery-asc' ? 1 : -1);
}
