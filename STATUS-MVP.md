# Status de implementação — EBC Monitor Portal v0.1

## Implementado no pacote
- Frontend React + TypeScript responsivo.
- Tela de login Supabase Auth.
- Autorização individual com tabela `portal_access` e RLS (nega por padrão).
- Edge Function que valida JWT e autorização antes de acessar o Grafana.
- Consultas PromQL fixas baseadas no JSON exportado do dashboard `ebc-monitor`.
- Token de serviço mantido exclusivamente como secret da Edge Function.
- Painéis próprios e atualização automática a cada 60 segundos.
- Prévia visual demonstrativa sem conexão a dados reais.
- Instruções de implantação Netlify + Supabase + Grafana no README.

## Ainda depende de configuração do ambiente do usuário
- Criar projeto Supabase e executar a migration SQL.
- Criar uma Service Account Viewer no Grafana e gerar token.
- Configurar os secrets da Edge Function e publicá-la.
- Autorizar os usuários na tabela `portal_access`.
- Configurar as variáveis públicas do Supabase no Netlify.
- Validar conectividade de saída da Edge Function até o Grafana e validar o formato de resposta real do datasource.

## Limite desta entrega
O pacote contém o código-fonte e as instruções, não está conectado ao Supabase/Grafana do usuário e não foi publicado no Netlify. A instalação de dependências/build não foi validada neste ambiente porque `npm install` excedeu o tempo limite disponível. Fazer o deploy somente após executar os testes de `README.md`.
