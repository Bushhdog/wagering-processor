import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { DATA_SOURCE } from '../database/database.module';
import { DomainError, Money } from '../domain/money';

type Kind = 'BET' | 'WIN' | 'LOSS';

interface Command {
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: Kind;
  money: Money;
}

// TypeORM devolve [rows, count] em UPDATE/DELETE e só rows nos demais.
const rows = (r: any): any[] => (Array.isArray(r[0]) ? r[0] : r);

@Injectable()
export class WageringService {
  constructor(@Inject(DATA_SOURCE) private readonly ds: DataSource) {}

  async submit(idempotencyKey: string | undefined, body: any) {
    if (!idempotencyKey) throw new BadRequestException({ code: 'MISSING_IDEMPOTENCY_KEY' });
    const cmd = this.parse(body);

    // JSON canônico: chaves em ordem alfabética, só campos de negócio.
    const payloadHash = createHash('sha256')
      .update(
        JSON.stringify({
          amount: cmd.money.toString(),
          currency: cmd.money.currency,
          externalTransactionId: cmd.externalTransactionId,
          gameId: cmd.gameId,
          kind: cmd.kind,
          playerId: cmd.playerId,
          providerId: cmd.providerId,
          roundId: cmd.roundId,
          walletId: cmd.walletId,
        }),
      )
      .digest('hex');

    let result: any;
    try {
      result = await this.ds.transaction((m) => this.process(m, idempotencyKey, payloadHash, cmd));
    } catch (e: any) {
      const code = e?.code ?? e?.driverError?.code;
      if (code === '23503') throw new NotFoundException({ code: 'WALLET_NOT_FOUND' });
      throw e;
    }
    if (result.status === 'REJECTED') throw new UnprocessableEntityException(result);
    return result;
  }

  private parse(body: any): Command {
    const str = (v: unknown) => typeof v === 'string' && v.length > 0;
    if (
      !body ||
      !str(body.providerId) ||
      !str(body.externalTransactionId) ||
      !str(body.playerId) ||
      !str(body.walletId) ||
      !str(body.roundId) ||
      !str(body.gameId) ||
      !str(body.kind) ||
      !body.money
    ) {
      throw new BadRequestException({ code: 'INVALID_PAYLOAD' });
    }
    if (!['BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK'].includes(body.kind)) {
      throw new BadRequestException({ code: 'INVALID_KIND' });
    }
    if (body.kind === 'REFUND' || body.kind === 'ROLLBACK') {
      throw new BadRequestException({ code: 'KIND_NOT_SUPPORTED' }); // fora do escopo do prazo
    }
    let money: Money;
    try {
      money = Money.from(body.money);
    } catch (e) {
      if (e instanceof DomainError) throw new BadRequestException({ code: e.code });
      throw e;
    }
    if (!money.isPositive()) throw new BadRequestException({ code: 'INVALID_AMOUNT' });
    return { ...body, money } as Command;
  }

  private async process(m: EntityManager, key: string, hash: string, c: Command) {
    const id = randomUUID();
    const amount = c.money.toString();

    // 1) Idempotência: o banco decide. Se já existe, o insert não retorna nada.
    const inserted = rows(
      await m.query(
        `INSERT INTO wager_transactions
           (id, provider_id, external_transaction_id, idempotency_key, payload_hash,
            wallet_id, player_id, round_id, game_id, kind, amount, currency, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'PENDING')
         ON CONFLICT DO NOTHING RETURNING id`,
        [id, c.providerId, c.externalTransactionId, key, hash, c.walletId, c.playerId,
         c.roundId, c.gameId, c.kind, amount, c.money.currency],
      ),
    );
    if (inserted.length === 0) return this.replay(m, key, hash, c);

    // 2) A wallet precisa bater com o jogador e a moeda.
    const [w] = rows(await m.query(`SELECT player_id, currency, balance FROM wallets WHERE id = $1`, [c.walletId]));
    if (w.player_id !== c.playerId) return this.reject(m, id, 'PLAYER_MISMATCH', w.balance, c);
    if (w.currency !== c.money.currency) return this.reject(m, id, 'CURRENCY_MISMATCH', w.balance, c);

    // 3) LOSS: registra sem mexer no saldo e sem ledger.
    if (c.kind === 'LOSS') return this.markProcessed(m, id, w.balance, c);

    // 4) BET/WIN: UPDATE atômico. A condição de saldo vai dentro do próprio comando.
    const upd = rows(
      c.kind === 'BET'
        ? await m.query(
            `UPDATE wallets SET balance = balance - $1, version = version + 1, updated_at = now()
             WHERE id = $2 AND balance >= $1 RETURNING balance`,
            [amount, c.walletId],
          )
        : await m.query(
            `UPDATE wallets SET balance = balance + $1, version = version + 1, updated_at = now()
             WHERE id = $2 RETURNING balance`,
            [amount, c.walletId],
          ),
    );

    if (upd.length === 0) {
      const [cur] = rows(await m.query(`SELECT balance FROM wallets WHERE id = $1`, [c.walletId]));
      return this.reject(m, id, 'INSUFFICIENT_FUNDS', cur.balance, c);
    }

    const after = Money.from({ amount: upd[0].balance, currency: c.money.currency });
    const before = c.kind === 'BET' ? after.add(c.money) : after.subtract(c.money);
    await m.query(
      `INSERT INTO wallet_ledger_entries
         (id, wallet_id, transaction_id, direction, amount, balance_before, balance_after)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [randomUUID(), c.walletId, id, c.kind === 'BET' ? 'DEBIT' : 'CREDIT',
       amount, before.toString(), after.toString()],
    );
    return this.markProcessed(m, id, after.toString(), c);
  }

  private async markProcessed(m: EntityManager, id: string, balance: string, c: Command) {
    await m.query(
      `UPDATE wager_transactions SET status='PROCESSED', balance_after=$2, processed_at=now() WHERE id=$1`,
      [id, balance],
    );
    return {
      transactionId: id,
      status: 'PROCESSED',
      balance: { amount: balance, currency: c.money.currency },
      idempotentReplay: false,
    };
  }

  private async reject(m: EntityManager, id: string, code: string, balance: string, c: Command) {
    await m.query(
      `UPDATE wager_transactions SET status='REJECTED', failure_code=$2, balance_after=$3, processed_at=now() WHERE id=$1`,
      [id, code, balance],
    );
    return {
      transactionId: id,
      status: 'REJECTED',
      failureCode: code,
      balance: { amount: balance, currency: c.money.currency },
      idempotentReplay: false,
    };
  }

  private async replay(m: EntityManager, key: string, hash: string, c: Command) {
    const found = rows(
      await m.query(
        `SELECT id, idempotency_key, payload_hash, status, failure_code, balance_after
         FROM wager_transactions
         WHERE idempotency_key = $1 OR (provider_id = $2 AND external_transaction_id = $3)`,
        [key, c.providerId, c.externalTransactionId],
      ),
    );
    const row = found.find((r) => r.idempotency_key === key);
    if (!row || row.payload_hash !== hash) {
      throw new ConflictException({ code: 'IDEMPOTENCY_CONFLICT' });
    }
    return {
      transactionId: row.id,
      status: row.status,
      failureCode: row.failure_code ?? undefined,
      balance: { amount: row.balance_after, currency: c.money.currency },
      idempotentReplay: true,
    };
  }
  
}