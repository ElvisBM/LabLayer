import { useEffect, useState } from 'react';
import { sendEmailVerification } from 'firebase/auth';
import { useAuth } from '../../contexts/AuthContext';
import { catalogRequest } from '../catalog/client';

type Member = { uid: string; email: string; role: string; revision: number };
type AccessRequest = { uid: string; email: string; revision: number };
type Team = { tenantId: string; companyName: string; isOwner: boolean; members: Member[]; requests: AccessRequest[] };
type Companies = { currentTenantId: string; email: string; companies: { id: string; name: string; role: string }[] };
const roles: Record<string, string> = { owner: 'Proprietário', admin: 'Administrador', member: 'Operador' };

export function TeamPage() {
  const { user, tenantId } = useAuth();
  const [team, setTeam] = useState<Team | null>(null);
  const [companies, setCompanies] = useState<Companies | null>(null);
  const [requestTenant, setRequestTenant] = useState('');
  const [selectedRoles, setSelectedRoles] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revoke, setRevoke] = useState<Member | null>(null);
  const [emailVerified, setEmailVerified] = useState(user?.emailVerified !== false);
  async function load() {
    if (!user || !tenantId) return;
    const [nextTeam, nextCompanies] = await Promise.all([
      catalogRequest(user, `/api/tenants/${tenantId}/team`), catalogRequest(user, '/api/team/companies'),
    ]);
    setTeam(nextTeam); setCompanies(nextCompanies);
  }
  useEffect(() => {
    let current = true;
    setTeam(null); setCompanies(null); setError(''); setNotice(''); setRevoke(null);
    setEmailVerified(user?.emailVerified !== false);
    if (user && tenantId) Promise.all([
      catalogRequest(user, `/api/tenants/${tenantId}/team`), catalogRequest(user, '/api/team/companies'),
    ]).then(([nextTeam, nextCompanies]) => { if (current) { setTeam(nextTeam); setCompanies(nextCompanies); } })
      .catch(e => { if (current) setError(e.message); });
    return () => { current = false; };
  }, [user, tenantId]);
  async function run(path: string, body: unknown, message: string, reload = false) {
    if (!user || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await catalogRequest(user, path, body);
      if (reload) { window.location.reload(); return; }
      await load(); setNotice(message); setRevoke(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível concluir.'); }
    finally { setBusy(false); }
  }
  async function verifyEmail(check: boolean) {
    if (!user || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      if (check) {
        await user.reload(); await user.getIdToken(true);
        setEmailVerified(user.emailVerified);
        setNotice(user.emailVerified ? 'E-mail verificado. Você já pode solicitar acesso.' : 'A confirmação ainda não foi encontrada. Abra o link recebido no seu e-mail.');
      } else {
        await sendEmailVerification(user);
        setNotice('Link de verificação enviado para o e-mail da sua conta.');
      }
    } catch { setError('Não foi possível verificar o e-mail. Tente novamente.'); }
    finally { setBusy(false); }
  }
  return <section className="space-y-5 max-w-5xl">
    <h2 className="text-2xl font-bold">Usuários e empresa</h2>
    <p>Conta: {user?.email || 'E-mail não disponível'} · Empresa atual: {tenantId}</p>
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {!emailVerified && <div className="rounded border p-4 space-y-2">
      <p>Confirme seu e-mail para solicitar acesso a outra empresa.</p>
      <button className="border p-2" disabled={busy} onClick={() => verifyEmail(false)}>Enviar link de verificação</button>
      <button className="ml-3 border p-2" disabled={busy} onClick={() => verifyEmail(true)}>Já confirmei meu e-mail</button>
    </div>}
    <button className="rounded border p-2" disabled={busy} onClick={async () => { setError(''); try { await load(); } catch (e) { setError((e as Error).message); } }}>Atualizar acessos</button>
    {!team && !error && <p role="status">Carregando acessos...</p>}
    {team && <>
      <div className="rounded border p-4 space-y-2">
        <h3 className="font-bold">{team.companyName || 'Minha Empresa'}</h3>
        <p>ID para solicitar acesso: <code className="break-all">{team.tenantId}</code></p>
        <p>Cada pessoa entra com sua própria conta, solicita acesso pelo ID acima e aguarda aprovação do proprietário. Depois seleciona esta empresa na própria conta.</p>
        <p>Operadores acessam os dados da empresa e as operações permitidas ao membro. Administradores também podem aprovar orçamentos e registrar financeiro. Somente o proprietário gerencia usuários.</p>
      </div>
      {team.isOwner ? <>
        <h3 className="font-bold">Pessoas com acesso</h3>
        <ul className="space-y-2">{team.members.map(member => <li className="rounded border p-3" key={member.uid}>
          <span>{member.email || member.uid} — {roles[member.role] || member.role}</span>
          {member.role !== 'owner' && <button className="ml-3 rounded border p-2" disabled={busy} onClick={() => setRevoke(member)}>Remover acesso de {member.email || member.uid}</button>}
        </li>)}</ul>
        {revoke && <div role="alertdialog" aria-label="Confirmar remoção de acesso" className="rounded border p-4 space-y-2">
          <p>Remover o acesso de {revoke.email || revoke.uid}? Os dados e o histórico da empresa serão preservados.</p>
          <button disabled={busy} onClick={() => run(`/api/tenants/${tenantId}/team/${revoke.uid}/revoke`, { expectedRevision: revoke.revision }, 'Acesso removido.')}>Confirmar remoção</button>
          <button disabled={busy} className="ml-3" onClick={() => setRevoke(null)}>Cancelar</button>
        </div>}
        <h3 className="font-bold">Solicitações de acesso</h3>
        {!team.requests.length && <p>Nenhuma solicitação pendente.</p>}
        {team.requests.map(request => <div className="rounded border p-3 space-y-2" key={request.uid}>
          <p>{request.email}</p>
          <label>Papel de {request.email}<select className="ml-2 border p-2" value={selectedRoles[request.uid] || 'member'} onChange={e => setSelectedRoles({ ...selectedRoles, [request.uid]: e.target.value })}>
            <option value="member">Operador</option><option value="admin">Administrador — orçamentos e financeiro</option>
          </select></label>
          <button className="ml-3 border p-2" disabled={busy} onClick={() => run(`/api/tenants/${tenantId}/team/${request.uid}/decision`, { decision: 'approve', role: selectedRoles[request.uid] || 'member', expectedRevision: request.revision }, 'Acesso aprovado. A pessoa já pode atualizar os acessos e selecionar esta empresa na própria conta.')}>Aprovar {request.email}</button>
          <button className="ml-3 border p-2" disabled={busy} onClick={() => run(`/api/tenants/${tenantId}/team/${request.uid}/decision`, { decision: 'reject', role: 'member', expectedRevision: request.revision }, 'Solicitação recusada.')}>Recusar {request.email}</button>
        </div>)}
      </> : <p>A lista e a aprovação de usuários são gerenciadas pelo proprietário desta empresa.</p>}
    </>}
    <div className="rounded border p-4 space-y-3">
      <h3 className="font-bold">Minhas empresas</h3>
      <p>Selecionar outra empresa recarrega o aplicativo. Salve suas alterações antes de trocar. Dados de empresas diferentes permanecem separados.</p>
      {companies?.companies.map(company => <div key={company.id}>
        <span>{company.name} — {roles[company.role] || company.role} · {company.id}</span>
        {company.id === tenantId ? <strong className="ml-3">Atual</strong> : <button className="ml-3 border p-2" disabled={busy} onClick={() => run('/api/team/select-company', { tenantId: company.id }, '', true)}>Selecionar {company.name}</button>}
      </div>)}
    </div>
    <form className="rounded border p-4 space-y-3" onSubmit={e => { e.preventDefault(); void run('/api/team/request-access', { tenantId: requestTenant.trim() }, 'Solicitação registrada. Aguarde a aprovação do proprietário e depois atualize os acessos.'); }}>
      <h3 className="font-bold">Solicitar acesso a uma empresa</h3>
      <p>Use o ID fornecido pelo proprietário. Sua conta precisa ter e-mail verificado. A solicitação não concede acesso automaticamente.</p>
      <label>ID da empresa <input className="border p-2" required maxLength={128} value={requestTenant} onChange={e => setRequestTenant(e.target.value)} /></label>
      <button className="ml-3 rounded border p-2" disabled={busy || !requestTenant.trim() || !emailVerified}>Solicitar acesso</button>
    </form>
  </section>;
}
