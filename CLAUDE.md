# Padrão de trabalho — VIGIA

Este arquivo documenta como trabalhar neste projeto. Leia antes de executar qualquer tarefa.

## Quem decide o quê

Eu (Claude Code) executo. Quem decide arquitetura é o Sampaio, normalmente em conversa com o Claude (chat) antes de eu receber o prompt. Isso significa:

- **Nunca decido sozinho uma ambiguidade que afete comportamento observável** (ex: classificar um erro como rede×rejeição, escolher entre duas estruturas de dado, decidir o que um endpoint deve ou não filtrar). Se encontrar uma decisão dessas no meio de uma tarefa, **paro e reporto** — não escolho e sigo em frente.
- Decisões técnicas de baixo nível e sem ambiguidade real (ex: qual biblioteca síncrona usar, como nomear uma variável) posso fazer, desde que justifique.
- Se o prompt já tomou a decisão explicitamente ("já decidido, não é ambiguidade"), sigo sem reabrir a discussão.

## PASSO 0 é obrigatório, não opcional

Antes de escrever qualquer código, releio os arquivos relevantes e confirmo suposições — nunca assumo baseado em nome de arquivo, comentário antigo, ou memória de uma investigação anterior sem reconferir se o código ainda está daquele jeito. Se o PASSO 0 revelar um bloqueio real (ambiguidade, bug, coisa que muda o escopo pedido), **paro ali e reporto antes de tocar em qualquer Tarefa** — não empurro pra frente com uma suposição.

## Evidência concreta, não alegação

- Nunca digo "os testes passaram" sem listar cada teste nominalmente.
- Sempre confiro que a matemática bate (testes antigos + novos = total).
- Para correção de bug, o teste que prova a correção precisa reproduzir o cenário exato do bug (não só "código não quebra mais") — idealmente um teste que falharia sem a correção e passa com ela.
- Se algo parecer certo mas eu não tiver como confirmar com evidência (ex: configuração que só existe num painel externo, como o Railway), digo isso explicitamente em vez de presumir.

## Escopo cirúrgico

- Não "melhoro" código vizinho não pedido, não expando escopo por conta própria.
- Se encontrar algo fora do escopo pedido (bug, código morto, inconsistência), **reporto, não corrijo sozinho** — a menos que o prompt peça explicitamente.
- "Fora de escopo" listado num prompt é uma instrução, não uma sugestão.

## Git e banco de dados — disciplina extra

- **Nunca commito nem faço push sem ser pedido explicitamente.** Depois de terminar uma tarefa, o código fica no working tree até receber instrução de commit.
- Commits são isolados por assunto — não misturo mudanças de tarefas diferentes num commit só, mesmo que estejam no working tree ao mesmo tempo.
- Migrations em banco de produção: uso `prisma migrate dev --create-only` pra gerar o arquivo, edito manualmente se precisar de backfill explícito, e só aplico depois de confirmação. Nunca uso `db push` direto em produção.
- Antes de aplicar qualquer migration em produção, reporto se existe backup conhecido — nunca presumo que existe ou que "é reversível" é a mesma coisa que "tem backup".
- Depois de um push, se for relevante, verifico se há algum comando de migration automática configurado no processo de deploy (mesmo que não esteja em arquivo versionado) e reporto o que encontrar.

## Pendências fiscais e jurídicas

Este projeto lida com emissão fiscal real (NFC-e, reforma tributária 2026). Qualquer suposição sobre lei, prazo legal, ou licença de biblioteca precisa ser pesquisada com fonte real (texto de lei, documentação oficial) antes de virar código — e sinalizada como "não sou advogado/contador" quando relevante. Nunca decido isso sozinho.

## Formato de resposta esperado

Para tarefas com PASSO 0: respondo o PASSO 0 primeiro, por completo, antes de qualquer código — e paro ali se encontrar bloqueio.

Para o resultado final: resumo do que foi feito, lista nominal de testes com resultado, número total de testes confirmado (antigo + novo = total), e qualquer suposição ou ambiguidade que precisei reportar em vez de decidir.