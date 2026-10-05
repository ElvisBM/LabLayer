import { count, decimal, PricingError } from '../../shared/pricing/engine';

export function calculateRecordedSale(input: { quantity: number; soldPrice: number; fees: number; totalCost: string }) {
  count(input.quantity, 'Quantidade', 1);
  const price = decimal(input.soldPrice, 'Preço vendido'), fees = decimal(input.fees, 'Taxas'), cost = decimal(input.totalCost, 'Custo total confirmado');
  if ([price, fees, cost].some(v => v.decimalPlaces() > 2)) throw new PricingError('Informe valores monetários em centavos.');
  return { realCost: cost.toNumber(), realProfit: price.minus(fees).minus(cost).toNumber(), costSource: 'manual-confirmed' as const };
}
