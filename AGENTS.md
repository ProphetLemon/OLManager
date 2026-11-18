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
│   ├── _legacy/               # copias de v1 con imports convertidos
│   │   ├── components/        # 11 subdirectorios
│   │   └── pages/
│   ├── components/ui/         # shadcn primitives + On Air primitives (see section 4)
│   ├── shell/                 # navModel.ts (paradas, grupos, defaultOpen), railMode.ts (Tree/Split puro), treeRows.ts (teclado puro),
│   │                          # RailTree, RailSplit, RailUtility, RailMore, RailRow, RailItem, useRailMode, useFadeMask, attention.ts, ClockPlate
│   │                          # (estado en store/navMemoryStore: última por grupo, grupos abiertos; la ubicación,
│   │                          #  la pila de Back (30) y Recent (6) en store/dashboardLocationStore; reset en store/sessionReset)
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
└── store/, services/, hooks/, api/  # compartidos (hooks/useRovingFocus, useClubTheme)
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
| AppV2 | MainMenu, MatchSimulation, UpdateModal; `SettingsV2` es nativo en `ui-v2/pages/` y envuelve `_legacy/pages/Settings` (ya no hay botón de bug flotante: cada pantalla aloja el suyo) |
| DashboardV2 | `DashboardOverlays`, `FiredModal`, `dashboardHelpers` y `DashboardWorkspaceContent` → `DashboardTabContent` → `EndOfSeasonScreen`: ese camino sólo se monta con la pantalla de fin de temporada (Home); el resto de pestañas son nativas v2 |
| TeamSelectionV2 | `LeaguePickerV2`, `TeamGridV2`, `teamSelection.helpers`; FloatingBugButton en el pie de `RosterOverlayPanel` (prop `actions`), en todos los pasos de /select-team |
| DashboardSidebarV2 | FloatingBugButton: variante `cell` (celda de iconos del cluster en Tree y Split de escritorio, con `open` controlado para abrirlo con Enter) y `hidden` (sólo el modal, abierto desde el menú Más de Android, donde las utilidades viven) |
| LiveMatchV2 | FloatingBugButton en la fila de controles de /match (no flota: no tapa el mapa ni las tarjetas) |

El partido en directo ya no es un wrapper: `_legacy/pages/MatchSimulation` monta la pantalla nativa `ui-v2/match/LiveMatchV2` en la etapa `first_half`. Se retiraron `LolMatchLive`, `lol-prototype/ui/render.ts` y `lol-prototype/ui/panels.tsx` (y sus dos tests); un guard (`ui-v2/match/liveMatchCutover.guard.test.ts`) impide que vuelvan a importarse. Lo que sigue en `_legacy/` para esa pantalla es el motor (`lol-prototype/engine`, `backend`, `ui/stepInterpolation.ts`), `championProfiles`, `itemNames` y `matchRuntimeEvents`.

Tocado en _legacy por On Air: `FloatingBugButton` (variantes `inline`, `cell` y `hidden`; sin variante flotante) y el cambio `text-primary` → `text-club-text` en los ficheros que lo usaban.

Tocado en _legacy por la conservación de partidas: `SavesList` etiqueta una partida de otra versión o ilegible y explica por qué no se carga (Cargar con `aria-disabled` y `aria-describedby`; Exportar y Eliminar siguen activos), y deja Enter/Espacio a su propio botón; `MainMenu` sólo amplía el tipo local `SaveEntry`.

---

## 4. Diseño

**P1 On Air.** Tokens en `src/themes/default.css`; sólo tokens, nunca colores crudos.

