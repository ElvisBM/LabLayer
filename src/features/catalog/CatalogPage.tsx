import React, { useEffect, useRef, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import {
  validateCatalog,
  recipeHead,
  id as catalogId,
  type CatalogData,
} from '../../../shared/catalog/model';
import { Field, RecipeEditor } from './RecipeEditor';
import { catalogRequest } from './client';
const cls = 'rounded border border-outline-variant/30 bg-surface-container p-2 text-sm';
const newVariant = () => ({
  id: crypto.randomUUID(),
  name: '',
  sku: '',
  status: 'active' as const,
});
const emptyCatalog = (): CatalogData => ({
  name: '',
  sku: '',
  description: '',
  status: 'active',
  kind: 'product',
  requestId: '',
  variants: [newVariant()],
});
const resourcesEmpty: Record<string, any[]> = {
  catalogItems: [],
  products: [],
  filaments: [],
  printers: [],
  supplies: [],
  customRequests: [],
};
export function CatalogPage({
  onBack,
  operational = false,
}: {
  onBack(): void;
  operational?: boolean;
}) {
  const { tenantId, user } = useAuth();
  if (!tenantId || !user) return null;
  return (
    <CatalogWorkspace
      key={tenantId}
      tenantId={tenantId}
      user={user}
      onBack={onBack}
      operational={operational}
    />
  );
}
function CatalogWorkspace({
  tenantId,
  user,
  onBack,
  operational,
}: {
  tenantId: string;
  user: any;
  onBack(): void;
  operational: boolean;
}) {
  const [resources, setResources] = useState(resourcesEmpty);
  const [selectedId, setSelectedId] = useState('');
  const [versions, setVersions] = useState<any[]>([]);
  const [metadataVersions, setMetadataVersions] = useState<any[]>([]);
  const [editing, setEditing] = useState<{
    id: string;
    revision: number;
    data: CatalogData;
    source: any;
    review: any;
  } | null>(null);
  const [recipeEdit, setRecipeEdit] = useState<{
    item: any;
    variationId: string;
    initial: any;
  } | null>(null);
  const [confirmed, setConfirmed] = useState(false),
    [reason, setReason] = useState('');
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  const pending = useRef<{ payload: string; requestId: string } | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const unsub = Object.keys(resourcesEmpty).map((key) =>
      onSnapshot(
        collection(db, `tenants/${tenantId}/${key}`),
        (snapshot) => {
          setResources((r) => ({
            ...r,
            [key]: snapshot.docs.map((d) => ({ ...d.data(), id: d.id })),
          }));
        },
        () => setError('Não foi possível carregar o catálogo. Confira o acesso e recarregue.'),
      ),
    );
    return () => {
      mounted.current = false;
      unsub.forEach((fn) => fn());
    };
  }, [tenantId]);
  useEffect(() => {
    setVersions([]);
    setMetadataVersions([]);
    if (!selectedId) return;
    const unsubscribe = onSnapshot(
      collection(db, `tenants/${tenantId}/catalogItems/${selectedId}/recipes`),
      (s) => setVersions(s.docs.map((d) => ({ ...d.data(), id: d.id }))),
      () => setError('Erro ao carregar versões.'),
    );
    const unsubscribeMetadata = onSnapshot(
      collection(db, `tenants/${tenantId}/catalogItems/${selectedId}/versions`),
      (s) => setMetadataVersions(s.docs.map((d) => ({ ...d.data(), id: d.id }))),
      () => setError('Erro ao carregar revisões do cadastro.'),
    );
    return () => {
      unsubscribe();
      unsubscribeMetadata();
    };
  }, [tenantId, selectedId]);
  const items = resources.catalogItems;
  const selected = items.find((i) => i.id === selectedId);
  const unprepared = resources.products.filter((p) => !items.some((i) => i.id === p.id));
  function select(itemId: string) {
    setSelectedId(itemId);
    setEditing(null);
    setRecipeEdit(null);
    setError('');
    setNotice('');
  }
  function edit(item?: any) {
    setRecipeEdit(null);
    setError('');
    setNotice('');
    setConfirmed(false);
    setReason('');
    setEditing(
      item
        ? {
            id: item.id,
            revision: item.revision,
            data: {
              name: item.name,
              sku: item.sku,
              description: item.description,
              kind: item.kind,
              requestId: item.requestId,
              status: item.status,
              variants: structuredClone(item.variants),
            },
            source: null,
            review: null,
          }
        : {
            id: crypto.randomUUID(),
            revision: 0,
            data: emptyCatalog(),
            source: null,
            review: null,
          },
    );
  }
  async function reviewLegacy(product: any) {
    setBusy(true);
    setError('');
    setNotice('');
    setRecipeEdit(null);
    try {
      const result = await catalogRequest(
        user,
        `/api/tenants/${encodeURIComponent(tenantId)}/catalog/${encodeURIComponent(product.id)}/legacy-review`,
      );
      if (!mounted.current) return;
      if (!result.source) throw new Error('Recarregue para obter a versão atual da origem.');
      const original = result.source;
      const seen = new Set();
      const variants = (Array.isArray(original.variations) ? original.variations : []).map(
        (v: any) => {
          let stable = !seen.has(v?.id);
          try {
            catalogId(v?.id);
          } catch {
            stable = false;
          }
          const variationId = stable ? v.id : crypto.randomUUID();
          seen.add(variationId);
          return {
            id: variationId,
            name: `${v?.color || 'Variação'} ${v?.material || ''}`.trim(),
            sku: v?.skuSuffix || '',
            status: 'active' as const,
          };
        },
      );
      setSelectedId(product.id);
      setConfirmed(false);
      setReason('');
      setEditing({
        id: product.id,
        revision: 0,
        source: { productId: product.id, updateTime: result.updateTime },
        review: result.review,
        data: {
          ...emptyCatalog(),
          name: original.name || '',
          sku: original.baseSku || '',
          status: original.status === 'inativo' ? 'archived' : 'active',
          variants: variants.length ? variants : [newVariant()],
        },
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setError('');
    try {
      if (editing.source && (!confirmed || !reason.trim()))
        throw new Error('Confirme a revisão e registre o motivo da classificação.');
      const data = validateCatalog(editing.data);
      const command = {
        expectedRevision: editing.revision,
        data,
        legacySource: editing.source ? { ...editing.source, reason } : null,
      };
      const payload = JSON.stringify([editing.id, command]);
      if (pending.current?.payload !== payload)
        pending.current = { payload, requestId: crypto.randomUUID() };
      setBusy(true);
      await catalogRequest(
        user,
        `/api/tenants/${encodeURIComponent(tenantId)}/catalog/${encodeURIComponent(editing.id)}`,
        { ...command, requestId: pending.current.requestId },
      );
      if (!mounted.current) return;
      setSelectedId(editing.id);
      setEditing(null);
      pending.current = null;
      setNotice('Cadastro versionado salvo. Estoque e registros antigos foram preservados.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const patch = (data: Partial<CatalogData>) =>
    setEditing((e) => (e ? { ...e, data: { ...e.data, ...data } } : e));
  return (
    <div className="space-y-6 pb-12">
      <div className="flex justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold text-primary">Catálogo e fichas</h2>
          <p className="text-sm mt-2">
            Prepare produtos, variações e receitas sem registrar fabricação.
          </p>
        </div>
        <button disabled={busy} onClick={onBack}>
          Voltar aos produtos
        </button>
      </div>
      <p role="note" className="rounded border border-outline-variant/30 p-4 text-sm">
        {operational ? (
          'Fichas versionadas para planejar a fabricação. Editar ou arquivar não altera saldos; use os comandos de estoque e produção.'
        ) : (
          <>
            {' '}
            Estas fichas estão em preparação. O estoque e a precificação operacional continuam
            usando os registros anteriores até a migração conjunta de produção e estoque. Salvar
            aqui não altera saldos, preços aprovados ou propostas antigas.
          </>
        )}
      </p>
      {error && (
        <p role="alert" className="text-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <button
        className="bg-primary text-on-primary rounded p-2"
        disabled={busy}
        onClick={() => edit()}
      >
        Novo cadastro sem movimentação
      </button>
      <div className="grid xl:grid-cols-3 gap-6">
        <aside className="space-y-4">
          <h3 className="font-bold">Cadastros preparados ({items.length})</h3>
          {items.map((item) => (
            <button
              disabled={busy}
              key={item.id}
              onClick={() => select(item.id)}
              className="block text-left w-full border rounded p-3"
            >
              <strong>{item.name}</strong>
              <span className="block text-xs">
                {item.sku || item.id} ·{' '}
                {item.status === 'archived'
                  ? 'Arquivado'
                  : item.kind === 'product'
                    ? 'Produto'
                    : 'Solicitação vinculada'}{' '}
                · revisão {item.revision}
              </span>
            </button>
          ))}
          <h3 className="font-bold">Legados a revisar ({unprepared.length})</h3>
          {unprepared.map((p) => (
            <div key={p.id} className="border rounded p-3">
              <p>{p.name}</p>
              <p className="text-xs">
                {p.productType || 'Tipo não informado'} · {p.id}
              </p>
              <button disabled={busy} onClick={() => reviewLegacy(p)}>
                Revisar {p.name}
              </button>
            </div>
          ))}
        </aside>
        <main className="xl:col-span-2 space-y-5">
          {editing && (
            <form onSubmit={save} className="space-y-4 border rounded p-5">
              <h3 className="text-xl font-bold">
                {editing.revision ? 'Editar cadastro' : 'Preparar cadastro'}
              </h3>
              <fieldset disabled={busy} className="space-y-4">
                <Field label="Nome do produto ou referência">
                  <input
                    className={cls}
                    required
                    maxLength={120}
                    value={editing.data.name}
                    onChange={(e) => patch({ name: e.target.value })}
                  />
                </Field>
                <div className="grid md:grid-cols-3 gap-3">
                  <Field label="SKU comercial">
                    <input
                      className={cls}
                      maxLength={60}
                      value={editing.data.sku}
                      onChange={(e) => patch({ sku: e.target.value })}
                    />
                  </Field>
                  <Field label="Classificação">
                    <select
                      className={cls}
                      disabled={editing.revision > 0}
                      value={editing.data.kind}
                      onChange={(e) =>
                        patch({
                          kind: e.target.value as any,
                          requestId: '',
                          variants: e.target.value === 'product' ? [newVariant()] : [],
                        })
                      }
                    >
                      <option value="product">Produto de catálogo</option>
                      <option value="request-reference">Referência a orçamento/encomenda</option>
                    </select>
                  </Field>
                  <Field label="Situação">
                    <select
                      className={cls}
                      value={editing.data.status}
                      onChange={(e) => patch({ status: e.target.value as any })}
                    >
                      <option value="active">Ativo</option>
                      <option value="archived">Arquivado</option>
                    </select>
                  </Field>
                </div>
                <Field label="Descrição comercial">
                  <textarea
                    className={cls}
                    maxLength={2000}
                    value={editing.data.description}
                    onChange={(e) => patch({ description: e.target.value })}
                  />
                </Field>
                {editing.data.kind === 'request-reference' ? (
                  <Field label="Solicitação existente">
                    <select
                      className={cls}
                      required
                      value={editing.data.requestId}
                      onChange={(e) => patch({ requestId: e.target.value })}
                    >
                      <option value="">Selecione no módulo de solicitações</option>
                      {resources.customRequests.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.title} ({r.id})
                        </option>
                      ))}
                    </select>
                    <span className="text-xs">
                      O vínculo não duplica a solicitação nem transfere saldo.
                    </span>
                  </Field>
                ) : (
                  <section className="space-y-3">
                    <h4 className="font-bold">Variações com identidade estável</h4>
                    {editing.data.variants.map((v, index) => (
                      <div className="grid md:grid-cols-3 gap-3 border rounded p-3" key={v.id}>
                        <Field label={`Nome da variação ${index + 1}`}>
                          <input
                            className={cls}
                            required
                            value={v.name}
                            onChange={(e) =>
                              patch({
                                variants: editing.data.variants.map((row, i) =>
                                  i === index ? { ...row, name: e.target.value } : row,
                                ),
                              })
                            }
                          />
                        </Field>
                        <Field label={`SKU da variação ${index + 1}`}>
                          <input
                            className={cls}
                            value={v.sku}
                            onChange={(e) =>
                              patch({
                                variants: editing.data.variants.map((row, i) =>
                                  i === index ? { ...row, sku: e.target.value } : row,
                                ),
                              })
                            }
                          />
                        </Field>
                        <Field label={`Situação da variação ${index + 1}`}>
                          <select
                            className={cls}
                            value={v.status}
                            onChange={(e) =>
                              patch({
                                variants: editing.data.variants.map((row, i) =>
                                  i === index ? { ...row, status: e.target.value as any } : row,
                                ),
                              })
                            }
                          >
                            <option value="active">Ativa</option>
                            <option value="archived">Arquivada</option>
                          </select>
                        </Field>
                        <p className="text-xs break-all">ID: {v.id}</p>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => patch({ variants: [...editing.data.variants, newVariant()] })}
                    >
                      Adicionar variação
                    </button>
                  </section>
                )}
                {editing.review && (
                  <section className="space-y-3 border rounded p-3">
                    <h4 className="font-bold">Conferência do registro original</h4>
                    <ul className="list-disc pl-5">
                      {editing.review.issues.map((x: string, i: number) => (
                        <li key={i}>{x}</li>
                      ))}
                    </ul>
                    {editing.review.candidates.map((v: any) => (
                      <details key={v.index}>
                        <summary>Variação original {v.variationId || v.index + 1}</summary>
                        <ul className="list-disc pl-5">
                          {v.warnings.map((w: string, i: number) => (
                            <li key={i}>{w}</li>
                          ))}
                        </ul>
                        <p className="text-xs">
                          Tempo preservável: {v.durationSeconds ?? 'desconhecido'} s
                        </p>
                        {v.materials.map((m: any, i: number) => (
                          <p className="text-xs" key={i}>
                            Material {m.filamentId || 'sem ID'}: peso {m.weightMg ?? 'desconhecido'}{' '}
                            mg; purga {m.purgeMg ?? 'desconhecida'} mg; suporte{' '}
                            {m.supportMg ?? 'desconhecido'} mg. Valores ainda não confirmados como
                            receita.
                          </p>
                        ))}
                      </details>
                    ))}
                    <Field label="Motivo da classificação">
                      <textarea
                        className={cls}
                        required
                        maxLength={500}
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                      />
                    </Field>
                    <label className="flex gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={confirmed}
                        onChange={(e) => setConfirmed(e.target.checked)}
                      />
                      Conferi a classificação e as variações. Pesos, tempos e rendimento serão
                      confirmados na receita; não estou confirmando saldo de estoque.
                    </label>
                  </section>
                )}
                <div className="flex gap-4">
                  <button className="bg-primary text-on-primary rounded p-2" type="submit">
                    {busy ? 'Salvando...' : 'Salvar cadastro versionado'}
                  </button>
                  <button type="button" onClick={() => setEditing(null)}>
                    Cancelar cadastro
                  </button>
                </div>
              </fieldset>
            </form>
          )}
          {!editing && selected && (
            <section className="space-y-4 border rounded p-5">
              <div className="flex justify-between">
                <h3 className="text-xl font-bold">{selected.name}</h3>
                <button onClick={() => edit(selected)}>Editar nome, variações ou arquivar</button>
              </div>
              <p>{selected.description}</p>
              {selected.kind === 'request-reference' ? (
                <p>
                  Solicitação vinculada: {selected.requestId}. Não possui receita nem saldo neste
                  catálogo.
                </p>
              ) : (
                selected.variants.map((v: any) => {
                  const head = recipeHead(selected.recipeHeads, v.id),
                    version = versions.find((r) => r.id === head);
                  return (
                    <div
                      key={v.id}
                      className="flex flex-wrap items-center justify-between gap-2 border rounded p-3"
                    >
                      <div>
                        <strong>{v.name}</strong>
                        <p className="text-xs">
                          {v.id} · {v.status === 'active' ? 'Ativa' : 'Arquivada'} ·{' '}
                          {version
                            ? `Receita v${version.version}`
                            : head
                              ? 'Carregando versão...'
                              : 'Sem receita confirmada'}
                        </p>
                      </div>
                      <button
                        disabled={
                          selected.status !== 'active' ||
                          v.status !== 'active' ||
                          (!!head && !version)
                        }
                        onClick={() => {
                          setRecipeEdit({
                            item: structuredClone(selected),
                            variationId: v.id,
                            initial: version ? structuredClone(version) : null,
                          });
                          setError('');
                        }}
                      >
                        {version ? 'Criar revisão de receita' : 'Preparar receita'}
                      </button>
                    </div>
                  );
                })
              )}
              <details>
                <summary>Histórico de cadastro e receitas</summary>
                <ul>
                  {[...metadataVersions]
                    .sort((a, b) => b.revision - a.revision)
                    .map((v) => (
                      <li key={v.id}>
                        Cadastro revisão {v.revision}: {v.name} · {v.updatedAt} ·{' '}
                        {v.status === 'archived' ? 'Arquivado' : 'Ativo'}
                      </li>
                    ))}
                </ul>
                {[...versions]
                  .sort((a, b) => b.version - a.version)
                  .map((v) => (
                    <details className="p-2" key={v.id}>
                      <summary>
                        Receita v{v.version} · variação {v.variationId} · {v.createdAt}
                      </summary>
                      <p>
                        {v.recipe.goodUnits} unidade(s) por execução · {v.recipe.durationSeconds} s
                        · {v.recipe.kind === 'print' ? 'Impressão' : 'Montagem'}
                      </p>
                      {v.recipe.materials.map((m: any) => (
                        <p key={m.id}>
                          {m.filamentId}: {m.totalMg} mg{' '}
                          {m.parts
                            ? `(peça ${m.parts.pieceMg}, suporte ${m.parts.supportMg}, purga ${m.parts.purgeMg})`
                            : '(peso total)'}
                        </p>
                      ))}
                      {v.recipe.components.map((c: any) => (
                        <p key={`${c.productId}/${c.variationId}`}>
                          {c.quantity} × {c.productId}/{c.variationId}; versão {c.recipeVersion}
                        </p>
                      ))}
                      <p>{v.recipe.notes}</p>
                      {v.recipe.files.map((f: any, i: number) => (
                        <p key={i}>
                          <a href={f.url} target="_blank" rel="noreferrer" className="underline">
                            {f.name}
                          </a>
                        </p>
                      ))}
                    </details>
                  ))}
              </details>
            </section>
          )}
          {!editing && recipeEdit && (
            <RecipeEditor
              key={`${recipeEdit.item.id}/${recipeEdit.variationId}/${recipeEdit.initial?.id ?? 'new'}`}
              {...recipeEdit}
              resources={resources}
              user={user}
              tenantId={tenantId}
              onClose={() => {
                setRecipeEdit(null);
                setNotice(
                  'Editor fechado. Versões salvas ficam no histórico; nenhum movimento de estoque foi feito.',
                );
              }}
            />
          )}
        </main>
      </div>
    </div>
  );
}
