import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { AppDataSource } from '../data-source';

const BASE = 'http://localhost:3000';

async function createWallet(amount: string) {
  const playerId = randomUUID();
  const res = await fetch(`${BASE}/wallets`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ playerId, initialBalance: { amount, currency: 'BRL' } }),
  });
  const w: any = await res.json();
  return { playerId, walletId: w.id as string };
}

function submit(
  playerId: string,
  walletId: string,
  externalId: string,
  amount: string,
  kind: 'BET' | 'WIN' | 'LOSS' = 'BET',
) {
  return fetch(`${BASE}/wagering/transactions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': `provider-a:${externalId}`,
    },
    body: JSON.stringify({
      providerId: 'provider-a',
      externalTransactionId: externalId,
      playerId,
      walletId,
      roundId: 'r1',
      gameId: 'g1',
      kind,
      money: { amount, currency: 'BRL' },
    }),
  });
}

async function balanceOf(walletId: string): Promise<string> {
  const r = await AppDataSource.query(`SELECT balance FROM wallets WHERE id = $1`, [walletId]);
  return r[0].balance;
}

async function ledgerTotal(walletId: string): Promise<string> {
  const r = await AppDataSource.query(
    `SELECT COALESCE(SUM(CASE WHEN direction='CREDIT' THEN amount ELSE -amount END), 0) AS total
     FROM wallet_ledger_entries WHERE wallet_id = $1`,
    [walletId],
  );
  return r[0].total;
}

async function countEntries(walletId: string, direction: 'DEBIT' | 'CREDIT'): Promise<number> {
  const r = await AppDataSource.query(
    `SELECT count(*)::int AS n FROM wallet_ledger_entries WHERE wallet_id = $1 AND direction = $2`,
    [walletId, direction],
  );
  return r[0].n;
}

beforeAll(async () => {
  if (!AppDataSource.isInitialized) await AppDataSource.initialize();
});

afterAll(async () => {
  await AppDataSource.destroy();
});

describe('concorrência (precisa do servidor rodando em localhost:3000)', () => {
  it('a mesma aposta enviada 50 vezes em paralelo gera um único débito', async () => {
    const { playerId, walletId } = await createWallet('100.00');

    const responses = await Promise.all(
      Array.from({ length: 50 }, () => submit(playerId, walletId, 'same-bet', '10.00')),
    );
    const bodies: any[] = await Promise.all(responses.map((r) => r.json()));

    expect(new Set(bodies.map((b) => b.transactionId)).size).toBe(1);
    expect(bodies.filter((b) => b.idempotentReplay === false).length).toBe(1);
    expect(await countEntries(walletId, 'DEBIT')).toBe(1);
    expect(await balanceOf(walletId)).toBe('90.00');
  });

  it('duas apostas de 80 disputando 100: uma passa, outra é rejeitada', async () => {
    const { playerId, walletId } = await createWallet('100.00');

    const responses = await Promise.all([
      submit(playerId, walletId, 'bet-a', '80.00'),
      submit(playerId, walletId, 'bet-b', '80.00'),
    ]);
    const bodies: any[] = await Promise.all(responses.map((r) => r.json()));
    const statuses = bodies.map((b) => b.status).sort();

    expect(statuses).toEqual(['PROCESSED', 'REJECTED']);
    expect(bodies.find((b) => b.status === 'REJECTED').failureCode).toBe('INSUFFICIENT_FUNDS');
    expect(await balanceOf(walletId)).toBe('20.00');
    expect(await countEntries(walletId, 'DEBIT')).toBe(1);
  });

  it('wallet quente: 20 apostas distintas de 10 em 100 deixam saldo 0, nunca negativo', async () => {
    const { playerId, walletId } = await createWallet('100.00');

    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, i) => submit(playerId, walletId, `hot-${i}`, '10.00')),
    );
    const bodies: any[] = await Promise.all(responses.map((r) => r.json()));

    expect(bodies.filter((b) => b.status === 'PROCESSED').length).toBe(10);
    expect(bodies.filter((b) => b.status === 'REJECTED').length).toBe(10);
    expect(await balanceOf(walletId)).toBe('0.00');
  });

  it('wallets diferentes em paralelo não interferem entre si', async () => {
    const wallets = await Promise.all(Array.from({ length: 10 }, () => createWallet('50.00')));

    const responses = await Promise.all(
      wallets.map((w, i) => submit(w.playerId, w.walletId, `multi-${i}`, '20.00')),
    );
    const bodies: any[] = await Promise.all(responses.map((r) => r.json()));

    expect(bodies.every((b) => b.status === 'PROCESSED')).toBe(true);
    for (const w of wallets) expect(await balanceOf(w.walletId)).toBe('30.00');
  });

  it('invariante: saldo da wallet == saldo reconstruído pelo ledger', async () => {
    const { playerId, walletId } = await createWallet('100.00');

    await Promise.all([
      ...Array.from({ length: 5 }, (_, i) => submit(playerId, walletId, `inv-bet-${i}`, '15.00')),
      ...Array.from({ length: 3 }, (_, i) => submit(playerId, walletId, `inv-win-${i}`, '7.50', 'WIN')),
      submit(playerId, walletId, 'inv-loss', '5.00', 'LOSS'),
    ]);

    expect(await balanceOf(walletId)).toBe(await ledgerTotal(walletId));
  });
});