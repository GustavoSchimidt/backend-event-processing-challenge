# Processador de Eventos Backend — Desafio Técnico

## Visão Geral

Você recebeu um projeto base com uma API Fastify, banco PostgreSQL e uma camada mock de serviços externos.

Sua missão é implementar um sistema de processamento de eventos resiliente e com padrão de produção sobre essa infraestrutura.

---

## O que você deve construir

### 1. Endpoint de ingestão de eventos

Implemente `POST /events` na API.

O endpoint deve:

- Aceitar o payload de evento descrito abaixo
- Validar o payload
- Persistir o evento recebido no PostgreSQL
- Enfileirar o evento para processamento assíncrono
- Retornar `202 Accepted` imediatamente, sem aguardar o processamento

### 2. Processador assíncrono de eventos

Implemente um worker que:

- Consuma eventos pendentes da fila
- Encaminhe cada evento para a integração correta com base no tipo:

| Tipo de evento       | Integração              |
|----------------------|-------------------------|
| `order.*`            | `POST /billing` + `POST /crm` |
| `payment.*`          | `POST /billing`         |
| `customer.*`         | `POST /crm` + `POST /notifications` |

- Marque eventos como `processed` em caso de sucesso
- Trate falhas de forma resiliente (ver seção Retry)

### 3. Lógica de retry

As integrações mock são intencionalmente instáveis (latência, 500, 429).

Seu processador deve:

- Repetir chamadas com **backoff exponencial**
- Respeitar o header `Retry-After` em respostas `429`
- Definir número máximo de tentativas (escolha sua e justifique)
- Encaminhar para **Dead Letter Queue (DLQ)** após esgotar tentativas

### 4. Dead Letter Queue (DLQ)

Implemente mecanismo de DLQ para eventos não processáveis.

Requisitos:

- Persistir eventos de DLQ separadamente (tabela, arquivo ou memória — documente sua escolha)
- Incluir motivo da falha e número de tentativas
- Expor `GET /dlq` para listar eventos em DLQ

### 5. Observabilidade

Instrumente sua implementação:

- Logs JSON estruturados (use o logger existente do Fastify)
- No mínimo, registrar: evento recebido, início de processamento, tentativa de retry, envio para DLQ e sucesso
- Endpoint `GET /metrics` com contadores básicos: `processed`, `failed`, `dlq`, `pending`

---

## Payload do evento

```json
{
  "event_id": "uuid-v4",
  "tenant_id": "tenant_a",
  "type": "order.created",
  "payload": {}
}
```

### Regras de validação

| Campo       | Obrigatório | Tipo   | Restrições               |
|-------------|-------------|--------|--------------------------|
| `event_id`  | sim         | string | UUID v4 válido           |
| `tenant_id` | sim         | string | string não vazia         |
| `type`      | sim         | string | deve ser tipo conhecido  |
| `payload`   | sim         | object | pode ser `{}` vazio      |

### Tipos de evento aceitos

- `order.created`
- `order.updated`
- `order.cancelled`
- `payment.approved`
- `payment.refused`
- `customer.registered`
- `customer.updated`

---

## Como testar sua implementação

### Subir ambiente

```bash
cp .env.example .env
docker compose up
```

### Enviar eventos de teste

```bash
# Evento único
curl -X POST http://localhost:3000/events \
  -H "Content-Type: application/json" \
  -d '{
    "event_id": "550e8400-e29b-41d4-a716-446655440000",
    "tenant_id": "tenant_a",
    "type": "order.created",
    "payload": { "orderId": "ORD-001", "value": 199.90 }
  }'

# Teste de carga (10k eventos, 50 concorrentes)
cd scripts && npm install && npx tsx generate-events.ts
```

---

## Entregáveis

1. Faça fork deste repositório e implemente o desafio
2. Envie um pull request ou compartilhe a URL do seu fork
3. Inclua um `SOLUTION.md` na raiz com:
   - Decisões de arquitetura e trade-offs
   - Escolhas tecnológicas (mecanismo de fila, estratégia de retry etc.)
   - Como executar sua solução
   - O que melhoraria com mais tempo

---

## Critérios de avaliação

| Critério               | Peso   |
|------------------------|--------|
| Corretude              | Alto   |
| Resiliência e retries  | Alto   |
| Qualidade de código    | Alto   |
| Observabilidade        | Médio  |
| Documentação           | Médio  |
| Performance            | Médio  |
| Cobertura de testes    | Bônus  |

---

## Restrições

- Não altere o comportamento das integrações mock
- Não altere o schema inicial do banco (você pode adicionar tabelas e colunas)
- Você pode adicionar quaisquer pacotes npm necessários
- Você pode usar qualquer mecanismo de fila (in-process, Redis, PostgreSQL SKIP LOCKED etc.)
- O modo strict do TypeScript deve permanecer habilitado

---

## Expectativa de tempo

Este desafio foi desenhado para ser concluído em **4–6 horas**.

Valorizamos código limpo e decisões bem justificadas mais do que completude. Se faltar tempo, documente o que faria na sequência.

---

*Nexly Engineering Team*
