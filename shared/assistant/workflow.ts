import { optionTotal, publicCustomerQuote } from '../requests/quote';

const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export function requestCodes(text: string): string[] {
  return [...new Set([...text.matchAll(/\bORC\s*[-#]?\s*0*(\d+)\b/gi)].map(m => String(Number(m[1]))))];
}
export function matchesRequestQuery(query: string, values: string[]) {
  const codes = requestCodes(query);
  if (codes.length) return codes.length === 1 && values.some(v => requestCodes(v).includes(codes[0]));
  const clean = (s: string) => normalize(s).replace(/[^a-z0-9]+/g, ' ').trim();
  const tokens = clean(query).split(/\s+/).filter(Boolean), haystack = clean(values.join(' '));
  return tokens.length > 0 && tokens.every(t => haystack.includes(t));
}
export type ProductionCommand = { code: string | null; paid: boolean; personalization: { quantity: number; name: string }[] };

// Narrow, deterministic grammar. AI output and attachment text never authorize a workflow change.
export function parseProductionCommand(message: string): ProductionCommand | null {
  const normalized = normalize(message);
  if (/[?]/.test(message) || /\b(nao|ainda|se|talvez|aguardando|cancel\w*|estorn\w*|exemplo|teste)\b/.test(normalized)) return null;
  const codes = requestCodes(message);
  if (codes.length > 1) return null;
  const lines = message.trim().split(/\n/).map(s => s.trim()).filter(Boolean);
  let first = normalize(lines[0] || '').replace(/^\s*(?:#{1,3}\s*)?orc\s*[-#]?\s*0*\d+\b/, '');
  first = first.replace(/[,.:;!—–-]/g, ' ').replace(/\s+/g, ' ').trim();
  const match = first.match(/^(?:(pago|pagamento confirmado|aprovado)\s+(?:e\s+)?)?(?:pode produzir|pode ir para (?:a )?fila de producao|(?:colocar|mover) (?:para |na )(?:a )?fila de producao)$/);
  if (!match) return null;
  const personalization: ProductionCommand['personalization'] = [];
  for (const line of lines.slice(1)) {
    const m = line.match(/^(\d+)\s+(?:unidades?\s+)?com\s+(?:o\s+)?nome\s*:\s*(.+)$/i);
    if (m) {
      const quantity = Number(m[1]), name = m[2].trim();
      if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100000 || name.length > 120 || /^\d/.test(name)) return null;
      personalization.push({ quantity, name });
    } else if (/\d.*\b(nome|unidades?|pecas?|peças?)\b/i.test(line)) return null;
  }
  return { code: codes[0] || null, paid: ['pago', 'pagamento confirmado'].includes(match[1]), personalization };
}

export type WorkflowChange = { field: string; before: string | number; after: string | number };
export function productionUpdate(row: any, command: ProductionCommand, now: string) {
  if (!['orcado', 'fila-producao'].includes(row.status)) throw Error('Somente pedidos orçados ou já na fila podem receber este comando. Confira o andamento atual.');
  const patch: Record<string, unknown> = { status: 'fila-producao', approvedAt: row.approvedAt || now, updatedAt: now };
  if (command.paid) patch.paidAt = row.paidAt || now;
  if (command.personalization.length) {
    const quantity = command.personalization.reduce((sum, item) => sum + item.quantity, 0);
    if (quantity > 100000) throw Error('Quantidade total excede o limite.');
    if (quantity !== row.requestedQuantity) {
      const option = publicCustomerQuote(row.customerQuote)?.options.find(o => o.quantity === quantity);
      if (!option) throw Error('A quantidade informada não tem uma opção de preço cadastrada. Confira o orçamento antes de liberar a produção.');
      patch.requestedQuantity = quantity;
      patch.quotedPrice = optionTotal(option);
    }
  }
  const changes: WorkflowChange[] = Object.entries(patch).filter(([field, value]) => field !== 'updatedAt' && (row[field] ?? '') !== value)
    .map(([field, value]) => ({ field, before: row[field] ?? '', after: value as string | number }));
  return { patch, changes };
}
