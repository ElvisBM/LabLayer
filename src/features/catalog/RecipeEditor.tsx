import { AssetUpload, LegacyAssets } from '../assets/AssetControls';
import React, { useEffect, useRef, useState } from 'react';
import {
  fromPhysical,
  parseInput,
  toPhysical,
  validateRecipe,
  recipeHead,
  type Recipe,
} from '../../../shared/catalog/model';
import { catalogRequest } from './client';

const blankRecipe = (): Recipe => ({
  kind: 'print',
  goodUnits: 1,
  durationSeconds: 0,
  printerId: '',
  setupSeconds: 0,
  finishSecondsPerUnit: 0,
  materials: [],
  components: [],
  supplies: [],
  files: [],
  notes: '',
});
const newMaterial = () => ({
  id: crypto.randomUUID(),
  filamentId: '',
  mode: 'total' as 'total' | 'parts',
  total: '',
  piece: '',
  support: '',
  purge: '',
});
export const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="flex flex-col gap-1 text-sm">
    {label}
    {children}
  </label>
);
const cls = 'rounded border border-outline-variant/30 bg-surface-container p-2 text-sm';
export function RecipeEditor({
  item,
  variationId,
  initial,
  resources,
  user,
  tenantId,
  onClose,
}: {
  item: any;
  variationId: string;
  initial: any;
  resources: Record<string, any[]>;
  user: any;
  tenantId: string;
  onClose(): void;
}) {
  const [recipe, setRecipe] = useState<Recipe>(() =>
    structuredClone(initial?.recipe ?? blankRecipe()),
  );
  const [materials, setMaterials] = useState(() =>
    initial?.recipe.materials.length
      ? initial.recipe.materials.map((m: any) => ({
          id: m.id,
          filamentId: m.filamentId,
          mode: m.mode,
          total: fromPhysical(m.totalMg, 'g'),
          piece: m.parts ? fromPhysical(m.parts.pieceMg, 'g') : '',
          support: m.parts ? fromPhysical(m.parts.supportMg, 'g') : '',
          purge: m.parts ? fromPhysical(m.parts.purgeMg, 'g') : '',
        }))
      : [newMaterial()],
  );
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const pending = useRef<{ payload: string; requestId: string } | null>(null);
  const update = (patch: Partial<Recipe>) => setRecipe((r) => ({ ...r, ...patch }));
  const changeMaterial = (index: number, patch: any) =>
    setMaterials((rows) => rows.map((m, i) => (i === index ? { ...m, ...patch } : m)));
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const value = validateRecipe({
        ...recipe,
        materials:
          recipe.kind === 'assembly'
            ? []
            : materials.map((m) => ({
                id: m.id,
                filamentId: m.filamentId,
                mode: m.mode,
                totalMg: toPhysical(m.total, 'g'),
                parts:
                  m.mode === 'total'
                    ? null
                    : {
                        pieceMg: toPhysical(m.piece, 'g'),
                        supportMg: toPhysical(m.support, 'g'),
                        purgeMg: toPhysical(m.purge, 'g'),
                      },
              })),
        supplies: recipe.supplies.map((s) => ({
          ...s,
          quantityPerUnit: parseInput(s.quantityPerUnit),
        })),
      });
      const command = {
        expectedRevision: item.revision,
        variationId,
        expectedRecipeVersion: initial?.id ?? null,
        recipe: value,
      };
      const payload = JSON.stringify(command);
      if (pending.current?.payload !== payload)
        pending.current = { payload, requestId: crypto.randomUUID() };
      setBusy(true);
      await catalogRequest(
        user,
        `/api/tenants/${encodeURIComponent(tenantId)}/catalog/${encodeURIComponent(item.id)}/recipes`,
        { ...command, requestId: pending.current.requestId },
      );
      if (mounted.current) onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const components = resources.catalogItems.filter(
    (i) => i.kind === 'product' && i.status === 'active',
  );
  return (
    <form onSubmit={save} className="rounded-xl border border-outline-variant/30 p-5 space-y-4">
      <h3 className="text-xl font-bold">
        {initial ? `Revisar receita v${initial.version}` : 'Nova receita'} —{' '}
        {item.variants.find((v: any) => v.id === variationId)?.name}
      </h3>
      <p className="text-sm text-on-surface-variant">
        Salvar cria uma versão preservada. Nenhum material será consumido e nenhum produto entrará
        em estoque. Use vírgula ou ponto decimal, sem separador de milhar.
      </p>
      <fieldset disabled={busy} className="space-y-4">
        <div className="grid md:grid-cols-3 gap-3">
          <Field label="Tipo de fabricação">
            <select
              className={cls}
              value={recipe.kind}
              onChange={(e) =>
                update({
                  kind: e.target.value as any,
                  goodUnits: 1,
                  components: [],
                  printerId: '',
                  durationSeconds: 0,
                })
              }
            >
              <option value="print">Impressão</option>
              <option value="assembly">Montagem de componentes</option>
            </select>
          </Field>
          {recipe.kind === 'print' && (
            <>
              <Field label="Unidades boas por execução">
                <input
                  className={cls}
                  type="number"
                  min="1"
                  step="1"
                  required
                  value={recipe.goodUnits}
                  onChange={(e) => update({ goodUnits: Number(e.target.value) })}
                />
              </Field>
              <Field label="Tempo por execução (segundos)">
                <input
                  className={cls}
                  type="number"
                  min="1"
                  step="1"
                  required
                  value={recipe.durationSeconds}
                  onChange={(e) => update({ durationSeconds: Number(e.target.value) })}
                />
              </Field>
              <Field label="Impressora">
                <select
                  className={cls}
                  required
                  value={recipe.printerId}
                  onChange={(e) => update({ printerId: e.target.value })}
                >
                  <option value="">Selecione</option>
                  {resources.printers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {p.status || 'cadastrada'}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          )}
          <Field label="Preparação por execução (segundos)">
            <input
              className={cls}
              type="number"
              min="0"
              step="1"
              value={recipe.setupSeconds}
              onChange={(e) => update({ setupSeconds: Number(e.target.value) })}
            />
          </Field>
          <Field label="Acabamento por unidade (segundos)">
            <input
              className={cls}
              type="number"
              min="0"
              step="1"
              value={recipe.finishSecondsPerUnit}
              onChange={(e) => update({ finishSecondsPerUnit: Number(e.target.value) })}
            />
          </Field>
        </div>
        {recipe.kind === 'print' ? (
          <section className="space-y-3">
            <h4 className="font-bold">Material por execução</h4>
            {materials.map((m, index) => (
              <div
                key={m.id}
                className="border border-outline-variant/30 rounded p-3 grid md:grid-cols-3 gap-3"
              >
                <Field label={`Filamento ${index + 1}`}>
                  <select
                    className={cls}
                    required
                    value={m.filamentId}
                    onChange={(e) => changeMaterial(index, { filamentId: e.target.value })}
                  >
                    <option value="">Selecione</option>
                    {resources.filaments.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.material} {f.color} ({f.id})
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={`Base do peso ${index + 1}`}>
                  <select
                    className={cls}
                    value={m.mode}
                    onChange={(e) => changeMaterial(index, { mode: e.target.value })}
                  >
                    <option value="total">Total já inclui suporte e purga</option>
                    <option value="parts">Conferir peça + suporte + purga</option>
                  </select>
                </Field>
                <Field label={`Peso total ${index + 1} (g)`}>
                  <input
                    className={cls}
                    inputMode="decimal"
                    required
                    value={m.total}
                    onChange={(e) => changeMaterial(index, { total: e.target.value })}
                  />
                </Field>
                {m.mode === 'parts' &&
                  (['piece', 'support', 'purge'] as const).map((key, k) => (
                    <Field key={key} label={`${['Peça', 'Suporte', 'Purga'][k]} ${index + 1} (g)`}>
                      <input
                        className={cls}
                        inputMode="decimal"
                        required
                        value={m[key]}
                        onChange={(e) => changeMaterial(index, { [key]: e.target.value })}
                      />
                    </Field>
                  ))}
                <button
                  type="button"
                  onClick={() => setMaterials((rows) => rows.filter((_, i) => i !== index))}
                >
                  Remover material {index + 1}
                </button>
              </div>
            ))}
            <button type="button" onClick={() => setMaterials((rows) => [...rows, newMaterial()])}>
              Adicionar material
            </button>
          </section>
        ) : (
          <section className="space-y-3">
            <h4 className="font-bold">Componentes por unidade acabada</h4>
            <p className="text-sm">
              10 bases e 6 tampas permitem montar 6 conjuntos. Montáveis não são produtos acabados;
              a montagem será registrada no fluxo de estoque.
            </p>
            {recipe.components.map((c, index) => {
              const component = components.find((p) => p.id === c.productId);
              return (
                <div key={index} className="grid md:grid-cols-3 gap-3 border rounded p-3">
                  <Field label={`Produto componente ${index + 1}`}>
                    <select
                      className={cls}
                      required
                      value={c.productId}
                      onChange={(e) =>
                        update({
                          components: recipe.components.map((row, i) =>
                            i === index
                              ? {
                                  ...row,
                                  productId: e.target.value,
                                  variationId: '',
                                  recipeVersion: '',
                                }
                              : row,
                          ),
                        })
                      }
                    >
                      <option value="">Selecione</option>
                      {components.map((p) => (
                        <option value={p.id} key={p.id}>
                          {p.name} ({p.sku || p.id})
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={`Variação do componente ${index + 1}`}>
                    <select
                      className={cls}
                      required
                      value={c.variationId}
                      onChange={(e) =>
                        update({
                          components: recipe.components.map((row, i) =>
                            i === index
                              ? {
                                  ...row,
                                  variationId: e.target.value,
                                  recipeVersion: component
                                    ? (recipeHead(component.recipeHeads, e.target.value) ?? '')
                                    : '',
                                }
                              : row,
                          ),
                        })
                      }
                    >
                      <option value="">Selecione</option>
                      {component?.variants
                        .filter((v: any) => v.status === 'active')
                        .map((v: any) => (
                          <option key={v.id} value={v.id}>
                            {v.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <Field label={`Quantidade do componente ${index + 1}`}>
                    <input
                      className={cls}
                      type="number"
                      min="1"
                      step="1"
                      value={c.quantity}
                      onChange={(e) =>
                        update({
                          components: recipe.components.map((row, i) =>
                            i === index ? { ...row, quantity: Number(e.target.value) } : row,
                          ),
                        })
                      }
                    />
                  </Field>
                  <p className="text-xs">
                    {c.recipeVersion
                      ? 'Versão de receita fixada; mudanças futuras no componente não alteram esta ficha.'
                      : 'O componente precisa de uma receita de impressão salva.'}
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      update({ components: recipe.components.filter((_, i) => i !== index) })
                    }
                  >
                    Remover componente {index + 1}
                  </button>
                </div>
              );
            })}
            <button
              type="button"
              onClick={() =>
                update({
                  components: [
                    ...recipe.components,
                    { productId: '', variationId: '', recipeVersion: '', quantity: 1 },
                  ],
                })
              }
            >
              Adicionar componente
            </button>
          </section>
        )}
        <section className="space-y-3">
          <h4 className="font-bold">Insumos por unidade</h4>
          {recipe.supplies.map((s, index) => (
            <div key={index} className="flex flex-wrap gap-3">
              <Field label={`Insumo ${index + 1}`}>
                <select
                  className={cls}
                  required
                  value={s.supplyId}
                  onChange={(e) =>
                    update({
                      supplies: recipe.supplies.map((row, i) =>
                        i === index
                          ? {
                              ...row,
                              supplyId: e.target.value,
                              unit:
                                resources.supplies.find((x) => x.id === e.target.value)?.unit ?? '',
                            }
                          : row,
                      ),
                    })
                  }
                >
                  <option value="">Selecione</option>
                  {resources.supplies.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name} ({x.unit})
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label={`Quantidade do insumo ${index + 1} (${s.unit || 'unidade do cadastro'})`}
              >
                <input
                  className={cls}
                  inputMode="decimal"
                  required
                  value={s.quantityPerUnit}
                  onChange={(e) =>
                    update({
                      supplies: recipe.supplies.map((row, i) =>
                        i === index ? { ...row, quantityPerUnit: e.target.value } : row,
                      ),
                    })
                  }
                />
              </Field>
              <button
                type="button"
                onClick={() => update({ supplies: recipe.supplies.filter((_, i) => i !== index) })}
              >
                Remover insumo {index + 1}
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              update({
                supplies: [...recipe.supplies, { supplyId: '', unit: '', quantityPerUnit: '1' }],
              })
            }
          >
            Adicionar insumo
          </button>
        </section>
        <details>
          <summary>Arquivos e observações</summary>
          <div className="space-y-3 mt-3">
            <p className="text-sm">
              Envie arquivos privados ou informe links HTTPS já armazenados. O conteúdo não é
              incorporado à ficha.
            </p>
            <AssetUpload
              user={user}
              tenantId={tenantId}
              disabled={recipe.files.length >= 10}
              onUploaded={(file) => update({ files: [...recipe.files, file] })}
            />
            {recipe.files.length < 10 && (
              <LegacyAssets
                user={user}
                tenantId={tenantId}
                collection="products"
                documentId={item.id}
                onImported={(file) => update({ files: [...recipe.files, file] })}
              />
            )}
            {recipe.files.map((f, index) => (
              <div className="flex flex-wrap gap-2" key={index}>
                <Field label={`Nome do arquivo ${index + 1}`}>
                  <input
                    className={cls}
                    required
                    value={f.name}
                    onChange={(e) =>
                      update({
                        files: recipe.files.map((row, i) =>
                          i === index ? { ...row, name: e.target.value } : row,
                        ),
                      })
                    }
                  />
                </Field>
                <Field label={`URL do arquivo ${index + 1}`}>
                  <input
                    className={cls}
                    required
                    value={f.url}
                    onChange={(e) =>
                      update({
                        files: recipe.files.map((row, i) =>
                          i === index ? { ...row, url: e.target.value } : row,
                        ),
                      })
                    }
                  />
                </Field>
                <button
                  type="button"
                  onClick={() => update({ files: recipe.files.filter((_, i) => i !== index) })}
                >
                  Remover arquivo {index + 1}
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => update({ files: [...recipe.files, { name: '', url: '' }] })}
            >
              Adicionar referência de arquivo
            </button>
            <Field label="Observações da receita">
              <textarea
                className={cls}
                maxLength={2000}
                value={recipe.notes}
                onChange={(e) => update({ notes: e.target.value })}
              />
            </Field>
          </div>
        </details>
        {error && (
          <p role="alert" className="text-error">
            {error}
          </p>
        )}
        <div className="flex gap-4">
          <button className="bg-primary text-on-primary rounded p-2" type="submit">
            {busy ? 'Salvando...' : 'Salvar nova versão'}
          </button>
          <button type="button" onClick={onClose}>
            Cancelar receita
          </button>
        </div>
      </fieldset>
    </form>
  );
}
