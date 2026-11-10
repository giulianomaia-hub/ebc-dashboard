# Atlantis - Infra Monitor | Atualização de dashboard

## Arquivos incluídos
- `src/App.tsx`: duas abas, gauges no padrão visual Grafana, indicadores de aplicações e gráficos.
- `src/index.css`: estilos complementares; preserva a identidade escura atual.
- `src/lib.ts`: tipagem e chamada à Edge Function com filtros de imagem, serviço e período.
- `supabase/functions/monitoring-data/index.ts`: consulta Prometheus via Grafana, com autorização `portal_access`.

## Aplicação local
1. Faça uma cópia de segurança do projeto atual.
2. Substitua os quatro arquivos nos caminhos correspondentes.
3. Mantenha `src/main.tsx` importando `./index.css` (ou copie o conteúdo de `src/index.css` para o CSS global que seu projeto já importa).
4. Execute `npm.cmd run build`.
5. Teste login, Visão geral e Desempenho e Confiabilidade.

## Publicação
Depois de validar o frontend:
1. Faça commit/push dos arquivos do frontend para o GitHub para o Netlify publicar.
2. Publique a Edge Function no projeto Supabase:
   `npx.cmd supabase functions deploy monitoring-data`
3. Não altere nem compartilhe os secrets existentes. A função continua usando `GRAFANA_URL`, `GRAFANA_SERVICE_ACCOUNT_TOKEN`, `GRAFANA_DATASOURCE_UID` e `PORTAL_ORIGIN`.

## Observações
- A aba de desempenho usa as expressões PromQL do dashboard Grafana fornecido: métricas `http_server_duration_milliseconds_*` e `http_server_request_duration_seconds_*`, com latência p95/p99 convertida para milissegundos.
- Períodos disponíveis: 1h, 6h e 24h. Atualização automática: 60 segundos.
- Os gauges mostram CPU, memória e disco em escala de 0 a 100%, com faixas verde/amarela/vermelha.
- A Edge Function mantém a validação de sessão e a autorização por `public.portal_access`.
- A lista de serviços é preenchida a partir das séries retornadas no período selecionado. Se não houver métricas HTTP no intervalo, a lista pode ficar vazia.
- O projeto não foi conectado ao seu Supabase/Netlify nem publicado por esta entrega. Faça o teste local antes do deploy.