- Tipografía: **Barlow Condensed** (`--font-heading`), mayúsculas, números tabulares. Tamaños con `--text-*` (2xs, caption, nav, entry, section, title, ovr, scoreboard); mínimo 0.75rem y todo en rem. Únicas excepciones: `--text-map: max(0.75rem, 10px)`, sólo para las etiquetas sobre el mapa del partido en vivo (`src/ui-v2/match/`); `--text-nav: max(0.75rem, 10px)`, sólo para las etiquetas de navegación (`src/ui-v2/shell/`, `DashboardSidebarV2`, la miga de `DashboardHeaderV2` y la franja de decisiones `AttentionLaneV2`, R16/R35: `text-caption` serían 6.75 px en Android); y `--text-entry: max(0.875rem, 12px)`, para los titulares de las píldoras de la franja (R35). Android usa una raíz de 9 px y 0.75rem quedaría en 6.75 px.
- Primary dirigido por el club: `--primary` = `--club` (`useClubTheme`). Texto sobre relleno de club: `--club-foreground`. Texto con el color del club: `--club-text` (`text-club-text`). `--club-wash` = tinte del club (desaparece en alto contraste).
- Superficies: `--rail` (rail), `--line` (bordes), `--dim` (texto atenuado), `--surface-clamp` (superficie de referencia para el contraste del color del club).
- Regla: `text-primary` desnudo está prohibido, usar `text-club-text`. Lo impone `src/ui-v2/tokens.guard.test.ts` (excluye `components/ui/`, `shell/` y `FloatingBugButton`).
- `cn()` (`src/ui-v2/lib/utils.ts`) usa `extendTailwindMerge` y registra los tamaños `text-2xs/caption/map/nav/entry/section/title/ovr/scoreboard`; un test lo compara con los `--text-*` de `default.css`. Un tamaño nuevo se añade en los dos sitios.
- Los estados activos nunca dependen sólo del color (barra, peso, `aria-current`).

**Shell: rail + barra.** `DashboardSidebarV2` es el único `<nav>` ("Main navigation") y tiene dos modos que decide `railMode.ts` (puro) con `useRailMode` sobre el cuerpo bajo la barra de título: **Tree** (Club abierto con sus 10 pestañas, Market y World plegados; filas de disclosure con `aria-expanded`; `--rail-w-tree`) cuando caben altura y 880 px de contenido, y **Split** (rail de iconos con etiqueta de hasta 2 líneas más un panel `role="group"` con las pestañas del grupo activo; `--rail-w-split` + `--nav-panel-w`) en el resto. Android es siempre Split con 7 paradas a `--hit` (48 px) y un menú Más (`RailMore`, Base UI); sus etiquetas nunca pasan a iconos (R14). En Split de escritorio, si las paradas con etiqueta no caben en altura pasan a iconos con `IconTip` (R13, `splitLabelsFit`). Las utilidades (bug, ajustes, salir, manager) son celdas de iconos con `IconTip` y `aria-label`. Tamaños en tokens `--nav-row`, `--nav-row-child`, `--nav-cell`, `--nav-indent`, `--nav-icon` (todos `max(rem, px)`), `--rail-w-*`, `--nav-panel-w` y `--hit`; las filas llevan ids estables (`tab:Squad`, `group:club`, `util:settings`) y el foco los sigue al cambiar de modo. El teclado es `treeKeyAction` sobre `useRovingFocus` (`onKey`). Ya no hay franja de secciones: `DashboardHeaderV2` es la barra (Back, miga `{equipo} · {grupo}`, título, chip de decisiones, reloj, Continuar). Back está siempre (R20): icono con `IconTip`, nombrado "Back to {destino}" por `backDestination`, que ejecuta el mismo `goBackDashboardProfile` que Back; sin destino queda `aria-disabled` y enfocable, nunca `disabled`. Los Back de las páginas de equipo, staff y campeón llevan la misma etiqueta (R41). `lib/dashboard/describeLocation.ts` es la fuente única de nombres de una ubicación: el h1 (el nombre de la entidad en un perfil, R21), Back y el anuncio. Todo movimiento del usuario pasa por `runIntent(intent, { announce, focusMain })` de `DashboardV2`; Back anuncia la llegada en `RouteAnnouncer` (R46), el Back de la barra conserva el foco y el de una página lo lleva a `#main-content`. Bajo la barra, fuera de Home y fuera de `compact`, con al menos 380 px de cuerpo, va la franja "Before you continue" (`AttentionLaneV2`, modelo puro `lib/dashboard/attentionLane.ts`, R24): una `section` nombrada con una `toolbar` sin nombre propio (R47), una sola parada de Tab, una píldora por decisión (`decisionItems`) más "All N on Home" fija al final, que hace lo mismo que el chip. Una píldora corre `runIntent(callAction(item), { announce: true, focusMain: true })`; si la franja desaparece con el foco dentro, el foco va a `#main-content`. No añade región viva. Tokens `--lane-h` y `--lane-pill-h` (Android `--hit`). `shell/navModel.ts` es la fuente única de paradas, grupos y pestañas. Con la pantalla de fin de temporada el rail pasa a `compact` (iconos, sin panel).

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
