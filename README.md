# Integração DHR → CRM (backend real)

Este repositório agora inclui um backend Node.js para:

- Receber webhook em `POST /webhooks/dhr`
- Aplicar regra `status == 3` como pago
- Aguardar janela configurável (padrão 5 minutos)
- Revalidar status opcionalmente na DHR
- Enviar aquisição para webhook do CRM

## Executar

```bash
npm start
```

Servidor padrão: `http://localhost:3000`

## Variáveis de ambiente

- `PORT` (default: `3000`)
- `CRM_WEBHOOK_URL` (default: vazio)
- `CRM_WEBHOOK_ENABLED` (default: `true`)
- `CRM_WEBHOOK_TIMEOUT_MS` (default: `10000`)
- `PAID_DELAY_MS` (default: `300000` = 5 minutos)
- `DHR_REVALIDATE_ENABLED` (default: `false`)
- `DHR_BASE_URL` (default: `https://api.dhrtecnologialtda.com`)
- `DHR_PUBLIC_KEY`
- `DHR_SECRET_KEY`

## Endpoints

### `POST /webhooks/dhr`

Payload mínimo:

```json
{
  "transaction_id": "txn_123",
  "order_id": "pedido_456",
  "status": 3,
  "amount": 19990,
  "currency": "BRL",
  "paid_at": "2026-02-23T10:00:00Z",
  "customer": {
    "name": "Lead Exemplo",
    "email": "lead@email.com",
    "phone": "5511999999999"
  }
}
```

### `POST /jobs/process-now`
Força processar uma transação imediatamente (útil para debug/teste).

### `GET /state`
Mostra eventos e aquisições em memória.

### `GET /health`
Healthcheck simples.

## Testes

```bash
npm test
```


## Deploy no Railway (passo a passo)

### 1) Subir este código para o seu GitHub

No seu computador/local (fora do ambiente daqui), execute:

```bash
git init
git add .
git commit -m "feat: dhr crm integration backend"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/SEU_REPO.git
git push -u origin main
```

> Se o repositório já existe, apenas copie os arquivos e faça `git add/commit/push`.

### 2) Criar o serviço no Railway

1. Acesse Railway > **New Project** > **Deploy from GitHub repo**.
2. Selecione o repositório.
3. O Railway deve detectar Node automaticamente (`npm start`).

### 3) Configurar variáveis de ambiente no Railway

Use os mesmos nomes do `.env.example`:

- `PORT=3000`
- `CRM_WEBHOOK_URL=...` (sua URL real do DataCrazy)
- `CRM_WEBHOOK_ENABLED=true`
- `CRM_WEBHOOK_TIMEOUT_MS=10000`
- `PAID_DELAY_MS=300000`
- `DHR_REVALIDATE_ENABLED=false` (ou `true` se quiser revalidar)
- `DHR_BASE_URL=https://api.dhrtecnologialtda.com`
- `DHR_PUBLIC_KEY=...` (se revalidar)
- `DHR_SECRET_KEY=...` (se revalidar)

### 4) Garantir start command

Se Railway não detectar automaticamente, configure:

- **Build Command**: `npm install`
- **Start Command**: `npm start`

### 5) Teste após deploy

Com a URL pública do Railway:

```bash
curl https://SEU_APP.up.railway.app/health
```

Deve retornar:

```json
{"ok":true}
```

E para testar webhook:

```bash
curl -X POST https://SEU_APP.up.railway.app/webhooks/dhr   -H "Content-Type: application/json"   -d '{
    "transaction_id":"txn_123",
    "order_id":"pedido_456",
    "status":3,
    "amount":19990,
    "currency":"BRL",
    "paid_at":"2026-02-23T10:00:00Z",
    "customer":{"name":"Lead","email":"lead@email.com","phone":"5511999999999"}
  }'
```

### 6) Problemas comuns no Railway (quando “não vai”)

- **Deploy falha por start command**: confirme `npm start`.
- **App sobe e cai**: veja logs; normalmente variável ausente/inválida.
- **Webhook do CRM não envia**: confirme `CRM_WEBHOOK_ENABLED=true` e `CRM_WEBHOOK_URL` correta.
- **Timeout no CRM**: aumente `CRM_WEBHOOK_TIMEOUT_MS`.
- **Não quer esperar 5 min em teste**: coloque `PAID_DELAY_MS=5000` temporariamente.

### 7) Checklist de produção

- [ ] URL do CRM configurada corretamente
- [ ] Delay de 5 min ativo (`PAID_DELAY_MS=300000`)
- [ ] Healthcheck respondendo 200
- [ ] Logs de envio ao CRM sem erro
- [ ] Revalidação DHR habilitada (se necessário)


### Erro específico: "Railpack analisou só .gitkeep"

Se no log aparecer algo como:

- `Railpack could not determine how to build the app`
- árvore contendo apenas `./ .gitkeep`

isso significa que o Railway recebeu **um repositório/branch/pasta sem os arquivos do projeto**.

Checklist rápido para corrigir:

1. Confirme no GitHub que existem `package.json`, `src/`, `README.md` na branch conectada ao Railway.
2. No Railway, confira se o serviço está apontando para o **repo correto** e branch correta (`main`, por exemplo).
3. Se usar monorepo, configure o **Root Directory** para a pasta do app (não raiz vazia).
4. Refaça deploy manual após confirmar os arquivos no GitHub.

Além disso, este repo agora inclui:

- `railway.toml` com start command explícito `./start.sh`
- `start.sh` para forçar execução Node (`npm install` + `npm start`)

Isso evita falhas de autodetecção quando o ambiente estiver corretamente apontado para o projeto.
