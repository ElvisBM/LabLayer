import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../server';
import { validId } from '../../server/session';

describe('entrada de sessão sem serviços externos', () => {
  it('não inicializa Firebase ao importar e reporta indisponibilidade sem fallback', async () => {
    const app = await createApp({ database: null, env: {} });
    await request(app).get('/api/health').expect(200);
    await request(app).post('/api/session').set('Authorization', 'Bearer token').expect(503);
  });
  it.each(['', '..', 'a/b', 'x'.repeat(129), null])('recusa identificador %s', value => expect(validId(value)).toBe(false));
  it('aceita ID estável da empresa', () => expect(validId('tenant-01')).toBe(true));
});
