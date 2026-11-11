# Ativar o painel administrativo

## Situação desta entrega

A instalação deste projeto já está ativa para testes: login, catálogo e Storage foram validados. `config.js` contém somente a URL e a chave pública. O site atual será temporário; antes do uso comercial, migrar de hospedagem e revisar limites de autenticação. As etapas abaixo documentam como configurar/reproduzir a instalação, não tarefas automaticamente pendentes.


O código do painel e o esquema do banco estão preparados. **Este código não cria automaticamente projeto Supabase, usuário, senha, chave secreta ou permissão de administrador.** O painel só poderá salvar alterações depois que o responsável configurar o backend e a função de login, criar seu usuário e conceder acesso. A preparação do código não comprova que essas etapas externas foram concluídas. O GitHub Pages hospeda arquivos estáticos e não executa um servidor de autenticação ou um banco de dados.

Não há senha padrão nem senha embutida no JavaScript. Não publique uma senha no repositório e não envie senhas pelo chat. A URL do projeto e a chave **publishable default** são configurações públicas, não credenciais administrativas. A proteção efetiva está nas funções e permissões do banco. O login por usuário exige essa mesma chave `default`; a chave legada `anon` não é aceita neste cliente.

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

## 2.1. Configurar o login por nome de usuário

O formulário pede **nome de usuário e senha**. O Supabase Auth continua usando um e-mail real para identificar a conta. A Edge Function `admin-login` associa os dois no servidor, autentica a senha e confirma que a conta pertence à lista privada de administradores antes de devolver uma sessão.

Configure somente no ambiente privado de **Edge Functions → Secrets**, nunca em `config.js` ou no repositório:

- `MARAVI_ADMIN_USERNAME`: o identificador escolhido, como `maravi`, de 3 a 32 caracteres minúsculos, números, ponto, sublinhado ou hífen.
- `MARAVI_ADMIN_EMAIL`: e-mail real da mesma conta criada em Authentication. Não é um endereço fictício.
- `MARAVI_ALLOWED_ORIGINS`: origens exatas do painel, separadas por vírgula, sem caminho nem barra final. Use HTTPS em produção. Origens locais HTTP são aceitas apenas para localhost/127.0.0.1/::1 durante testes.

A função usa os valores `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEYS.default` fornecidos pelo projeto. Verifique sua disponibilidade antes de implantar. Ela não lê nem precisa de `service_role`, `sb_secret_` ou senha do banco. O arquivo `supabase/config.toml` documenta `verify_jwt = false` **apenas para esta função de login**, porque o usuário ainda não tem uma sessão nessa etapa; a própria função verifica a senha e a autorização. Isso não remove a proteção dos RPCs administrativos.

Implante os dois arquivos `index.ts` e `handler.mjs` somente após autorização de publicação. Configurar secrets ou publicar este código não cria a conta no Auth. Não configure o site para usar login por usuário antes de validar a função implantada, pois não existe fallback silencioso para login direto por e-mail.

O e-mail não aparece no formulário nem no JavaScript público. O JWT da conta autenticada pode conter seu e-mail, visível a quem inspecionar tecnicamente a própria sessão. Quem controla a caixa de e-mail de recuperação pode redefinir a senha e assumir esse acesso. O nome de usuário não é um segredo e não deve ser tratado como proteção contra ataques.

### Limites de autenticação e liberação

