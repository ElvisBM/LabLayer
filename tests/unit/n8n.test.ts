import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import vm from 'node:vm';

const workflow = JSON.parse(readFileSync('docs/n8n/whatsapp-orcamentos.workflow.json', 'utf8'));
const code = workflow.nodes.find((x: any) => x.type === 'n8n-nodes-base.code').parameters.jsCode;
function normalize(body: any, env: any = { WHATSAPP_TENANT_ID: 'tenant', WHATSAPP_INGEST_TOKEN: 'test' }) {
  return vm.runInNewContext(`(function() { ${code} })()`, { $json: { body }, $env: env });
}
it('workflow usa empresa configurada e ID original da mensagem', () => {
  const [item] = normalize({ data: { key: { remoteJid: '5511999999999@s.whatsapp.net', id: 'message-1' }, message: { conversation: 'Olá' } } });
  expect(item.json).toMatchObject({ tenantId: 'tenant', eventId: 'message-1', sourceMessage: 'Olá' });
  expect(item.json).not.toHaveProperty('rawPayload');
  expect(workflow.nodes.find((x: any) => x.type === 'n8n-nodes-base.httpRequest').parameters.jsonBody).toContain('eventId: $json.eventId');
});
it('workflow rejeita falta de credencial/ID e ignora mensagens de grupo', () => {
  expect(() => normalize({ sender: '5511999999999' })).toThrow('ID estável');
  expect(() => normalize({ sender: '5511999999999', id: 'message' }, {})).toThrow();
  expect(normalize({ sender: 'group@g.us' })).toEqual([]);
});
