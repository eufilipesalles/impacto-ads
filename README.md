# Impacto Ads

Painel interno da Impacto para acompanhar as contas de anúncio (Meta) de todos os clientes.

- `web/`: o painel (React + Vite). É ele que sobe no Vercel.
- `supabase/`: banco (migrations) e a função de coleta `meta-sync`, já aplicados no projeto Supabase "Impacto Ads".

## Subir no Vercel

1. Crie um repositório no GitHub e envie esta pasta inteira.
2. No Vercel: **Add New → Project** e importe o repositório.
3. Em **Root Directory**, escolha `web`. O Vercel detecta o Vite sozinho:
   - Build command: `npm run build`
   - Output: `dist`
4. Em **Environment Variables**, adicione as duas variáveis do arquivo `web/.env.example`:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. Clique em **Deploy**.

## Criar o seu login

O painel só abre para e-mails cadastrados na tabela `team_members`. Já estão cadastrados:

- eufilipesalles.contato@gmail.com
- filiperscoproducao@gmail.com

Para criar a senha:

1. No Supabase, vá em **Authentication → Users → Add user → Create new user**.
2. Use um dos e-mails acima, defina a senha e marque **Auto Confirm User**.

Recomendado: em **Authentication → Sign In / Providers**, desative **Allow new users to sign up**. Mesmo sem isso, quem não estiver na equipe não vê nenhum dado.

Para incluir outra pessoa da equipe, adicione o e-mail dela na tabela `team_members` e crie o usuário do mesmo jeito.

## Rodar no computador

```bash
cd web
npm install
npm run dev
```

Para ver o painel com dados fictícios, sem login, abra o endereço com `?demo` no final.