- A função valida origem, método, chave pública, formato, tamanho e tempo de leitura do corpo. Nunca aceita e-mail ou URL de destino enviados pelo navegador. CORS não impede clientes externos de chamar o endpoint.
- A senha é enviada somente por HTTPS ao projeto configurado. A resposta contém apenas token de acesso e tempo de expiração, sem objeto de usuário nem token de renovação. A aplicação não registra corpos, senhas ou tokens; a plataforma pode manter seus próprios logs de acesso.
- A proteção nativa de tentativas do Supabase continua ativa. Pelo proxy da Edge Function, requisições podem compartilhar o IP de saída do servidor. Não encaminhe cabeçalhos de IP arbitrários nem prometa limites individuais por navegador.
- **Antes da liberação pública**, testar abuso e decidir explicitamente entre aceitar os limites nativos para esta operação ou adicionar proteção compartilhada contra tentativas repetidas/CAPTCHA. Contadores apenas em memória da função não são uma proteção distribuída. Evite bloqueios permanentes que um atacante possa causar ao único administrador.
- Testes locais usam respostas simuladas. Login real, ausência de cadastro público, revogação, configuração de origens e execução no Deno/Supabase devem ser verificados no projeto antes de ativar.

### Redefinição de senha: manutenção manual

Por decisão do responsável, esta entrega **não inclui recuperação por link, tela de retorno ou formulário de redefinição de senha**. Se a usuária esquecer a senha, deve pedir ao responsável que faça a manutenção da conta no Supabase. O login por nome de usuário permanece associado ao e-mail real cadastrado, sem expor esse endereço no formulário público.

A recuperação manual é o escopo escolhido, não uma tela pendente de implementação. **Nenhuma redefinição real foi executada ou validada nesta entrega.** O responsável deverá confirmar o procedimento seguro disponível no projeto e testar o novo login antes de considerar uma solicitação resolvida. Não envie links de recuperação apontando para `admin.html`: o painel não processa esses retornos. Não registre a nova senha em código, logs ou chat.

Referências: [login por senha](https://supabase.com/docs/reference/javascript/auth-signinwithpassword), [variáveis de ambiente](https://supabase.com/docs/guides/functions/secrets), [limites de Auth](https://supabase.com/docs/guides/auth/rate-limits) e [recuperação de senha](https://supabase.com/docs/guides/auth/passwords).

## 3. Configurar o site

Edite somente os valores públicos de `config.js`:

```js
window.MARAVI_CONFIG = Object.freeze({
  supabaseUrl: 'https://SEU-PROJETO.supabase.co',
  supabasePublishableKey: 'SUA-CHAVE-PUBLISHABLE-DEFAULT'
});
```

Copie a URL e a chave publishable chamada **default** nas configurações de API do projeto, a mesma disponível à função em `SUPABASE_PUBLISHABLE_KEYS.default`. Use a URL HTTPS da raiz do projeto, sem `/rest/v1` no final. **Nunca use `service_role`, uma chave `sb_secret_…`, senha do banco ou token administrativo nesse arquivo.** Não coloque segredos em GitHub Pages, variáveis que são incorporadas ao JavaScript durante o build ou arquivos públicos.

O formulário de login envia usuário e senha à função `admin-login` por HTTPS, que repassa a autenticação ao Supabase Auth. Os tokens de sessão ficam somente na memória da página, não em `localStorage`, arquivos ou no repositório. Recarregar ou fechar o painel pode exigir novo login. A senha não fica no catálogo.

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
- Instale `supabase/product-images.sql` depois do esquema principal, seguindo [o guia de fotos](PRODUCT_IMAGES.md). Envie uma foto pelo editor, aplique ao rascunho e publique. Confira que o cardápio mostra a nova foto. Fotos do catálogo são públicas; não envie documentos ou imagens privadas.
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
- Fotos podem usar arquivos locais `assets/nome-da-foto.webp` ou URLs estritas do bucket `product-images` do projeto configurado. O editor aceita JPG, PNG e WebP de até 5 MiB e 40 megapixels, convertendo em WebP de até 1600px antes do upload. Só administradores podem enviar; não há sobrescrita nem exclusão pelo painel. Uma foto enviada só é associada ao produto ao aplicar e publicar o rascunho. Cancelar o rascunho não apaga o arquivo enviado. Veja [os detalhes de segurança e manutenção](PRODUCT_IMAGES.md).
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
