import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Bot,
  Check,
  Copy,
  MessageSquare,
  Paperclip,
  Plus,
  Send,
  ShieldCheck,
} from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { catalogRequest } from "../catalog/client";
import type { Intake } from "../../../shared/assistant/model";

type Attachment = { id: string; name: string; mime: string };
const field =
  "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-900";
const button =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-700 px-4 py-3 font-semibold text-white disabled:opacity-50";
const secondary =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-slate-700 disabled:opacity-50";
const statusLabels: Record<string, string> = {
  "aguardando-orcamento": "Aguardando orçamento",
  orcado: "Orçado",
  "fila-producao": "Na fila de produção",
  produzindo: "Em produção",
  finalizado: "Finalizado",
};
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
  if (!response.ok) throw Error(data.error || "Não foi possível concluir.");
  return data;
}
function Files({
  files,
  load,
}: {
  files: Attachment[];
  load: (id: string) => Promise<Blob>;
}) {
  return (
    <div className="space-y-3">
      {files.map((file) => (
        <FilePreview key={file.id} file={file} load={load} />
      ))}
    </div>
  );
}
function FilePreview({
  file,
  load,
}: {
  file: Attachment;
  load: (id: string) => Promise<Blob>;
}) {
  const [url, setUrl] = useState(""),
    [error, setError] = useState("");
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    let active = true,
      objectUrl = "";
    loadRef
      .current(file.id)
      .then((blob) => {
        if (active) {
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
        }
      })
      .catch(() => {
        if (active) setError("Não foi possível abrir o anexo.");
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file.id]);
  return (
    <div className="rounded-xl border p-3 space-y-2">
      <p className="text-sm break-all">{file.name}</p>
      {error && <p role="alert">{error}</p>}
      {url ? (
        file.mime.startsWith("image/") ? (
          <img
            className="max-h-72 w-full object-contain"
            src={url}
            alt={file.name}
          />
        ) : (
          <audio className="w-full" src={url} controls preload="metadata" />
        )
      ) : (
        !error && <p>Carregando anexo…</p>
      )}
    </div>
  );
}
export function AssistantLinks() {
  const { user, tenantId } = useAuth();
  const [links, setLinks] = useState<any[]>([]),
    [name, setName] = useState(""),
    [url, setUrl] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [copied, setCopied] = useState(false);
  const base = `/api/tenants/${tenantId}/assistant-links`;
  async function load() {
    if (user && tenantId) setLinks((await catalogRequest(user, base)).links);
  }
  useEffect(() => {
    setLinks([]);
    setUrl("");
    setError("");
    load().catch((e) => setError(e.message));
  }, [user, tenantId]);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex gap-2 items-center">
          <Bot /> Assistente de orçamentos
        </h1>
        <p className="mt-2 text-slate-600">
          Crie um acesso para cada vendedor receber pedidos pelo celular, com
          fotos e áudios.
        </p>
      </div>
      <div className="rounded-2xl bg-indigo-50 p-5 space-y-2">
        <p className="flex gap-2 font-semibold">
          <ShieldCheck size={20} /> Um link por vendedor
        </p>
        <p>
          Quem possui o link pode cadastrar e consultar os pedidos enviados por
          ele. O link vence em 90 dias e pode ser revogado aqui. Compartilhe
          apenas com o vendedor responsável.
        </p>
        <p className="text-sm">
          O assistente organiza o recebimento. A equipe confere os anexos e
          calcula os valores no orçamento.
        </p>
      </div>
      {error && (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-700">
          {error}
        </p>
      )}
      <form
        className="flex flex-col sm:flex-row gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            const result = await catalogRequest(user!, base, { name });
            setUrl(`${window.location.origin}/assistente#${result.token}`);
            setCopied(false);
            setName("");
          });
        }}
      >
        <label className="flex-1">
          Nome do vendedor
          <input
            required
            maxLength={80}
            className={field}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Elvis — vendas"
          />
        </label>
        <button
          className={`${button} self-end`}
          disabled={busy || !name.trim()}
        >
          <Plus size={18} /> Criar link
        </button>
      </form>
      {url && (
        <div className="rounded-2xl border border-indigo-200 bg-white p-4 space-y-3">
          <p className="font-semibold">Link criado — copie agora</p>
          <p className="text-sm">
            Por segurança, o endereço completo só aparece neste momento.
          </p>
          <input
            readOnly
            aria-label="Link do vendedor"
            className={`${field} font-mono text-xs`}
            value={url}
          />
          <button
            className={secondary}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(url);
                setCopied(true);
              } catch {
                setError("Selecione e copie o link pelo campo acima.");
              }
            }}
          >
            <Copy size={16} />
            {copied ? "Copiado" : "Copiar link"}
          </button>
          <a
            className={`${secondary} ml-2`}
            href={url}
            target="_blank"
            rel="noreferrer"
          >
            Abrir chat
          </a>
        </div>
      )}
      <ul className="space-y-3">
        {links.map((link) => (
          <li
            key={link.id}
            className="rounded-2xl border bg-white p-4 flex flex-wrap items-center justify-between gap-3"
          >
            <div>
              <strong>{link.name}</strong>
              <p className="text-sm text-slate-600">
                {!link.active
                  ? "Revogado"
                  : link.expiresAt <= new Date().toISOString()
                    ? "Expirado"
                    : `Ativo até ${new Date(link.expiresAt).toLocaleDateString("pt-BR")}`}
              </p>
            </div>
            {link.active && (
              <button
                className={secondary}
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await catalogRequest(
                      user!,
                      `${base}/${link.id}/revoke`,
                      {},
                    );
                    if (url) setUrl("");
                  })
                }
              >
                Revogar acesso de {link.name}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
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
    [transcript, setTranscript] = useState(""),
    [guided, setGuided] = useState(false),
    [detail, setDetail] = useState<any>(null),
    [tab, setTab] = useState<"new" | "list">("new");
  const operation = useRef(crypto.randomUUID());
  const lockedPayload = useRef<any>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const load = async () => setState(await api(token, "/api/assistant"));
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "referrer";
    meta.content = "no-referrer";
    document.head.appendChild(meta);
    load().catch((e) => setError(e.message));
    return () => meta.remove();
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
  async function loadFile(id: string) {
    const response = await fetch(`/api/assistant/assets/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw Error();
    return response.blob();
  }
  function reset() {
    setDraft(null);
    setTranscript("");
    setMessage("");
    setFiles([]);
    operation.current = crypto.randomUUID();
    lockedPayload.current = null;
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
  async function open(id: string) {
    await run(async () => {
      setDetail(await api(token, `/api/assistant/requests/${id}`));
      reset();
      setNotice("");
    });
  }
  async function save() {
    await run(async () => {
      const payload = lockedPayload.current || {
        operationId: operation.current,
        intake: draft,
        message: message.trim() || "Pedido recebido por anexos.",
        attachments: files.map((f) => f.id),
      };
      lockedPayload.current = payload;
      const result = await api(token, "/api/assistant/requests", payload);
      setNotice(result.message);
      reset();
      await load();
      setDetail(await api(token, `/api/assistant/requests/${result.id}`));
    });
  }
  const composer = (
    <div className="space-y-3">
      <label className="block font-medium" htmlFor="assistant-message">
        {detail ? "Complementar este pedido" : "Conte o pedido do cliente"}
      </label>
      <textarea
        id="assistant-message"
        rows={5}
        maxLength={detail ? 2000 : 4000}
        className={field}
        value={message}
        disabled={busy || !!draft || !!lockedPayload.current}
        onChange={(e) => setMessage(e.target.value)}
        placeholder={
          detail
            ? "Ex.: o cliente confirmou a cor azul…"
            : "Ex.: Chaveiro com logo NFC\nCliente: Zalma Joias\n10 unidades, tamanho pequeno, verde e branco."
        }
      />
      <input
        ref={fileInput}
        className="hidden"
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp,audio/mpeg,audio/mp4,audio/x-m4a,audio/webm,audio/ogg,audio/wav,audio/x-wav"
        onChange={(e) => upload(e.target.files)}
      />
      <button
        className={secondary}
        disabled={busy || !!draft || !!lockedPayload.current}
        onClick={() => fileInput.current?.click()}
      >
        <Paperclip size={18} /> Fotos ou áudios
      </button>
      <p className="text-xs text-slate-500">
        Até 6 anexos, 10 MiB cada. {state?.mode === "ai"
          ? "A IA interpreta fotos e um áudio MP3, M4A, WAV ou WebM, até 8 MiB no total. OGG fica para análise da equipe."
          : "Áudios ficam disponíveis para a equipe ouvir."}
      </p>
      {files.length > 0 && (
        <ul className="text-sm space-y-1">
          {files.map((f) => (
            <li key={f.id} className="flex justify-between gap-2 break-all">
              <span>✓ {f.name}</span>
              <button
                disabled={busy || !!draft || !!lockedPayload.current}
                onClick={() =>
                  setFiles((current) => current.filter((x) => x.id !== f.id))
                }
              >
                Remover
              </button>
            </li>
          ))}
        </ul>
      )}
      {!detail && !draft && state?.mode === "ai" && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={guided} disabled={busy} onChange={e => setGuided(e.target.checked)} />
          Preencher manualmente, sem usar IA
        </label>
      )}
      {!draft && (
        <button
          className={`${button} w-full`}
          disabled={busy || (!message.trim() && (detail || !files.length))}
          onClick={() =>
            detail
              ? run(async () => {
                  const payload = lockedPayload.current || {
                    operationId: operation.current,
                    message,
                    attachments: files.map((f) => f.id),
                  };
                  lockedPayload.current = payload;
                  const result = await api(
                    token,
                    `/api/assistant/requests/${detail.id}/notes`,
                    payload,
                  );
                  setNotice(result.message);
                  reset();
                  setDetail(
                    await api(token, `/api/assistant/requests/${detail.id}`),
                  );
                })
              : run(async () => {
                  const result = await api(token, "/api/assistant/draft", {
                    message: message.trim() || "Pedido recebido por anexos.",
                    attachments: files.map(f => f.id),
                    guided,
                  });
                  setDraft({ ...result.draft, description: result.transcript ? `${result.draft.description}\n\nTranscrição do áudio:\n${result.transcript}`.slice(0, 4000) : result.draft.description });
                  setTranscript(result.transcript || "");
                  setNotice(result.message);
                })
          }
        >
          <Send size={18} />
          {busy
            ? "Aguarde…"
            : detail
              ? "Salvar complemento"
              : "Preparar solicitação"}
        </button>
      )}
    </div>
  );
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
          <div className="rounded-2xl bg-indigo-700 text-white p-3">
            <Bot />
          </div>
          <div>
            <h1 className="text-lg font-bold">Assistente LabLayer</h1>
            <p className="text-sm text-slate-500">
              {state
                ? `${state.company} · ${state.seller}`
                : "Acesso por link exclusivo"}
            </p>
          </div>
        </div>
      </header>
      <main className="max-w-2xl mx-auto p-4 pb-12 space-y-5">
        {error && (
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
            {!detail && (
              <nav
                className="grid grid-cols-2 rounded-xl bg-slate-200 p-1 gap-1"
                aria-label="Assistente"
              >
                <button
                  disabled={busy}
                  className={`rounded-lg py-3 ${tab === "new" ? "bg-white shadow-sm" : ""}`}
                  onClick={() => {
                    setTab("new");
                    setNotice("");
                  }}
                >
                  Novo pedido
                </button>
                <button
                  disabled={busy}
                  className={`rounded-lg py-3 ${tab === "list" ? "bg-white shadow-sm" : ""}`}
                  onClick={() =>
                    run(async () => {
                      await load();
                      setTab("list");
                      setNotice("");
                    })
                  }
                >
                  Meus pedidos
                </button>
              </nav>
            )}
            {notice && (
              <p
                role="status"
                className="rounded-xl bg-indigo-50 p-4 text-indigo-900"
              >
                {notice}
              </p>
            )}
            {transcript && <section className="rounded-xl border bg-white p-4">
              <h2 className="font-semibold">Transcrição do áudio — confira</h2>
              <p className="whitespace-pre-wrap">{transcript}</p>
            </section>}
            {detail ? (
              <>
                <button
                  className={secondary}
                  disabled={busy}
                  onClick={() => {
                    setDetail(null);
                    reset();
                    setTab("list");
                    setNotice("");
                  }}
                >
                  <ArrowLeft size={18} /> Voltar aos pedidos
                </button>
                <article className="bg-white rounded-2xl border p-5 space-y-3">
                  <h2 className="text-xl font-bold">{detail.title}</h2>
                  <p>
                    {detail.customerName || "Cliente a confirmar"} ·{" "}
                    {detail.quantity} unidade(s)
                  </p>
                  <p className="font-medium text-indigo-700">
                    {statusLabels[detail.status] || detail.status}
                  </p>
                  <p className="whitespace-pre-wrap">{detail.description}</p>
                  <Files files={detail.attachments || []} load={loadFile} />
                  {detail.notes?.map((note: any) => (
                    <div key={note.id} className="border-t pt-3 space-y-2">
                      <p className="text-xs text-slate-500">
                        Complemento ·{" "}
                        {new Date(note.createdAt).toLocaleString("pt-BR")}
                      </p>
                      <p className="whitespace-pre-wrap">{note.message}</p>
                      <Files files={note.attachments || []} load={loadFile} />
                    </div>
                  ))}
                </article>
                <section className="bg-white rounded-2xl border p-5">
                  {composer}
                </section>
              </>
            ) : tab === "new" ? (
              <>
                <div className="flex items-start gap-3">
                  <MessageSquare className="shrink-0 mt-1 text-indigo-700" />
                  <p>
                    Olá! Envie um pedido de cada vez. Vou organizar o texto e os
                    anexos para cadastrar na fila de orçamentos. Depois você
                    acompanha a situação em <strong>Meus pedidos</strong>.
                  </p>
                </div>
                <section className="bg-white rounded-2xl border p-5 space-y-5">
                  {composer}
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
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              quantity: Number(e.target.value),
                              provisionalQuantity: false,
                            })
                          }
                        />
                      </label>
                      {draft.provisionalQuantity && (
                        <p className="text-sm text-amber-800">
                          Quantidade não identificada: 1 unidade provisória, a
                          confirmar.
                        </p>
                      )}
                      <p className="text-sm text-slate-600">
                        O texto original e os {files.length} anexo(s) serão
                        salvos. Valores ainda serão calculados pela equipe.
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
                              setNotice("");
                            }}
                          >
                            Editar mensagem
                          </button>
                        )}
                      </div>
                    </form>
                  )}
                </section>
              </>
            ) : (
              <section className="space-y-3">
                <p className="text-sm text-slate-500">
                  Até 100 pedidos mais recentes deste link.
                </p>
                {!state.requests.length && (
                  <div className="rounded-2xl bg-white border p-6">
                    Nenhum pedido enviado ainda.
                  </div>
                )}
                {state.requests.map((row: any) => (
                  <button
                    key={row.id}
                    className="w-full text-left rounded-2xl border bg-white p-4 space-y-2"
                    disabled={busy}
                    onClick={() => open(row.id)}
                  >
                    <h2 className="font-semibold">{row.title}</h2>
                    <p className="text-sm">
                      {row.customerName || "Cliente a confirmar"} ·{" "}
                      {row.quantity} unidade(s)
                    </p>
                    <p className="text-sm text-indigo-700">
                      {statusLabels[row.status] || row.status}
                    </p>
                  </button>
                ))}
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
export function AssistantRequestNotes({ requestId }: { requestId: string }) {
  const { user, tenantId } = useAuth();
  const [data, setData] = useState<any>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    if (user && tenantId)
      catalogRequest(
        user,
        `/api/tenants/${tenantId}/assistant-requests/${requestId}`,
      )
        .then((result) => {
          if (active) setData(result);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [user, tenantId, requestId]);
  async function load(id: string) {
    const token = await user!.getIdToken();
    const response = await fetch(
      `/api/tenants/${tenantId}/assets/${id}/download`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!response.ok) throw Error();
    return response.blob();
  }
  if (error) return <p role="alert">Anexos do assistente: {error}</p>;
  if (!data?.seller) return null;
  return (
    <section className="rounded-xl border border-indigo-200 p-4 space-y-3">
      <h3 className="font-semibold">
        Recebido pelo assistente · {data.seller}
      </h3>
      {data.provisionalQuantity && (
        <p>Quantidade inicial provisória: confirmar com o cliente.</p>
      )}
      <Files files={data.attachments || []} load={load} />
      {data.notes.map((note: any) => (
        <div key={note.id} className="border-t pt-3 space-y-2">
          <p className="text-sm">
            Complemento · {new Date(note.createdAt).toLocaleString("pt-BR")}
          </p>
          <p className="whitespace-pre-wrap">{note.message}</p>
          <Files files={note.attachments || []} load={load} />
        </div>
      ))}
    </section>
  );
}
