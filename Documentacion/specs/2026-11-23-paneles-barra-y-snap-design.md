# Paneles: barra con botones y mover como "snap" — diseño corto

Fecha: 23/11/2026. Estado: para aprobar.

## Por qué
Bruno trabaja con varias terminales y agentes a la vez en una misma pestaña. Hoy dividir y cerrar
paneles solo se puede con atajos (Alt+Shift+=, Alt+Shift+-, Alt+Shift+D, Ctrl+Shift+W), no hay forma
de cambiar el orden de los paneles y la línea para cambiar el tamaño casi no se ve. Quiere hacerlo
con el mouse: botones de dividir y cerrar, y mover los paneles "como snap" (cambiar el orden o el
tamaño).

## Objetivos
- Una barrita arriba de cada panel con el nombre y los botones dividir a la derecha (⇥), dividir
  abajo (⤓) y cerrar (✕).
- Clic derecho en la barrita: menú con Dividir a la derecha, Dividir abajo, Igualar tamaños y Cerrar
  panel.
- Arrastrar un panel por su barrita y soltarlo sobre otro: la mitad izquierda, derecha, de arriba o
  de abajo del otro panel lo deja de ese lado; el centro los intercambia. Mientras se arrastra, se
  pinta dónde va a quedar.
- Tamaño: la línea divisoria más fácil de agarrar, que se frena sola en ⅓, ½ y ⅔, y doble clic para
  dejar los dos lados iguales.

## Fuera de alcance (por ahora)
- Diseños listos al estilo Windows 11 (2 columnas, 2×2, etc.): quedó como extra posible. Bruno no
  lo pidió en la respuesta; se suma después si lo quiere.
- Mover paneles a otra pestaña o a otra ventana, o soltar una pestaña adentro de otra.
- Cambios a la API de control o al MCP (siguen con `split` como hoy).

## Lo que no puede pasar
- Que mover un panel vuelva a crear su terminal (mata la shell y el agente). Los paneles se siguen
  iterando por id y posicionando por rectángulos; mover es solo cambiar el árbol.
- Que el navegador integrado (WebView2 nativo, nada lo puede tapar) quede encima de la zona donde se
  suelta.
- Perder el clic derecho de la terminal (copiar si hay selección, si no pegar): el menú nuevo va en
  la barrita, no en la terminal.
- Romper los atajos de teclado que ya existen.

## Enfoques considerados
- **A) Barrita fija arriba de cada panel** (elegido por Bruno). Se ve siempre qué es cada panel y
  dónde agarrarlo; le saca una línea de alto a cada terminal.
- B) Botones flotantes en la esquina al pasar el mouse. No ocupan lugar, pero tapan texto de la
  terminal y cuestan más de descubrir.

## Cómo (decisiones mías, marcadas para revisar)
- **Barrita siempre visible**, también con un solo panel (es donde está el botón para la primera
  división). Unos 22 px. El panel enfocado (con 2 o más) la tiene resaltada con el color de acento.
  Nombre: el mismo que ya usa el navegador para elegir terminal (agente o shell · carpeta).
- **Paneles de navegador**: ya tienen su propia barra; se le suma el agarre (⋮⋮) a la izquierda y
  los botones ⇥ ⤓ (dividir desde un navegador abre una terminal en la carpeta de su dueño, como hoy).
- **✕ con algo corriendo pide confirmación** (agente o comando en marcha), porque el botón es chico
  y está al lado de los de dividir. Sin nada corriendo cierra directo. Ctrl+Shift+W sigue sin
  preguntar.
- **Arrastre con eventos de puntero** (como los divisores), no con el arrastre nativo del navegador:
  empieza recién al mover 5 px (un clic simple en la barrita solo enfoca). Esc cancela. Soltar sobre
  sí mismo o fuera de los paneles no hace nada. Durante el arrastre se esconden los navegadores (la
  misma clase `resizing` que ya usan los divisores) y el menú nuevo va en `FLOATING`.
- **Modelo** (`src/layout/model.ts`, funciones puras con tests): insertar un panel al lado de otro
  de cualquiera de los cuatro lados, mover un panel (sacarlo e insertarlo, con mitad y mitad) e
  intercambiar dos paneles. Igualar: cada división toma la proporción de paneles que tiene de cada
  lado, así todos quedan del mismo tamaño en ese eje.
- **Frenado de la línea**: si se suelta a menos de ~12 px de ⅓, ½ o ⅔ de su división, queda justo
  ahí. La función que decide es pura y con test.
- La sesión ya guarda el árbol: lo movido se recupera solo al volver a abrir.

## Para quien lo construya
- Detalles visuales (íconos, colores, el dibujo de la zona de soltar) siguiendo el estilo actual de
  `styles.css`.
- Probar en una AlphaTerm aparte (`CARGO_TARGET_DIR=target\prueba` + `ALPHATERM_DATA_DIR` y
  `WEBVIEW2_USER_DATA_FOLDER` propios) por CDP, sin cerrar la de Bruno. Tests: vitest, tsc, y que
  mover un panel con un comando corriendo no lo corte.
