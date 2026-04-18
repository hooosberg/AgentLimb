<p align="center">
  <img src="../site/icons/icon.svg" alt="AgentLimb Logo" width="64" height="64">
</p>

<h1 align="center">AgentLimb</h1>

<p align="center">
  <strong>Deja de ver a tu IA reaprender la misma tarea.</strong><br>
  La alternativa open-source a CoWork — 90% menos tokens en tareas repetitivas del navegador.
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/agentlimb/hldldfepjhljhbcneojddjkkodkjglof">
    <img src="https://img.shields.io/badge/Chrome_Web_Store-Instalar_gratis-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Instalar desde Chrome Web Store">
  </a>
  <a href="https://agentlimb.com">
    <img src="https://img.shields.io/badge/Website-agentlimb.com-F5A623?style=for-the-badge" alt="Website">
  </a>
  <a href="https://github.com/hooosberg/AgentLimb">
    <img src="https://img.shields.io/github/stars/hooosberg/AgentLimb?style=for-the-badge&logo=github&label=Star&color=24292f" alt="GitHub Star">
  </a>
</p>

<p align="center">
  <em>Si AgentLimb te resulta útil, por favor ⭐ dale una estrella a este repo — ¡ayuda a otros a descubrir el proyecto!</em>
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

## Acerca de

