import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase';

export function useInventoryPhase(tenantId?: string | null) {
  const [state, setState] = useState<{ tenantId?: string | null; phase: string; version: number }>({
    phase: 'loading',
    version: 0,
  });
  useEffect(() => {
    if (!tenantId) {
      setState({ tenantId, phase: 'legacy', version: 0 });
      return;
    }
    return onSnapshot(
      doc(db, `tenants/${tenantId}/inventoryControl/state`),
      (s) =>
        setState({
          tenantId,
          phase: s.exists() ? s.data().phase : 'legacy',
          version: s.data()?.version ?? 0,
        }),
      () => setState({ tenantId, phase: 'error', version: 0 }),
    );
  }, [tenantId]);
  return state.tenantId === tenantId ? state : { phase: 'loading', version: 0 };
}
