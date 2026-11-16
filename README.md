# 🎮 Dethrone Control v1.4 — Supabase + 3 PINs

Esta versão mantém **a aparência e as regras da v1.3**. As únicas novidades são:

- Entrada com **um dos três PINs de 6 dígitos definidos pelo responsável**; **todos acessam o mesmo painel e os mesmos dados**.
- Registros salvos no **Supabase**, com sincronização automática para PC e celular.
- Enquanto a internet estiver indisponível, guarda uma cópia local de alterações pendentes para reenviar depois.
- Proteção contra sobrescrever alterações simultâneas: mescla alterações em registros diferentes e pede decisão caso duas pessoas editem o **mesmo** registro.
- Migração opcional do localStorage da v1.3 e importação/exportação de backups JSON.

⚠️ **Importante:** o ZIP entrega os arquivos prontos para configurar, **mas ainda não está conectado à sua conta Supabase**. Ninguém precisa informar os PINs aqui na conversa de novo. Por segurança, os PINs **não estão gravados no ZIP**: você vai defini-los como segredo no painel Supabase. Não há login por e-mail.

## Configuração em 5 etapas

### 1) Crie o projeto

1. Acesse https://supabase.com/dashboard e crie/abra um projeto.
2. Em **SQL Editor → New query**, cole **todo** o arquivo `supabase/setup.sql` e clique em **Run**.
3. Isso cria duas tabelas privadas e a função de controle de tentativas. Elas não têm acesso público direto.

### 2) Configure os PINs no lado do servidor

No **Supabase Dashboard → Edge Functions → Secrets** (às vezes acessível por Project Settings → Edge Functions), adicione:

| Secret | O que preencher |
|---|---|
| `ACCESS_PINS` | **Seus três PINs**, separados por vírgulas, sem espaços adicionais (preserve zeros à esquerda) |
| `SESSION_SECRET` | **Uma chave longa aleatória**, de no mínimo 32 caracteres (não use um PIN aqui) |

Exemplo do **formato** de `ACCESS_PINS`: `111111,222222,333333` — **esse exemplo não é a sua configuração**.

Não coloque esses valores em `js/config.js`, `setup.sql`, `index.ts` ou no GitHub. O Supabase guarda esses secrets e os disponibiliza somente à função no servidor.

Para gerar `SESSION_SECRET`, em um terminal com Python execute:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Copie a saída para `SESSION_SECRET` no painel do Supabase, sem publicar a chave.

### 3) Publique a função `dethrone-api`

**Pelo painel do Supabase (sem instalar programas):**

1. Abra **Edge Functions → Deploy a new function → Via Editor**.
2. Nomeie a função **`dethrone-api`**.
3. Substitua o código do editor por **todo o conteúdo** do arquivo `supabase/functions/dethrone-api/index.ts`.
4. Clique em **Deploy function**.
5. Nas configurações da função, **desative a opção "Verify JWT" (verificação JWT)**. Isso permite a tela de PIN funcionar: a própria função verifica o PIN/sessão e a tabela permanece bloqueada para acesso anônimo.

**Alternativa pelo CLI** (dentro da pasta extraída):

```bash
npx supabase login
npx supabase link --project-ref SEU_PROJECT_REF
npx supabase functions deploy dethrone-api --no-verify-jwt --use-api
```

O arquivo `supabase/config.toml` também define `verify_jwt = false`. Os secrets são configurados somente no painel ou com `supabase secrets set` (não os salve em arquivos públicos).

### 4) Configure o site

Abra `js/config.js` e substitua apenas `SEU-PROJETO` pela referência do seu projeto:

```javascript
window.DETHRONE_CONFIG = {
  supabaseUrl: 'https://abc123xyz.supabase.co'
};
```

Essa URL **não é uma senha** e pode ficar no GitHub. Não precisa de chave `service_role` ou chave `anon` no navegador.

### 5) Atualize o GitHub Pages

