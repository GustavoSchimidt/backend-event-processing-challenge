# Desafio de Processamento de Eventos Backend

Processador de eventos resiliente usando Fastify + PostgreSQL, com worker assíncrono, estratégia de retry e DLQ.

---

## Stack

| Camada       | Tecnologia               |
|--------------|--------------------------|
| Execução     | Node.js 22               |
| Linguagem    | TypeScript (strict)      |
| Framework    | Fastify 4                |
| Banco        | PostgreSQL 16            |
| Container    | Docker + Docker Compose  |

---

## O que foi implementado

- `POST /events` para ingestão com validação de payload
- Trava de idempotência por `(tenant_id, event_id)`
- Worker assíncrono usando fila em PostgreSQL + `FOR UPDATE SKIP LOCKED`
- Roteamento para integrações externas por tipo de evento
- Retry com backoff exponencial + jitter
- Tratamento de `429` com suporte ao `Retry-After`
- Fluxo de DLQ: move para `dlq_events` e remove de `events` na mesma transação
- `GET /metrics` e `GET /dlq`
- Logs estruturados para ingestão, processamento, retry e DLQ

---

## Estrutura do projeto

```
.
├── apps/
│   └── api/
│       ├── src/
│       │   ├── domain/                    # Tipos de domínio e regras de negócio
│       │   ├── application/               # Casos de uso e orquestração do worker
│       │   ├── infra/                     # Repositório PostgreSQL + cliente HTTP das integrações
│       │   ├── interface/http/routes/     # Adaptadores HTTP (Fastify)
│       │   ├── app.ts                     # Composição de dependências
│       │   └── server.ts                  # Ponto de entrada
│       └── tests/
│           ├── unit/
│           └── integration/
├── mock-integrations/
├── infra/postgres/init.sql
└── scripts/generate-events.ts
```

---

## Execução com Docker

```bash
cp .env.example .env
docker compose up --build
```

Serviços:

- API: `http://localhost:3000`
- Mock integrations: `http://localhost:4000`
- PostgreSQL: `localhost:5432`

Health checks:

```bash
curl http://localhost:3000/health
curl http://localhost:4000/health
```

---

## API

### `POST /events`

Recebe um evento e o enfileira para processamento em background.

Body:

```json
{
  "event_id": "550e8400-e29b-41d4-a716-446655440000",
  "tenant_id": "tenant_a",
  "type": "order.created",
  "payload": {}
}
```

Resposta (`202`):

```json
{
  "accepted": true,
  "duplicate": false
}
```

Se o mesmo `(tenant_id, event_id)` for enviado novamente:

```json
{
  "accepted": true,
  "duplicate": true
}
```

### `GET /metrics`

Retorna contadores:

```json
{
  "processed": 0,
  "failed": 0,
  "dlq": 0,
  "pending": 0
}
```

### `GET /dlq?limit=50&offset=0`

Retorna eventos da DLQ com paginação.

---

## Roteamento de eventos

- `order.*` -> `POST /billing` + `POST /crm`
- `payment.*` -> `POST /billing`
- `customer.*` -> `POST /crm` + `POST /notifications`

---

## Política de retry e DLQ

- Máximo de tentativas: `MAX_RETRIES` (padrão `6`)
- Backoff: exponencial (base 1s, teto 60s) + jitter
- `429`: `Retry-After` é respeitado como atraso mínimo
- Tentativas esgotadas: evento é movido para `dlq_events`, removido de `events` e o estado de idempotência vira `dlq`

---

## Variáveis de ambiente

| Nome | Padrão | Descrição |
|------|--------|-----------|
| `DATABASE_URL` | - | String de conexão com PostgreSQL |
| `API_PORT` | `3000` | Porta da API |
| `MOCK_INTEGRATIONS_URL` | `http://localhost:4000` | URL base das integrações externas |
| `WORKER_ENABLED` | `true` | Ativa/desativa worker em background |
| `WORKER_POLL_MS` | `500` | Intervalo de polling do worker |
| `WORKER_BATCH_SIZE` | `50` | Quantidade de eventos por ciclo |
| `WORKER_CONCURRENCY` | `10` | Paralelismo por ciclo |
| `WORKER_LEASE_MS` | `30000` | Tempo de lease de processamento |
| `MAX_RETRIES` | `6` | Máximo de tentativas |
| `HTTP_TIMEOUT_MS` | `5000` | Timeout das chamadas HTTP externas |

---

## Testes

A partir de `apps/api`:

```bash
npm install
npm run test:unit
```

Testes de integração (exigem PostgreSQL em execução e schema inicializado):

```bash
RUN_INTEGRATION_TESTS=1 npm run test:integration
```

---

## Teste de carga

Na raiz do repositório:

```bash
npm install
npm run generate-events -- --count 10000 --concurrency 50
```
