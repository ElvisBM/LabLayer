import { BusinessError } from './session';
import type { Reader } from './quote-cost';

/** Canonical E4 line targets coexist with historical E3 orders without making
 * the new order writable through the legacy client rules. */
export async function orderTarget(get: Reader, orderId: string, active = true) {
  const target = await get(`orderTargets/${orderId}`);
  if (!target) return get(`orders/${orderId}`);
  const order = await get(`salesOrders/${target.salesOrderId}`);
  if (!order) throw new BusinessError(409, 'Pedido do atendimento não encontrado.');
  if (active && (order.status !== 'active' || !target.item))
    throw new BusinessError(409, 'Pedido cancelado ou item ainda sem ficha de produção.');
  return target;
}
