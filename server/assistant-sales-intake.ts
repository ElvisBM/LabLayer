import { deliveryCalendar, saoPauloDay, sellerTurns } from './assistant-calendar';
import { requestCodes } from '../shared/assistant/workflow';

// A sales summary is a proposal for a NEW record only. Never use it to update
// or approve an existing order. Keep the source text intact in the draft.
export function salesSummary(message: string, today = saoPauloDay()) {
  // A seller can recover an old clarification without typing the order again.
  const turns = sellerTurns(message);
  if (turns.length > 1) {
    if (!turns.slice(1).every(s=>/^(?:sim|confirmo|(?:sim[,;]? )?é um (?:único )?pedido)[.!]?$/i.test(s.trim()))) return null;
    message=turns[0];
  }
  const plain = message.replace(/https?:\/\/\S+/gi, '').trim();
  if (!plain || requestCodes(plain).length || /[?]|Pergunta do assistente:|\b(?:cancelar|cancelado|se|talvez|ainda não|não aprov\w*|nao aprov\w*)\b/i.test(plain)) return null;
  const lines = plain.split(/\n+/).map(l => l.trim()).filter(Boolean);
  const header = lines[0].match(/^(?:pedido\s*:\s*)?([1-9]\d{0,5})\s*(?:x\s+)?([^,;]+)(?:[,;]\s*(.+))?$/i);
  if (!header || Number(header[1]) > 100000 || !/[a-zá-ú]/i.test(header[2])) return null;
  const quantity = Number(header[1]), title = header[2].trim();
  if (title.length > 150 || /^\d|\b(?:orçamentos?|pedidos?)\b/i.test(title)) return null;
  const split = (header[3] || '').split(/\s*[,;]\s*/);
  const approved = /^(?:j[áa]\s+)?aprovad[oa](?:\s+(?:para|pra)\s+(?:produzir|produ[çc][ãa]o))?[.!]?$/i;
  const statusTokens = [...split,...lines.slice(1)];
  const queued = statusTokens.some(s => approved.test(s));
  const priced = statusTokens.some(s => /^(?:j[áa] )?or[çc]ado[.!]?$/i.test(s));
  if (!queued && !priced) return null;
  if (lines.slice(1).some(s => /^\d+\s+(?:x\s*)?[a-zá-ú]/i.test(s))) return null;
  const client = /(?:^|[,;\n])\s*cliente\s*:\s*([^,;\n]+)/i.exec(plain)?.[1].trim() ||
    (split[0] && !approved.test(split[0]) && /^[\p{L}][\p{L}\p{M}'’ .-]{0,119}$/u.test(split[0]) && !/or[çc]ado/i.test(split[0]) ? split[0] : '');
  const prices = [...plain.matchAll(/(?:^|[,;\n])\s*(cada|valor unitário|preço unitário|valor total|total)\s*[:=]?\s*(?:R\$\s*)?(\d+(?:[.,]\d{1,2})?)(?=\s*(?:[,;\n]|$))/gi)];
  const price = prices.length === 1 ? Number(prices[0][2].replace(',','.')) : undefined;
  const unit = price !== undefined && !/total/i.test(prices[0][1]);
  const total = price === undefined ? undefined : Math.round(price*100) * (unit ? quantity : 1)/100;
  const deliveryLines = lines.filter(l=>/^(?:entregar|entrega|prazo)\b/i.test(l));
  const calendar = deliveryLines.length===1 ? deliveryCalendar(deliveryLines[0].replace(/^(entrega|prazo)\s*:\s*/i,'Entrega '),today) : null;
  return {
    draft:{title,customerName:client,quantity,provisionalQuantity:false,description:message},
    stage:{status:queued?'fila-producao':'orcado',quotedPrice:total,unitPrice:unit?price:undefined,
      deliveryDate:calendar && ['future','today'].includes(calendar.state)?calendar.iso:''}
  };
}
