# AGENTS.md — UI v2 (la única UI)

v1 fue eliminada. No hay toggle, no hay `src/components/`, no hay `src/App.tsx`.

---

## 1. Estado

| Elemento | Estado |
|----------|--------|
| `src/components/` | ❌ Eliminado |
| `src/pages/` | ❌ Eliminado |
| `src/App.tsx` | ❌ Eliminado |
| `src/App.css` | ✅ Existe; `main.tsx` lo importa |
| `src/ui-v2/uiVersion.ts` | ❌ Eliminado |
| `src/main.tsx` | ✅ Renderiza AppV2 directo |
| Toggle v1/v2 en Config | ❌ Ya no existe funcionalmente |

**Lo que sobrevive de v1** está en `src/ui-v2/_legacy/`. Es el código v1 original con imports convertidos, únicamente lo que los wrappers v2 necesitan para funcionar. No tocar a menos que se esté portando a v2 nativo.

---

## 2. Where things live

```
src/
├── main.tsx                   # entry point → siempre AppV2
├── lib/                       # helpers puros (movidos de @/components/)
│   ├── squad/helpers.ts       # antes en components/squad/SquadTab.helpers
│   ├── home/helpers.ts        # sin importadores en runtime; sólo lo usan tests
│   ├── dashboard/helpers.ts
│   ├── match/live/            # lógica pura del partido en directo (contactos, etiquetas, foco, tablero, vistas)
│   └── ...
├── ui-v2/
│   ├── AppV2.tsx              # router root + update checker + UI scale + Android immersive
│   ├── updater/               # AndroidUpdateNotice (aviso de arranque en Android sin build en latest.json)
│   ├── _legacy/               # copias de v1 con imports convertidos
│   │   ├── components/        # 11 subdirectorios
│   │   └── pages/
│   ├── components/ui/         # shadcn primitives + On Air primitives (see section 4)
│   ├── shell/                 # navModel.ts (paradas, grupos, defaultOpen), railMode.ts (Tree/Split puro), treeRows.ts (teclado puro),
│   │                          # RailTree, RailSplit, RailUtility, RailMore, PhoneMoreMenu (el menú Más en la barra del teléfono), RailRow, RailItem, useRailMode, useFadeMask, attention.ts, ClockPlate
│   │                          # (estado en store/navMemoryStore: última por grupo, grupos abiertos; la ubicación,
│   │                          #  la pila de Back (30) y Recent (6) en store/dashboardLocationStore; reset en store/sessionReset)
│   ├── sheet/                 # useSheetBack (contrato de Atrás de un overlay modal en Android: entrada de historial compartida o dismisser nativo; lo usan GoPalette, RailMore y SideSheet; una hoja sólo libera la entrada que empujó ella misma, así que otra hoja abierta o una cerrada no se la quitan) y SideSheet (hoja lateral modal sobre Base UI Dialog: lado, ancho `--sheet-w`, foco al abrir y al volver, Atrás, teclado en pantalla con `--sheet-vvh`, activación R37; la paleta Go de Android es su primer uso; el popup de escritorio de la paleta no es una hoja)
│   ├── lib/utils.ts           # cn()
│   ├── pages/                 # v2 pages (SettingsV2, TeamSelectionV2, PlayerProfileV2, TeamProfileV2, StaffProfileV2, ChampionPageV2; customTeam/, playerProfile/, settings/, teamProfile/)
│   ├── match/                 # partido en directo (Arena): LiveMatchV2.tsx es la pantalla; MatchSimulation la monta
│   │   └── live/              # mapa (ArenaMap + capas), barra, tarjetas, feed, controles, EndPanel, hooks de sesión
│   └── dashboard/
│       ├── DashboardV2.tsx    # state container + tab dispatcher
│       ├── DashboardSidebarV2.tsx  # rail: Tree o Split, una sola `nav`, sobre navModel y treeRows
│       ├── DashboardHeaderV2.tsx   # barra: Back, miga (equipo · grupo) sobre el h1, reloj, Continuar
│       ├── RouteAnnouncer.tsx      # la única región viva de cambios de ruta ("Now on {título}, {grupo}")
│       └── tabs/              # tabs nativos v2 (home/, squad/ = On Air panels); vista, filtros, orden, página y
│                              # selección de cada pestaña en store/tabUiStore (R23: sobreviven a un perfil; ids
│                              # por useValidTabUiField; initialMessageId/initialCompetitionId ganan una vez por useOneShotOverride;
│                              # la página vuelve a 1 con hooks/useResetOnChange, nunca al montar)
│       └── scrims/phone/     # Scrims en el teléfono: ScrimsPhoneLayout (la única selección: "home" es Semana, el resto una vista), ScrimWeekHome (Semana)
│                              # y una vista por pantalla en ScrimViewFrame (objetivo, volumen, informe, elegir rival, decidir, seguimiento, resultado); logos en TeamShield
│                              # (nombre y logo reales, ver lib/teams/teamIdentity); los modelos puros son lib/scrims/phoneWeek.ts (etiquetas y Done) y lib/scrims/phoneHome.ts (Semana)
└── store/, services/, hooks/, api/  # compartidos (hooks/useRovingFocus, useClubTheme, usePhoneForm: el mismo predicado que pone `data-form="phone"`, leído al renderizar)
```

