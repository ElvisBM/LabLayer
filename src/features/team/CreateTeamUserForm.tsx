import { useState } from 'react';
import type { User } from 'firebase/auth';
import { catalogRequest } from '../catalog/client';

export function CreateTeamUserForm({ user, tenantId, disabled, onCreated }: {
  user: User; tenantId: string; disabled: boolean; onCreated: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [password, setPassword] = useState('');
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const changed = () => {
    setRequestId(crypto.randomUUID()); setError(''); setNotice('');
    if (attempted) setPassword('');
    setAttempted(false);
  };
  async function submit() {
    if (busy || disabled) return;
    setBusy(true); setAttempted(true); setError(''); setNotice('');
    try {
      await catalogRequest(user, `/api/tenants/${tenantId}/team/create-user`, { requestId, name: name.trim(), email: email.trim().toLowerCase(), role, password });
      setPassword(''); setName(''); setEmail(''); setRole('member'); setRequestId(crypto.randomUUID()); setAttempted(false);
      setNotice('Usuário cadastrado com acesso à empresa atual. Ele já pode entrar com o e-mail e a senha inicial.');
      try { await onCreated(); }
      catch { setError('Cadastro concluído, mas a lista não foi atualizada. Clique em Atualizar acessos.'); }
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível cadastrar o usuário.'); }
    finally { setBusy(false); }
  }
  return <form className="rounded-xl border border-slate-200 bg-white p-5 space-y-4" aria-label="Cadastrar usuário" onSubmit={e => { e.preventDefault(); void submit(); }}>
    <div><h3 className="font-bold text-lg">Cadastrar usuário</h3><p className="text-sm text-slate-600">Crie uma conta e dê acesso a esta empresa. Para um e-mail que já tem conta, use a solicitação de acesso abaixo.</p></div>
    <fieldset disabled={disabled || busy} className="grid gap-4 sm:grid-cols-2">
      <label className="space-y-1">Nome<input className="block w-full rounded border p-2" required maxLength={100} autoComplete="name" value={name} onChange={e => { setName(e.target.value); changed(); }} /></label>
      <label className="space-y-1">E-mail<input className="block w-full rounded border p-2" type="email" required maxLength={254} autoComplete="off" value={email} onChange={e => { setEmail(e.target.value); changed(); }} /></label>
      <label className="space-y-1">Tipo de acesso<select className="block w-full rounded border p-2" value={role} onChange={e => { setRole(e.target.value); changed(); }}><option value="member">Operador</option><option value="admin">Administrador</option></select></label>
      <label className="space-y-1">Senha inicial<input className="block w-full rounded border p-2" type="password" autoComplete="new-password" required minLength={12} maxLength={128} readOnly={attempted} aria-describedby="initial-password-help" value={password} onChange={e => setPassword(e.target.value)} /></label>
      <p id="initial-password-help" className="text-sm text-slate-600 sm:col-span-2">Use de 12 a 128 caracteres. A senha é usada apenas na criação da conta e não fica disponível para consulta. Nenhum e-mail é enviado automaticamente.</p>
      <button className="rounded bg-slate-900 text-white px-4 py-2 disabled:opacity-50" disabled={!name.trim() || !email.trim() || password.length < 12}>{busy ? 'Cadastrando…' : 'Cadastrar usuário'}</button>
      {attempted && <button type="button" className="rounded border p-2" onClick={() => { changed(); setName(''); setEmail(''); setRole('member'); }}>Iniciar outro cadastro</button>}
    </fieldset>
    {attempted && !busy && <p className="text-sm text-slate-600">Ao tentar novamente, o cadastro conserva a senha da primeira tentativa. Para corrigir os dados, inicie outro cadastro.</p>}
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {notice && <p role="status" className="text-emerald-700">{notice}</p>}
  </form>;
}
