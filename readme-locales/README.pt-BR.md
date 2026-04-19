<p align="center">
  <img src="../site/icons/icon.svg" alt="AgentLimb Logo" width="64" height="64">
</p>

<h1 align="center">AgentLimb</h1>

<p align="center">
  <strong>Pare de assistir sua IA reaprender a mesma tarefa.</strong><br>
  A alternativa open-source ao CoWork — 90% menos tokens em tarefas repetitivas do navegador.
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/agentlimb/hldldfepjhljhbcneojddjkkodkjglof">
    <img src="https://img.shields.io/badge/Chrome_Web_Store-Instalar_grátis-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Instalar do Chrome Web Store">
  </a>
  <a href="https://agentlimb.com">
    <img src="https://img.shields.io/badge/Website-agentlimb.com-F5A623?style=for-the-badge" alt="Website">
  </a>
  <a href="https://github.com/hooosberg/AgentLimb">
    <img src="https://img.shields.io/github/stars/hooosberg/AgentLimb?style=for-the-badge&logo=github&label=Star&color=24292f" alt="GitHub Star">
  </a>
</p>

<p align="center">
  <em>Se o AgentLimb for útil para você, dê uma ⭐ estrela neste repositório — ajuda outros a descobrir o projeto!</em>
</p>

<p align="center">
  <strong>
    <a href="../README.md">English</a> &nbsp;|&nbsp;
    <a href="./README.zh-CN.md">中文</a> &nbsp;|&nbsp;
    <a href="./README.ja-JP.md">日本語</a> &nbsp;|&nbsp;
    <a href="./README.ko-KR.md">한국어</a> &nbsp;|&nbsp;
    <a href="./README.es-ES.md">Español</a> &nbsp;|&nbsp;
    <a href="./README.fr-FR.md">Français</a> &nbsp;|&nbsp;
    <a href="./README.de-DE.md">Deutsch</a> &nbsp;|&nbsp;
    <a href="./README.pt-BR.md">Português</a> &nbsp;|&nbsp;
    <a href="./README.ru-RU.md">Русский</a> &nbsp;|&nbsp;
    <a href="./README.ar-SA.md">العربية</a> &nbsp;|&nbsp;
    <a href="./README.it-IT.md">Italiano</a> &nbsp;|&nbsp;
    <a href="./README.hi-IN.md">हिन्दी</a>
  </strong>
</p>

<p align="center">
  <img src="../assets/demo.gif" alt="AgentLimb Demo — AI agent controlling the browser" width="720">
</p>

---

## Sobre

