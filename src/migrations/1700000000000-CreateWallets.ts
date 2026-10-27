import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWallets1700000000000 implements MigrationInterface {
  name = 'CreateWallets1700000000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE wallets (
        id          uuid PRIMARY KEY,
        player_id   uuid NOT NULL,
        currency    char(3) NOT NULL,
        balance     numeric(18,2) NOT NULL CHECK (balance >= 0),
        version     integer NOT NULL DEFAULT 1,
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now(),
        UNIQUE (player_id, currency)
      )
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE wallets`);
  }
}