import { useEffect, useState, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { catalogRequest } from '../catalog/client';

type Shop = { id: string; name: string; region: string };
type Settings = { appKey: string; serviceId: string; hasSecret: boolean; revision: number; storageReady: boolean;
  connection: { status: string; connectionId: string | null; shops: Shop[]; shop: Shop | null } };
export const tikTokNavigation = { open: (url: string) => window.location.assign(url) };
const labels: Record<string, string> = { 'not-connected': 'Autorização pendente', 'reconnect-required': 'Reconexão necessária', 'select-shop': 'Selecione a loja para concluir', connected: 'Loja conectada' };
const callbacks: Record<string, string> = { 'select-shop': 'Autorização recebida. Selecione abaixo a loja desta empresa.', denied: 'Autorização cancelada. Você pode tentar novamente.',
  'invalid-state': 'Tentativa expirada ou inválida. Clique em Conectar TikTok Shop novamente.', 'no-br-shop': 'Nenhuma loja brasileira foi retornada. Confira a conta e as permissões do aplicativo.', unavailable: 'Não foi possível concluir a autorização. Confira o aplicativo no Partner Center e tente novamente.' };
export function TikTokCredentials() {
  const { user, tenantId } = useAuth();
  return user && tenantId ? <Form key={`${user.uid}:${tenantId}`} user={user} tenant={tenantId} /> : null;
}
function Form({ user, tenant }: { user: { getIdToken(): Promise<string> }; tenant: string }) {
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [settings, setSettings] = useState<Settings | null>(null), [appKey, setAppKey] = useState(''), [secret, setSecret] = useState(''), [serviceId, setServiceId] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [reload, setReload] = useState(0), [needsReload, setNeedsReload] = useState(false);
  const [shopId, setShopId] = useState('');
  const [callback] = useState(() => new URLSearchParams(window.location.search).get('tiktokshop'));
  const base = `/api/tenants/${encodeURIComponent(tenant)}/integrations/tiktokshop`;
  const unsaved = !!secret || appKey.trim() !== settings?.appKey || serviceId.trim() !== settings?.serviceId;
  function accept(s: Settings) { setSettings(s); setAppKey(s.appKey); setServiceId(s.serviceId); setShopId(s.connection.shop?.id || ''); }
  useEffect(() => {
    let alive = true; setSettings(null); setSecret(''); setError(''); setNotice(''); setNeedsReload(false);
    catalogRequest(user, base + '/credentials').then(s => { if (alive) accept(s); }).catch(e => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [user, base, reload]);
  async function run(kind: 'credentials' | 'connect' | 'select-shop' | 'check') {
    if (!settings || busy || needsReload || (kind !== 'credentials' && unsaved)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const body = kind === 'credentials' ? { appKey: appKey.trim(), appSecret: secret, serviceId: serviceId.trim(), expectedRevision: settings.revision }
        : kind === 'connect' ? { expectedRevision: settings.revision } : kind === 'select-shop' ? { shopId, connectionId: settings.connection.connectionId } : {};
      const result = await catalogRequest(user, base + '/' + kind, body);
      if (!mounted.current) return;
      if (kind === 'connect') {
        const url = new URL(result.authorizationUrl);
        if (url.origin !== 'https://services.tiktokshop.com' || url.pathname !== '/open/authorize' || url.username || url.password) throw Error('Endereço de autorização inválido.');
        tikTokNavigation.open(url.toString());
      } else {
        accept(result); setNotice(kind === 'credentials' ? 'Credenciais salvas. Clique em Conectar TikTok Shop para autorizar sua loja.' : kind === 'select-shop' ? 'Loja selecionada. Os produtos podem ser consultados no menu Anúncios.' : 'Consulta de autorização concluída.');
      }
    } catch (e) { if (!mounted.current) return; setError(e instanceof Error ? e.message : 'Não foi possível confirmar a operação.'); if (kind !== 'connect') setNeedsReload(true); }
    finally { if (mounted.current) { setSecret(''); setBusy(false); } }
  }
  const input = 'w-full min-w-0 bg-surface-container rounded p-2 text-sm border border-outline-variant/30';
  return <section aria-label="Integração TikTok Shop" className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/20 shadow-sm min-w-0 space-y-3">
    <h3 className="font-bold text-lg">TikTok Shop</h3>
    <p className="text-sm">{settings ? labels[settings.connection.status] || 'Configuração pendente' : 'Carregando configuração…'}</p>
    <p className="text-sm">Cadastre o aplicativo do TikTok Shop Partner Center e autorize a conta de vendedor. O App Secret fica protegido no servidor.</p>
    {callback && <p role="status" className="text-sm">{callbacks[callback] || 'Confira a conexão abaixo.'}</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="text-sm text-green-700">{notice}</p>}
    {settings && <>
      <form aria-label="Credenciais TikTok Shop" onSubmit={e => { e.preventDefault(); void run('credentials'); }}>
        <fieldset disabled={busy || needsReload || !settings.storageReady} className="space-y-3 disabled:opacity-50">
          <label className="block text-sm">App Key<input required className={input} maxLength={128} value={appKey} onChange={e => setAppKey(e.target.value)} /></label>
          <label className="block text-sm">App Secret<input type="password" autoComplete="new-password" spellCheck={false} className={input} required={!settings.hasSecret || appKey.trim() !== settings.appKey} minLength={16} maxLength={512} value={secret} onChange={e => setSecret(e.target.value)} /></label>
          {settings.hasSecret && <p className="text-xs">Segredo cadastrado. Deixe em branco para mantê-lo.</p>}
          <label className="block text-sm">Service ID<input required inputMode="numeric" pattern="[0-9]+" maxLength={40} className={input} value={serviceId} onChange={e => setServiceId(e.target.value)} /></label>
          <p className="text-xs">O Service ID aparece no link de autorização de vendedor do aplicativo, após service_id=.</p>
          <button type="submit" className="w-full bg-slate-900 text-white rounded py-3">Salvar credenciais TikTok</button>
        </fieldset>
      </form>
      {!settings.storageReady && <p role="alert">Armazenamento protegido indisponível.</p>}
      <button onClick={() => run('connect')} disabled={busy || needsReload || unsaved || !settings.hasSecret || !settings.storageReady} className="w-full bg-slate-900 text-white rounded py-3 disabled:opacity-50">{settings.connection.status === 'connected' ? 'Reconectar TikTok Shop' : 'Conectar TikTok Shop'}</button>
      {unsaved && <p className="text-xs">Salve as alterações antes de conectar. Salvar credenciais novamente exige nova autorização.</p>}
      {['connected', 'select-shop'].includes(settings.connection.status) && <div className="space-y-2">
        {settings.connection.shop && <p className="text-sm">Loja atual: <strong>{settings.connection.shop.name}</strong> · {settings.connection.shop.id}</p>}
        <label className="block text-sm">Loja desta empresa<select className={input} value={shopId} disabled={busy || needsReload || unsaved} onChange={e => setShopId(e.target.value)}><option value="">Selecione a loja brasileira</option>{settings.connection.shops.map(s => <option key={s.id} value={s.id}>{s.name} · {s.id} ({s.region})</option>)}</select></label>
        <button disabled={busy || needsReload || unsaved || !shopId} onClick={() => run('select-shop')} className="border rounded px-3 py-2 disabled:opacity-50">Usar esta loja</button>
        <button disabled={busy || needsReload || unsaved} onClick={() => run('check')} className="underline text-sm ml-3 disabled:opacity-50">Verificar conexão TikTok</button>
      </div>}
    </>}
    <button onClick={() => setReload(n => n + 1)} disabled={busy} className="underline text-sm">Recarregar configuração TikTok</button>
    <p className="text-xs">URL de redirect para cadastrar no Partner Center:</p>
    <code className="text-xs block break-all select-all">https://app.lablayer.com.br/api/integrations/tiktokshop/callback</code>
    <p className="text-xs">Esta etapa permite consultar anúncios. Publicação, pedidos e sincronização de estoque serão habilitados nas próximas etapas.</p>
  </section>;
}
