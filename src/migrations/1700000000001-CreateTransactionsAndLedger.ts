import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTransactionsAndLedger1700000000001 implements MigrationInterface {
  name = 'CreateTransactionsAndLedger1700000000001';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE wager_transactions (
        id                        uuid PRIMARY KEY,
        provider_id               text NOT NULL,
        external_transaction_id   text NOT NULL,
        idempotency_key           text NOT NULL UNIQUE,
        payload_hash              text NOT NULL,
        wallet_id                 uuid NOT NULL REFERENCES wallets(id),
        player_id                 uuid NOT NULL,
        round_id                  text NOT NULL,
        game_id                   text NOT NULL,
        kind                      text NOT NULL
          CHECK (kind IN ('OPENING','BET','WIN','LOSS','REFUND','ROLLBACK')),
        amount                    numeric(18,2) NOT NULL CHECK (amount > 0),
        currency                  char(3) NOT NULL,
        status                    text NOT NULL
          CHECK (status IN ('PENDING','PENDING_REFERENCE','PROCESSED','REJECTED','FAILED')),
        failure_code              text,
        balance_after             numeric(18,2),
        created_at                timestamptz NOT NULL DEFAULT now(),
        processed_at              timestamptz,
        UNIQUE (provider_id, external_transaction_id)
      )
    `);

    await q.query(`
      CREATE TABLE wallet_ledger_entries (
        id             uuid PRIMARY KEY,
        wallet_id      uuid NOT NULL REFERENCES wallets(id),
        transaction_id uuid NOT NULL REFERENCES wager_transactions(id),
        direction      text NOT NULL CHECK (direction IN ('DEBIT','CREDIT')),
        amount         numeric(18,2) NOT NULL CHECK (amount > 0),
        balance_before numeric(18,2) NOT NULL,
        balance_after  numeric(18,2) NOT NULL,
        created_at     timestamptz NOT NULL DEFAULT now(),
        UNIQUE (wallet_id, transaction_id),
        CHECK (
          (direction = 'DEBIT'  AND balance_after = balance_before - amount) OR
          (direction = 'CREDIT' AND balance_after = balance_before + amount)
        )
      )
    `);

    await q.query(`
      CREATE FUNCTION forbid_ledger_changes() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'wallet_ledger_entries is immutable';
      END;
      $$ LANGUAGE plpgsql
    `);

    await q.query(`
      CREATE TRIGGER ledger_immutable
      BEFORE UPDATE OR DELETE ON wallet_ledger_entries
      FOR EACH ROW EXECUTE FUNCTION forbid_ledger_changes()
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TRIGGER ledger_immutable ON wallet_ledger_entries`);
    await q.query(`DROP FUNCTION forbid_ledger_changes()`);
    await q.query(`DROP TABLE wallet_ledger_entries`);
    await q.query(`DROP TABLE wager_transactions`);
  }
}