---

## 3. Legacy wrappers que usan _legacy/

| Tab v2 | Importa de _legacy |
|--------|-------------------|
| PlayerProfileV2 | `DashboardModalFrame` desde _legacy (modales de renovación, rescisión y oferta; la página es nativa en `pages/playerProfile/`) |
| ScheduleTabV2 | `_legacy/components/schedule/ScheduleCalendarView` |
| ScheduleTabV2 | `_legacy/components/playoffs/PlayoffBracketBoard` |
| PlayersTabV2 | PlayerAvatar desde _legacy (SquadTabV2 no importa nada de _legacy) |
| CompetitionsTabV2 | ScheduleCalendarView desde _legacy |
| MainMenu (teléfono) | `_legacy/pages/MainMenu` y `_legacy/components/menu/` (`SavesList`, `CommunityPanel`, `PatchNotesPanel`) tienen una rama de teléfono elegida con `usePhoneForm()`: rejilla de fichas 2 x 3 con Exit game y la versión en la columna izquierda, panel con scroll vertical a la derecha, filas de partidas de 56 px con objetivos de 48 px, y Atrás del sistema cierra el panel abierto (`useBackDismisser`). La rama de escritorio no se toca |
| AppV2 | MainMenu, MatchSimulation, UpdateModal (sólo escritorio); en Android, cuando el manifiesto no tiene build, el aviso nativo `ui-v2/updater/AndroidUpdateNotice` envía a la página de la última release; `SettingsV2` es nativo en `ui-v2/pages/` y envuelve `_legacy/pages/Settings` (ya no hay botón de bug flotante: cada pantalla aloja el suyo) |
| DashboardV2 | `DashboardOverlays`, `FiredModal`, `dashboardHelpers` y `DashboardWorkspaceContent` → `DashboardTabContent` → `EndOfSeasonScreen`: ese camino sólo se monta con la pantalla de fin de temporada (Home); el resto de pestañas son nativas v2 |
| TeamSelectionV2 | `LeaguePickerV2`, `TeamGridV2`, `teamSelection.helpers`; FloatingBugButton en el pie de `RosterOverlayPanel` (prop `actions`), en todos los pasos de /select-team |
| DashboardSidebarV2 | FloatingBugButton: variante `cell` (celda de iconos del cluster en Tree y Split de escritorio, con `open` controlado para abrirlo con Enter) ; en el teléfono el modal (`hidden`) lo aloja `shell/PhoneMoreMenu`, el menú Más de la barra |
| LiveMatchV2 | FloatingBugButton en la fila de controles de /match (no flota: no tapa el mapa ni las tarjetas) |

El partido en directo ya no es un wrapper: `_legacy/pages/MatchSimulation` monta la pantalla nativa `ui-v2/match/LiveMatchV2` en la etapa `first_half`. Se retiraron `LolMatchLive`, `lol-prototype/ui/render.ts` y `lol-prototype/ui/panels.tsx` (y sus dos tests); un guard (`ui-v2/match/liveMatchCutover.guard.test.ts`) impide que vuelvan a importarse. Lo que sigue en `_legacy/` para esa pantalla es el motor (`lol-prototype/engine`, `backend`, `ui/stepInterpolation.ts`), `championProfiles`, `itemNames` y `matchRuntimeEvents`.

Tocado en _legacy por On Air: `FloatingBugButton` (variantes `inline`, `cell` y `hidden`; sin variante flotante) y el cambio `text-primary` → `text-club-text` en los ficheros que lo usaban.