1. **Antes de atualizar a v1.3**, entre nela e clique em **Backup → Baixar backup**.
2. Envie os arquivos **`index.html`, `css/`, `js/`** da v1.4 para o repositório e publique pelo GitHub Pages como antes.
3. A pasta **`supabase/`** serve apenas para instalar o banco/função; não precisa ser publicada no Pages. Também não é necessário publicar o `README.md`.
4. Abra a URL do site e digite **qualquer um dos três PINs**.
5. Após entrar, o status no cabeçalho deve mostrar **"Salvo na nuvem"**.

## Como aproveitar os dados anteriores

Se você atualizar o **mesmo endereço do GitHub Pages, no mesmo navegador**, a v1.4 reconhecerá registros da v1.3 e oferecerá **"Importar registros antigos"** quando o banco estiver vazio. Também há uma opção na janela **Backup**.

Se o endereço ou dispositivo for diferente, utilize o backup JSON da v1.3 em **Backup → Importar backup**. Faça a importação apenas uma vez e confira o status **"Salvo na nuvem"** antes de fechar.

A importação substitui o conteúdo da nuvem — portanto, não a faça novamente depois que outros dispositivos já tiverem criado dados novos.

## Regras preservadas

### Dethrone

- Segunda / quarta / quinta: **2h manhã + 2h noite** para contar 1 dia.
- Terça: **2h de manhã** para contar 1 dia.
- Sexta / sábado / domingo: **4h à noite** para contar 1 dia.
- É possível registrar períodos parciais (1h, 2h, 3h); a data prevista é recalculada considerando apenas dias completos.
- Início em quarta-feira à noite não contabiliza a manhã que não foi realizada.

### Chaos Golem

- A semana vai de **quarta-feira até terça-feira**.
- PT1: GolemA1–A5; PT2: GolemB1–B5; PT3: GolemC1–C5; PT4: GolemD1–D5.
- Marcação simples: **feito / não feito**, no máximo uma participação por personagem/dia.
- Objetivo: **3 dias com participação por semana**.
- A grade permite escolher qualquer PT/dia, inclusive terça-feira; o planejamento de horários **não é uma restrição**.
- Mantido o destaque **neon do dia atual**.

## Segurança, sessão e sincronização

- **Os três PINs compartilham um único banco de dados**. Não existem três usuários independentes.
- O PIN é validado **dentro da Edge Function**, não no navegador. O servidor devolve uma sessão temporária de **24 horas**. Fechar a aba encerra a sessão no navegador; recarregar a página na mesma aba mantém o acesso até expirar. O botão **Sair** encerra o acesso nesse navegador.
- A Edge Function limita tentativas inválidas por origem e também globalmente. PINs de 6 dígitos são convenientes, mas menos fortes que senhas longas: **não compartilhe a URL + PIN com pessoas não autorizadas**.
- O banco usa RLS e não permite que o navegador leia/escreva tabelas diretamente. Nunca publique `SESSION_SECRET` ou `SUPABASE_SERVICE_ROLE_KEY`.
- A sincronização ocorre após cada alteração. O sistema consulta mudanças dos outros dispositivos aproximadamente a cada **20 segundos**, quando não há edições locais pendentes.
- Em falha de conexão, guarda uma cópia pendente no `localStorage` deste navegador. **Não limpe os dados do navegador enquanto houver registros pendentes.** Em caso de conflito simultâneo no mesmo registro, baixe um backup e escolha qual versão manter.
- As cópias pendentes armazenadas no navegador **não são criptografadas em disco**. A tela de PIN protege o acesso à nuvem, não substitui a segurança física do aparelho.
- Faça backups manuais em JSON regularmente. O plano gratuito do Supabase pode pausar por inatividade e não oferece backup automático gerenciado.

## Estrutura do ZIP

```
index.html
css/styles.css
js/config.js        <- inserir somente URL do projeto
js/app.js           <- interface v1.3 e regras preservadas
js/cloud.js         <- autenticação e sincronização
supabase/setup.sql  <- executar no SQL Editor
supabase/config.toml
supabase/functions/dethrone-api/index.ts  <- publicar como Edge Function
README.md
.gitignore
```

**Limites do teste:** esta versão foi testada localmente com uma API Supabase simulada; a conexão com o projeto Supabase real só pode ser validada depois que você configurar seu projeto e publicar a Edge Function.
