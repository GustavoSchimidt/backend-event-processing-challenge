# Visão Geral da Solução

## Arquitetura

A implementação segue uma Clean Architecture leve (Ports & Adapters):

- `domain`: tipos de evento, validações, roteamento e regras de retry
- `application`: casos de uso (`ingest`, `metrics`, `dlq`, `process batch`) e orquestração do worker
- `infra`: repositório PostgreSQL e cliente HTTP das integrações
- `interface/http`: rotas Fastify como adaptadores de entrega

O objetivo foi manter responsabilidades explícitas com baixa complexidade operacional.

## Decisões principais

### Mecanismo de fila

Foi utilizado PostgreSQL como mecanismo de fila, sem infraestrutura adicional.
O claim dos eventos é feito com `FOR UPDATE SKIP LOCKED`, com `lease_until` para recuperação de itens presos.

### Idempotência

Foi criada uma tabela dedicada `idempotency_keys` (`tenant_id`, `event_id`) para deduplicação permanente.
Se houver conflito na inserção da chave, a ingestão retorna `202` com `duplicate: true`.

### Estratégia de retry

- Backoff exponencial (base 1s, teto 60s) com jitter.
- Para `429`, `Retry-After` é tratado como atraso mínimo.
- Número máximo de tentativas configurável (`MAX_RETRIES`, padrão 6).

### Estratégia de DLQ

Quando o limite de tentativas é atingido:

1. Inserir snapshot do evento em `dlq_events`
2. Deletar o evento da fila ativa `events`
3. Atualizar estado da chave de idempotência para `dlq`

As três operações ocorrem na mesma transação.

## Modelo de dados

### `events`

Tabela de fila ativa com estado, tentativas, agendamento e metadados de lease.

### `idempotency_keys`

Controle permanente de deduplicação e estado final (`pending`, `processed`, `dlq`).

### `dlq_events`

Snapshot final dos eventos com falha definitiva, incluindo motivo e número de tentativas.

## Como rodar

```bash
cp .env.example .env
docker compose up --build
```

## Melhorias futuras

- Adotar ferramenta de migração versionada (além do SQL de bootstrap)
- Separar modo de execução em processo dedicado de worker para escala horizontal
- Expor métricas em formato Prometheus
- Adicionar rastreabilidade distribuída (`trace_id` / `event_id`) ponta a ponta
- Automatizar testes de carga e cenários de caos na CI
