# Plano de integração: Gateway DHRPagamentos → CRM de vendas pagas → WhatsApp

## 1) O que consegui validar na documentação

Da página inicial da documentação (`/docs/intro/first-steps`), foi possível confirmar:

- A API é REST e responde em JSON.
- A autenticação é **Basic Auth** com `publicKey:secretKey` em Base64 no header `Authorization`.
- Há seções de:
  - **Formato dos postbacks** (essencial para tempo real).
  - **Vendas**: criar, buscar, listar, estornar e status de entrega.
  - Outras rotas (saques, antecipações, saldo).

> Próximo passo obrigatório no seu projeto real: abrir especificamente a seção de **postbacks** para mapear todos os eventos e status de venda/chargeback/cancelamento.

---

## 2) Objetivo técnico do sistema

Receber em **tempo real** os eventos de pagamento aprovados do gateway e transformar isso em:

1. criação/atualização de lead no CRM,
2. criação de oportunidade de venda paga,
3. disparo de fluxo de WhatsApp para o lead,
4. trilha de auditoria completa (idempotência + reconciliação).

---

## 3) Arquitetura recomendada (simples e robusta)

```text
DHR (postback/webhook)
   ↓
[Webhook Receiver API]
   - valida assinatura/origem
   - idempotência por event_id / transaction_id + status
   - persistência bruta (raw payload)
   ↓
[Fila (SQS/Rabbit/Kafka)]
   ↓
[Worker de Integração]
   - normaliza payload
   - aplica regra "lead pago"
   - upsert no CRM
   - cria aquisição/oportunidade
   - agenda/enfila mensagem WhatsApp
   ↓
[Serviço WhatsApp (Cloud API / BSP)]
   ↓
Lead recebe mensagem

Paralelo:
[Job de Reconciliação]
   - consulta API de vendas (buscar/listar)
   - corrige eventos perdidos ou fora de ordem
```

### Por que essa arquitetura

- **Webhook desacoplado por fila** evita perda em pico.
- **Idempotência** evita duplicar aquisição no CRM.
- **Reconciliação periódica** resolve falhas de rede e inconsistência eventual.

---

## 4) Regras de negócio para “lead pago”

Você deve transformar status do gateway em uma máquina de estados interna.

Sugestão:

- `APPROVED/PAID/CONFIRMED` ⇒ `paid`
- `PENDING` ⇒ `pending`
- `REFUNDED/CHARGEBACK/CANCELED` ⇒ `reversed`

Ação por status:

- `paid`: cria aquisição no CRM + dispara WhatsApp de boas-vindas.
- `reversed`: marca aquisição como perdida/estornada + bloqueia automações.
- `pending`: apenas registro; sem disparo comercial final.

> Ajustar nomes conforme os status exatos do “Formato dos postbacks”.

---

## 5) Contratos de dados (modelo mínimo)

## 5.1 Tabela `payment_events`

- `id` (uuid)
- `provider` (`dhr`)
- `event_key` (único: `transaction_id + status + paid_at`)
- `transaction_id`
- `status_raw`
- `payload_raw` (jsonb)
- `received_at`
- `processed_at`
- `process_error`

Índice único em `event_key` para idempotência.

## 5.2 Tabela `lead_acquisitions`

- `id`
- `crm_lead_id`
- `transaction_id` (único)
- `amount`
- `currency`
- `paid_at`
- `source` (`gateway_dhr`)
- `status` (`paid`, `reversed`, `pending`)

## 5.3 Payload interno normalizado

```json
{
  "provider": "dhr",
  "transactionId": "txn_123",
  "orderId": "pedido_456",
  "status": "paid",
  "amount": 19990,
  "currency": "BRL",
  "customer": {
    "name": "Nome",
    "email": "lead@email.com",
    "phone": "5511999999999",
    "document": "***"
  },
  "paidAt": "2026-02-23T10:00:00Z",
  "raw": {}
}
```

---

## 6) Fluxo de ponta a ponta

1. DHR envia postback para `POST /webhooks/dhr`.
2. Receiver valida request (auth/header/IP se disponível na doc).
3. Calcula `event_key` e faz `insert ... on conflict do nothing`.
4. Publica evento na fila.
5. Worker consome evento.
6. Mapeia para status interno.
7. Faz `upsert` no CRM por chave externa (`transaction_id` ou `order_id`).
8. Se status `paid` e ainda não notificado:
   - cria aquisição/oportunidade no CRM,
   - envia template WhatsApp,
   - registra `notified_at`.
9. Retorna métricas/logs.