Tocado en _legacy por el menú en el teléfono (`usePhoneForm()`, `components/menu/phoneClasses.ts`): `MainMenu` pinta la rejilla de fichas (`MenuTile`) y la columna izquierda sólo en el teléfono, y registra `useBackDismisser` para sus paneles; `SavesList`, `CommunityPanel` y `PatchNotesPanel` cambian cadenas de clases sólo en la rama de teléfono (objetivos de 48 px, Close con `aria-label`, Play siempre visible, la lista de partidas con scroll bajo una cabecera fija). `MainMenu.desktop.test.tsx` fija que el escritorio conserva su diseño.

Tocado en _legacy por la conservación de partidas: `SavesList` etiqueta una partida de otra versión o ilegible y explica por qué no se carga (Cargar con `aria-disabled` y `aria-describedby`; Exportar y Eliminar siguen activos), y deja Enter/Espacio a su propio botón; `MainMenu` sólo amplía el tipo local `SaveEntry`.

---

## 4. Diseño

**P1 On Air.** Tokens en `src/themes/default.css`; sólo tokens, nunca colores crudos.

- Tipografía: **Barlow Condensed** (`--font-heading`), mayúsculas, números tabulares. Tamaños con `--text-*` (2xs, caption, nav, entry, section, title, ovr, scoreboard); mínimo 0.75rem y todo en rem. Únicas excepciones: `--text-map: max(0.75rem, 10px)`, sólo para las etiquetas sobre el mapa del partido en vivo (`src/ui-v2/match/`); `--text-nav: max(0.75rem, 10px)`, sólo para las etiquetas de navegación (`src/ui-v2/shell/`, `DashboardSidebarV2`, la miga de `DashboardHeaderV2`, la franja de decisiones `AttentionLaneV2` y la placa de `IconTip`, que muestra un solo tip a la vez, R16/R35/NR2.10); y `--text-entry: max(0.875rem, 12px)`, para los titulares de las píldoras de la franja (R35). La raíz de Android es de 16 px (`phoneRootFontPx()` en `src/ui-v2/uiScale.ts`, una sola función; `<html>` lleva `data-platform="android"` y `data-form="phone"`), así que 0.75rem son 12 px y esos pisos en px ya no hacen falta en el móvil; siguen en escritorio, donde `xsmall` usa una raíz de 12 px. Nunca por debajo de 16 px: el futuro ajuste de texto del móvil será 16 / 18 / 20.
- Primary dirigido por el club: `--primary` = `--club` (`useClubTheme`). Texto sobre relleno de club: `--club-foreground`. Texto con el color del club: `--club-text` (`text-club-text`). `--club-wash` = tinte del club (desaparece en alto contraste).
- Superficies: `--rail` (rail), `--line` (bordes), `--dim` (texto atenuado), `--surface-clamp` (superficie de referencia para el contraste del color del club).
- Android: la app es sólo apaisada y a pantalla completa (nativo, `MainActivity` y manifiesto); `--safe-top` y `--safe-bottom` tienen un mínimo `--edge-gutter` para pantallas curvas.
- Móvil (`data-form="phone"` en `<html>`, junto a `data-platform="android"`): raíz de 16 px y `--target-min: var(--hit)` (48 px) en el bloque Android de `default.css`, así que `Button`, pestañas y los demás controles que leen `--target-min` llegan a 48 px. La variante Tailwind `phone:` (`src/App.css`) sólo coincide bajo `[data-form="phone"]`, nunca en escritorio. `--spacing` no cambia en el móvil todavía: se decide con mediciones. `src/themes/phoneTokens.guard.test.ts` impone que ningún `--text-*` quede por debajo de 12 px con una raíz de móvil de 16, 18 o 20 px.
- Scrims en el teléfono: `ScrimsTabV2` elige con `usePhoneForm()` entre la columna de escritorio (sin cambios) y `ui-v2/dashboard/tabs/scrims/phone/ScrimsPhoneLayout`. La pantalla de inicio es Semana (`ScrimWeekHome`): tres entradas (objetivo, volumen, informe), el héroe (lo que pide al mánager, uno de siete estados) y los bloques por día con el nombre y el logo real de cada club (`TeamShield`, con un contorno fino del color del texto para que un logo oscuro no se pierda). Hay una sola selección, `selected`, y su valor `"home"` es Semana; cualquier otro valor es una vista a ancho completo dentro de `ScrimViewFrame` (fila superior de `--hit` con un botón Atrás que lleva el título de la vista, y debajo el cuerpo), y el Atrás del sistema (`useBackDismisser`) hace lo mismo que ese botón: vuelve a Semana, o del seguimiento a la decisión; en Semana no hace nada. La pestaña conserva el estado, los manejadores y los datos derivados (las vistas sólo los reciben); el layout sólo guarda qué vista está abierta y a quién se devuelve el foco. Los modelos puros viven en `lib/scrims/phoneWeek.ts` (qué bloque lleva la etiqueta Next, Today o Decide, qué se puede editar, adónde lleva Done) y `lib/scrims/phoneHome.ts` (las entradas, el héroe y los bloques de Semana). Los efectos de una decisión (Decidir y Seguimiento) son una tabla, `PhoneEffectsTable`: los nombres Calidad, Moral y Energía salen una sola vez en una cabecera con su icono y siempre en ese orden, cada opción es una fila-botón (mínimo `--hit`, 4 px entre filas) con una columna fija por dato, una banda muy tenue detrás de cada columna y el nombre con su descripción de una línea a la izquierda; una subida lleva flecha arriba y +n, una bajada flecha abajo y −n en ámbar, un dato que la opción no toca una raya con el token `--dim`, y Calidad dice dónde acaba (+6 → 65). Con una o dos opciones la fila lleva debajo su línea extra (la frase neutra o la caja ámbar de Coste con Rep scrims); el nombre accesible de la fila dice la opción, cada dato en palabras y el coste, y la cabecera no se lee. Gravedad no se muestra: el motor no la lee después de decidir. La Revisión del bloque es una tabla de sólo lectura con la misma cabecera (Calidad, Moral y Energía una vez): una fila por bloque decidido del día, en orden (A, luego B), con el nombre de la decisión y su bloque, y la del bloque abierto marcada con una barra y `aria-current`; cada fila lleva lo que esa decisión aplicó (la pestaña guarda el resultado de cada bloque del día en `dayResults`), y si tras un reinicio sólo queda la decisión guardada la fila dice «Cambios no disponibles» sin valores ni rayas. Después van los costes, la fila del otro bloque y la frase de cierre. Un botón «?» al final de la fila superior de Decidir, Seguimiento y Revisión (`ScrimGlossary`) abre el glosario «Qué significa cada dato»; el Atrás del sistema cierra primero ese diálogo. La selección se mueve sola sólo al abrir (a Decidir si espera un bloque, si no Semana), cuando el juego mueve la etiqueta (Decide abre su bloque, Today vuelve a Semana, que lo muestra en el héroe), con el resultado de una decisión (a su bloque, la Revisión del bloque; pero si otro bloque del día espera su propia decisión, va directo al Decidir de ese bloque y la Revisión del primero no se muestra entre medias: sigue abierta desde su bloque en Semana, y el aviso `aria-live` sigue diciendo que la decisión se aplicó), tras elegir el objetivo (a Volumen, una vez) y con Done; tocar un logo de la tira de rivales elige el rival y no avanza el plan. El aviso de resultado del scrim del dashboard no se dibuja en esta pestaña en el teléfono (la pestaña ya muestra el resultado y no tiene altura de sobra): lo que el jugador vio aquí se descarta y la nota del asistente va a las alertas. Su raíz sigue llevando `data-phone-fixed`: la regla de `src/App.css` que sigue a la del scroll de página la deja exactamente tan alta como el área de contenido, así que la página nunca hace scroll; dentro, el cuerpo de cada vista y Semana sólo hacen scroll si su área es más baja que su contenido, y a las alturas del diseño solo lo hacen el cuerpo del informe y la tira de rivales (`design/scrims-look-2026-11-23`).
- Regla: `text-primary` desnudo está prohibido, usar `text-club-text`. Lo impone `src/ui-v2/tokens.guard.test.ts` (excluye `components/ui/`, `shell/` y `FloatingBugButton`).
- `cn()` (`src/ui-v2/lib/utils.ts`) usa `extendTailwindMerge` y registra los tamaños `text-2xs/caption/map/nav/entry/section/title/ovr/scoreboard`; un test lo compara con los `--text-*` de `default.css`. Un tamaño nuevo se añade en los dos sitios.
- Los estados activos nunca dependen sólo del color (barra, peso, `aria-current`).

