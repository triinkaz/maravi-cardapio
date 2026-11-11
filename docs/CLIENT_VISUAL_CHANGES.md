# Ajustes solicitados pela cliente

## Conteúdo e identidade

- Título principal: **Artesanal por essência.**
- Chamada do cardápio: **Sabor em cada detalhe**.
- Removida a repetição de “Produção artesanal” abaixo do botão.
- Monograma MR com alinhamento central e círculo de 2 px.
- Duas fotos reais em molduras sobrepostas, contornos verdes finos e formas claras, seguindo a referência enviada. O selo marrom foi retirado para manter a composição leve.

## Fotos e descrições

Os arquivos originais não foram editados nem substituídos. As imagens do cardápio mantêm proporção 4:3 em todas as larguras. O enquadramento das fotos originais de Kinder Classic e Rabanada prioriza as duas metades. Esta regra usa o caminho das fotos originais; não interfere automaticamente no enquadramento de uma foto nova enviada pelo painel.

Kinder Classic e Rabanada agora começam com “Massa clássica de baunilha”. Também foi incluída a palavra “Massa” em Double Chocolate, Red Ninho e Dark Cacau. Nenhum ingrediente foi acrescentado. Caixas mistas, brigadeiros e cremosos mantêm suas descrições, pois não há uma massa única confirmada para indicar.

As alterações estão no catálogo estático e no catálogo inicial do banco. **Reexecutar `schema.sql` preserva um catálogo já existente.** Para uma instalação existente, `supabase/client-copy-updates.json` relaciona os cinco IDs, descrições anteriores e novas. O responsável deve comparar com a versão atual antes de aplicar: substituir apenas quando o ID e o texto anterior forem iguais, preservar produtos excluídos e descrições já editadas e incrementar a revisão uma vez, somente se houver alteração. Nenhuma atualização de catálogo remoto foi feita por estes arquivos.

## Verificação

- `npm run check`: inclui os testes de conteúdo e comparação entre catálogo estático e seed em `tests/client-visual.test.cjs`.
- `CHROMIUM_PATH=/usr/bin/chromium node tests/client-visual-browser.cjs`: testa layout em 11 larguras (320–1440 px), descrições completas, ausência de rolagem horizontal e enquadramento das duas metades. Capturas ficam em `test-results/client-visual/`.
- `npm run test:browser`: mantém a cobertura dos fluxos de pedido e painel.

A revisão visual deve incluir celular e desktop. A execução destes testes não faz publicação, pedido, alteração em backend real nem merge.
