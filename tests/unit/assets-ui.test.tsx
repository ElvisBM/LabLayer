// @vitest-environment jsdom
import React from 'react';
import { it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
vi.mock('../../src/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { getIdToken: async () => 'token' }, tenantId: 'a' }),
}));
import { AssetUpload, AssetLink } from '../../src/features/assets/AssetControls';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('upload só publica referência após resposta confirmada e envia token', async () => {
  const onUploaded = vi.fn(),
    fetch = vi
      .fn()
      .mockResolvedValue({
        ok: true,
        json: async () => ({ name: 'a.png', reference: `asset:${'a'.repeat(64)}` }),
      });
  vi.stubGlobal('fetch', fetch);
  render(
    <AssetUpload user={{ getIdToken: async () => 'token' }} tenantId="a" onUploaded={onUploaded} />,
  );
  fireEvent.change(screen.getByLabelText(/Enviar arquivo/), {
    target: { files: [new File(['bytes'], 'a.png', { type: 'image/png' })] },
  });
  await waitFor(() =>
    expect(onUploaded).toHaveBeenCalledWith({ name: 'a.png', url: `asset:${'a'.repeat(64)}` }),
  );
  expect(fetch).toHaveBeenCalledWith(
    '/api/tenants/a/assets/upload',
    expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: 'Bearer token',
        'Content-Type': 'application/octet-stream',
      }),
    }),
  );
});
it('falha no upload não altera a ficha nem anuncia sucesso', async () => {
  const onUploaded = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Storage indisponível' }) }),
  );
  render(
    <AssetUpload user={{ getIdToken: async () => 'token' }} tenantId="a" onUploaded={onUploaded} />,
  );
  fireEvent.change(screen.getByLabelText(/Enviar arquivo/), {
    target: { files: [new File(['x'], 'a.png')] },
  });
  expect((await screen.findByRole('alert')).textContent).toContain('Storage indisponível');
  expect(onUploaded).not.toHaveBeenCalled();
});
it('referência privada não vira URL pública e exige download autenticado', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue({ ok: false, json: async () => ({ error: 'Sem acesso' }) });
  vi.stubGlobal('fetch', fetch);
  render(<AssetLink reference={`asset:${'b'.repeat(64)}`}>Projeto</AssetLink>);
  expect(screen.queryByRole('link')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Projeto' }));
  await screen.findByRole('alert');
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/assets/'), {
    headers: { Authorization: 'Bearer token' },
  });
});