**AgentLimb** é uma extensão do Chrome — [já disponível no Chrome Web Store](https://chromewebstore.google.com/detail/agentlimb/hldldfepjhljhbcneojddjkkodkjglof) — que permite a qualquer terminal de IA — Claude Code, Cursor, Codex, Trae, Windsurf ou qualquer modelo local — controlar seu navegador com precisão. Instale a extensão, copie um prompt, cole na sua IA — configuração automática em 10 segundos.

Sem navegadores headless. Sem re-login. Sem agentes invasivos. Seu Chrome real, seus cookies reais, suas sessões reais — mais uma memória muscular que torna as tarefas repetidas cada vez mais baratas.

## Destaques

### 1. Configuração com um único prompt

Copie um prompt, cole em qualquer ferramenta de IA. Sem arquivos de configuração, sem comandos no terminal, sem chaves de API. Se a sua IA consegue executar comandos, ela consegue usar o AgentLimb.

### 2. Memória muscular — 85% menos tokens, 80–95% menos espera

Na primeira vez que sua IA visita um site, ela explora o DOM e aprende seletores e fluxos de trabalho. O AgentLimb salva esse conhecimento em `~/Desktop/AgentLimb-muscle/<domain>.json`. Cada execução futura no mesmo site pula a exploração e reutiliza o que foi aprendido.

Dados reais de regressão de uma tarefa de publicação no Reddit (Codex de baixo parâmetro, 2026-04-18):

| | Início a frio (primeira exploração) | Início a quente (memória muscular) | Economia |
|---|---|---|---|
| Chamadas a `page_snapshot` | 3 | **0** | 100% |
| Total de chamadas de ferramentas | 23 | 10 | 56,5% |
| Tokens estimados | ~12.250 | **~1.750** | **↓ 85,7%** |
| Tempo real | 8–20 min | 30 s–2 min | **↓ ~80–95%** |

Quanto mais você reutiliza um site, mais barato e rápido ele fica.

### 3. CDP nativo, sem adivinhação por captura de tela

O AgentLimb controla o navegador via Chrome Debugger Protocol. A IA recebe uma lista semântica estruturada de elementos interativos — não capturas de tela. Os cliques acertam o nó certo, os formulários usam APIs nativas, as navegações retornam imediatamente a nova URL.

### 4. Ciclo de vida de tarefa explícito

Silêncio não significa mais sucesso. A IA declara explicitamente `task_plan` → `task_step_done` → `task_complete` / `task_fail`. Timeouts e quedas do bridge são capturados como falhas reais. O painel lateral renderiza a lista de etapas em tempo real.

### 5. 100% local e privado

O bridge roda em `127.0.0.1:7791`. Sem analytics, sem rastreamento, sem nuvem. O conhecimento muscular é JSON simples no seu desktop — você pode ler, comparar, compartilhar ou excluir a qualquer momento.

### 6. Controle Paralelo Multi-Conta — Opere Vários Perfis do Chrome ao Mesmo Tempo

Um comando de IA, cada perfil do Chrome o executa simultaneamente. Sejam duas contas do Twitter, três contas corporativas do Google ou uma dúzia de perfis de teste——AgentLimb controla todos em uma única tarefa.

- **Identidade explícita** — cada painel lateral exibe "Este painel: Profile-xxxxxx"; o Bridge sabe qual perfil retornou qual resultado
- **Suspender / auto-suspender** — fechar o painel (ou clicar em Suspender) remove aquele perfil da tarefa; os demais continuam sem interrupção
- **Broadcast task\_\*** — `task_plan`, `task_step_done`, `task_complete`, `task_fail` são transmitidos a cada perfil ativo; todos os painéis laterais permanecem sincronizados
- **Bloqueio de janela** — `navigate` mira automaticamente na janela correta do Chrome, mesmo que o mesmo perfil tenha múltiplas janelas abertas
- **Roteamento por alvo** — especifique o perfil por rótulo na chamada de ferramenta para precisão cirúrgica

## Como funciona

```
Seu terminal de IA  (Claude Code / Cursor / Codex / Trae / Windsurf / modelo local)
    ↕  HTTP + SSE  (16 ferramentas padronizadas, descobríveis via endpoints /docs)
AgentLimb Bridge  (Node.js local · 127.0.0.1:7791)
    ↕  mensageria chrome.runtime
AgentLimb Extension  (Chrome MV3 · painel lateral · abas tarefa/músculo/log)
    ↕  Chrome Debugger Protocol
Seu navegador  (logado, com cookies, suas sessões reais)
    ↓  conhecimento persistido
~/Desktop/AgentLimb-muscle/<domain>.json  (durável, legível por humanos)
```

## Início Rápido

1. **Instalar** — Duas opções:
   - **Chrome Web Store** (recomendado): [Instalar AgentLimb](https://chromewebstore.google.com/detail/agentlimb/hldldfepjhljhbcneojddjkkodkjglof) — um clique, atualizações automáticas
   - **Manual (última build)**: [Baixe o zip](https://github.com/hooosberg/AgentLimb/releases/latest), descompacte, abra `chrome://extensions`, ative o **Modo desenvolvedor**, clique em **Carregar sem compactação**
2. **Copiar** — Abra o painel lateral, clique em "Copiar Prompt de Integração"
3. **Colar** — Cole em qualquer terminal de IA. Ele se conecta automaticamente, busca o esquema de ferramentas sob demanda e começa a trabalhar

## Conjunto de ferramentas — 16 ferramentas

16 ferramentas padronizadas em cinco categorias: observar o estado do navegador, navegar e interagir com elementos da página, ler e escrever memória muscular, declarar eventos do ciclo de vida da tarefa e manter a conectividade do bridge. A documentação completa é fornecida sob demanda — a IA busca os esquemas apenas quando precisa.

## Por que não usar X?

Toda abordagem existente de automação de navegador tem um custo real. Aqui a comparação honesta:

| | Browser Use / Playwright | BrowseAI / Browserbase | Codex / Claude Computer Use | **AgentLimb** |
|---|---|---|---|---|
| **Configuração** | Escrever scripts, gerenciar dependências, lidar com modo headless | Config SaaS, setup por fluxo | Só Mac (requer ambiente desktop), sandbox obrigatório | Copie um prompt. Pronto |
| **Identificação de elementos** | CSS/XPath — você os escreve e mantém | Detecção visual por IA — instável em atualizações | Coordenadas de captura — ±1px pode errar o alvo | CDP lê o DOM ao vivo — semântico, preciso |
| **Custo de tokens por ação** | Zero (script puro) | Taxas de cloud + tokens IA | 1.000–3.000 tokens/screenshot × cada passo | ~300 tokens/passo, início quente: **85,7% menos** |
| **Custo de tarefas repetidas** | Fixo (o script roda de novo) | Linear — cobrado por execução | Linear — reexplora cada vez, sem memória | **Decrescente** — memória muscular se acumula |
| **Sessões de login** | Setup extra de cookies/sessões | Cloud — não usa suas sessões locais | Nível do SO, sem saber o estado do navegador | Seu Chrome real — já logado |
| **Quando o site muda** | Os seletores quebram — reescreva scripts | O modelo visual pode degradar silenciosamente | A inferência por screenshot se ajusta, mas sai cara | A IA detecta a divergência, acha novo seletor e repara o músculo |
| **Privacidade de dados** | Local ✅ | Via servidores de terceiros ❌ | Local ✅ | 100% local — apenas 127.0.0.1 ✅ |
| **Escolha do terminal IA** | Qualquer (script puro) | Varia por plataforma | Incluído com Codex / Claude | Qualquer IA que fale HTTP |
| **Conhecimento compartilhado** | Script = preso a uma IA | Workflow = preso à plataforma | Sem memória persistente | Arquivos de músculos = cross-IA, transferíveis, permanentes |
| **Multi-conta paralelo** | Orquestração manual | Dependente da plataforma | Não | ✅ Vários perfis do Chrome, um comando |

**O diferencial**: os arquivos de músculos do AgentLimb vivem em `~/Desktop/AgentLimb-muscle/` como JSON puro. O conhecimento explorado hoje por Claude Code está disponível amanhã para Codex — mesmos arquivos, zero reexploração. Troque de ferramenta IA sem perder um único workflow aprendido.

## Casos de uso

- **Marketing** — Publicar nas redes sociais, gerenciar campanhas em múltiplas plataformas
- **Pesquisa** — Raspar dados, comparar produtos, coletar inteligência competitiva
- **Automação** — Preencher formulários, enviar candidaturas, atualizar perfis
- **Testes** — QA do seu app web em um navegador real com sessões reais

## Filosofia de design

- **Superfície mínima** — 16 ferramentas, cada uma faz uma coisa bem, combináveis em qualquer workflow
- **Não invasivo** — funciona dentro do seu navegador real, não em uma sandbox
- **Local-first** — privacidade por arquitetura, não por promessa
- **Agnóstico de IA** — qualquer ferramenta que possa enviar HTTP pode se conectar; sem lock-in de fornecedor

## Recursos

- **Site**: [agentlimb.com](https://agentlimb.com)
- **Tutoriais**: [agentlimb.com/tutorials.html](https://agentlimb.com/tutorials.html)
- **Diretório de ferramentas IA**: [agentlimb.com/tools.html](https://agentlimb.com/tools.html)
- **Notícias**: [agentlimb.com/news.html](https://agentlimb.com/news.html)
- **Política de privacidade**: [agentlimb.com/privacy.html](https://agentlimb.com/privacy.html)
- **Termos de serviço**: [agentlimb.com/terms.html](https://agentlimb.com/terms.html)
- **Licença**: [agentlimb.com/license.html](https://agentlimb.com/license.html)

## Contato

- **GitHub**: [hooosberg/AgentLimb](https://github.com/hooosberg/AgentLimb)
- **Email**: [zikedece@proton.me](mailto:zikedece@proton.me)

## Mais projetos

<table>
  <tr>
    <td align="center">
      <a href="https://hooosberg.github.io/WitNote/">
        <b>✍️ WitNote</b><br>
        <sub>Companheiro de escrita com IA</sub>
      </a>
    </td>
    <td align="center">
      <a href="https://hooosberg.github.io/DOMPrompter/">
        <b>🎯 DOMPrompter</b><br>
        <sub>Gerador visual de prompts de IA</sub>
      </a>
    </td>
    <td align="center">
      <a href="https://hooosberg.github.io/GlotShot/">
        <b>📸 GlotShot</b><br>
        <sub>Capturas para App Store</sub>
      </a>
    </td>
    <td align="center">
      <a href="https://hooosberg.github.io/TrekReel/">
        <b>🏔️ TrekReel</b><br>
        <sub>Histórias de trilhas 3D</sub>
      </a>
    </td>
    <td align="center">
      <a href="https://uixskills.com/">
        <b>🎨 UIXskills</b><br>
        <sub>Camada de protocolo de design</sub>
      </a>
    </td>
  </tr>
</table>

## Licença

[Business Source License 1.1](../LICENSE) — Grátis para uso pessoal. O uso comercial requer licença. Converte para Apache 2.0 em 2030-04-12.

Copyright © 2025 hooosberg. Todos os direitos reservados.
