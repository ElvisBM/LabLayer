import { blankQuote, blankLine, type QuoteData } from '../../shared/quotes/model';
export function customQuote(): QuoteData {
  return {
    ...blankQuote(),
    customerName: 'Cliente',
    description: 'Pedido de peças',
    lines: [
      {
        ...blankLine('line'),
        description: 'Peça avulsa',
        quantity: 3,
        customUnitCost: '10',
        costSource: 'Estudo confirmado',
      },
    ],
    policy: {
      batchAllocation: 'full-lot',
      energyPricePerKwh: '1',
      maintenancePerHour: '1',
      overheadPerHour: '2',
      laborPerHour: '12',
      finishLaborPerHour: '12',
      source: 'Tarifas conferidas',
    },
    orderExpense: '5',
    expenseSource: 'Embalagem de envio',
    fees: { rate: '0.1', perOrder: '1', perUnit: '0.5', source: 'Canal direto' },
    target: { type: 'margin', value: '0.2' },
  };
}
export function productQuote(): QuoteData {
  const q = customQuote();
  q.lines = [
    {
      ...q.lines[0],
      kind: 'catalog',
      description: 'Peça azul',
      quantity: 5,
      productId: 'p',
      variationId: 'blue',
      recipeVersion: 'v1',
      customUnitCost: '',
      costSource: '',
    },
  ];
  return q;
}
