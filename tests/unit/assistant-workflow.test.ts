import { expect, it } from 'vitest';
import { matchesRequestQuery, parseProductionCommand, productionUpdate } from '../../shared/assistant/workflow';

const message = 'ORC 11 Pago pode Produzir ,\n5 com nome: Viviane Rodriguero\n5 com nome: Daniella Maglio Löw';
it('reconhece comando explícito e preserva grafia e distribuição dos nomes', () => {
  expect(parseProductionCommand(message)).toEqual({ code: '11', paid: true, personalization: [{ quantity: 5, name: 'Viviane Rodriguero' }, { quantity: 5, name: 'Daniella Maglio Löw' }] });
  expect(parseProductionCommand('Pode produzir')).toMatchObject({ code: null, paid: false });
});
it.each(['ORC 11 não pago pode produzir', 'ORC 11 pago pode produzir?', 'ORC 11 se pago pode produzir', 'Exemplo: ORC 11 pago pode produzir', 'ORC 11 pago pode produzir\nNão produzir ainda', 'ORC 11 pago pode produzir\nORC 12 também', 'ORC 11 pago pode produzir\n5 com nome: 5 Daniella', 'ORC 11 pago pode produzir\n0 com nome: Pessoa'])('não executa interpretação ambígua: %s', text => {
  expect(parseProductionCommand(text)).toBeNull();
});
it('busca códigos com zeros equivalentes, sem confundir ORC 11 com 110', () => {
  expect(matchesRequestQuery('ORC 11', ['ORC-011 — Daniella'])).toBe(true);
  expect(matchesRequestQuery('ORC11', ['ORC-110 — Daniella'])).toBe(false);
  expect(matchesRequestQuery('Daniella Löw', ['ORC-011 — Daniella Low'])).toBe(true);
});
it('seleciona opção existente para 10 peças sem alterar catálogo de preços ou consumo', () => {
  const row = { status: 'orcado', requestedQuantity: 1, quotedPrice: 24.99, customerQuote: { name: 'Chaveiro', size: '6 cm', options: [{ quantity: 10, unitPrice: 16.6, deliveryDays: 2 }] } };
  const result = productionUpdate(row, parseProductionCommand(message)!, '2026-10-22T00:00:00Z');
  expect(result.patch).toMatchObject({ status: 'fila-producao', requestedQuantity: 10, quotedPrice: 166 });
  expect(result.patch).not.toHaveProperty('customerQuote'); expect(result.patch).not.toHaveProperty('productionTimeHours');
  expect(row.status).toBe('orcado');
  expect(() => productionUpdate({ ...row, customerQuote: null }, parseProductionCommand(message)!, '')).toThrow(/opção de preço/);
});
