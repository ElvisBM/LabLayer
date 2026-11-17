import { useEffect, useState } from 'react';
import { Bot, Copy, Plus, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { catalogRequest } from '../catalog/client';
import { Files, RequestTimeline } from './AssistantChat';
export { AssistantChat, RequestTimeline } from './AssistantChat';

const field =
  "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-900";
const button =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-700 px-4 py-3 font-semibold text-white disabled:opacity-50";
const secondary =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-slate-700 disabled:opacity-50";
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
          O link abre sem login. Em empresas com atendimento compartilhado, todos os
          vendedores consultam os pedidos da empresa e podem acrescentar informações.
          O link vence em 90 dias e pode ser revogado aqui. Compartilhe com sua equipe.
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
  if (!data) return <p className="text-sm">Carregando linha do tempo…</p>;
  return (
    <section className="rounded-xl border border-indigo-200 p-4 space-y-3">
      <h3 className="font-semibold">
        Histórico do atendimento{data.seller ? ` · ${data.seller}` : ""}
      </h3>
      {data.provisionalQuantity && (
        <p>Quantidade inicial provisória: confirmar com o cliente.</p>
      )}
      <Files files={data.attachments || []} load={load} />
      <RequestTimeline notes={data.notes || []} load={load} />
    </section>
  );
}