**AgentLimb** es una extensión de Chrome — [ya disponible en Chrome Web Store](https://chromewebstore.google.com/detail/agentlimb/hldldfepjhljhbcneojddjkkodkjglof) — que permite a cualquier terminal de IA — Claude Code, Cursor, Codex, Trae, Windsurf o cualquier modelo local — controlar tu navegador con precisión. Instala la extensión, copia un prompt, pégalo en tu IA y se configura automáticamente en 10 segundos.

Sin navegadores headless. Sin re-login. Sin agentes invasivos. Tu Chrome real, tus cookies reales, tus sesiones reales — más memoria muscular que hace las tareas repetidas cada vez más baratas.

## Características principales

### 1. Configuración con un solo prompt

Copia un prompt, pégalo en cualquier herramienta de IA. Sin archivos de configuración, sin comandos de terminal, sin API keys. Si tu IA puede ejecutar comandos, puede usar AgentLimb.

### 2. Memoria muscular — 85% menos tokens, 80–95% menos espera

La primera vez que tu IA visita un sitio, explora el DOM y aprende los selectores y flujos de trabajo. AgentLimb guarda ese conocimiento en `~/Desktop/AgentLimb-muscle/<domain>.json`. Cada ejecución futura en el mismo sitio omite la exploración y reutiliza lo aprendido.

Datos reales de regresión de una tarea de publicación en Reddit (Codex de bajo parámetro, 2026-04-18):

| | Inicio en frío (primera exploración) | Inicio en caliente (memoria muscular) | Ahorro |
|---|---|---|---|
| Llamadas a `page_snapshot` | 3 | **0** | 100% |
| Total de llamadas a herramientas | 23 | 10 | 56,5% |
| Tokens estimados | ~12.250 | **~1.750** | **↓ 85,7%** |
| Tiempo real | 8–20 min | 30 s–2 min | **↓ ~80–95%** |

Cuanto más reutilizas un sitio, más barato y rápido se vuelve.

### 3. CDP nativo, no adivinanza por captura de pantalla

AgentLimb controla el navegador a través de Chrome Debugger Protocol. La IA recibe una lista semántica estructurada de elementos interactivos — no capturas de pantalla. Los clics alcanzan el nodo correcto, los formularios usan APIs nativas, las navegaciones devuelven la nueva URL de inmediato.

### 4. Ciclo de vida de tarea explícito

El silencio ya no equivale a éxito. La IA declara explícitamente `task_plan` → `task_step_done` → `task_complete` / `task_fail`. Los timeouts y las caídas del bridge se capturan como fallos reales. El panel lateral muestra la lista de pasos en tiempo real.

### 5. 100% local y privado

El bridge corre en `127.0.0.1:7791`. Sin analíticas, sin rastreo, sin nube. El conocimiento muscular es JSON plano en tu escritorio — puedes leerlo, compararlo, compartirlo o borrarlo en cualquier momento.

## Cómo funciona

```
Tu terminal de IA  (Claude Code / Cursor / Codex / Trae / Windsurf / modelo local)
    ↕  HTTP + SSE  (16 herramientas estandarizadas, descubribles via endpoints /docs)
AgentLimb Bridge  (Node.js local · 127.0.0.1:7791)
    ↕  mensajería chrome.runtime
AgentLimb Extension  (Chrome MV3 · panel lateral · pestañas tarea/músculo/log)
    ↕  Chrome Debugger Protocol
Tu navegador  (sesión iniciada, con cookies, tus sesiones reales)
    ↓  conocimiento persistido
~/Desktop/AgentLimb-muscle/<domain>.json  (duradero, legible por humanos)
```

## Inicio Rápido

1. **Instalar** — Dos opciones:
   - **Chrome Web Store** (recomendado): [Instalar AgentLimb](https://chromewebstore.google.com/detail/agentlimb/hldldfepjhljhbcneojddjkkodkjglof) — un clic, actualizaciones automáticas
   - **Manual (última build)**: [Descargar el zip](https://github.com/hooosberg/AgentLimb/releases/latest), descomprimir, abrir `chrome://extensions`, activar **Modo desarrollador**, clic en **Cargar descomprimida**
2. **Copiar** — Abrir el panel lateral, clic en "Copiar Prompt de incorporación"
3. **Pegar** — Pegar en cualquier terminal de IA. Se conecta automáticamente, obtiene el esquema de herramientas y empieza a trabajar

## Conjunto de herramientas — 16 herramientas

16 herramientas estandarizadas en cinco categorías: observar el estado del navegador, navegar e interactuar con elementos de la página, leer y escribir memoria muscular, declarar eventos del ciclo de vida de la tarea y mantener la conectividad con el bridge. La documentación completa se sirve bajo demanda — la IA obtiene los esquemas solo cuando los necesita.

## ¿Por qué no simplemente usar X?

Cada enfoque existente de automatización del navegador tiene un coste real. Aquí la comparación honesta:

| | Browser Use / Playwright | BrowseAI / Browserbase | Codex / Claude Computer Use | **AgentLimb** |
|---|---|---|---|---|
| **Configuración** | Escribir scripts, gestionar dependencias, manejar modo headless | Config SaaS, configuración por flujo | Solo Mac (requiere entorno de escritorio), sandbox obligatorio | Copia un prompt. Listo |
| **Identificación de elementos** | CSS/XPath — tú los escribes y mantienes | Detección visual por IA — inestable ante cambios | Coordenadas de captura — ±1px puede fallar el objetivo | CDP lee el DOM en vivo — semántico, preciso |
| **Coste de tokens por acción** | Ninguno (script puro) | Tarifas cloud + tokens de IA | 1.000–3.000 tokens/captura × cada paso | ~300 tokens/paso, inicio en caliente: **85,7 % menos** |
| **Coste de tareas repetidas** | Fijo (el script se vuelve a ejecutar) | Lineal — se cobra por ejecución | Lineal — re-explora cada vez, sin memoria | **Decreciente** — la memoria muscular se acumula |
| **Sesiones de inicio** | Configuración extra de cookies/sesiones | Cloud — no puedes usar tus sesiones locales | A nivel SO, no conoce el estado del navegador | Tu Chrome real — ya tienes sesión |
| **Cuando el sitio cambia** | Los selectores se rompen — reescribir scripts | El modelo visual puede degradarse en silencio | La inferencia de captura se ajusta, pero es cara | La IA detecta el desajuste, halla un nuevo selector y repara el músculo |
| **Privacidad de datos** | Local ✅ | A través de servidores de terceros ❌ | Local ✅ | 100% local — solo 127.0.0.1 ✅ |
| **Elección de terminal IA** | Cualquiera (script puro) | Varía según plataforma | Empaquetado con Codex / Claude | Cualquier IA que hable HTTP |
| **Conocimiento compartido** | Script = atado a una sola IA | Flujo = atado a la plataforma | Sin memoria persistente | Archivos de músculos = cross-IA, transferibles, permanentes |

**El diferenciador**: los archivos de músculos de AgentLimb viven en `~/Desktop/AgentLimb-muscle/` como JSON plano. El conocimiento explorado hoy por Claude Code estará disponible mañana para Codex — mismos archivos, cero re-exploración. Cambia de herramienta de IA sin perder un solo flujo aprendido.

## Casos de uso

- **Marketing** — Publicar en redes sociales, gestionar campañas en varias plataformas
- **Investigación** — Extraer datos, comparar productos, recopilar inteligencia competitiva
- **Automatización** — Rellenar formularios, enviar solicitudes, actualizar perfiles
- **Testing** — QA de tu web en un navegador real con sesiones reales

## Filosofía de diseño

- **Superficie mínima** — 16 herramientas, cada una hace una cosa bien, composables en cualquier flujo
- **No invasivo** — funciona dentro de tu navegador real, no en una sandbox
- **Local-first** — privacidad por arquitectura, no por promesa
- **Agnóstico de IA** — cualquier herramienta que pueda enviar HTTP puede conectarse; sin lock-in de proveedor

## Recursos

- **Sitio web**: [agentlimb.com](https://agentlimb.com)
- **Tutoriales**: [agentlimb.com/tutorials.html](https://agentlimb.com/tutorials.html)
- **Directorio de herramientas IA**: [agentlimb.com/tools.html](https://agentlimb.com/tools.html)
- **Noticias**: [agentlimb.com/news.html](https://agentlimb.com/news.html)
- **Política de privacidad**: [agentlimb.com/privacy.html](https://agentlimb.com/privacy.html)
- **Términos de servicio**: [agentlimb.com/terms.html](https://agentlimb.com/terms.html)
- **Licencia**: [agentlimb.com/license.html](https://agentlimb.com/license.html)

## Contacto

- **GitHub**: [hooosberg/AgentLimb](https://github.com/hooosberg/AgentLimb)
- **Email**: [zikedece@proton.me](mailto:zikedece@proton.me)

## Más proyectos

<table>
  <tr>
    <td align="center">
      <a href="https://hooosberg.github.io/WitNote/">
        <b>✍️ WitNote</b><br>
        <sub>Compañero de escritura IA</sub>
      </a>
    </td>
    <td align="center">
      <a href="https://hooosberg.github.io/DOMPrompter/">
        <b>🎯 DOMPrompter</b><br>
        <sub>Generador visual de prompts IA</sub>
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
        <sub>Historias de rutas 3D</sub>
      </a>
    </td>
    <td align="center">
      <a href="https://uixskills.com/">
        <b>🎨 UIXskills</b><br>
        <sub>Capa de protocolo de diseño</sub>
      </a>
    </td>
  </tr>
</table>

## Licencia

[Business Source License 1.1](../LICENSE) — Gratis para uso personal. El uso comercial requiere licencia. Se convierte a Apache 2.0 el 2030-04-12.

Copyright © 2025 hooosberg. Todos los derechos reservados.
