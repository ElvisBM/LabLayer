import { useEffect, useState } from 'react';
import { Store } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { catalogRequest } from '../catalog/client';

type Settings = { clientId: string; hasSecret: boolean; revision: number; storageReady: boolean; status: string };

export function MercadoLivreCredentials() {
  const { user, tenantId } = useAuth();
  return user && tenantId ? <CredentialsForm key={`${user.uid}:${tenantId}`} user={user} tenantId={tenantId} /> : null;
}

function CredentialsForm({ user, tenantId }: { user: { getIdToken(): Promise<string> }; tenantId: string }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  const [needsReload, setNeedsReload] = useState(false);
  const path = `/api/tenants/${encodeURIComponent(tenantId)}/integrations/mercadolivre/credentials`;
  useEffect(() => {
    let current = true;
    setSettings(null); setError(''); setNotice(''); setSecret(''); setNeedsReload(false);
    catalogRequest(user, path).then(data => {
      if (current) { setSettings(data); setClientId(data.clientId); }
    }).catch(e => { if (current) setError(e.message); });
    return () => { current = false; };
  }, [user, path, reload]);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!settings || busy || needsReload) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const data = await catalogRequest(user, path, { clientId: clientId.trim(), clientSecret: secret, expectedRevision: settings.revision });
      setSettings(data); setClientId(data.clientId);
      setNotice('Credenciais salvas com segurança. A autorização da conta ainda está pendente.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível salvar.'); setNeedsReload(true);
    } finally { setSecret(''); setBusy(false); }
  }
  const input = 'w-full min-w-0 bg-surface-container rounded p-2 text-sm border border-outline-variant/30';
  return <section aria-label="Integração Mercado Livre" className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/20 shadow-sm min-w-0">
    <div className="flex items-center gap-3 mb-4"><Store className="w-8 h-8 text-primary shrink-0" /><div>
      <h3 className="font-bold text-lg">Mercado Livre</h3>
      <p className="text-xs text-on-surface-variant">{settings?.hasSecret ? 'Credenciais salvas — autorização pendente' : 'Conta não conectada'}</p>
    </div></div>
    <p className="text-sm mb-4">Cadastre as credenciais do aplicativo desta empresa. O segredo fica protegido no servidor e não será exibido novamente.</p>
    {error && <p role="alert" className="text-sm text-red-700 mb-3">{error}</p>}
    {notice && <p role="status" className="text-sm text-green-700 mb-3">{notice}</p>}
    {!settings && !error && <p role="status">Carregando configuração…</p>}
    {settings && <form aria-label="Credenciais Mercado Livre" onSubmit={save} className="space-y-3">
      <fieldset disabled={busy || needsReload || !settings.storageReady} className="space-y-3 disabled:opacity-60">
        <label className="block text-sm">App ID / Client ID<input className={input} inputMode="numeric" pattern="[0-9]{5,30}" maxLength={30} required value={clientId} onChange={e => setClientId(e.target.value)} /></label>
        <label className="block text-sm">Client Secret<input type="password" autoComplete="new-password" spellCheck={false} className={input} minLength={16} maxLength={512} required={!settings.hasSecret || clientId.trim() !== settings.clientId} value={secret} onChange={e => setSecret(e.target.value)} /></label>
        {settings.hasSecret && <p className="text-xs">Segredo cadastrado. Deixe em branco para mantê-lo ou informe um novo para substituí-lo.</p>}
        <button className="w-full py-2.5 bg-[#2D3277] text-white rounded font-bold text-sm" type="submit">{busy ? 'Salvando…' : 'Salvar credenciais'}</button>
      </fieldset>
      {!settings.storageReady && <p role="alert" className="text-sm">Armazenamento protegido indisponível. Tente novamente mais tarde.</p>}
    </form>}
    <button type="button" disabled={busy} className="text-sm underline mt-3 disabled:opacity-50" onClick={() => setReload(n => n + 1)}>Recarregar configuração</button>
    <div className="mt-4 text-xs space-y-2 text-on-surface-variant">
      <p>URL de redirect para cadastrar no Mercado Livre:</p>
      <code className="block break-all select-all">https://app.lablayer.com.br/api/integrations/mercadolivre/callback</code>
      <p>Salvar as credenciais não conecta a conta nem sincroniza anúncios, vendas ou estoque. A autorização OAuth será disponibilizada na próxima etapa.</p>
    </div>
  </section>;
}
