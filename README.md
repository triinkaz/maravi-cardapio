# Maravi Doceria — Cardápio e pedidos

Site do cardápio da Maravi Doceria. O cliente escolhe os itens, informa entrega ou retirada, pagamento e observações, e abre uma mensagem pronta para o WhatsApp. O pedido só é enviado quando o cliente confirma no WhatsApp.

## Prazo e pagamento no checkout

- **Para hoje:** mostra a data atual de `America/Sao_Paulo`, sem campo editável. Delivery informa estimativa de 35–75 minutos, a confirmar pelo WhatsApp. Retirada mantém prazo a confirmar, sem impor prazo de entrega.
- **Agendar:** data, horário e pagamento são combinados pelo WhatsApp; o site não pede essas escolhas nem inclui valores antigos no resumo.
- **Pagamento automático:** apenas delivery para hoje, de terça a sábado entre 12:00 (inclusive) e 17:00 (exclusive), restringe a seleção a Pix. De terça a sábado, das 19h às 22h, e domingo, das 17h às 22h, todas as formas permanecem disponíveis. Segunda não tem restrição de Pix. Não há nova regra, bloqueio ou cálculo de horário fora dessas faixas. Retirada preserva todas as formas.
- A data e as opções são atualizadas ao retornar à página, ao abrir o carrinho e antes/depois da confirmação do catálogo. Uma seleção que deixou de ser válida é limpa para o cliente revisar; nenhuma forma é trocada silenciosamente por outra.
- O total dos produtos e eventuais descontos continuam visíveis, sem repetir o subtotal. Taxa de entrega e confirmação do pedido continuam no WhatsApp.

A escolha automática evita criar mais um controle administrativo e segue o relógio do navegador convertido para o fuso da loja. Não é uma validação de pagamento no servidor: a Maravi continua confirmando o pedido no WhatsApp.

## Painel administrativo

Abra `admin.html` para administrar produtos, preços, disponibilidade, estoque manual, fotos e sabores de caixas de quatro. As edições ficam em rascunho até clicar em **Publicar alterações**. O painel permite criar, editar, inativar e excluir produtos. Novas fotos JPG, PNG ou WebP de até 5 MiB podem ser enviadas pelo editor; o navegador as otimiza em WebP antes de carregar no Storage.

**Versão temporária de testes:** o backend Supabase está configurado com valores públicos em `config.js`; não há senha padrão nem chave administrativa no repositório. Cadastro público está fechado. A publicação definitiva será feita após a migração de hospedagem. Veja [o guia de configuração](docs/ADMIN_SETUP.md).

O login usa uma Edge Function com associação privada entre nome de usuário e e-mail da conta. A redefinição de senha fica a cargo do responsável, sem tela de recuperação automática neste site. O backend usa Supabase Auth e PostgreSQL, com lista de administradores, RLS e funções de gravação autorizadas no servidor. Tokens ficam somente na memória da página. O cliente relê o catálogo antes de abrir o pedido no WhatsApp. Estoque é manual, sem reserva ou baixa automática.

Enquanto `config.js` estiver vazio, o cardápio original de `app.js` continua funcionando e o painel fica bloqueado. Depois de configurado, falhas no backend não fazem o site voltar silenciosamente a preços ou estoque antigos.

## Desenvolvimento e verificação

Requisitos de testes: Node.js 20+ e npm. O site em si continua sendo HTML/CSS/JavaScript estático, sem build ou dependências de execução.

```sh
npm ci
npm run check
```

`check` valida sintaxe, testes de unidade/DOM e permissões/validações do banco em PostgreSQL embutido (PGlite). Não acessa serviços reais nem cria credenciais.

Teste de navegador opcional:

```sh
npx playwright install chromium
npm run test:browser
```

O comando inicia um servidor local temporário. `CHROMIUM_PATH` permite usar Chromium já instalado. Os testes simulam o backend, bloqueiam acessos externos e não enviam pedidos. O workflow do PR executa os mesmos testes com permissão somente de leitura e guarda capturas por sete dias; não faz deploy. As verificações contra Supabase real e a inspeção visual devem ser concluídas antes da ativação em produção.

## Publicação e arquivos

O GitHub Pages publica a raiz de `main`. Uma branch/PR de revisão não ativa o painel no site. A configuração do backend e a publicação são etapas separadas.

- `config.js`: URL e chave pública do backend.
- `supabase/schema.sql`: banco, funções e catálogo inicial.
- `supabase/functions/admin-login/`: login por usuário, ainda dependente de configuração e deploy autorizados.
- `app.js`: catálogo estático inicial, WhatsApp e regras de pedidos/promoções.
- `assets/`: fotos originais; continuam funcionando junto das novas fotos enviadas pelo painel.
- `supabase/product-images.sql` e [guia de fotos](docs/PRODUCT_IMAGES.md): bucket público, permissões de upload somente para administradores e limites de imagem.
- `admin.html`, `admin.js`, `admin.css`: administração.
- `styles.css` e `index.html`: apresentação do cardápio.

Disponibilidade final, prazo e taxa de entrega continuam sendo confirmados pela Maravi.
