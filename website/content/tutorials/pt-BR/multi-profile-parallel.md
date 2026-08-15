---
title: "Controle Multi-Conta Paralelo: Um Comando, Todos os Perfis ao Mesmo Tempo"
date: "2026-04-20"
tag: "Novo no v0.1.3"
icon: "👥"
description: "Execute uma tarefa de IA em múltiplos perfis do Chrome simultaneamente. Contas diferentes, o mesmo comando — cada perfil tem sua própria identidade, bloqueio de janela e pode ser suspenso independentemente."
readTime: "8 min"
difficulty: "Intermediário"
---

## O Que Esta Funcionalidade Faz

O AgentLimb v0.1.3 permite que sua IA controle múltiplos perfis do Chrome ao mesmo tempo — em paralelo, com um único comando.

Se você tem três contas do Twitter, dois logins do Google Workspace da empresa, ou uma dúzia de perfis de teste, você não precisa mais executar a mesma tarefa três vezes. Uma instrução chega a todos os painéis laterais abertos simultaneamente.

Cada perfil:
- Exibe uma **identidade explícita** no cabeçalho do painel lateral (ex. `Profile-a3f2`)
- Bloqueia as ações da IA na **janela correta do Chrome** automaticamente
- Pode ser **suspenso** independentemente sem parar os outros
- Recebe o **ciclo de vida completo da tarefa** — plano, atualizações de etapas e resultado final

---

## Configuração

Você não precisa configurar nada novo. O comportamento multi-perfil é automático desde que você tenha mais de um painel lateral aberto.

**Passo 1 — Crie múltiplos perfis do Chrome**

Abra o Chrome → clique no avatar do perfil → **Adicionar** → crie quantos perfis precisar. Cada perfil tem seus próprios cookies, sessões e estado de login.

**Passo 2 — Abra o painel lateral em cada perfil**

Em cada janela de perfil do Chrome, clique no ícone do AgentLimb ou abra o painel lateral pelo menu de Extensões. Você deve ver o rótulo de identidade do perfil no cabeçalho de cada painel.

**Passo 3 — Conecte sua IA**

Copie o prompt de integração de qualquer painel lateral e cole no seu terminal de IA. O Bridge descobre automaticamente todos os perfis conectados.

É isso. Sua IA está agora conectada a todos os perfis abertos.

---

## Executar uma Tarefa em Todos os Perfis

Dê à sua IA uma única instrução como de costume. Por exemplo:

> Publique "Nossa nova funcionalidade está no ar — confira em agentlimb.com" no Twitter.

A IA irá:
1. Declarar um `task_plan` — todos os painéis laterais mostram a mesma lista de etapas simultaneamente
2. Executar a tarefa em cada perfil ativo em paralelo
3. Reportar `task_complete` quando todos os perfis ativos terminarem, indicando os perfis ignorados se algum estava suspenso

Você observa o progresso em cada painel lateral independentemente. Um pode terminar antes do outro — eles não se esperam.

---

## Bloqueio de Janela: A Navegação Vai para o Lugar Certo

Cada perfil do Chrome pode ter múltiplas janelas abertas. Sem o bloqueio de janela, o comando `navigate` da IA pode aterrissar na janela errada.

O AgentLimb resolve isso automaticamente. Quando você abre um painel lateral, ele registra a janela do Chrome em que está. Cada chamada `navigate` para esse perfil aponta para aquela janela específica — não para a que o Chrome considera "ativa" naquele momento.

Se você fechar a janela e reabrir o painel lateral em outra, o bloqueio se atualiza automaticamente. A IA segue seu foco.

---

## Suspender um Perfil (Exclusão)

Às vezes você quer executar uma tarefa em dois dos seus três perfis, não em todos.

**Método 1 — Feche o painel lateral.** Um painel fechado significa "este perfil não participa". A IA o ignora silenciosamente e reporta no resumo final.

**Método 2 — Clique em Suspender.** O botão Suspender dentro do painel exclui aquele perfil sem fechar o painel. Útil se você quiser manter o painel visível mas excluí-lo temporariamente.

De qualquer forma, a IA não declara a falha da tarefa geral por causa de um perfil suspenso. Continua com os perfis ativos restantes. Somente se *todos* os perfis estiverem suspensos, a IA declarará `task_fail(no_active_profile)`.

**Para retomar:** basta reabrir o painel ou clicar em Retomar. O Bridge detecta a mudança em 300ms e inclui automaticamente o perfil na próxima tarefa.

---

## Direcionar um Perfil Específico

Para algumas tarefas você quer controlar um perfil com precisão em vez de transmitir para todos.

Use o parâmetro `target` na sua instrução:

> Usando apenas Profile-a3f2: atualizar a bio no LinkedIn.

A IA passa esse rótulo ao Bridge, que roteia a chamada de ferramenta exclusivamente para aquele perfil. Os outros perfis não são afetados.

Você pode encontrar o rótulo de cada perfil no cabeçalho do seu painel lateral.

---

## Exemplo Prático

Você gerencia um produto com contas no X, Weibo e Threads em três perfis do Chrome.

**Fluxo de trabalho anterior:** executar a tarefa de publicação três vezes, trocando de perfil manualmente.

**Com controle multi-perfil paralelo:**

1. Abra os três perfis, abra um painel lateral em cada um
2. Dê à sua IA uma instrução: "Publique a atualização do build de hoje em todas as contas"
3. Os três painéis laterais mostram o plano; os três executam em paralelo
4. Conclui em aproximadamente o mesmo tempo que executar uma vez

Se uma conta estiver com limitação de taxa ou suspensa, aquele perfil é ignorado. Os outros dois completam normalmente. O resumo final diz exatamente o que aconteceu em cada um.

---

## Resumo

| | Antes do v0.1.3 | v0.1.3 |
|---|---|---|
| Executar em 3 perfis | 3 tarefas separadas | 1 comando |
| Identidade do perfil | Nenhuma — IA adivinha | Rótulo explícito no painel |
| Destino da janela | Não confiável entre janelas | Bloqueado automaticamente na janela correta |
| Excluir um perfil | Sem mecanismo | Fechar painel ou clicar Suspender |
| Resultado da tarefa | Um resultado por execução | Status por perfil em um único resumo |

O controle multi-perfil paralelo é mais poderoso combinado com memória muscular — a IA já conhece os seletores de cada site, então a tarefa de cada perfil roda em velocidade total de início a quente.
