// Resolve a single delivery day using civil dates, never the provider's clock.
import { validDeliveryDate } from '../shared/assistant/workflow';
const months = 'janeiro fevereiro marco abril maio junho julho agosto setembro outubro novembro dezembro'.split(' ');
const clean = (s:string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
export const saoPauloDay = (now = new Date()) => new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo'}).format(now);

export function sellerTurns(message:string) {
  return message.split('\n\nPergunta do assistente:\n').map((part,i) => i ? part.split('\n\nResposta do vendedor:\n').slice(1).join('\n') : part).filter(Boolean);
}
export function deliveryCalendar(message:string, today = saoPauloDay()) {
  const turns = sellerTurns(message).map(clean);
  const text = turns.join('\n');
  const monthList = months.join('|');
  // Never guess between competing milestones or override a correction/relative month.
  if (/\b(?:proximo|seguinte|anterior|passado|adiar|antecipar|corrigindo)\b|\b(?:em|daqui a)\s+\d+\s+dias/.test(text)) return null;
  const dayPattern = new RegExp('(?:\\bdia\\s+|\\b(?:entrega(?:r)?|prazo|para)\\s+(?:ate\\s+)?(?:o\\s+)?(?:dia\\s+)?|^\\s*)([0-3]?\\d)(?!\\d)(?=\\s|[.,!?;:/-]|$)(?:[/.-](\\d{1,2})(?:[/.-](\\d{4}))?|\\s+de\\s+('+monthList+')(?:\\s+de\\s+(\\d{4}))?)?', 'gm');
  if (/\b(?:ou|entre)\s+(?:o\s+)?(?:dia\s+)?\d|\b(?:dia\s+)?\d{1,2}\s*(?:a|até|ate|-)\s*\d/.test(text)) return null;
  const matches=[...text.matchAll(dayPattern)].filter(m => !/^\s*(?:unidades?|pecas?|chaveiros?|reais|dias|horas)\b/.test(text.slice(m.index!+m[0].length)));
  if (!matches.length || new Set(matches.map(m=>Number(m[1]))).size!==1) return null;
  if (matches.some(m=>/\b(?:pagamento|pago|pagar|nasceu|criado|aprovado em)\s*$/.test(text.slice(Math.max(0,m.index!-30),m.index)))) return null;
  if (!/\b(entrega|entregar|prazo)\b/.test(text) && !turns.some(t=>/^\s*(?:para (?:o )?)?dia \d{1,2}\b/.test(t)) && !(/Pergunta do assistente:\n[^\n]*(?:data|mês|entrega)/i.test(message) && /^\d{1,2}(?:$|\/)/.test(turns.at(-1) || '')) && !/\bpara (?:o )?dia\b/.test(text)) return null;
  const day=Number(matches[0][1]);
  const named=[...text.matchAll(new RegExp('\\b('+monthList+')\\b','g'))].map(m=>months.indexOf(m[1])+1);
  const numeric=matches.filter(m=>m[2]).map(m=>Number(m[2]));
  const monthValues=new Set([...named,...numeric]);
  const years=new Set([...text.matchAll(/\b(20\d\d|2100)\b/g)].map(m=>m[1]));
  if(monthValues.size>1 || years.size>1 || /\b\d{4}-\d{2}-\d{2}\b/.test(text) || /\b\d{1,2}\/\d{1,2}\/\d{2}\b/.test(text)) return null;
  const [y,m]=today.split('-');
  const date=[...years][0] || y;
  const iso=date+'-'+String([...monthValues][0] ?? Number(m)).padStart(2,'0')+'-'+String(day).padStart(2,'0');
  return {iso, label:iso.split('-').reverse().join('/'), today, state:!validDeliveryDate(iso) ? 'invalid' : iso<today ? 'past' : iso===today ? 'today' : 'future'} as const;
}
