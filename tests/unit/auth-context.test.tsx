// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';

const authMock = vi.hoisted(() => ({ callback: undefined as any }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: (_: unknown, callback: any) => {
  authMock.callback = callback; return () => {};
} }));
vi.mock('../../src/firebase', () => ({ auth: {} }));
import { AuthProvider, useAuth } from '../../src/contexts/AuthContext';

function Probe() {
  const session = useAuth();
  return <div data-testid="session">{JSON.stringify({ tenantId: session.tenantId, loading: session.loading,
    isSuperAdmin: session.isSuperAdmin, error: session.initializationError })}</div>;
}
const state = () => JSON.parse(screen.getByTestId('session').textContent!);
beforeEach(() => { render(<AuthProvider><Probe /></AuthProvider>); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('usa empresa verificada pelo servidor e token Firebase', async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ tenantId: 'company', isSuperAdmin: false }) });
  vi.stubGlobal('fetch', fetcher);
  await act(() => authMock.callback({ uid: 'member', email: 'elvisbmartins@gmail.com', getIdToken: async () => 'id-token' }));
  expect(state()).toEqual({ tenantId: 'company', loading: false, isSuperAdmin: false, error: null });
  expect(fetcher).toHaveBeenCalledWith('/api/session', { method: 'POST', headers: { Authorization: 'Bearer id-token' } });
});

it('falha fechada sem assumir uid como empresa', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Empresa inativa.' }) }));
  await act(() => authMock.callback({ uid: 'member', getIdToken: async () => 'token' }));
  expect(state()).toEqual({ tenantId: null, loading: false, isSuperAdmin: false, error: 'Empresa inativa.' });
});

it('logout durante inicialização descarta resposta atrasada', async () => {
  let resolve: (value: unknown) => void;
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise(r => { resolve = r; })));
  let pending: Promise<void>;
  act(() => { pending = authMock.callback({ uid: 'member', getIdToken: async () => 'token' }); });
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  await act(() => authMock.callback(null));
  await act(async () => { resolve!({ ok: true, json: async () => ({ tenantId: 'company', isSuperAdmin: true }) }); await pending!; });
  expect(state()).toEqual({ tenantId: null, loading: false, isSuperAdmin: false, error: null });
});
