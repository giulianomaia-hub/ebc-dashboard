# EBC Monitor Portal — MVP v0.1

Portal de consulta autenticado para o dashboard `ebc-monitor` do Grafana 12.2.0. O frontend é hospedado no Netlify; autenticação e autorização são feitas pelo Supabase; a Edge Function consulta a HTTP API do Grafana usando um token de conta de serviço guardado exclusivamente no backend.

## Escopo entregue

- Login por e-mail e senha via Supabase Auth.
- Autorização individual por `portal_access.enabled` (nega por padrão).
- Dashboard próprio com cartões de CPU, memória, disco e containers.
- Gráficos de rede, CPU por imagem e memória por imagem.
- Tabela de consumo atual por imagem.
- Filtro textual de imagem/container.
- Atualização automática a cada 60 segundos.
- Layout responsivo e modo de prévia visual sem dados reais.
- Nenhuma credencial do Grafana no bundle do navegador.

## Arquitetura

`Browser → Netlify (React) → Supabase Auth → Supabase Edge Function → Grafana /api/ds/query → Prometheus`

A função aceita somente o filtro textual `imageFilter` e monta no servidor as consultas PromQL predefinidas. Não aceita PromQL arbitrária do navegador. O token da conta técnica Grafana nunca é enviado ao cliente.

## 1. Criar e configurar o projeto Supabase

1. Crie um projeto Supabase.
2. Abra **SQL Editor** e execute `supabase/migrations/001_portal_access.sql`.
3. Em **Authentication → Providers**, mantenha Email habilitado. Para produção, prefira convites/criação administrativa de usuários e desabilite cadastro público (Signups) se somente pessoas pré-autorizadas devem entrar.
4. Crie o primeiro usuário em **Authentication → Users → Add user**.
5. Copie o UUID desse usuário e autorize-o no SQL Editor:

```sql
insert into public.portal_access (user_id, enabled)
values ('UUID-DO-USUARIO', true)
on conflict (user_id) do update set enabled = true;
```

Para bloquear posteriormente:

```sql
update public.portal_access set enabled = false where user_id = 'UUID-DO-USUARIO';
```

A política RLS permite que cada usuário autenticado leia somente o próprio registro. Não há política para usuário comum inserir ou alterar permissões.

## 2. Criar a conta técnica no Grafana (pela interface web)

No Grafana `https://grafana.plataformacomum.tv.br/`:

1. Acesse **Administration → Users and access → Service accounts** (o nome pode variar ligeiramente).
2. Crie uma Service Account chamada `ebc-monitor-portal` com papel **Viewer**.
3. Gere um token. Copie-o apenas uma vez para um gerenciador seguro/ambiente de implantação. Não o envie por chat, não o coloque no `.env` do frontend e não o versione no Git.
4. Confirme que a conta consegue consultar a fonte de dados Prometheus de UID `prometheus`. Se a consulta retornar 403, revise as permissões da fonte de dados e a política da organização.
5. Não conceda Admin nem Editor à conta técnica.

**Nota de segurança:** Viewer pode ter alcance de leitura maior que um único dashboard, dependendo da organização e da edição/configuração do Grafana. A Edge Function reduz a superfície de exposição ao permitir apenas as consultas fixas implementadas no código. Não implemente um endpoint genérico que aceite PromQL arbitrária.

## 3. Implantar a Edge Function

Instale a Supabase CLI e autentique-se:

```bash
supabase login
supabase link --project-ref SEU_PROJECT_REF
```

Configure os segredos no projeto Supabase (não no Netlify):

```bash
supabase secrets set \
  GRAFANA_URL=https://grafana.plataformacomum.tv.br \
  GRAFANA_SERVICE_ACCOUNT_TOKEN='TOKEN_GERADO_NO_GRAFANA' \
  GRAFANA_DATASOURCE_UID=prometheus \
  PORTAL_ORIGIN=https://SEU-PORTAL.netlify.app
```

Publique a função:

```bash
supabase functions deploy monitoring-data
```

`SUPABASE_URL` e `SUPABASE_ANON_KEY` são disponibilizados automaticamente no ambiente da Edge Function pelo Supabase. A função exige JWT válido e ainda verifica `portal_access.enabled` antes de consultar o Grafana.

## 4. Executar localmente

```bash
npm install
cp .env.example .env.local
```

Preencha `.env.local` com a URL do projeto Supabase e a chave **anon/public** (nunca a service-role key):

```env
VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_ANON_KEY=SUA_CHAVE_ANON_PUBLICA
```

Depois:

```bash
npm run dev
```

A prévia visual sem dados reais aparece se as variáveis Supabase ainda não estiverem configuradas. Ela não simula autenticação nem consulta dados reais.

## 5. Publicar no Netlify

1. Suba o diretório do projeto para um repositório Git privado.
2. Importe o repositório no Netlify.
3. Build command: `npm run build`.
4. Publish directory: `dist`.
5. Cadastre no Netlify as variáveis `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.
6. Cadastre o domínio definitivo do portal e atualize `PORTAL_ORIGIN` nos segredos Supabase para esse domínio.
7. Em Supabase Auth → URL Configuration, configure Site URL e Redirect URLs para o domínio Netlify/portal.

## 6. Testes obrigatórios antes de liberar

- Usuário sem linha em `portal_access`: deve receber HTTP 403.
- Usuário com `enabled=false`: deve receber HTTP 403.
- Usuário habilitado: deve receber os dados esperados.
- Usuário deslogado ou JWT expirado: deve receber HTTP 401.
- Inspecionar o bundle do navegador: não pode conter token Grafana nem Supabase service-role key.
- Testar filtro com caracteres especiais; a função escapa caracteres de regex antes de compor o seletor Prometheus.
- Confirmar que a conta técnica só consegue consultar a fonte Prometheus necessária.
- Verificar se as métricas existem no Prometheus e se os nomes dos jobs são exatamente `node-exporter` e `cadvisor`.

## Limitações conhecidas do MVP v0.1

- O portal recria os gráficos a partir das consultas PromQL exportadas; ele não incorpora a interface Grafana.
- O filtro é textual e filtra o label `image`; a lista de opções dinâmica do dropdown original será uma evolução posterior.
- O período inicial das séries é de uma hora.
- O mapeamento dos frames de resposta da API do Grafana pode precisar de pequeno ajuste conforme o formato efetivo retornado pela instância e pelo datasource Prometheus.
- O acesso externo do Supabase Edge Function ao Grafana precisa ser possível pela rede/HTTPS. Se o Grafana estiver protegido por allowlist, WAF ou VPN, será necessário autorizar a saída do Supabase ou adotar um backend de integração em rede permitida.
- A conta de serviço Viewer não equivale a isolamento de dados por dashboard. O isolamento do portal é feito pela autenticação Supabase e pela lista fixa de consultas do backend; valide o alcance da conta técnica antes de produção.

## Variáveis e segredos

**Frontend/Netlify:** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (chave pública anon).

**Supabase Edge Function secrets:** `GRAFANA_URL`, `GRAFANA_SERVICE_ACCOUNT_TOKEN`, `GRAFANA_DATASOURCE_UID`, `PORTAL_ORIGIN`. Não configurar esses segredos como variáveis `VITE_*`.
