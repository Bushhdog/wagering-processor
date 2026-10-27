import { describe, it, expect } from 'bun:test';
import { Money, DomainError } from './money';

const brl = (amount: string) => Money.from({ amount, currency: 'BRL' });

describe('Money', () => {
  it('soma sem erro de ponto flutuante', () => {
    expect(brl('0.10').add(brl('0.20')).toString()).toBe('0.30');
  });

  it('subtrai e pode ficar negativo internamente', () => {
    expect(brl('10.00').subtract(brl('25.00')).isNegative()).toBe(true);
  });

  it('rejeita entradas inválidas', () => {
    for (const bad of ['', 'abc', '25', '25.5', '25.123', '-5.00', '1e3', 'NaN', 'Infinity']) {
      expect(() => brl(bad)).toThrow(DomainError);
    }
  });

  it('rejeita operação entre moedas diferentes', () => {
    const usd = Money.from({ amount: '1.00', currency: 'USD' });
    expect(() => brl('1.00').add(usd)).toThrow(DomainError);
  });

  it('é imutável', () => {
    const a = brl('5.00');
    a.add(brl('1.00'));
    expect(a.toString()).toBe('5.00');
  });
});