**Shell: rail + barra.** `DashboardSidebarV2` es el único `<nav>` ("Main navigation") y tiene dos modos que decide `railMode.ts` (puro) con `useRailMode` sobre el cuerpo bajo la barra de título: **Tree** (Club abierto con sus 10 pestañas, Market y World plegados; filas de disclosure con `aria-expanded`; `--rail-w-tree`) cuando caben altura y 880 px de contenido, y **Split** (rail de iconos con etiqueta de hasta 2 líneas más un panel `role="group"` con las pestañas del grupo activo; `--rail-w-split` + `--nav-panel-w`) en el resto. Android es siempre Split y no acopla panel: 7 paradas de exactamente `--hit` (48 px: Go, Home, Inbox, Schedule, Club, Market, World; 336 px sin scroll) en una columna de `--rail-w-phone` (64 px; la rama es `platform === "android"`, con `RailItem phone`); sus etiquetas nunca pasan a iconos (R14). Una parada de grupo (Club, Market, World) lleva `aria-haspopup="dialog"` y `aria-expanded` y no navega: abre las secciones del grupo en una hoja lateral (`SideSheet` con `alignToRail`, titulada con el grupo y modal) cuyas filas y teclado son los del panel (`RailSplitPanel` con `sheet`: una columna hasta 5 secciones, dos desde 6; el foco entra en la sección abierta o en la última usada; la actual lleva `aria-current`). Elegir una sección cierra la hoja y navega después (`onSheetNavigate` = `handleLaneCall`: anuncia y enfoca `#main-content`); Atrás o Escape la cierran y el foco vuelve a la parada. Más ya no es una parada: su disparador (`shell/PhoneMoreMenu`, sobre `RailMore` con `placement="bar"`) vive en la barra y abre el mismo menú (News, Social, Settings, Report bug, Exit, Manager); con News, Social o Manager abiertos ninguna parada es la actual y la parada de Tab es Go. En Split de escritorio, si las paradas con etiqueta no caben en altura pasan a iconos con `IconTip` (R13, `splitLabelsFit`). Las utilidades (bug, ajustes, salir, manager) son celdas de iconos con `IconTip` y `aria-label`. Go (`shell/GoButton.tsx`, id `util:go` en todos los modos) es la primera fila del widget y abre la paleta Go (`ui-v2/palette/`) con `openPalette("util:go")`, que devuelve el foco a Go al cerrarse: fila "Go to…" sobre el árbol en Tree (`--go-row`; `railMode.goReserve` reserva su altura), celda de icono con `IconTip` en Split de escritorio y en `compact`, y parada con etiqueta "Go" en Android (R40: el nombre accesible contiene el texto visible). En Android la paleta (y Más) empuja una entrada de historial propia mientras está abierta (`palette/paletteHistory.ts`, R87) para que el gesto Atrás la cierre, sólo mientras el listener nativo `back-button` no esté registrado: con él registrado no toman entrada alguna y Atrás las cierra con un dismisser (`useBackDismisser`), y `DashboardV2` no navega con ese pop. En Android el gesto Atrás lo resuelve primero el evento nativo `back-button` (`onBackButtonPress`, registrado en `main.tsx`; con un listener JS Tauri no recorre el historial ni cierra la app) y `handleNativeBack` decide por el slot: retener no hace nada, salir llama a `exit`, sin significado va atrás o cierra la app. Si el registro falla o aún no resolvió, y para los pops programáticos, queda el listener único de `popstate` (`lib/backGuard.ts`), instalado en `main.tsx` antes de renderizar: Chromium ejecuta los listeners de `window` en orden de registro, sea cual sea su fase, y el router desmonta la pantalla en un microtask, así que un listener de pantalla nunca llega a actuar. Las pantallas sólo declaran qué significa Atrás mientras están montadas (`useMenuBackExit`: salir; `useDashboardBackHold`: retener con `history.forward()`) y el guard no toca un pop que la paleta o Más reclaman (`paletteHoldsEntry`). Tamaños en tokens `--nav-row`, `--nav-row-child`, `--nav-cell`, `--nav-indent`, `--nav-icon` (todos `max(rem, px)`), `--rail-w-*`, `--nav-panel-w` y `--hit`; las filas llevan ids estables (`tab:Squad`, `group:club`, `util:settings`) y el foco los sigue al cambiar de modo. El teclado es `treeKeyAction` sobre `useRovingFocus` (`onKey`). Ya no hay franja de secciones: `DashboardHeaderV2` es la barra (Back, miga `{equipo} · {grupo}`, título, chip de decisiones, reloj, Continuar). En el teléfono (`usePhoneForm()`) es una sola fila de `--hit` (más la regla del club): Back, título (trunca; el texto entero queda en `title`), chip, fecha corta sobre la fase (`ClockPlate stacked`), More, Save y Continuar; el escudo, el equipo y la miga salen de la barra. Back está siempre (R20): icono con `IconTip`, nombrado "Back to {destino}" por `backDestination`, que ejecuta el mismo `goBackDashboardProfile` que Back; sin destino queda `aria-disabled` y enfocable, nunca `disabled`. Los Back de las páginas de equipo, staff y campeón llevan la misma etiqueta (R41). `lib/dashboard/describeLocation.ts` es la fuente única de nombres de una ubicación: el h1 (el nombre de la entidad en un perfil, R21), Back y el anuncio. Todo movimiento del usuario pasa por `runIntent(intent, { announce, focusMain })` de `DashboardV2`; Back anuncia la llegada en `RouteAnnouncer` (R46), el Back de la barra conserva el foco y el de una página lo lleva a `#main-content`. Bajo la barra, fuera de Home y fuera de `compact`, con al menos 380 px de cuerpo, va la franja "Before you continue" (`AttentionLaneV2`, modelo puro `lib/dashboard/attentionLane.ts`, R24): una `section` nombrada con una `toolbar` sin nombre propio (R47), una sola parada de Tab, una píldora por decisión (`decisionItems`) más "All N on Home" fija al final, que hace lo mismo que el chip. Una píldora corre `runIntent(callAction(item), { announce: true, focusMain: true })`; si la franja desaparece con el foco dentro, el foco va a `#main-content`. No añade región viva: una decisión nueva que trae un avance (Continuar o un salto) fuera de Home la dice `RouteAnnouncer` una vez como estado ("N to resolve", R42); en Home habla el `role="status"` del panel. Tokens `--lane-h` y `--lane-pill-h` (Android `--hit`). `shell/navModel.ts` es la fuente única de paradas, grupos y pestañas. Con la pantalla de fin de temporada el rail pasa a `compact` (iconos, sin panel).

