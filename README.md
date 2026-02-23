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
2. Selecione o repositório certo.
3. Em **Settings > Source**, garanta:
   - **Repository**: seu repositório com este código
   - **Branch**: branch onde estão `package.json` e `src/`
   - **Root Directory**: vazio (`.`) para este projeto
4. Clique em **Deploy**.

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
curl -X POST https://SEU_APP.up.railway.app/webhooks/dhr \
  -H "Content-Type: application/json" \
  -d '{
    "transaction_id":"txn_123",
    "order_id":"pedido_456",
    "status":3,
    "amount":19990,
    "currency":"BRL",
    "paid_at":"2026-02-23T10:00:00Z",
    "customer":{"name":"Lead","email":"lead@email.com","phone":"5511999999999"}
  }'
```

### 6) Erro específico: "Railpack analisou só .gitkeep"

Se no log aparecer algo como:

- `⚠ Script start.sh not found`
- `Railpack could not determine how to build the app`
- árvore contendo apenas `./ .gitkeep`

isso **não é erro do Node**. Significa que o Railway está lendo uma pasta vazia/errada.

#### Correção em 60 segundos

1. Abra **Railway > seu serviço > Settings > Source**.
2. Confirme **Repository** e **Branch** corretos.
3. Em **Root Directory**, deixe vazio (`.`) para este projeto.
4. Salve e clique em **Redeploy**.
5. Se ainda aparecer `.gitkeep`, desconecte e reconecte o repositório no serviço.

#### Quando isso continua acontecendo (mesmo após redeploy)

Se o log continua mostrando apenas `.gitkeep`, normalmente o serviço foi criado a partir de uma origem vazia e não está puxando seu GitHub de fato. Faça este reset rápido:

1. No Railway, crie **um novo serviço** com **Deploy from GitHub repo** (não use serviço vazio/manual).
2. Selecione o mesmo repositório e a branch correta.
3. Em **Root Directory**, use `.`.
4. Em **Deploy > Settings**, garanta:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
5. Faça deploy desse novo serviço.

> Se funcionar no serviço novo, o serviço antigo estava com source quebrado/cacheado.

#### Validação no GitHub (antes do deploy)

Na branch usada no Railway, precisa existir pelo menos:

- `package.json`
- `start.sh`
- `src/server.js`

Se qualquer um desses não estiver no GitHub, faça push novamente.

Comandos para validar localmente antes de abrir o Railway:

```bash
git branch --show-current
git remote -v
git ls-files | rg '^(package.json|start.sh|src/server.js)$'
git push origin $(git branch --show-current)
```

### 7) Problemas comuns no Railway

- **Deploy falha por start command**: confirme `npm start`.
- **App sobe e cai**: veja logs; normalmente variável ausente/inválida.
- **Webhook do CRM não envia**: confirme `CRM_WEBHOOK_ENABLED=true` e `CRM_WEBHOOK_URL` correta.
- **Timeout no CRM**: aumente `CRM_WEBHOOK_TIMEOUT_MS`.
- **Não quer esperar 5 min em teste**: coloque `PAID_DELAY_MS=5000` temporariamente.

### 8) Checklist de produção

- [ ] URL do CRM configurada corretamente
- [ ] Delay de 5 min ativo (`PAID_DELAY_MS=300000`)
- [ ] Healthcheck respondendo 200
- [ ] Logs de envio ao CRM sem erro
- [ ] Revalidação DHR habilitada (se necessário)

Este repo também inclui `railway.toml` e `start.sh`, mas eles só funcionam quando o Source está apontando para o diretório correto do projeto.
