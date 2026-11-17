import { useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { catalogRequest } from '../catalog/client';
import { assetId, MAX_ASSET_BYTES } from '../../../shared/assets/model';
const mimeFor = (name: string, browserMime: string) => {
  const ext = name.split('.').at(-1)?.toLowerCase();
  return (
    (
      {
        stl: 'model/stl',
        '3mf': 'model/3mf',
        pdf: 'application/pdf',
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        webp: 'image/webp',
      } as Record<string, string>
    )[ext ?? ''] ?? browserMime
  );
};
export function AssetUpload({
  user,
  tenantId,
  onUploaded,
  disabled = false,
}: {
  user: any;
  tenantId: string;
  onUploaded(file: { name: string; url: string }): void;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const picker = useRef<HTMLInputElement>(null);
  return (
    <div>
      <label>
        Enviar arquivo privado (até 10 MiB)
        <input
          ref={picker}
          type="file"
          accept=".png,.jpg,.jpeg,.webp,.pdf,.stl,.3mf"
          disabled={busy || disabled}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setError('');
            setBusy(true);
            try {
              if (file.size > MAX_ASSET_BYTES) throw new Error('Arquivo excede 10 MiB.');
              const response = await fetch(`/api/tenants/${tenantId}/assets/upload`, {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${await user.getIdToken()}`,
                  'Content-Type': 'application/octet-stream',
                  'X-File-Name': encodeURIComponent(file.name),
                  'X-File-Type': mimeFor(file.name, file.type),
                },
                body: file,
              });
              if (!response.ok) {
                const result = await response.json().catch(() => ({}));
                throw new Error(result.error || 'Upload não confirmado. Tente novamente.');
              }
              const result = await response.json();
              onUploaded({ name: result.name, url: result.reference });
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Falha no upload.');
            } finally {
              setBusy(false);
              if (picker.current) picker.current.value = '';
            }
          }}
        />
      </label>
      {busy && <p role="status">Armazenando e conferindo o arquivo...</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
export function AssetLink({ reference, children }: { reference: string; children: any }) {
  const { user, tenantId } = useAuth();
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const key = assetId(reference);
  if (!key)
    return (
      <a href={reference} target="_blank" rel="noreferrer" className="underline">
        {children}
      </a>
    );
  return (
    <span>
      <button
        type="button"
        className="underline"
        disabled={busy || !user || !tenantId}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            const response = await fetch(`/api/tenants/${tenantId}/assets/${key}/download`, {
              headers: { Authorization: `Bearer ${await user!.getIdToken()}` },
            });
            if (!response.ok) throw new Error((await response.json()).error || 'Falha ao baixar.');
            const blob = await response.blob(),
              url = URL.createObjectURL(blob),
              link = document.createElement('a');
            link.href = url;
            const header = response.headers.get('Content-Disposition');
            link.download = header?.includes("UTF-8''")
              ? decodeURIComponent(header.split("UTF-8''")[1])
              : 'arquivo';
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Falha ao baixar.');
          } finally {
            setBusy(false);
          }
        }}
      >
        {children}
      </button>
      {error && <span role="alert">{error}</span>}
    </span>
  );
}
export function LegacyAssets({
  user,
  tenantId,
  collection,
  documentId,
  onImported,
}: {
  user: any;
  tenantId: string;
  collection: 'products' | 'customRequests';
  documentId: string;
  onImported(file: { name: string; url: string }): void;
}) {
  const [files, setFiles] = useState<any[] | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  if (!documentId) return null;
  const endpoint = `/api/tenants/${tenantId}/assets/legacy/${collection}/${encodeURIComponent(documentId)}`;
  return (
    <details>
      <summary>Migrar arquivos incorporados do registro antigo</summary>
      <p>
        Somente o responsável pode importar. O original será preservado; a nova referência será
        adicionada ao rascunho atual.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            setFiles((await catalogRequest(user, endpoint)).files);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Conferir mídia antiga
      </button>
      {files?.length === 0 && <p>Nenhuma mídia incorporada neste registro.</p>}
      {files?.map((f) => (
        <p key={f.field}>
          {f.name}{' '}
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                const r = await catalogRequest(user, endpoint, {
                  field: f.field,
                  sourceHash: f.sourceHash,
                });
                onImported({ name: r.name, url: r.reference });
                setFiles((previous) => previous?.filter((x) => x.field !== f.field) ?? []);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Importar {f.name}
          </button>
        </p>
      ))}
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
