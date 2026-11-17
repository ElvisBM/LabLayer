import { priceFromOrderMessage, quoteTiersFromMessage } from '../../../shared/requests/quote';
import { compareRequestList, type RequestListSort } from '../../../shared/requests/number';
import { clearAssistantMedia, loadAssistantAsset } from './asset-loader';
import { useEffect, useRef, useState } from 'react';
import { ArrowDownNarrowWide, ArrowUpWideNarrow, Bot, Check, ChevronRight, Info, Paperclip, Plus, RefreshCw, Search, Send, Sparkles } from 'lucide-react';
import { AssistantOrderDetail } from './AssistantOrderDetail';
import { AssistantStatusConfirmation, type StatusPayload } from './AssistantStatusUpdate';
import { assistantStatuses as statusLabels, canCancelAssistantOrder } from '../../../shared/assistant/status';
import { AssistantOrderCard, ProductionConfirmation, money, orderHeading, type AssistantOrder } from './AssistantOrderCard';
import './AssistantChat.css';
import type { Intake } from '../../../shared/assistant/model';
import { canConfirmQuestion, clarificationMessage, type Clarification } from './conversation';
import { approvedQuantityFromNote, requestCodes } from '../../../shared/assistant/workflow';

import { Files, type Attachment } from './AssistantFiles';
export { Files } from './AssistantFiles';
type ChatMessage = { id: string; role: "user" | "assistant"; text: string; files?: Attachment[]; transcript?: string; kind?: "question" | "success" };
const field =
  "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-900";
