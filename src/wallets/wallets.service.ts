import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { DATA_SOURCE } from '../database/database.module';
import { DomainError, Money } from '../domain/money';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class WalletsService {
  constructor(@Inject(DATA_SOURCE) private readonly ds: DataSource) {}

  async create(body: any) {
    if (!body || typeof body.playerId !== 'string' || !UUID_RE.test(body.playerId) || !body.initialBalance) {
      throw new BadRequestException({ code: 'INVALID_PAYLOAD' });
    }

    let initial: Money;
    try {
      initial = Money.from(body.initialBalance);
    } catch (e) {
      if (e instanceof DomainError) throw new BadRequestException({ code: e.code });
      throw e;
    }

    const playerId: string = body.playerId;
    const walletId = randomUUID();
    const amount = initial.toString();

    try {
      await this.ds.transaction(async (m) => {
        await m.query(
          `INSERT INTO wallets (id, player_id, currency, balance, version)
           VALUES ($1, $2, $3, $4, 1)`,
          [walletId, playerId, initial.currency, amount],
        );

        if (initial.isPositive()) {
          const txId = randomUUID();
          await m.query(
            `INSERT INTO wager_transactions
               (id, provider_id, external_transaction_id, idempotency_key, payload_hash,
                wallet_id, player_id, round_id, game_id, kind, amount, currency,
                status, balance_after, processed_at)
             VALUES ($1, 'internal', $2, $3, 'opening', $4, $5, 'opening', 'opening',
                     'OPENING', $6, $7, 'PROCESSED', $6, now())`,
            [txId, walletId, `opening:${walletId}`, walletId, playerId, amount, initial.currency],
          );
          await m.query(
            `INSERT INTO wallet_ledger_entries
               (id, wallet_id, transaction_id, direction, amount, balance_before, balance_after)
             VALUES ($1, $2, $3, 'CREDIT', $4, '0.00', $4)`,
            [randomUUID(), walletId, txId, amount],
          );
        }
      });
    } catch (e: any) {
      const code = e?.code ?? e?.driverError?.code;
      if (code === '23505') throw new ConflictException({ code: 'WALLET_ALREADY_EXISTS' });
      throw e;
    }

    return { id: walletId, playerId, balance: initial.toJSON(), version: 1 };
  }
    
  private readonly logger = new Logger(WalletsService.name);

  async get(id: string) {
    if (!UUID_RE.test(id)) throw new NotFoundException({ code: 'WALLET_NOT_FOUND' });
    const rows = await this.ds.query(
      `SELECT id, player_id, currency, balance, version FROM wallets WHERE id = $1`,
      [id],
    );
    if (rows.length === 0) throw new NotFoundException({ code: 'WALLET_NOT_FOUND' });
    const w = rows[0];
    return {
      id: w.id,
      playerId: w.player_id,
      balance: { amount: w.balance, currency: w.currency },
      version: w.version,
    };
  }

  async reconcile(id: string) {
    if (!UUID_RE.test(id)) throw new NotFoundException({ code: 'WALLET_NOT_FOUND' });
    const rows = await this.ds.query(
      `SELECT w.currency,
              w.balance,
              COALESCE((SELECT SUM(CASE WHEN direction = 'CREDIT' THEN amount ELSE -amount END)
                        FROM wallet_ledger_entries WHERE wallet_id = w.id), 0)::numeric(18,2) AS calculated,
              (SELECT count(*)::int FROM wallet_ledger_entries WHERE wallet_id = w.id) AS checked
       FROM wallets w WHERE w.id = $1`,
      [id],
    );
    if (rows.length === 0) throw new NotFoundException({ code: 'WALLET_NOT_FOUND' });

    const r = rows[0];
    const stored = Money.from({ amount: r.balance, currency: r.currency });
    const calculated = Money.from({ amount: r.calculated, currency: r.currency });
    const difference = stored.subtract(calculated);
    const consistent = difference.isZero();

    if (!consistent) {
      // Divergência nunca é corrigida em silêncio: fica logada e sinalizada na resposta.
      this.logger.error(`reconciliation divergence walletId=${id} difference=${difference.toString()}`);
    }

    return {
      walletId: id,
      storedBalance: stored.toJSON(),
      calculatedBalance: calculated.toJSON(),
      difference: difference.toJSON(),
      consistent,
      checkedEntries: r.checked,
    };
  }
}