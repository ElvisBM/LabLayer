import { useEffect, useState } from 'react';
import { Store } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { catalogRequest } from '../catalog/client';

type Connection = { status: string; userId?: string; nickname?: string; checkedAt?: string };
type Settings = { clientId: string; hasSecret: boolean; revision: number; storageReady: boolean; status: string; oauthReady: boolean; connection?: Connection };

export const marketplaceNavigation = { open: (url: string) => window.location.assign(url) };
const callbackMessages: Record<string, string> = {
  denied: 'A autorização foi cancelada no Mercado Livre. Você pode tentar novamente.',
  'invalid-state': 'A tentativa expirou ou pertence a outro navegador. Clique em Conectar Mercado Livre novamente.',
  invalid_client: 'O Mercado Livre recusou o App ID ou Client Secret. Confira as credenciais salvas.',
  invalid_grant: 'O Mercado Livre recusou a autorização. Confira a URL de redirect e inicie uma nova conexão.',
  invalid_scope: 'Confira as permissões do aplicativo no Mercado Livre.',
  unauthorized_client: 'O Mercado Livre não autorizou este aplicativo para a conta.',
  unauthorized_application: 'O aplicativo está bloqueado no Mercado Livre. Confira o painel do desenvolvedor.',
  unavailable: 'Não foi possível concluir a conexão. Tente novamente.',
};

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
  const [oauthResult] = useState(() => new URLSearchParams(window.location.search).get('mercadolivre'));
  const connected = settings?.connection?.status === 'connected';
  const unsaved = !!secret || clientId.trim() !== settings?.clientId;
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
      setNotice('Credenciais salvas com segurança. Clique em Conectar Mercado Livre para autorizar a conta.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível salvar.'); setNeedsReload(true);
    } finally { setSecret(''); setBusy(false); }
  }
  async function connect() {
    if (!settings || busy || needsReload || unsaved) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await catalogRequest(user, path.replace('/credentials', '/connect'), { expectedRevision: settings.revision });
      const url = new URL(result.authorizationUrl);
      if (url.origin !== 'https://auth.mercadolivre.com.br' || url.pathname !== '/authorization') throw Error('Endereço de autorização inválido.');
      marketplaceNavigation.open(url.toString());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível iniciar a autorização.');
    } finally { setBusy(false); }
  }
  async function check() {
    if (!settings || busy || needsReload || unsaved) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await catalogRequest(user, path.replace('/credentials', '/check'), {});
      setSettings({ ...settings, connection: result.connection });
      setNotice('Conexão verificada com o Mercado Livre.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível verificar a conexão.'); }
    finally { setBusy(false); }
  }
  const input = 'w-full min-w-0 bg-surface-container rounded p-2 text-sm border border-outline-variant/30';
  return <section aria-label="Integração Mercado Livre" className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/20 shadow-sm min-w-0">
    <div className="flex items-center gap-3 mb-4"><Store className="w-8 h-8 text-primary shrink-0" /><div>
      <h3 className="font-bold text-lg">Mercado Livre</h3>
      <p className="text-xs text-on-surface-variant">{connected ? 'Conta conectada' : settings?.connection?.status === 'reconnect-required' ? 'Reconexão necessária' : settings?.hasSecret ? 'Credenciais salvas — autorização pendente' : 'Conta não conectada'}</p>
    </div></div>
    <p className="text-sm mb-4">Cadastre as credenciais do aplicativo desta empresa. O segredo fica protegido no servidor e não será exibido novamente.</p>
    {oauthResult && oauthResult !== 'connected' && <p role="alert" className="text-sm text-red-700 mb-3">{callbackMessages[oauthResult] || 'A conexão não foi concluída. Inicie uma nova tentativa.'}</p>}
    {error && <p role="alert" className="text-sm text-red-700 mb-3">{error}</p>}
    {notice && <p role="status" className="text-sm text-green-700 mb-3">{notice}</p>}
    {!settings && !error && <p role="status">Carregando configuração…</p>}
    {settings?.connection?.userId && <p className="text-sm mb-3">Conta Mercado Livre: <strong>{settings.connection.nickname}</strong> (ID {settings.connection.userId})</p>}
    {connected && <p className="text-sm text-green-700 mb-3">Autorização registrada. A sincronização de anúncios, vendas e estoque ainda não está ativada.</p>}
    {settings && <form aria-label="Credenciais Mercado Livre" onSubmit={save} className="space-y-3">
      <fieldset disabled={busy || needsReload || !settings.storageReady} className="space-y-3 disabled:opacity-60">
        <label className="block text-sm">App ID / Client ID<input className={input} inputMode="numeric" pattern="[0-9]{5,30}" maxLength={30} required value={clientId} onChange={e => setClientId(e.target.value)} /></label>
        <label className="block text-sm">Client Secret<input type="password" autoComplete="new-password" spellCheck={false} className={input} minLength={16} maxLength={512} required={!settings.hasSecret || clientId.trim() !== settings.clientId} value={secret} onChange={e => setSecret(e.target.value)} /></label>
        {settings.hasSecret && <p className="text-xs">Segredo cadastrado. Deixe em branco para mantê-lo ou informe um novo para substituí-lo.</p>}
        <button className="w-full py-2.5 bg-[#2D3277] text-white rounded font-bold text-sm" type="submit">{busy ? 'Salvando…' : 'Salvar credenciais'}</button>
      </fieldset>
      {!settings.storageReady && <p role="alert" className="text-sm">Armazenamento protegido indisponível. Tente novamente mais tarde.</p>}
    </form>}
    {settings && <div className="mt-4 space-y-2">
      <button type="button" onClick={connect} disabled={busy || needsReload || unsaved || !settings.hasSecret || !settings.oauthReady} className="w-full py-3 bg-[#FFE600] text-[#2D3277] rounded font-bold text-sm disabled:opacity-50">{connected ? 'Reconectar Mercado Livre' : 'Conectar Mercado Livre'}</button>
      {unsaved && <p className="text-xs">Salve as alterações das credenciais antes de conectar. Salvar novamente exige uma nova autorização.</p>}
      {connected && <button type="button" disabled={busy || needsReload || unsaved} onClick={check} className="text-sm underline disabled:opacity-50">Verificar conexão</button>}
    </div>}
    <button type="button" disabled={busy} className="text-sm underline mt-3 disabled:opacity-50" onClick={() => setReload(n => n + 1)}>Recarregar configuração</button>
    <div className="mt-4 text-xs space-y-2 text-on-surface-variant">
      <p>URL de redirect para cadastrar no Mercado Livre:</p>
      <code className="block break-all select-all">https://app.lablayer.com.br/api/integrations/mercadolivre/callback</code>
      <p>Após salvar, clique em Conectar Mercado Livre e autorize o aplicativo na conta de vendedor desejada. Você retornará a esta tela. A chave e os tokens permanecem protegidos no servidor.</p>
    </div>
  </section>;
}
