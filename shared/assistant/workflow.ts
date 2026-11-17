import { optionTotal, publicCustomerQuote } from '../requests/quote';

const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export function requestCodes(text: string): string[] {
  return [...new Set([...text.matchAll(/\bORC\s*[-#]?\s*0*(\d+)\b/gi)].map(m => String(Number(m[1]))))];
}
// Recognize only explicit, positive approval messages with one unambiguous
// quantity. The caller still asks the seller to review price and delivery.
export function approvedQuantityFromNote(message: string): number | null {
  if (message.length > 2000 || message.includes('?')) return null;
  const normalized = normalize(message);
  if (/\b(?:nao|ainda|se|talvez|quando|cancel\w*|revog\w*|aguardando|exemplo|teste)\b/.test(normalized) ||
      !/\b(?:aprovad[oa]|autorizad[oa]|liberad[oa]|confirmad[oa])\b/.test(normalized)) return null;
  const matches = [...normalized.matchAll(/\b(?:apenas|somente|so)\s+(\d{1,6}|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez)\s+(?:unidade(?:s)?|peca(?:s)?|un)\b/g)];
  if (matches.length !== 1) return null;
  const word = matches[0][1];
  const spelled: Record<string, number> = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10 };
  const quantity = /^\d+$/.test(word) ? Number(word) : spelled[word];
  return Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= 100000 ? quantity : null;
}

export function matchesRequestQuery(query: string, values: string[]) {
  const codes = requestCodes(query);
  if (codes.length) return codes.length === 1 && values.some(v => requestCodes(v).includes(codes[0]));
  const clean = (s: string) => normalize(s).replace(/[^a-z0-9]+/g, ' ').trim();
  const tokens = clean(query).split(/\s+/).filter(Boolean), haystack = clean(values.join(' '));
  return tokens.length > 0 && tokens.every(t => haystack.includes(t));
}
export function matchesApprovalReference(query: string, values: string[]) {
  if (requestCodes(query).length) return matchesRequestQuery(query, values);
  const words = (s: string) => normalize(s).replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  const tokens = words(query), haystack = new Set(words(values.join(' ')));
  return tokens.length > 0 && tokens.every(token => haystack.has(token));
}
export type ProductionCommand = { code: string | null; paid: boolean; quantity?: number; deliveryDate?: string; personalization: { quantity: number; name: string }[] };

export function validDeliveryDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^(20\d{2}|2100)-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// Fast path for established explicit commands. Other wording is interpreted by the server-side AI approval flow.
export function parseProductionCommand(message: string): ProductionCommand | null {
  const normalized = normalize(message);
  if (/[?]/.test(message) || /\b(nao|ainda|se|talvez|aguardando|cancel\w*|estorn\w*|exemplo|teste)\b/.test(normalized)) return null;
  const codes = requestCodes(message);
  if (codes.length > 1) return null;
  const lines = message.trim().split(/\n/).map(s => s.trim()).filter(Boolean);
  let first = normalize(lines[0] || '').replace(/^\s*(?:#{1,3}\s*)?orc\s*[-#]?\s*0*\d+\b/, '');
  first = first.replace(/[,.:;!—–-]/g, ' ').replace(/\s+/g, ' ').trim();
  const approval = normalize(message.trim()).match(/^(?:orc\s*[-#]?\s*0*\d+\s+)?aprovado\s*[,;]\s*(\d+)\s+(?:quantidade|unidades?|pecas?)\s*[,;]\s*entregar\s+dia\s+(\d{2})\/(\d{2})\/(\d{4})[.!]?$/);
  if (approval) {
    const quantity = Number(approval[1]);
    const [, , day, month, year] = approval;
    const deliveryDate = `${year}-${month}-${day}`;
    const date = new Date(`${deliveryDate}T12:00:00Z`);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100000 || Number(year) < 2000 || Number(year) > 2100 || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== deliveryDate) return null;
    return { code: codes[0] || null, paid: false, quantity, deliveryDate, personalization: [] };
  }
  const match = first.match(/^(?:(pago|pagamento confirmado|aprovado)\s+(?:e\s+)?)?(?:pode produzir|pode ir para (?:a )?fila de producao|(?:colocar|mover) (?:para |na )(?:a )?fila de producao)$/);
  if (!match) return null;
  const personalization: ProductionCommand['personalization'] = [];
  for (const line of lines.slice(1)) {
    const m = line.match(/^(\d+)\s+(?:unidades?\s+)?com\s+(?:o\s+)?nome\s*:\s*(.+)$/i);
    if (m) {
      const quantity = Number(m[1]), name = m[2].trim();
      if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100000 || name.length > 120 || /^\d/.test(name)) return null;
      personalization.push({ quantity, name });
    } else return null;
  }
  return { code: codes[0] || null, paid: ['pago', 'pagamento confirmado'].includes(match[1]), personalization };
}

export type WorkflowChange = { field: string; before: string | number | boolean; after: string | number | boolean };
export function productionUpdate(row: any, command: ProductionCommand, now: string) {
  if (!['orcado', 'fila-producao'].includes(row.status)) throw Error('Somente pedidos orçados ou já na fila podem receber este comando. Confira o andamento atual.');
  if (command.deliveryDate !== undefined && !validDeliveryDate(command.deliveryDate)) throw Error('Data de entrega inválida. Informe uma data real.');
  const patch: Record<string, unknown> = { status: 'fila-producao', approvedAt: row.approvedAt || now, updatedAt: now };
  if (command.paid) patch.paidAt = row.paidAt || now;
  if (command.deliveryDate) patch.requestedDeliveryDate = command.deliveryDate;
  if (command.quantity !== undefined || command.personalization.length) {
    const quantity = command.quantity ?? command.personalization.reduce((sum, item) => sum + item.quantity, 0);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100000) throw Error('Quantidade total inválida.');
    if (command.personalization.length && command.quantity !== undefined && quantity !== command.personalization.reduce((sum, item) => sum + item.quantity, 0)) throw Error('Quantidade e distribuição dos nomes divergem.');
    const option = publicCustomerQuote(row.customerQuote)?.options.find(o => o.quantity === quantity);
    if (quantity !== row.requestedQuantity) {
      if (!option || option.unitPrice <= 0) throw Error('A quantidade informada não tem uma opção de preço cadastrada. Confira o orçamento antes de liberar a produção.');
      patch.requestedQuantity = quantity;
    }
    if (!row.isGift && option && option.unitPrice > 0) patch.quotedPrice = optionTotal(option);
    if (row.provisionalQuantity) patch.provisionalQuantity = false;
  }
  if (command.quantity === undefined && !command.personalization.length && row.provisionalQuantity) throw Error('Confirme a quantidade antes de aprovar este orçamento.');
  const changes: WorkflowChange[] = Object.entries(patch).filter(([field, value]) => field !== 'updatedAt' && (row[field] ?? '') !== value)
    .map(([field, value]) => ({ field, before: row[field] ?? '', after: value as string | number | boolean }));
  return { patch, changes };
}