---

## 7) Integração com CRM (boas práticas)

- Use **chave externa estável** (`transaction_id`) para deduplicação.
- Faça **upsert** (nunca create cego).
- Guarde os IDs cruzados: `gateway_transaction_id`, `crm_lead_id`, `crm_deal_id`.
- Tenha transição de estágio por status de pagamento.

---

## 8) WhatsApp (compliance e entrega)

- Use provedor oficial (Meta Cloud API ou BSP).
- Para primeiro contato ativo, use **template aprovado**.
- Normalize número em E.164 (`55DDDNUMERO`).
- Tenha fallback:
  - se falha WhatsApp, reprocessar por fila com backoff;
  - após N tentativas, abrir tarefa para operador.

Template inicial sugerido:

> "Olá, {{nome}}! Confirmamos seu pagamento ✅. Vou te enviar os próximos passos por aqui."

---

## 9) Segurança e confiabilidade

- Segredos em cofre (Vault/Secrets Manager), nunca no código.
- TLS obrigatório e rotação de chaves periódica.
- Rate limiting no endpoint de webhook.
- DLQ (dead-letter queue) para eventos inválidos.
- Observabilidade:
  - logs estruturados com `transaction_id`,
  - métricas de latência, taxa de erro e duplicidade,
  - alertas quando reconciliação detecta divergência.

---

## 10) Reconciliação (fundamental)

Mesmo com webhook em tempo real, rode reconciliação a cada 5–15 minutos:

- Consulta `listar vendas` / `buscar venda` no período.
- Compara com eventos processados.
- Reinsere eventos faltantes na fila.
- Corrige estados inconsistentes no CRM.

Isso evita perda de lead pago por qualquer indisponibilidade temporária.

---

## 11) Stack sugerida (prática)

- **Backend**: Node.js (Fastify/Nest) ou Python (FastAPI).
- **Fila**: SQS (AWS) ou RabbitMQ.
- **Banco**: Postgres.
- **Deploy**: container + autoscaling.
- **IaC**: Terraform.

---

## 12) Plano de implementação em 2 semanas (MVP)

### Semana 1
- Implementar `POST /webhooks/dhr`.
- Persistência bruta + idempotência.
- Publicação em fila.
- Worker com normalização e mapeamento de status.
- Upsert no CRM com chave externa.

### Semana 2
- Disparo WhatsApp + retentativa.
- Job de reconciliação com API de vendas.
- Dashboard operacional (eventos por minuto, erros, pendências).
- Testes de carga e caos básico (duplicidade e reorder).

---

## 13) Checklist de validação antes de produção

- [ ] Endpoint webhook com autenticação validada.
- [ ] Idempotência comprovada com eventos duplicados.
- [ ] CRM sem duplicidade após 10k eventos.
- [ ] WhatsApp com template aprovado e taxa de entrega aceitável.
- [ ] Reconciliação corrigindo perdas simuladas.
- [ ] Alertas e runbook de incidentes prontos.

---

## 14) Pontos que preciso de você para fechar o desenho final

1. Qual CRM exatamente (HubSpot, Pipedrive, RD, Salesforce, outro)?
2. Qual provedor de WhatsApp (Cloud API, Z-API, Gupshup, 360Dialog, etc.)?
3. Quais status exatos do DHR no postback?
4. O que significa “aquisição” no seu CRM (negócio, atividade, evento custom)?
5. Qual SLA de tempo real (ex.: até 10s do pagamento)?

Com essas respostas, dá para transformar este plano em especificação técnica fechada (campos, rotas, payloads e pseudocódigo prontos para dev).


---

## 15) Parametrização fechada com o seu CRM

Webhook informado por você (destino da aquisição):

`POST https://api.datacrazy.io/v1/crm/api/crm/flows/webhooks/a3161e6d-6f4d-4b16-a1b5-16bcb9641994/dbcb4103-0a6a-4553-b3e0-977057906de4`

### Webhook do CRM configurável (recomendado)

Não deixar URL fixa no código. Use variável de ambiente para poder trocar quando quiser:

- `CRM_WEBHOOK_URL` = URL ativa do fluxo no CRM
- `CRM_WEBHOOK_TIMEOUT_MS` = timeout da chamada (ex.: `10000`)
- `CRM_WEBHOOK_ENABLED` = `true/false` para ligar/desligar envio

Exemplo de estratégia:

- Produção: `CRM_WEBHOOK_URL=https://api.datacrazy.io/.../webhooks/...`
- Homologação: `CRM_WEBHOOK_URL=https://api.datacrazy.io/.../webhooks/...-hml`

