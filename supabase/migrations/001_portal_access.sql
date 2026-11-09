-- Execute no SQL Editor do Supabase.
-- Por padrão, novos usuários NÃO recebem acesso automaticamente.
create table if not exists public.portal_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.portal_access enable row level security;

-- O usuário só pode consultar o próprio registro de autorização.
drop policy if exists "Users can read their own portal access" on public.portal_access;
create policy "Users can read their own portal access"
  on public.portal_access for select
  to authenticated
  using (auth.uid() = user_id);

-- Não há políticas de INSERT, UPDATE ou DELETE para usuários autenticados.
-- A administração de permissões deve ocorrer pelo painel do Supabase.