**Hojas laterales.** `--sheet-w` (`max(22rem, 320px)`, en `:root`) es el ancho de toda hoja lateral; `--palette-sheet-w` queda como alias. La altura sigue al visual viewport con `--sheet-vvh` (antes `--palette-vvh`), que sólo se fija con `fitVisualViewport`.

**Primitivas** (`src/ui-v2/components/ui/`): `ClubShield`, `LowerThird` (primitiva todavía sin montar: `NeedsYourCallPanel` usa `data-slot="lower-third"` propio), `Meter`, `ScoreNumeral`, `SegmentedControl`, `SplitButton`, `TagBlock`, además de las shadcn (`button` con variantes `club` y tamaños `touch`).

**Home y Squad On Air:** `tabs/home/` (ScoreboardHero, NeedsYourCallPanel, InboxPanel, StandingsPanel) y `tabs/squad/` (PlayerCardV2, SelectedPlayerBar, BenchEmptyState, StartingFiveGrid). Textos por i18next con las claves `onAir.*` en los 8 locales (`src/i18n/onAirKeys.test.ts` exige el mismo conjunto de claves).

Layout: `<Card className="h-full">` con `<CardHeader>` + `<CardContent>`.

---

## 5. Workflow

```bash
npx tsc --noEmit
npm run build
npm run tauri dev
```

Branch: `feat/ui-v2`. Commit style: `feat(ui-v2): …`, `fix(ui-v2): …`.

---

## 6. Próximos pasos (opcionales)

- Portar los wrappers `_legacy/` restantes a v2 nativo (ver tabla de la sección 3). Ya son nativos: dialogs de fichajes (`dashboard/tabs/transfers/`), `CountryFlag` (`components/ui/country-flag`) y `NegotiationFeedbackPanel` (`components/negotiation/`)
- Separar chunks grandes (MatchSimulation, _legacy) con lazy loading