### Regra operacional que você definiu

- **Somente enviar para o CRM quando o pagamento tiver 5 minutos de confirmação**;
- **Status `3` deve ser tratado como `pago`**.

Implementação prática da regra:

1. Recebe postback do gateway.
2. Se `status != 3`, não envia aquisição (apenas registra evento para rastreio).
3. Se `status == 3`, agenda tarefa para `paid_at + 5 minutos`.
4. Antes de disparar ao CRM, revalida status da transação (`buscar venda`) para garantir que ainda está pago.
5. Envia payload ao webhook do CRM com chave de idempotência.

### Payload sugerido para o webhook do CRM

```json
{
  "event": "paid_acquisition",
  "provider": "dhr",
  "transaction_id": "txn_123",
  "order_id": "pedido_456",
  "status": 3,
  "status_label": "paid",
  "amount": 19990,
  "currency": "BRL",
  "paid_at": "2026-02-23T10:00:00Z",
  "confirmed_after_minutes": 5,
  "customer": {
    "name": "Nome",
    "email": "lead@email.com",
    "phone": "5511999999999"
  },
  "metadata": {
    "source": "gateway_dhr",
    "idempotency_key": "dhr_txn_123_status3_paid"
  }
}
```

### Exemplo de envio (Node.js)

```js
const crmWebhookUrl = process.env.CRM_WEBHOOK_URL;
const crmWebhookTimeoutMs = Number(process.env.CRM_WEBHOOK_TIMEOUT_MS || 10000);

async function sendPaidAcquisitionToCrm(payload) {
  const idempotencyKey = payload?.metadata?.idempotency_key;

  if (!crmWebhookUrl || process.env.CRM_WEBHOOK_ENABLED === 'false') {
    return; // envio desabilitado ou não configurado
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), crmWebhookTimeoutMs);

  const response = await fetch(crmWebhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey
    },
    body: JSON.stringify(payload),
    signal: controller.signal
  });

  clearTimeout(timer);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Erro ao enviar aquisição para CRM: ${response.status} - ${body}`);
  }
}
```

### Pseudocódigo da janela de 5 minutos

```text
onPostback(event):
  persistRaw(event)

  if event.status != 3:
    markAsNonPaid(event)
    return 200

  schedule(jobAt = event.paid_at + 5min, key = transaction_id)
  return 200

onScheduledJob(transaction_id):
  sale = dhr.getSale(transaction_id)

  if sale.status == 3:
    payload = buildCrmPayload(sale)
    sendToCrmWebhook(payload)
    sendWhatsApp(payload.customer)
    markDispatched(transaction_id)
  else:
    markSkipped(transaction_id, reason='status_changed_before_5min')
```

### Ajustes de banco para essa regra

Adicionar campos em `lead_acquisitions`:

- `gateway_status_code` (int)
- `eligible_at` (`paid_at + interval '5 minutes'`)
- `dispatched_to_crm_at`
- `crm_webhook_url`
- `idempotency_key`

Com isso, sua operação fica alinhada exatamente com a regra: **só considerar lead pago (status 3) após 5 minutos**, e então disparar aquisição no webhook do CRM.


### Você está enviando os dados pedidos? (mapa de campos)

Sim — abaixo está o mapeamento mínimo recomendado dos dados que normalmente o CRM pede para aquisição de lead pago:

- `transaction_id`: identificador único da venda no gateway.
- `order_id`: id do pedido/funil (quando existir).
- `status` e `status_label`: código bruto (`3`) + semântico (`paid`).
- `amount` e `currency`: valor e moeda da compra.
- `paid_at`: data/hora da confirmação.
- `customer.name`, `customer.email`, `customer.phone`: dados de contato para CRM e WhatsApp.
- `metadata.idempotency_key`: evita duplicidade no fluxo.

Se o seu CRM exigir outros campos obrigatórios (ex.: `campaign`, `utm_source`, `product_name`, `seller_id`), incluir no payload antes do envio.

### Conseguiu analisar a documentação da DHR?

Sim, parcialmente:

- Foi possível validar a página de introdução e confirmar autenticação Basic Auth, padrão REST/JSON e presença das seções de postback e vendas.
- O endpoint HTTP direto por `curl` bloqueou no ambiente (403 de tunnel), mas a leitura via browser headless retornou a página da documentação.
- Ainda falta confirmar no detalhe a página específica de **Formato dos postbacks** (campos e enumeração oficial de status) para fechar 100% da implementação sem suposições.
