# Ativar o painel administrativo

## Situação desta entrega

O código do painel e o esquema do banco estão preparados. **Nenhum projeto Supabase, usuário, senha, chave secreta ou permissão de administrador foi criado por esta alteração.** O painel só poderá salvar alterações depois que o responsável configurar o backend, criar seu usuário e conceder acesso. O GitHub Pages hospeda arquivos estáticos e não executa um servidor de autenticação ou um banco de dados.

Não há senha padrão nem senha embutida no JavaScript. Não publique uma senha no repositório e não envie senhas pelo chat. A URL do projeto e a chave **publishable** (ou a chave legada **anon**) são configurações públicas, não credenciais administrativas. A proteção efetiva está nas funções e permissões do banco.

## 1. Preparar um projeto Supabase

1. O responsável deve acessar [Supabase](https://supabase.com/) e criar ou escolher um projeto adequado para este site. Verifique o plano, os limites, a região, os custos e os termos antes de contratar. Este procedimento não é executado automaticamente pelo site.
2. Em **SQL Editor**, execute o arquivo completo `supabase/schema.sql`, como proprietário do banco. Ele cria as tabelas privadas, habilita RLS, revoga acesso direto dos navegadores, instala as três funções públicas e importa os 14 produtos atuais.
3. A execução é transacional: uma falha não deve ser ignorada. Corrija a causa antes de continuar. Executar novamente o mesmo arquivo **não substitui** o catálogo existente nem remove administradores cadastrados.
4. Mantenha `maravi_private` fora da lista de schemas expostos pela Data API. Não conceda acesso de `anon` ou `authenticated` às tabelas privadas. Não adicione políticas permissivas de leitura ou escrita.
5. Em **Authentication**, desabilite o cadastro público de novos usuários. Configure os limites de tentativas de autenticação adequados à operação. Não há tela de cadastro público neste painel.

O esquema deve ser instalado em um projeto controlado pela Maravi. Não reutilize um projeto de terceiros sem autorização.

## 2. Criar o administrador com segurança

1. No painel do Supabase, em **Authentication → Users**, crie manualmente o usuário administrador com um e-mail que o responsável controla e uma senha longa, exclusiva e guardada em seu gerenciador de senhas. Não use exemplos de senha ou valores fixos do código.
2. Copie o **UUID** desse usuário. Ele identifica a conta; não é a senha.
3. No SQL Editor, substitua o marcador abaixo pelo UUID real e execute:

```sql
insert into maravi_private.admins (user_id)
values ('UUID-DO-USUARIO'::uuid)
on conflict (user_id) do nothing;
```

Só contas explicitamente incluídas nessa lista conseguem ler o catálogo administrativo ou gravar. Uma conta autenticada comum não pode se promover a administradora. Para revogar um administrador, o proprietário pode executar:

```sql
delete from maravi_private.admins
where user_id = 'UUID-DO-USUARIO'::uuid;
```

A revogação passa a valer nas próximas chamadas ao banco, inclusive se houver uma sessão ainda aberta. A senha e a recuperação da conta são gerenciadas no Supabase, não no repositório. Não conceda acesso à administração do projeto a quem só precisa editar produtos.

## 3. Configurar o site

Edite somente os valores públicos de `config.js`:

```js
window.MARAVI_CONFIG = Object.freeze({
  supabaseUrl: 'https://SEU-PROJETO.supabase.co',
  supabasePublishableKey: 'SUA-CHAVE-PUBLISHABLE-OU-ANON'
});
```

Copie a URL e a chave nas configurações de API do projeto. Use a URL HTTPS da raiz do projeto, sem `/rest/v1` no final. **Nunca use `service_role`, uma chave `sb_secret_…`, senha do banco ou token administrativo nesse arquivo.** Não coloque segredos em GitHub Pages, variáveis que são incorporadas ao JavaScript durante o build ou arquivos públicos.

O formulário de login envia a senha diretamente ao serviço de autenticação por HTTPS. Os tokens de sessão ficam somente na memória da página, não em `localStorage`, arquivos ou no repositório. Recarregar ou fechar o painel pode exigir novo login. A senha não fica no catálogo.

Abra `admin.html` no endereço do site de testes. Para conferir os arquivos localmente, a partir da raiz do repositório:

```sh
python3 -m http.server 8080
```

Depois acesse `http://localhost:8080/admin.html`. O navegador ainda usará o backend indicado em `config.js`; **não aponte testes destrutivos para um catálogo de produção**. Sem backend configurado, o painel deve informar a pendência, não simular um salvamento bem-sucedido.

## 4. Conferir antes de publicar

Faça essas verificações com um projeto de testes:

- Abra o cardápio sem login e confirme produtos, preços, fotos e sabores.
- Entre com o administrador. Altere um produto, salve e abra o cardápio em outro navegador. A alteração deve aparecer após uma nova leitura do catálogo.
- Inative um produto e um sabor de caixa. Eles não devem ser oferecidos ao cliente.
- Ajuste o estoque para zero e confirme que não é possível adicionar o produto ao pedido. Estoque em branco significa sem limite manual; zero significa esgotado.
- Abra duas sessões administrativas, carregue a mesma revisão e salve na primeira. A segunda deve receber um conflito e recarregar o catálogo antes de tentar novamente, sem sobrescrever silenciosamente a primeira.
- Verifique senha incorreta, saída da conta, recarga da página e sessão expirada.
- Uma conta autenticada fora da lista `maravi_private.admins` deve receber `ADMIN_REQUIRED`. Chamadas anônimas de gravação e acesso direto às tabelas devem falhar.
- Teste o fluxo completo de montagem das caixas e geração do pedido no WhatsApp, sem enviar pedidos fictícios à doceria.
- Mantenha cópia de segurança do catálogo e confirme a política de backups do plano escolhido antes da operação real.

Este preparo não faz merge, deploy, migração automática nem mudanças no site em produção. A publicação e a ativação do backend precisam ser feitas no ambiente escolhido e verificadas separadamente.

## Regras do catálogo

- Até 200 produtos. IDs únicos, de até 80 caracteres, com letras minúsculas, números e hífens entre segmentos.
- Preços em centavos inteiros, de 1 a 1.000.000 (R$ 0,01 a R$ 10.000,00).
- Nome até 100 caracteres, categoria até 80, descrição até 1.000 e peso/apresentação até 100.
- Estoque manual inteiro de 0 a 99.999, ou `null` para não limitar. **Não há reserva ou baixa automática por pedido.** Abrir/enviar uma mensagem do WhatsApp não comprova uma venda; o responsável deve atualizar o estoque depois da confirmação.
- Produtos simples não têm sabores. Os tipos de caixa `aconchego` e `quarteto` têm quatro unidades e entre 1 e 20 sabores cadastrados. Sabores podem ser ativados/inativados individualmente. Uma caixa sem sabores ativos não pode ser montada.
- Fotos devem apontar para arquivos locais `assets/nome-da-foto.webp`. O painel não faz upload. Novas fotos precisam ser adicionadas ao repositório pelo fluxo de revisão habitual antes de usar o caminho. Escolher um caminho válido não garante que o arquivo exista.
- Remover um produto do catálogo é diferente de inativá-lo. Prefira inativar quando quiser poder oferecê-lo novamente.
- As promoções e regras do pedido existentes continuam no código do cardápio; este painel não é um editor de promoções nem um sistema de pagamento. Alterações de preços, IDs e nomes dos sabores envolvidos em uma promoção exigem conferir o total mostrado ao cliente.

## Contrato técnico e segurança

As funções expostas na API são:

- `get_public_catalog()`: leitura anônima; retorna `{revision, catalog: {products: [...]}}`, removendo produtos e sabores inativos.
- `admin_get_catalog()`: mesma estrutura, incluindo inativos; exige usuário da lista administrativa.
- `admin_save_catalog(expected_revision, catalog_data)`: valida todo o catálogo, bloqueia a linha durante a transação e compara a revisão antes de gravar. Retorna a nova revisão e o catálogo salvo.

As funções públicas são `SECURITY DEFINER`, com `search_path` vazio e nomes de schema explícitos. O acesso administrativo é conferido pelo `auth.uid()` da sessão, nunca por um campo enviado pelo cliente. As tabelas privadas têm RLS habilitada, nenhuma política de acesso do navegador e permissões revogadas. Apenas o proprietário do projeto pode manter a lista administrativa.

Os campos são validados também no PostgreSQL, incluindo limites, tipos, IDs e sabores duplicados, preço, estoque e caminhos de imagem. Dados inválidos não são gravados. Erros principais: `ADMIN_REQUIRED` (não autorizado), `CATALOG_INVALID` (conteúdo inválido) e `CATALOG_CONFLICT` (revisão desatualizada). Um conflito não deve ser resolvido reenviando cegamente os mesmos dados com uma revisão maior.

O esquema foi exercitado em PostgreSQL embutido (PGlite) com testes de autorização, validação, filtragem pública, conflitos de revisão e reexecução sem perda de dados. Isso **não substitui** a verificação de Auth, Data API, configuração, rede e navegador contra o projeto Supabase real depois da ativação.
