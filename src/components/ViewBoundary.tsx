import { Component, Suspense, type ReactNode } from 'react';

class ViewErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return <div role="alert" className="rounded border p-4 space-y-3">
        <p>Não foi possível abrir esta tela. Você pode acessar outra opção do menu ou recarregar o aplicativo.</p>
        <p>Ao recarregar, alterações ainda não salvas serão perdidas.</p>
        <button className="rounded border px-3 py-2" onClick={() => window.location.reload()}>Recarregar aplicativo</button>
      </div>;
    }
    return this.props.children;
  }
}

export function ViewBoundary({ children }: { children: ReactNode }) {
  return <ViewErrorBoundary>
    <Suspense fallback={<p role="status">Carregando tela...</p>}>{children}</Suspense>
  </ViewErrorBoundary>;
}
