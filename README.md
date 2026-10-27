# Wagering Processor

Serviço de processamento de apostas (NestJS + Bun + PostgreSQL + TypeORM).
Decisões de arquitetura e limitações: ver [ARCHITECTURE.md](./ARCHITECTURE.md).

## Requisitos
Bun 1.x e Docker (Docker Compose).

## Setup
```bash
bun install
docker compose up -d      # sobe o PostgreSQL
bun run migrate           # aplica as migrations
bun run migrate:down      # (opcional) reverte a última migration
bun run start:dev         # sobe a API em http://localhost:3000
```

## Testes
Com a API rodando em outro terminal:
```bash
bun test src
```
Os testes de concorrência usam o PostgreSQL real e a API em localhost:3000.

## Endpoints implementados
- `POST /wallets`
- `GET /wallets/:id`
- `POST /wallets/:id/reconciliation`
- `POST /wagering/transactions` (header `Idempotency-Key`; kinds BET, WIN, LOSS)