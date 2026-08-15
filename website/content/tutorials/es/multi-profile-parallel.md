---
title: "Control Multi-Cuenta Paralelo: Un Comando, Todos los Perfiles a la Vez"
date: "2026-04-20"
tag: "Nuevo en v0.1.3"
icon: "👥"
description: "Ejecuta una tarea de IA en múltiples perfiles de Chrome simultáneamente. Cuentas diferentes, el mismo comando — cada perfil tiene su propia identidad, bloqueo de ventana y puede suspenderse de forma independiente."
readTime: "8 min"
difficulty: "Intermedio"
---

## Qué Hace Esta Función

AgentLimb v0.1.3 permite que tu IA controle múltiples perfiles de Chrome al mismo tiempo — en paralelo, con un solo comando.

Si tienes tres cuentas de Twitter, dos inicios de sesión de Google Workspace de empresa, o una docena de perfiles de prueba, ya no necesitas ejecutar la misma tarea tres veces. Una instrucción llega a todos los paneles laterales abiertos simultáneamente.

Cada perfil:
- Muestra una **identidad explícita** en el encabezado del panel lateral (p. ej. `Profile-a3f2`)
- Bloquea las acciones de la IA en la **ventana correcta de Chrome** automáticamente
- Puede **suspenderse** de forma independiente sin detener a los demás
- Recibe el **ciclo de vida completo de la tarea** — plan, actualizaciones de pasos y el resultado final

---

## Configuración

No necesitas configurar nada nuevo. El comportamiento multi-perfil es automático siempre que tengas más de un panel lateral abierto.

**Paso 1 — Crea múltiples perfiles de Chrome**

Abre Chrome → haz clic en el avatar de tu perfil → **Agregar** → crea tantos perfiles como necesites. Cada perfil tiene sus propias cookies, sesiones y estado de inicio de sesión.

**Paso 2 — Abre el panel lateral en cada perfil**

En cada ventana de perfil de Chrome, haz clic en el icono de AgentLimb o abre el panel lateral desde el menú de Extensiones. Deberías ver la etiqueta de identidad del perfil en el encabezado de cada panel.

**Paso 3 — Conecta tu IA**

Copia el prompt de incorporación de cualquier panel lateral y pégalo en tu terminal de IA. El Bridge descubre automáticamente todos los perfiles conectados.

Eso es todo. Tu IA está ahora conectada a todos los perfiles abiertos.

---

## Ejecutar una Tarea en Todos los Perfiles

Da a tu IA una sola instrucción como de costumbre. Por ejemplo:

> Publica "Nuestra nueva función está en vivo — compruébala en agentlimb.com" en Twitter.

La IA:
1. Declarará un `task_plan` — todos los paneles laterales muestran la misma lista de pasos simultáneamente
2. Ejecutará la tarea en cada perfil activo en paralelo
3. Reportará `task_complete` cuando todos los perfiles activos terminen, indicando qué perfiles fueron omitidos si alguno estaba suspendido

Observas el progreso en cada panel lateral de forma independiente. Uno puede terminar antes que el otro — no se esperan entre sí.

---

## Bloqueo de Ventana: La Navegación Va al Lugar Correcto

Cada perfil de Chrome puede tener múltiples ventanas abiertas. Sin bloqueo de ventana, el comando `navigate` de la IA podría aterrizar en la ventana equivocada.

AgentLimb lo resuelve automáticamente. Cuando abres un panel lateral, registra la ventana de Chrome en la que se encuentra. Cada llamada `navigate` para ese perfil apunta a esa ventana específica — no a la que Chrome considera "activa" en ese momento.

Si cierras la ventana y reabres el panel lateral en otra, el bloqueo se actualiza automáticamente. La IA sigue tu foco.

---

## Suspender un Perfil (Excluirlo)

A veces quieres ejecutar una tarea en dos de tus tres perfiles, no en todos.

**Método 1 — Cierra el panel lateral.** Un panel cerrado significa "este perfil no participa". La IA lo omite silenciosamente y lo reporta en el resumen final.

**Método 2 — Haz clic en Suspender.** El botón Suspender dentro del panel excluye ese perfil sin cerrar el panel. Útil si quieres mantener el panel visible pero excluirlo temporalmente.

De cualquier manera, la IA no declara el fracaso de la tarea completa por un perfil suspendido. Continúa con los restantes activos. Solo si *todos* los perfiles están suspendidos, la IA declarará `task_fail(no_active_profile)`.

**Para reanudar:** simplemente reabre el panel o haz clic en Reanudar. El Bridge detecta el cambio en 300ms e incluye automáticamente el perfil en la siguiente tarea.

---

## Apuntar a un Perfil Específico

Para algunas tareas quieres controlar un perfil con precisión en lugar de transmitir a todos.

Usa el parámetro `target` en tu instrucción:

> Usando solo Profile-a3f2: actualiza la bio en LinkedIn.

La IA pasa esta etiqueta al Bridge, que enruta la llamada de herramienta exclusivamente a ese perfil. Los demás no se ven afectados.

Puedes encontrar la etiqueta de cada perfil en el encabezado de su panel lateral.

---

## Un Ejemplo Práctico

Tienes cuentas en X, Weibo y Threads en tres perfiles de Chrome.

**Flujo de trabajo anterior:** ejecuta la tarea de publicación tres veces, cambiando perfiles manualmente cada vez.

**Con control multi-perfil paralelo:**

1. Abre los tres perfiles, abre un panel lateral en cada uno
2. Da a tu IA una instrucción: "Publica la actualización de hoy en todas las cuentas"
3. Los tres paneles laterales muestran el plan; los tres se ejecutan en paralelo
4. Se completa en aproximadamente el mismo tiempo que ejecutarlo una vez

Si una cuenta está limitada por tasa o suspendida, ese perfil se omite. Los otros dos completan normalmente. El resumen final te dice exactamente qué pasó en cada uno.

---

## Resumen

| | Antes de v0.1.3 | v0.1.3 |
|---|---|---|
| Ejecutar en 3 perfiles | 3 tareas separadas | 1 comando |
| Identidad del perfil | Ninguna — la IA adivina | Etiqueta explícita en el panel |
| Objetivo de ventana | No confiable entre ventanas | Bloqueado automáticamente en la ventana correcta |
| Excluir un perfil | Sin mecanismo | Cerrar panel o hacer clic en Suspender |
| Resultado de la tarea | Un resultado por ejecución | Estado por perfil en un único resumen |

El control multi-perfil paralelo es más poderoso combinado con la memoria muscular — la IA ya conoce los selectores de cada sitio, por lo que la tarea de cada perfil se ejecuta a plena velocidad de inicio en caliente.