const button =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-700 px-4 py-3 font-semibold text-white disabled:opacity-50";
const secondary =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-slate-700 disabled:opacity-50";
async function api(token: string, path: string, body?: unknown) {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) throw Object.assign(Error(data.error || "Não foi possível concluir."), { status: response.status });
  return data;
}
function historicalUnitPrice(notes: any[]): number | null {
  for (const note of [...notes].reverse()) {
    const values = [...String(note.message || '').matchAll(/R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2}|\d+(?:,\d{2})?)\s+cada\b/gi)];
    if (values.length !== 1) continue;
    const amount = Number(values[0][1].replace(/\./g, '').replace(',', '.'));
    if (Number.isFinite(amount) && amount > 0) return amount;
  }
  return null;
}
export function AssistantChat() {
  const [token] = useState(() => window.location.hash.slice(1));
  const [state, setState] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [draft, setDraft] = useState<Intake | null>(null),
    [files, setFiles] = useState<Attachment[]>([]),
    [notice, setNotice] = useState(""),
    [savedFeedback, setSavedFeedback] = useState<{ title: string; order: string; message: string } | null>(null),
    [guided, setGuided] = useState(false),
    [answer, setAnswer] = useState<any>(null),
    [history, setHistory] = useState<ChatMessage[]>([]),
    [clarification, setClarification] = useState<(Clarification & { responseId: string }) | null>(null),
    [pendingNote, setPendingNote] = useState(false),
    [conversationOrder, setConversationOrder] = useState<any>(null),
    [detail, setDetail] = useState<any>(null),
    [tab, setTab] = useState<"new" | "list">("new"),
    [listStatus, setListStatus] = useState("active"),
    [direction, setDirection] = useState<RequestListSort>('asc'),
    [query, setQuery] = useState(""),
    [approving, setApproving] = useState(false),
    [listApproval, setListApproval] = useState<AssistantOrder | null>(null),
    [statusEdit, setStatusEdit] = useState<{ order: AssistantOrder; status: string; tierMessage?: string; quoteMessage?: string; workflowMessage?: string; workflowPriceSuggested?: boolean; workflowPaid?: boolean } | null>(null);
  const blankStage = {status:'aguardando-orcamento', total:'', delivery:'', gift:false, unitPrice:undefined as number | undefined};
  const [initial, setInitial] = useState(blankStage);
  const withPrice = initial.status === 'orcado' || initial.status === 'fila-producao';
  const currentOrder = detail || conversationOrder;
  const listApprovalPayload = useRef<any>(null);
  const operation = useRef(crypto.randomUUID());
  const lockedPayload = useRef<any>(null);
  const conversationPayload = useRef<any>(null);
  const submittedPayload = useRef<any>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const messageInput = useRef<HTMLTextAreaElement>(null);
  const responseAnchor = useRef<HTMLDivElement>(null);
  const feedbackAnchor = useRef<HTMLDivElement>(null);
  const accessRequest = useRef<Promise<any> | null>(null);
  useEffect(() => {
    if (history.length) responseAnchor.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  }, [history.length]);
  useEffect(() => {
    if (error || notice) feedbackAnchor.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [error, notice]);
  const sortParam = (order: RequestListSort) => order === 'asc' ? '' : '&sort=' + order;
  const load = async (status = listStatus, order = direction) => setState(await api(token, `/api/assistant?status=${encodeURIComponent(status)}${sortParam(order)}`));
  const byDelivery = direction === 'delivery-asc' || direction === 'delivery-desc';
  function changeSort(next: RequestListSort) {
    if (state.nextCursor) void run(async () => { await load(listStatus, next); setDirection(next); });
    else setDirection(next);
  }
  async function loadMore() {
    const page = await api(token, `/api/assistant?status=${encodeURIComponent(listStatus)}${sortParam(direction)}&cursor=${encodeURIComponent(state.nextCursor)}`);
    setState((current: any) => ({ ...page, requests: [...current.requests, ...page.requests.filter((r: any) => !current.requests.some((x: any) => x.id === r.id))] }));
  }
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "referrer";
    meta.content = "no-referrer";
    document.head.appendChild(meta);
    let active = true;
    (accessRequest.current ??= api(token, "/api/assistant?summary=true"))
      .then(result => { if (active) setState(result); })
      .catch((e) => { if (active) setError(e.message); });
    return () => { active = false; meta.remove(); clearAssistantMedia(); };
  }, [token]);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function updateStatus(payload: StatusPayload) {
    if (!statusEdit) return;
    setBusy(true);
    setSavedFeedback(null);
    try {
      const id = statusEdit.order.id;
      const result = await api(token, `/api/assistant/requests/${id}/status`, payload);
      setState((current: any) => ({ ...current, requests: current.requests.map((row: any) => row.id === id ? { ...row, ...result.request } : row)
        .filter((row: any) => listStatus === 'all' || (listStatus === 'active' ? ['aguardando-orcamento', 'orcado'].includes(row.status) : row.status === listStatus)) }));
      setDetail((current: any) => current?.id === id ? { ...current, ...result.request, notes: [...(current.notes || []).filter((note: any) => note.id !== result.note.id), result.note] } : current);
      setSavedFeedback({ title: 'Pedido atualizado com sucesso', order: orderHeading(statusEdit.order).code || statusEdit.order.title,
        message: payload.quoteMessage ? 'Valor do orçamento atualizado. A mensagem foi salva no histórico.' : payload.tierMessage ? 'As faixas de quantidade e preço foram salvas neste orçamento.' : `Status atual: ${statusLabels[result.request.status] || result.request.status}. A alteração foi salva no histórico.` });
      setStatusEdit(null); setNotice(result.message);
    } finally { setBusy(false); }
  }
  async function backToOrders() {
    await run(async () => { setDetail(null); setConversationOrder(null); reset(); setHistory([]); setTab('list'); setNotice(''); await load(); });
  }
  function selectStatus(order: AssistantOrder, status: string) {
    setNotice(''); setStatusEdit({ order, status });
  }
  function beginListApproval(order: AssistantOrder) {
    setError(''); setNotice(''); setSavedFeedback(null); setStatusEdit(null);
    listApprovalPayload.current = null; setListApproval(order);
  }
  async function approveListedOrder(command: string) {
    if (!listApproval) return;
    await run(async () => {
      setSavedFeedback(null);
      const payload = listApprovalPayload.current || { operationId: crypto.randomUUID(), message: command, attachments: [], conversation: true, requestId: listApproval.id };
      listApprovalPayload.current = payload;
      let result;
      try { result = await api(token, '/api/assistant/draft', payload); }
      catch (e) { const status = (e as any).status; if (status >= 400 && status < 500 && status !== 429) listApprovalPayload.current = null; throw e; }
      if (!result.updatedRequestId) { listApprovalPayload.current = null; throw Error(result.message || 'A aprovação não foi concluída. Confira os dados.'); }
      setSavedFeedback({ title: 'Pedido atualizado com sucesso', order: orderHeading(listApproval).code || listApproval.title, message: `Confirmação: ${result.message}` });
      listApprovalPayload.current = null; setListApproval(null);
      await load();
    });
  }
  async function loadFile(id: string, preview = false) {
    return loadAssistantAsset(token, id, currentOrder?.id, preview);
  }
  function reset() {
    setApproving(false);
    setDraft(null);
    setAnswer(null);
    setPendingNote(false);
    setGuided(false);
    setClarification(null);
    setMessage("");
    setFiles([]);
    operation.current = crypto.randomUUID();
    lockedPayload.current = null;
    conversationPayload.current = null;
    submittedPayload.current = null;
  }
  async function upload(selected: FileList | null) {
    if (!selected) return;
    const picked = Array.from(selected);
    await run(async () => {
      if (files.length + picked.length > 6)
        throw Error("Envie até seis anexos por vez.");
      for (const file of picked) {
        if (file.size > 10 * 1024 * 1024)
          throw Error(`${file.name}: máximo 10 MiB.`);
        const response = await fetch("/api/assistant/assets", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/octet-stream",
            "X-File-Name": encodeURIComponent(file.name),
            "X-File-Type": file.type.split(";")[0],
          },
          body: file,
        });
        const result = await response.json();
        if (!response.ok) throw Error(result.error);
        setFiles((current) =>
          current.some((x) => x.id === result.id)
            ? current
            : [...current, result],
        );
      }
    });
    if (fileInput.current) fileInput.current.value = "";
  }
  async function open(id: string, approve = false) {
    await run(async () => {
      setDetail(await api(token, `/api/assistant/requests/${id}`));
      setConversationOrder(null);
      reset();
      setHistory([]);
      setNotice("");
      setApproving(approve);
    });
  }
  function newOrderForm() {
    reset(); setDetail(null); setConversationOrder(null); setHistory([]); setNotice(''); setError(''); setSavedFeedback(null);
    setTab('new'); setInitial(blankStage);
    setDraft({title:'',description:'',customerName:'',quantity:1,provisionalQuantity:false});
  }
  async function save() {
    await run(async () => {
      setSavedFeedback(null);
      const payload = lockedPayload.current || {
        operationId: operation.current,
        intake: { ...draft, description: draft?.description.trim() || draft?.title.trim() },
        ...(state.workflowUpdates && initial.status !== 'aguardando-orcamento' ? {initialStage:{
          status:initial.status, ...(withPrice ? {quotedPrice:initial.gift ? 0 : Number(initial.total.replace(',','.')), gift:initial.gift} : {}),
          ...(['fila-producao','produzindo'].includes(initial.status) ? {deliveryDate:initial.delivery} : {})
        }} : {}),
        message: submittedPayload.current?.message || message.trim() || draft?.title || "Pedido recebido por anexos.",
        attachments: files.map((f) => f.id),
      };
      lockedPayload.current = payload;
      let result;
      try { result = await api(token, "/api/assistant/requests", payload); }
      catch (e) { const code=(e as any).status; if(code >= 400 && code < 500 && code !== 429) lockedPayload.current = null; throw e; }
      setSavedFeedback({ title: 'Pedido cadastrado com sucesso', order: payload.intake?.title || 'Novo pedido', message: `Confirmação: ${result.message}` });
      setHistory(current => [...current, { id: `${operation.current}-saved`, role: "assistant", text: result.message, kind: "success" }]);
      setNotice("");
      reset();
      setDetail(await api(token, `/api/assistant/requests/${result.id}`));
    });
  }
  async function converse(reply = message.trim()) {
    await run(async () => {
      setSavedFeedback(null);
      const text = reply || "Pedido recebido por anexos.";
      const payload = conversationPayload.current || {
        message: clarification && !(currentOrder && priceFromOrderMessage(text)) ? clarificationMessage(clarification, text) : text,
        attachments: files.map(f => f.id), guided: !currentOrder && guided,
        conversation: true, operationId: crypto.randomUUID(),
        ...((clarification?.requestId || currentOrder?.id) ? { requestId: clarification?.requestId || currentOrder.id } : {}),
      };
      if (payload.message.length > 4000) throw Error("A conversa ficou longa para este envio. Cancele esta solicitação e envie uma nova mensagem com o pedido e os detalhes confirmados.");
      if (!conversationPayload.current) {
        setHistory(current => [...current, { id: payload.operationId, role: "user", text, files: [...files] }]);
      }
      setAnswer(null);
      conversationPayload.current = payload;
      let result;
      try { result = await api(token, "/api/assistant/draft", payload); }
      catch (e) {
        const status = (e as any).status;
        if (status >= 400 && status < 500 && status !== 429) {
          conversationPayload.current = null;
          setMessage(reply);
        }
        throw e;
      }
      // The server has answered. Preserve that answer even if refreshing the order fails.
      conversationPayload.current = null;
      submittedPayload.current = payload;
      setHistory(current => [...current, {
        id: `${payload.operationId}-answer`, role: "assistant", text: result.message,
        transcript: result.transcript, kind: result.updatedRequestId ? "success" : result.action?.intent === "clarify" ? "question" : undefined,
      }]);
      setMessage("");
      setNotice("");
      setAnswer(null);
      setClarification(null);
      if (result.updatedRequestId) {
        // Keep the confirmed write visible even if refreshing the detail fails afterwards.
        setSavedFeedback({ title: 'Pedido atualizado com sucesso', order: currentOrder?.id === result.updatedRequestId ? orderHeading(currentOrder).code || currentOrder.title : '', message: `Confirmação: ${result.message}` });
        reset();
        const updated = await api(token, `/api/assistant/requests/${result.updatedRequestId}`);
        setSavedFeedback(current => current ? { ...current, order: orderHeading(updated).code || updated.title } : current);
        setConversationOrder(null); setDetail(updated);
        return;
      }
      if (result.draft) {
        const stage=state.workflowUpdates ? result.initialStage : null;
        setInitial(stage ? {...blankStage,status:stage.status,delivery:stage.deliveryDate || '',unitPrice:stage.unitPrice,
          total:typeof stage.quotedPrice === 'number' ? stage.quotedPrice.toFixed(2).replace('.',',') : ''} : blankStage);
        setDetail(null); setConversationOrder(null); setTab("new");
        setDraft({ ...result.draft, description: result.transcript ? `${result.draft.description}\n\nTranscrição do áudio:\n${result.transcript}`.slice(0, 4000) : result.draft.description });
      } else {
        setAnswer(result);
        if (result.selectedRequestId) {
          await selectConversationRequest(result.selectedRequestId, result);
          return;
        }
        if (result.action?.intent === "clarify" && result.mode !== "guided") {
          setClarification({ message: payload.message, question: result.message, requestId: payload.requestId, responseId: `${payload.operationId}-answer` });
        } else if (result.mode === "guided") {
          setMessage(payload.message);
        } else if (!result.candidates?.length) setFiles([]);
      }
    });
  }
  async function selectConversationRequest(id: string, result: any) {
    const selected = await api(token, `/api/assistant/requests/${id}`);
    if (result?.action?.intent === 'approvalReview') {
      const quantity = result.action.quantity ?? selected.quantity;
      const changedQuantity = quantity !== selected.quantity;
      const unitPrice = changedQuantity ? historicalUnitPrice(selected.notes || []) : null;
      const quotedPrice = selected.isGift ? 0 : changedQuantity ? unitPrice === null ? null : Math.round(unitPrice * quantity * 100) / 100 : selected.quotedPrice;
      setDetail(selected); setConversationOrder(null); setPendingNote(false); setAnswer(null); setMessage('');
      if (state.workflowUpdates && selected.status === 'orcado') {
        setStatusEdit({ order: { ...selected, quantity, quotedPrice, requestedDeliveryDate: result.action.deliveryDate ?? selected.requestedDeliveryDate }, status: 'fila-producao', workflowMessage: result.action.workflowMessage, workflowPriceSuggested: unitPrice !== null, workflowPaid: result.action.paid === true });
        setNotice(result.message || 'Confira o valor e a data de entrega antes de colocar na fila.');
      } else setNotice('Este pedido mudou de etapa. Recarregue os pedidos e confira os dados antes de aprovar.');
      return;
    }
    if (result?.action?.intent === 'queueReview') {
      setDetail(selected); setConversationOrder(null); setPendingNote(false); setAnswer(null); setMessage('');
      if (state.workflowUpdates && selected.status === 'aguardando-orcamento') {
        const qty = result.action.quantity ?? selected.quantity;
        setStatusEdit({order:{...selected, quantity:qty, quotedPrice:qty === selected.quantity ? selected.quotedPrice : null, requestedDeliveryDate:result.action.deliveryDate ?? selected.requestedDeliveryDate},status:'fila-producao'});
      } else setNotice('Confira a etapa atual deste pedido antes de atualizar.');
      return;
    }
    if (result?.action?.intent === 'quotePrice') {
      setDetail(selected); setConversationOrder(null); setAnswer(null); setPendingNote(false);
      if (state?.workflowUpdates && ['aguardando-orcamento','orcado'].includes(selected.status)) {
        setMessage(''); setStatusEdit({ order: selected, status: 'orcado', quoteMessage: result.action.note });
      } else { setMessage(result.action.note); setNotice('Nesta etapa ou neste acesso o preço não pode ser alterado. Você pode registrar a mensagem como complemento.'); }
      return;
    }
    if (result?.action?.intent === 'quoteTiers') {
      setDetail(selected); setConversationOrder(null); setAnswer(null); setPendingNote(false); setMessage('');
      if (state?.workflowUpdates && ['orcado','aguardando-orcamento'].includes(selected.status) && !selected.customerQuote?.options?.length)
        setStatusEdit({ order: selected, status: 'orcado', tierMessage: result.action.note });
      else setNotice('Não foi possível aplicar estas faixas: confira a etapa, as opções já cadastradas e a permissão de atualização deste acesso.');
      return;
    }
    const updating = result?.action?.intent === 'update';
    if (detail) setDetail(selected); else setConversationOrder(selected);
    setDraft(null); setAnswer(null); setClarification(null);
    setPendingNote(updating); setMessage(updating ? result.action.note || submittedPayload.current?.message || '' : '');
    // Looking up an order must never discard an image that has not been saved.
    operation.current = crypto.randomUUID(); lockedPayload.current = null;
    setNotice('');
  }
  async function chooseRequest(id: string) {
    await run(() => selectConversationRequest(id, answer));
  }
  async function saveNote() {
    const quantity = !files.length && !lockedPayload.current ? approvedQuantityFromNote(message.trim()) : null;
    const messageCodes = requestCodes(message);
    const selectedCodes = requestCodes(orderHeading(currentOrder).code || '');
    const matchesSelectedOrder = !messageCodes.length || (messageCodes.length === 1 && selectedCodes.includes(messageCodes[0]));
    if (state?.workflowUpdates && quantity !== null && matchesSelectedOrder && ['aguardando-orcamento', 'orcado'].includes(currentOrder.status)) {
      const approvalMessage = message.trim();
      const unitPrice = historicalUnitPrice(currentOrder.notes || []);
      setSavedFeedback(null);
      setPendingNote(false);
      setConversationOrder(null);
      setDetail(currentOrder);
      setMessage('');
      setNotice(`Identifiquei a aprovação de ${quantity} ${quantity === 1 ? 'unidade' : 'unidades'}. Confira o valor e a data de entrega antes de confirmar; nada foi alterado ainda.`);
      setStatusEdit({ order: { ...currentOrder, quantity, quotedPrice: unitPrice === null ? null : Math.round(unitPrice * quantity * 100) / 100 }, status: 'fila-producao', workflowMessage: approvalMessage, workflowPriceSuggested: unitPrice !== null });
      return;
    }
    await run(async () => {
      setSavedFeedback(null);
      const payload = lockedPayload.current || { operationId: operation.current, message, attachments: files.map(f => f.id) };
      lockedPayload.current = payload;
      let result;
      try { result = await api(token, `/api/assistant/requests/${currentOrder.id}/notes`, payload); }
      catch (e) { const code = (e as any).status; if (code >= 400 && code < 500 && code !== 429) lockedPayload.current = null; throw e; }
      const id = currentOrder.id;
      const count = payload.attachments.length;
      setSavedFeedback({ title: 'Pedido atualizado com sucesso', order: orderHeading(currentOrder).code || currentOrder.title,
        message: `Atualização salva no histórico.${count ? ` ${count} ${count === 1 ? 'anexo salvo' : 'anexos salvos'} no pedido.` : ''}` });
      setHistory(current => [...current, { id: `${operation.current}-saved`, role: "assistant", text: result.message, kind: "success" }]);
      reset(); setNotice("");
      const refreshed = await api(token, `/api/assistant/requests/${id}`);
      if (detail) setDetail(refreshed); else setConversationOrder(refreshed);
    });
  }
  function startPrompt(text: string) {
    setConversationOrder(null);
    setMessage(text);
    messageInput.current?.focus();
  }
  const normalizeSearch = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const visibleOrders = (state?.requests || []).filter((row: any) => normalizeSearch([row.title, row.customerName, row.code, row.requestNumber, row.customerQuote?.name].filter(Boolean).join(' ')).includes(normalizeSearch(query.trim()))).sort((a: AssistantOrder, b: AssistantOrder) => compareRequestList(a, b, direction));
  const isConfirmable = !!clarification && canConfirmQuestion(clarification.question);
  const inputLocked = busy || !!statusEdit || !!listApproval || !!draft || !!lockedPayload.current || !!conversationPayload.current;
  const feedback = <div ref={feedbackAnchor} className="scroll-mt-28 space-y-3">
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">{error}</p>}
    {notice && <p role="status" className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-indigo-900">{notice}</p>}
  </div>;
  const orderContext = !detail && conversationOrder && <section className="assistant-chat-order" aria-label="Pedido da conversa">
    <div><small>Você está falando sobre</small><strong>{orderHeading(conversationOrder).code || conversationOrder.title} · {orderHeading(conversationOrder).title}</strong><p>{statusLabels[conversationOrder.status]}{conversationOrder.quotedPrice != null ? ` · ${money(conversationOrder.quotedPrice)}` : ''}</p></div>
    <div className="flex flex-wrap gap-2">{state?.workflowUpdates && ['orcado','fila-producao'].includes(conversationOrder.status) && !files.length && !pendingNote && !clarification && !approving && <button className={button} disabled={inputLocked || !!message.trim()} onClick={() => setApproving(true)}>{conversationOrder.status === 'orcado' ? 'Aprovar produção' : 'Ajustar entrega'}</button>}<button className={secondary} disabled={inputLocked || approving} onClick={() => { setDetail(conversationOrder); setConversationOrder(null); }}>Ver detalhes</button><button className={secondary} disabled={inputLocked || approving || !!files.length || pendingNote} onClick={() => { setConversationOrder(null); reset(); }}>Trocar pedido</button></div>
  </section>;
  const conversation = <section aria-label="Conversa com o assistente" className="assistant-conversation space-y-4">
    <div role="log" aria-label="Mensagens da conversa" aria-live="polite" aria-relevant="additions" className="space-y-4">
      {history.map((entry, index) => <div key={entry.id} ref={index === history.length - 1 ? responseAnchor : undefined}
        className={`assistant-bubble scroll-mt-28 space-y-2 break-words ${entry.role === "user" ? "is-user" : entry.kind === "success" ? "is-success" : "is-assistant"}`}>
        <p className="text-xs font-semibold text-slate-500">{entry.role === "user" ? "Você" : "Assistente LabLayer"}</p>
        {entry.kind === "question" && <p className="font-semibold text-indigo-800">{clarification?.responseId === entry.id ? "Aguardando sua resposta" : "Pergunta do assistente"}</p>}
        {entry.kind === "success" && <p className="flex items-center gap-2 font-semibold text-emerald-800"><Check size={18} /> Atualização concluída</p>}
        <p className="whitespace-pre-wrap">{entry.text}</p>
        {!!entry.files?.length && <ul className="text-xs text-slate-600 space-y-1">{entry.files.map(file => <li key={file.id}>Anexo: {file.name}</li>)}</ul>}
        {entry.transcript && <details className="text-sm"><summary className="cursor-pointer font-medium">Transcrição do áudio — confira</summary><p className="mt-2 whitespace-pre-wrap">{entry.transcript}</p></details>}
        {clarification?.responseId === entry.id && <div className="pt-2 space-y-3">
          <p className="text-sm text-slate-600">Sua resposta será enviada com o pedido original e os anexos.</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            {isConfirmable && <button className={button} disabled={inputLocked || !!message.trim()} onClick={() => converse("Sim, confirmo e autorizo o que foi perguntado acima.")}><Check size={18} /> Sim, confirmar</button>}
            <button className={secondary} disabled={inputLocked} onClick={() => messageInput.current?.focus()}>{isConfirmable ? "Quero corrigir" : "Responder pergunta"}</button>
            <button className={secondary} disabled={inputLocked} onClick={() => {
              reset();
              setHistory(current => [...current, { id: crypto.randomUUID(), role: "assistant", text: "Solicitação cancelada. Você pode enviar uma nova mensagem." }]);
            }}>Cancelar solicitação</button>
          </div>
        </div>}
      </div>)}
    </div>
    {orderContext}
    {answer?.candidates?.length > 0 && <section className="rounded-xl border bg-white p-4 space-y-3" aria-label="Selecionar pedido">
      <h2 className="font-semibold">Qual pedido você quer {answer.action?.intent === "update" ? "atualizar" : "consultar"}?</h2>
      {answer.candidates.map((candidate: any) => <button key={candidate.id} className={`${secondary} w-full text-left justify-start`} disabled={busy} onClick={() => chooseRequest(candidate.id)}>
        {candidate.title} · {candidate.customerName || "Cliente a confirmar"} · {statusLabels[candidate.status] || candidate.status}
      </button>)}
    </section>}
    {busy && <p role="status" className="text-sm text-indigo-700">Processando sua solicitação…</p>}
  </section>;
  const sendDisabled = busy || (!conversationPayload.current && !message.trim() && (!!clarification || !!currentOrder || !files.length));
  const detectedApprovalQuantity = pendingNote && !files.length ? approvedQuantityFromNote(message.trim()) : null;
  const sendLabel = busy ? "Aguarde…" : conversationPayload.current ? "Reenviar a mesma mensagem" : pendingNote ? (lockedPayload.current ? "Reenviar o mesmo complemento" : detectedApprovalQuantity !== null ? "Revisar aprovação" : "Confirmar complemento") : clarification ? "Enviar resposta" : "Enviar mensagem";
  const composer = <div className="space-y-3">
    {feedback}
    {currentOrder && files.length > 0 && !pendingNote && !clarification && <div className="assistant-attachment-next" role="status"><strong>Imagem pronta para anexar a {orderHeading(currentOrder).code || currentOrder.title}</strong><p>Ainda não foi salva no pedido.</p><button className={secondary} disabled={inputLocked} onClick={() => { setPendingNote(true); setMessage(message.trim() || 'Adicionar imagem de referência ao pedido.'); }}>Anexar ao pedido</button></div>}
    <div className="assistant-composer">
      <label htmlFor="assistant-message">{pendingNote ? "Confira o complemento" : clarification ? "Sua resposta" : currentOrder ? "Registrar atualização" : "O que você precisa fazer?"}</label>
      <textarea id="assistant-message" ref={messageInput} rows={3} maxLength={pendingNote ? 2000 : 4000}
        aria-label={pendingNote ? "Confira o complemento" : clarification ? "Sua resposta" : "Criar, consultar ou atualizar um pedido"}
        value={message} disabled={inputLocked} onChange={e => setMessage(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia?.('(pointer: fine)').matches && !sendDisabled && !inputLocked) {
            e.preventDefault();
            if (pendingNote) saveNote(); else converse();
          }
        }}
        placeholder={clarification ? "Responda à pergunta acima ou explique o que precisa corrigir." : currentOrder ? "Ex.: O cliente confirmou a cor azul." : "Ex.: Novo orçamento para Zalma, 10 chaveiros NFC"} />
      {detectedApprovalQuantity !== null && <p role="status" className="text-sm text-indigo-800">A mensagem indica aprovação de {detectedApprovalQuantity} {detectedApprovalQuantity === 1 ? 'unidade' : 'unidades'}. Você poderá conferir o valor e a data antes de atualizar para a fila.</p>}
      {!!files.length && <ul className="assistant-attachments">{files.map(f => <li key={f.id}>
        <span>✓ {f.name}</span><button type="button" disabled={inputLocked} onClick={() => setFiles(current => current.filter(x => x.id !== f.id))}>Remover</button>
      </li>)}</ul>}
      <div className="assistant-composer-footer">
        <input ref={fileInput} className="hidden" type="file" multiple accept="image/png,image/jpeg,image/webp,audio/mpeg,audio/mp4,audio/x-m4a,audio/webm,audio/ogg,audio/wav,audio/x-wav" onChange={e => upload(e.target.files)} />
        <button className="assistant-attach" disabled={inputLocked} onClick={() => fileInput.current?.click()}><Paperclip size={18} />Anexar arquivo</button>
        <span className="assistant-enter-hint">Enter para enviar</span>
        <button className="assistant-send" aria-label={sendLabel} disabled={sendDisabled} onClick={pendingNote ? saveNote : () => converse()}><Send size={17} />{sendLabel === 'Enviar mensagem' ? 'Enviar' : sendLabel}</button>
      </div>
    </div>
    <details className="assistant-options"><summary>Opções e limites dos anexos</summary>
      <p>Até 6 fotos ou áudios, 10 MiB cada. {state?.mode === "ai" ? "A IA interpreta fotos e um áudio MP3, M4A, WAV ou WebM, até 8 MiB no total. OGG fica para análise da equipe." : "Áudios ficam disponíveis para a equipe ouvir."}</p>
      {!currentOrder && !draft && !clarification && <label className="mt-3 flex items-center gap-2"><input type="checkbox" checked={guided} disabled={inputLocked} onChange={e => setGuided(e.target.checked)} />Novo pedido manual, sem usar IA</label>}
    </details>
    {currentOrder && !draft && !pendingNote && !clarification && <button className={secondary} disabled={inputLocked || !message.trim() || message.length > 2000} onClick={() => {
      setAnswer(null); setPendingNote(true);
      setNotice("Confira o texto e confirme para registrar como complemento. Isso não altera quantidade, preço ou status.");
    }}>Preparar complemento manual</button>}
    {pendingNote && !lockedPayload.current && <button className={secondary} disabled={busy} onClick={() => { setPendingNote(false); setNotice(""); }}>Voltar à conversa</button>}
    <p className="assistant-note">Revise valores e dados antes de confirmar.</p>
  </div>;
  return (
    <div className={`assistant-app${savedFeedback ? " has-save-feedback" : ""}`}>
      <header className="assistant-header">
        <div className="assistant-header-inner">
          <div className="assistant-brand"><span><Bot size={23} /></span><div><h1>Assistente LabLayer</h1><p>{state ? `${state.company} · ${state.seller}` : "Acesso por link exclusivo"}</p></div></div>
          {state && <span className="assistant-access"><i />Acesso validado</span>}
        </div>
      </header>
      <main className="assistant-container">
        {error && (!state || (!detail && tab === "list" && !listApproval)) && (
          <p
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800"
          >
            {error}
          </p>
        )}
        {!state && !error && <p>Conferindo acesso…</p>}
        {state && (
          <>
            <details className="assistant-guide">
              <summary>
                <span className="inline-flex items-center gap-2 align-middle"><Info size={17} aria-hidden="true" /> Como usar o assistente</span><ChevronRight className="assistant-guide-chevron" size={17} />
              </summary>
              <div className="pb-4 space-y-2">
                <p>Crie um orçamento, consulte um pedido pelo nome do cliente ou código, ou envie uma atualização. Você também pode anexar fotos e áudios.</p>
                <p>Se precisar de mais informações, o assistente fará uma pergunta na conversa. Responda ali ou use os botões de confirmação.</p>
                <p>Autorizações explícitas, como “ORC-008 pago, pode produzir”, podem atualizar o pedido ao enviar. Consulte a lista em <strong>{state.requestScope === "tenant" ? "Todos os pedidos" : "Meus pedidos"}</strong>.</p>
              </div>
            </details>
            {(<nav
                className="assistant-tabs"
                aria-label="Assistente"
              >
                <button
                  disabled={busy || !!statusEdit || !!listApproval || !!conversationPayload.current}
                  aria-current={!detail && tab === "new" ? "page" : undefined}
                  onClick={() => {
                    if (detail) { setDetail(null); setConversationOrder(null); reset(); setHistory([]); }
                    setTab("new"); setNotice("");
                  }}
                >
                  Conversar
                </button>
                <button
                  disabled={busy || !!statusEdit || !!listApproval || !!conversationPayload.current}
                  aria-current={detail || tab === "list" ? "page" : undefined}
                  onClick={() =>
                    run(async () => {
                      if (detail) { setDetail(null); setConversationOrder(null); reset(); setHistory([]); }
                      const order = tab === 'new' && !detail ? 'asc' : direction;
                      setTab("list");
                      setNotice("");
                      await load(listStatus, order);
                      setDirection(order);
                    })
                  }
                >
                  {state.requestScope === "tenant" ? "Todos os pedidos" : "Meus pedidos"}
                </button>
              </nav>
            )}
            {detail ? (
              <AssistantOrderDetail order={detail} token={token} focusOnOpen={!approving} busy={busy || !!statusEdit || !!listApproval || !!conversationPayload.current || approving} onBack={backToOrders}
                onAttach={() => { messageInput.current?.focus(); fileInput.current?.click(); }} loadFile={loadFile}
                timeline={<RequestTimeline notes={detail.notes || []} load={loadFile} showFiles={false} createdAt={detail.createdAt} quoteSentAt={detail.quoteSentAt} />}>
                {!clarification && !pendingNote && !draft && state.workflowUpdates && !approving && <>
                  {['aguardando-orcamento','orcado'].includes(detail.status) && !detail.customerQuote?.options?.length && (() => {
                    const note = [...(detail.notes || [])].reverse().find(n => n.kind === 'note' && quoteTiersFromMessage(n.message));
                    return note && <button className="assistant-card-button" disabled={inputLocked} onClick={() => setStatusEdit({order:detail,status:'orcado',tierMessage:note.message})}>Usar preços do histórico</button>;
                  })()}
                  <label className="assistant-status-control"><span>Alterar etapa do pedido</span><select disabled={inputLocked} value={detail.status} onChange={e=>selectStatus(detail,e.target.value)}>
                    {Object.entries(statusLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}
                  </select></label>
                  {detail.status === 'aguardando-orcamento' && <button className="assistant-send assistant-detail-primary" disabled={inputLocked} onClick={() => selectStatus(detail, 'orcado')}>Marcar como orçado</button>}
                  {['orcado', 'fila-producao'].includes(detail.status) && <button className="assistant-send assistant-detail-primary" disabled={inputLocked || !!message.trim() || !!files.length} onClick={() => setApproving(true)}><Check size={18} />{detail.status === 'orcado' ? 'Aprovar orçamento e definir prazo' : 'Ajustar entrega'}</button>}
                  {['fila-producao', 'produzindo'].includes(detail.status) && <button className="assistant-card-button assistant-detail-primary" disabled={inputLocked} onClick={() => selectStatus(detail, detail.status === 'fila-producao' ? 'produzindo' : 'finalizado')}>{detail.status === 'fila-producao' ? 'Iniciar produção' : 'Finalizar pedido'}</button>}
                </>}
                {!clarification && !pendingNote && !draft && state.workflowUpdates && !approving && canCancelAssistantOrder(detail.status) && <button className="assistant-card-button assistant-cancel-order" disabled={inputLocked} onClick={() => selectStatus(detail, 'cancelado')}>Cancelar pedido</button>}
                {statusEdit?.order.id === detail.id && <AssistantStatusConfirmation key={detail.id + statusEdit.status} order={statusEdit.order} status={statusEdit.status} tierMessage={statusEdit.tierMessage} quoteMessage={statusEdit.quoteMessage} workflowMessage={statusEdit.workflowMessage} workflowPriceSuggested={statusEdit.workflowPriceSuggested} workflowPaid={statusEdit.workflowPaid} busy={busy} onConfirm={updateStatus} onCancel={() => setStatusEdit(null)} />}
                {approving && <ProductionConfirmation key={detail.id} order={detail} busy={busy} retry={!!conversationPayload.current} onCancel={() => { setApproving(false); setMessage(""); setError(""); }} onConfirm={command => converse(command)} feedback={feedback} />}
                {(!approving || history.length > 0) && <div className="space-y-5">{conversation}{!approving && composer}</div>}
              </AssistantOrderDetail>
            ) : tab === "new" ? (
              <section className="assistant-surface">
                {!history.length && !draft && <>
                  <div className="assistant-welcome"><span><Sparkles size={22} /></span><div><h2>Olá, como posso ajudar?</h2><p>Crie um orçamento, consulte um pedido ou atualize o status usando uma frase simples.</p></div></div>
                  <div className="assistant-quick-actions">
                    {[{ icon: Plus, title: 'Novo orçamento', hint: 'Informe cliente e produto', prompt: 'Criar novo orçamento para ' }, { icon: Search, title: 'Consultar pedido', hint: 'Busque pelo número ou cliente', prompt: 'Consultar o pedido ' }, { icon: RefreshCw, title: 'Atualizar status', hint: 'Informe o pedido e a atualização', prompt: 'Atualizar o status do pedido ' }].map(action => <button key={action.title} disabled={inputLocked} onClick={() => startPrompt(action.prompt)}><span><action.icon size={18} /></span><div><strong>{action.title}</strong><small>{action.hint}</small></div></button>)}
                  </div>
                  <button className={secondary} disabled={inputLocked} onClick={newOrderForm}>Cadastrar pedido diretamente</button>
                </>}
                {conversation}
                <div className="space-y-5">
                  {approving && conversationOrder ? <ProductionConfirmation key={conversationOrder.id} order={conversationOrder} busy={busy} retry={!!conversationPayload.current} onCancel={() => { setApproving(false); setError(''); }} onConfirm={command => converse(command)} feedback={feedback} /> : draft ? feedback : composer}
                  {draft && (
                    <form
                      className="border-t pt-5 space-y-4"
                      onSubmit={(e) => {
                        e.preventDefault();
                        save();
                      }}
                    >
                      <h2 className="font-bold text-lg">
                        Confira antes de cadastrar
                      </h2>
                      <label className="block">
                        Título
                        <input
                          className={field}
                          required
                          maxLength={150}
                          value={draft.title}
                          disabled={busy || !!lockedPayload.current}
                          onChange={(e) =>
                            setDraft({ ...draft, title: e.target.value })
                          }
                        />
                      </label>
                      <label className="block">
                        Cliente
                        <input
                          className={field}
                          maxLength={120}
                          value={draft.customerName}
                          disabled={busy || !!lockedPayload.current}
                          onChange={(e) =>
                            setDraft({ ...draft, customerName: e.target.value })
                          }
                          placeholder="Nome do cliente (se conhecido)"
                        />
                      </label>
                      <label className="block">
                        Quantidade
                        <input
                          className={field}
                          type="number"
                          min={1}
                          max={100000}
                          step={1}
                          required
                          value={draft.quantity}
                          disabled={busy || !!lockedPayload.current}
                          onChange={e => {
                            const quantity=Number(e.target.value);
                            setDraft({...draft,quantity,provisionalQuantity:false});
                            if (initial.unitPrice !== undefined) setInitial({...initial,total:(Math.round(initial.unitPrice*100)*quantity/100).toFixed(2).replace('.',',')});
                          }}
                        />
                      </label>
                      <label className="block">Descrição<textarea className={field} maxLength={4000} value={draft.description} disabled={busy || !!lockedPayload.current} placeholder="Detalhes do pedido (opcional)" onChange={e=>setDraft({...draft,description:e.target.value})} /></label>
                      {state.workflowUpdates && <fieldset disabled={busy || !!lockedPayload.current} className="space-y-3">
                        <label className="block">Status inicial<select className={field} value={initial.status} onChange={e=>setInitial({...initial,status:e.target.value})}>
                          {Object.entries(statusLabels).map(([value,label])=><option key={value} value={value}>{value === 'orcado' ? 'Orçado · aguardando aprovação' : label}</option>)}
                        </select></label>
                        {withPrice && <>
                          <label className="block"><input type="checkbox" checked={initial.gift} onChange={e=>setInitial({...initial,gift:e.target.checked})} /> Presente / sem cobrança</label>
                          {!initial.gift && initial.unitPrice !== undefined && <p>{draft.quantity} × {money(initial.unitPrice)} por unidade</p>}
                          {initial.gift ? <p>Total: R$ 0,00 · sem pagamento</p> : <label className="block">Valor total do orçamento (R$)<input className={field} inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,2})?" required placeholder="Ex.: 125,50" value={initial.total} onChange={e=>setInitial({...initial,total:e.target.value,unitPrice:undefined})} /></label>}
                          {draft.provisionalQuantity && <label className="block"><input type="checkbox" required onChange={()=>setDraft({...draft, provisionalQuantity:false})} /> Confirmo a quantidade de {draft.quantity} unidade(s)</label>}
                        </>}
                        {['fila-producao','produzindo'].includes(initial.status) && <label className="block">Data de entrega combinada<input className={field} type="date" required min="2000-01-01" max="2100-12-31" value={initial.delivery} onChange={e=>setInitial({...initial,delivery:e.target.value})} /></label>}
                      </fieldset>}
                      {draft.provisionalQuantity && (
                        <p className="text-sm text-amber-800">
                          Quantidade não identificada: 1 unidade provisória, a
                          confirmar.
                        </p>
                      )}
                      <p className="text-sm text-slate-600">
                        O texto original e os {files.length} anexo(s) serão
                        salvos.{initial.status === 'aguardando-orcamento' ? ' Valores ainda serão calculados pela equipe.' : ' O pedido já será cadastrado na etapa selecionada.'}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <button className={button} disabled={busy}>
                          <Check size={18} />
                          {lockedPayload.current
                            ? "Reenviar o mesmo pedido"
                            : "Cadastrar no LabLayer"}
                        </button>
                        {!lockedPayload.current && (
                          <button
                            type="button"
                            className={secondary}
                            disabled={busy}
                            onClick={() => {
                              setDraft(null);
                              setMessage(submittedPayload.current?.message || "");
                              setNotice("");
                            }}
                          >
                            Editar mensagem
                          </button>
                        )}
                      </div>
                    </form>
                  )}
                </div>
              </section>
            ) : (
              <section className="assistant-surface assistant-orders">
                <div className="assistant-orders-heading"><div><h2>Pedidos</h2><p>Acompanhe os orçamentos e as atualizações da equipe.</p></div><button className="assistant-send" disabled={busy || !!statusEdit || !!listApproval} onClick={newOrderForm}><Plus size={16} />Novo orçamento</button></div>
                {notice && <p role="status" className="assistant-list-notice">{notice}</p>}
                <div className="assistant-order-tools">
                  <label><Search size={18} /><input aria-label="Buscar pedido ou cliente" value={query} disabled={busy || !!statusEdit || !!listApproval} onChange={e => setQuery(e.target.value)} placeholder="Buscar pedido ou cliente" /></label>
                  <select aria-label="Filtrar pedidos por status" value={listStatus} disabled={busy || !!statusEdit || !!listApproval} onChange={e => {
                    const value = e.target.value;
                    run(async () => { const next = byDelivery && value !== 'fila-producao' ? 'asc' : direction; await load(value, next); setDirection(next); setListStatus(value); });
                  }}>
                    <option value="active">Aguardando orçamento e Orçado</option>
                    <option value="all">Todos os status</option>
                    {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </div>
                <div className="assistant-order-sort-row">
                  <p className="assistant-result-count">{visibleOrders.length} {visibleOrders.length === 1 ? 'pedido encontrado' : 'pedidos encontrados'}{state.nextCursor ? ' nesta página' : ''}</p>
                  <div className="assistant-sort-options">
                    <button type="button" className="assistant-sort-button" disabled={busy || !!statusEdit || !!listApproval} aria-pressed={!byDelivery}
                      aria-label={byDelivery ? 'Ordenar por número crescente' : direction === 'asc' ? 'Ordem crescente. Mudar para ordem decrescente' : 'Ordem decrescente. Mudar para ordem crescente'}
                      onClick={() => changeSort(direction === 'asc' ? 'desc' : 'asc')}>
                      {direction === 'desc' ? <ArrowUpWideNarrow size={17} aria-hidden="true" /> : <ArrowDownNarrowWide size={17} aria-hidden="true" />}
                      Nº {direction === 'desc' ? 'decrescente' : 'crescente'}
                    </button>
                    {listStatus === 'fila-producao' && (state.workflowUpdates || state.requestScope === 'tenant') &&
                      <button type="button" className="assistant-sort-button" disabled={busy || !!statusEdit || !!listApproval} aria-pressed={byDelivery}
                        aria-label={direction === 'delivery-asc' ? 'Entrega combinada: mais próximas primeiro. Inverter ordem' : direction === 'delivery-desc' ? 'Entrega combinada: mais distantes primeiro. Inverter ordem' : 'Ordenar por entrega combinada, mais próximas primeiro'}
                        onClick={() => changeSort(direction === 'delivery-asc' ? 'delivery-desc' : 'delivery-asc')}>
                        {direction === 'delivery-desc' ? <ArrowUpWideNarrow size={17} aria-hidden="true" /> : <ArrowDownNarrowWide size={17} aria-hidden="true" />}
                        Entrega combinada
                      </button>}
                  </div>
                </div>
                {state.nextCursor && <p className="text-xs text-slate-500">A busca inclui os pedidos carregados. Carregue mais para ampliar os resultados.</p>}
                {busy && !statusEdit && !listApproval && <p role="status">Carregando pedidos…</p>}
                {!busy && !visibleOrders.length && <div className="assistant-empty"><Search size={26} /><strong>Nenhum pedido encontrado neste filtro.</strong><p>Tente alterar a busca ou o status.</p></div>}
                <div className="assistant-order-list">{visibleOrders.map((row: any) => <AssistantOrderCard key={row.id} order={row} token={token} busy={busy || !!statusEdit || !!listApproval} workflowUpdates={state.workflowUpdates} onOpen={() => open(row.id)} onApprove={() => beginListApproval(row)} onStatus={status => selectStatus(row, status)}
                  confirmation={statusEdit?.order.id === row.id ? <AssistantStatusConfirmation key={row.id + statusEdit.status} order={statusEdit.order} status={statusEdit.status} tierMessage={statusEdit.tierMessage} quoteMessage={statusEdit.quoteMessage} workflowMessage={statusEdit.workflowMessage} workflowPriceSuggested={statusEdit.workflowPriceSuggested} workflowPaid={statusEdit.workflowPaid} busy={busy} onConfirm={updateStatus} onCancel={() => setStatusEdit(null)} /> : listApproval?.id === row.id ? <ProductionConfirmation inline key={row.id} order={listApproval} busy={busy} retry={!!listApprovalPayload.current} onConfirm={approveListedOrder} onCancel={() => { setListApproval(null); setError(''); }} feedback={error ? <p role="alert" className="text-red-800">{error}</p> : undefined} /> : undefined} />)}</div>
                {state.nextCursor && <button className={secondary} disabled={busy || !!statusEdit || !!listApproval} onClick={() => run(loadMore)}>Carregar mais pedidos</button>}
              </section>
            )}
          </>
        )}
      </main>
      {savedFeedback && <aside className="assistant-save-feedback" role="status" aria-label="Confirmação de atualização" aria-live="polite" aria-atomic="true">
        <span className="assistant-save-feedback-icon" aria-hidden="true"><Check size={24} /></span>
        <div><h2>{savedFeedback.title}</h2>{savedFeedback.order && <strong>{savedFeedback.order}</strong>}<p>{savedFeedback.message}</p></div>
        <button type="button" onClick={() => setSavedFeedback(null)}>Entendi</button>
      </aside>}
    </div>
  );
}
export function RequestTimeline({ notes, load, showFiles = true, createdAt, quoteSentAt }: { notes: any[]; load: (id: string, preview?: boolean) => Promise<Blob>; showFiles?: boolean; createdAt?: string; quoteSentAt?: string }) {
  const names: Record<string, string> = { startedAt: 'Início da produção', completedAt: 'Conclusão', status: 'Status', approvedAt: 'Autorização para produção', paidAt: 'Pagamento informado', requestedDeliveryDate: 'Data de entrega', requestedQuantity: 'Quantidade', quotedPrice: 'Valor total do orçamento', provisionalQuantity: 'Quantidade provisória', isGift: 'Presente / sem cobrança' };
  function value(field: string, data: any) {
    if (data === '' || data == null) return 'Não informado';
    if (field === 'status') return statusLabels[data] || String(data);
    if (field === 'provisionalQuantity' || field === 'isGift') return data ? 'Sim' : 'Não';
    if (field === 'quotedPrice') return Number(data).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    if (field === 'requestedDeliveryDate') return String(data).split('-').reverse().join('/');
    if (field.endsWith('At')) return new Date(data).toLocaleString('pt-BR');
    return String(data);
  }
  return <section aria-label="Linha do tempo do orçamento" className="space-y-3">
    {!notes.length && !createdAt && !quoteSentAt && <p className="text-sm text-slate-500">Nenhuma atualização registrada.</p>}
    <ol className="border-l-2 border-indigo-200 pl-4 space-y-5">
      {[...notes].sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt))).map(note => <li key={note.id} className="space-y-2 break-words">
        <p className="text-xs text-slate-500">{note.kind === 'workflow-update' ? 'Atualização do pedido' : 'Complemento'} · {note.seller || 'Equipe'} · <time dateTime={note.createdAt}>{new Date(note.createdAt).toLocaleString('pt-BR')}</time></p>
        <p className="whitespace-pre-wrap">{note.message}</p>
        {!!note.changes?.length && <ul className="text-sm space-y-1">{note.changes.map((c: any) => <li key={c.field}>{names[c.field] || c.field}: {value(c.field, c.before)} → {value(c.field, c.after)}</li>)}</ul>}
        {note.paymentReported && <p className="text-xs text-slate-500">Pagamento informado pelo atendimento; não representa conciliação bancária.</p>}
        {showFiles && <Files files={note.attachments || []} load={load} />}
      </li>)}
      {quoteSentAt && <li className="space-y-1"><p className="font-semibold">Orçamento enviado</p><time className="text-xs text-slate-500" dateTime={quoteSentAt}>{new Date(quoteSentAt).toLocaleString('pt-BR')}</time></li>}
      {createdAt && <li className="space-y-1"><p className="font-semibold">Pedido criado</p><time className="text-xs text-slate-500" dateTime={createdAt}>{new Date(createdAt).toLocaleString('pt-BR')}</time></li>}
    </ol>
  </section>;
}
