# Changelog

All notable changes to OLManager will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses GPL-3.0 licensing inherited from the OpenFootManager lineage unless otherwise documented.

## [2026.1123.1] - 2026-11-23

A small update, mostly for Android. It was checked on an Android 14 emulator (x86_64 build) and on one real phone, a OnePlus 11 with Android 16 (arm64 build).

### Fixed

- Android: the game now always runs in landscape and in full screen. Before, it could turn to portrait, where the main menu did not fit, and in landscape the status bar stayed on screen and pushed the game down. Swipe from an edge of the screen to see the system bars for a moment.
- Android: buttons at the top and bottom edges of the screen keep a small margin, so they are easier to press on a phone with curved edges.
- Android: "Exit game" on the main menu now closes the app. Before, it did nothing.
- Android: "Import save" and "Export save" now open the file picker. Before, they did nothing, so a save could not be moved to or from the phone. A save exported on a PC was imported on the phone and loaded there. Exporting was only checked on the emulator.
- Importing a file that is not a save now says so, and tells you to use "Export save" in the Load Game list to get a .olsave file. Before, any such file was reported as a save from another game version. This is the only change for Windows and Linux players.

### Changed

- Android now treats the app as a game, which is what keeps it in landscape on tablets. On the OnePlus we tried, the phone's game mode (Game Space) showed its side handle over the game.

### Known issues

- Android: if you import a save you already have and pick the file from the Downloads view of the file picker, it is added as a second copy instead of asking to replace the one you have. Picking the same file through the device storage asks to replace it.
- Android: the interface is still the desktop layout at a smaller size, and it is hard to read on a phone.
- The file made by Settings > "Export World Database" holds teams, players and staff only. It is not a save and cannot be imported.

## [2026.1122.1] - 2026-11-22

### Added

- The first Android app from this fork, as an APK attached to the release. It is a separate app from Open League Manager: it installs next to the original and does not replace it, and the two apps keep separate saves. On the phone it is called OLM Limón, so you can tell the two apps apart.
- The Android APK is built for 64-bit ARM (arm64) devices only.
- The Android app does not update itself. To update, download the new APK from the release and install it over the old one. Every APK is signed with the same key, so your saves stay.
- On Android, when a new version is out, the game says so when it opens and in Settings > Updates, with a button that opens the release page to download the new APK. It never installs anything by itself.
- Google Play Protect blocked a test copy of this APK as harmful on the one phone we tried it on, and you may see the same warning. We have asked Google to review it.
- The Android app was checked on an Android 14 emulator running the x86_64 build (launch, new game, one match day, save and load, Settings > Updates, installing a new APK over an old one). The arm64 APK has not been run on a real phone, and live (watched) matches, landscape and the system Back button were not checked.
- The Android layout is adapted to touch: no desktop title bar, navigation buttons and menu rows sized at 48 px, and a More menu for the sections that do not fit. Only checked on an emulated phone screen.

### Changed

- In a large window, the Club sections are a list down the left side: Club opens to its ten sections (Squad, Tactics, Training, Scrims, SoloQ, Meta, Staff, Scouting, Academy, Finances), and Market and World start folded. The strip of sections across the top is gone in every window size.
- When the window is too small for the full list, and always on Android, the left bar shows the groups as icons, with a panel next to it listing the sections of the group you are in.
- The top bar shows your team, and for pages inside a group the group, above the page title, and it fits narrow windows.
- In the full list you can move with the arrow keys: Up and Down between rows, Right and Left to open and close a group.
- A section with a decision waiting for you (the ones listed under "Needs your call" on Home) carries a warning marker in the left list. Notices that need no decision show none.
- The game remembers the section you were on, the last section of each group and which groups are open when you come back from Settings or a match. The memory lasts for the session: it resets when you load a save, start a new game or leave the game.
- The team selection screen no longer has an "Update rosters" button. The game checks for roster updates by itself when it opens, and the screen shows a status line instead: "Rosters as of {date}", "Checking for roster updates…", "Rosters updated to {date}" or "Rosters are up to date ({date})". The check only affects new games.
- If the roster check fails, the status line reads "Couldn't check for roster updates" and a Retry button appears next to it.
- While a roster check runs, Confirm on the team selection screen waits, with a note beside it: "Waiting for the roster check…".
- New games come with the roster refresh of 17 November 2026 (the previous release used 15 November), and the roster check can bring a newer one. The pool of free agents is now 3,514 players and 613 staff, up from 3,495 and 587. New games only.
- In new games, 117 free-agent players have a different role than before, decided from their latest games and roster entries. For example, Vander is now ADC and Huron is Support. New games only.
- In new games, free-agent players who were really coaches or other staff in the game are no longer listed as free agents as well. New games only.

### Fixed

- Linux: if Fast graphics fails with WebKit's "Failed to create GBM buffer" error (a grey window after start, seen with an NVIDIA card on Wayland), the game now notices in the first seconds, saves Compatibility and restarts by itself. Seen working with a simulated error; the real failure and a restart from a packaged AppImage have not been tried yet.
- Linux: the automatic switch only happens in the first 15 seconds after the window opens, only from Fast, and never when you have set `WEBKIT_DISABLE_DMABUF_RENDERER` yourself. After it, the game stays in Compatibility and does not restart again until you choose Fast and it fails again.
- Linux: to go back to Fast, choose it in Settings under "Graphics mode".
- Saves written in a different save format (from a very old or a future release), and saves whose header cannot be read (for example an empty or cut-short file), are no longer deleted when the game starts. Before, starting the game erased them without a word. Saves already deleted by an earlier release cannot be restored. Saves made by this release and by 2026.1116.1 use the same format.
- Such a save is listed with "From another version" or "Can't be read". Load is blocked and the reason is shown, but Export and Delete still work, so you can keep a copy or open it with the version that made it. Importing an exported copy of the same save over it restores it.
- On the saves list, Enter and Space on Export, Delete and Import no longer load a save, and Enter acts on the row you are on.
- Releases before this one, including 2026.1116.1, still delete saves in a different save format or with an unreadable header when they start. If you share a save folder with an older release, do not start it.

## [2026.1116.1] - 2026-11-16

### Changed

- An academy is now a real second-tier club. Funding one links a club of the parent club's region to yours: it keeps its own players, league place, name, logo, money, sponsor and wages, and you move players between the two clubs. The weekly academy report reads that club's real league table. The AI market never trades with the linked club on its own, and if the club reaches the first tier the link ends with an inbox message. Before, funding an academy built a copy of the club with five made-up players, a balance of zero and no income, and most copies ended a season in the red. The link now costs the larger of the old formula and the club's whole squad market value, because a link gives call-up rights to the whole squad: typically a few hundred thousand euros, and up to about €1.5M for the most valuable squads. New games only: a save that already holds academy copies keeps them and the old rules, and saves made by earlier releases do.
- New games use the roster refresh of 15 November 2026. Players who moved or were released since the 7 November refresh are on their new teams or on the market. New games only.
- Prize money and matchday income are now paid in every league, not only the one you play, scaled by tier: second-tier and lower clubs get 60% of the first-tier amounts. A second-tier champion gets €480K against €800K, and the runner-up €300K against €500K. To keep a typical second-tier club level, its tier sponsor drops from €950K to €850K a year; the first-tier sponsor stays at €1.5M. In test seasons the median second-tier club ended slightly up and the median first-tier club slightly below its start, close to break-even, because AI clubs fill their benches to seven players during a season at market wages. The board mail names the prize as, for example, "€800K". The scaling applies to every save whose leagues store a tier (saves made with 2026.1111.4 or later do; a league with no tier pays in full, as before). The lower sponsor reaches a club when its current 12-month deal ends and renews.
- Every club earns matchday income. When the data gives a club no stadium size, the game now uses 2,500 seats in the first tier and 1,500 below it. Before, most second-tier clubs and a few first-tier clubs earned none. Applies to every save, from the next matchday payment.
- A random sponsor offer now shows what you are paid: the monthly amount, the term (3 months) and the total, in the inbox, the accept option, the signed mail and the toast. Before, the offer promised a one-time payment of its headline figure but was signed for 3 months and paid only about a quarter of it. The money paid is unchanged. Applies to every save, to offers from now on.
- The transfer window is open in the off-season. It opens the day after the last league fixture (playoffs do not count) and stays open until the next season's first fixture. Before, it stayed closed from the first match of a season until the next season was scheduled, so AI clubs signed no free agent for weeks while hundreds sat unsigned, and you could not bid, counter or release in that stretch. In a simulated year without the new free-agent pool, AI clubs signed clearly more free agents in December and made more moves between clubs. The Transfers tab hides the countdown when there is no closing date. Applies to every save, from the next day.
- AI clubs no longer buy players from other clubs into a full roster. Club-to-club buys now respect the same limit of seven players that free-agent signings already had. Starting rosters are not trimmed, so some AI clubs still hold more than seven players for a while. Applies to every save, from the next day.
- Post-match progression judges laning by creep score against the lane opponent, using the 80th percentile of real 2026 pro games, so a lane win and a lane loss fire equally often. Before, it used a fixed creep score per role that the game's matches rarely reach, so almost every ADC lost laning after almost every match. In a long simulated run, the AI ADCs' laning loss per split fell by about two thirds. Applies to every save, from your next match.
- A player who performs at par no longer slides down near the potential cap. Losses 1 to 9 points under the cap now shrink the way gains already did (by headroom, but never below one fifth), a weak match at the cap still costs the point, and no gain applies while the overall is at or above the cap. In three simulated seasons, established starters lost less than half as much overall per season as before, and no player ended a season above their cap and above where they started. Applies to every save, from your next match.
- Post-match progression now judges a best-of-3 or best-of-5 by its average game. Before, it compared the sum of a series' kills, deaths and assists with per-game thresholds, so a series read as one very bad or very good game. Shotcalling is now judged by assists against the lane opponent's (real 80th-percentile cut points: Top 8/3, Jungle, Mid and ADC 5/2, Support 13/5), because the game's Supports make far fewer assists than real Supports and could only lose the term. In 12 simulated 3-year runs, no role and attribute at par lost more than it gained, and established starters' overall change per season moved from slightly negative to about zero. Applies to every save, from your next match.
- A best-of-N series is rated by its average game when the engine gives no rating. Before, the rating read a series' summed kills, deaths and assists as one game, so AI players' series ratings ran far above their single-game ratings and many series rated above 10. Now they match single games and none rates above 10. Applies to every save, to series played from now on.
- A series' morale and "stomp" tag are read per game. Before, the same per-game line gave more and more individual morale the longer the series ran; it now gives the same at every length. A stomp now needs a 2-game margin or a lead of 10 kills per game played, so a 2-1 series with a 12-kill total lead is no longer a stomp. Stamina still counts a series' total minutes, but a long series no longer wraps its minutes at 256 (a 260-minute series was read as 4 minutes). Applies to every save, to series played from now on.
- Stats rows count the games they sum. The champion page and the team overview average per game, not per row, and a series row in a player's match history shows "xN" for N games. Rows already stored count as one game each.
- The market hides a free agent only when the player could be the same person as a contracted one. Before, every free agent whose nick matched any contracted player was hidden, which also hid different people with the same nick. A date of birth written as text ("June 3, 2003") is now compared as a date. Applies to every save.
- A free agent with no wage on record shows the wage a signing would ask, in the market row, the profile and the wage dialog, and the dialog opens with that amount, so you can submit it. Before, these players showed €0/yr, Submit was disabled, and the real ask appeared only after a rejected offer. The negotiation itself is unchanged. Applies to every save.
- The squad bench shows a player's wage in the short form (€211K) like the starter cards, with the exact figure as a tooltip.
- The 13 players the data listed twice on the same team are listed once (dadou, skyp, panther, omon, rabelo, insane, frog, jiwoo, akaje, peter, quantum, ryuk2 and spooky), and the data now fills two missing contract ends (omon, spooky) and RyuK2's nationality (Vietnam, not Austria). New games only: a save keeps the rows it already has.
- The data corrects two roles: RyuK2 plays Top, not ADC, and Skyp plays ADC, not Jungle. New games only.
- The data corrects ten birth dates from Leaguepedia (Kangin, Zephyr, DDoiV, Seaz, Smarty, Jaehyuk, Mihawk, Legolas, Kaii and Papiteero). For example, Mihawk's date moves from 1993 to 2009 and DDoiV's from 2023 to 2003, so their ages now read correctly. Chico plays Support, not ADC. Ace is now a single Uruguayan record (Ignacio David Piaggio) with no birth date: before, the record mixed two people and carried the other person's Cuban nationality and 2007 birth date. New games only: a save keeps the rows it already has.
- The custom-team founder editor explains its nationality list. Under the field it reads "Only countries in this league's region are listed, so founders never count as imports." The text is translated in all eight languages. Applies to every save.

### Added

- A pool of 3,495 active players and 587 staff beyond the 29 leagues, as free agents in new games. Anyone not retired with a roster entry since 12 November 2023 in a recurring league, a promotion stage or a second division (open qualifiers and one-off cups are left out), and with a Leaguepedia player page, can be found, scouted and signed. Most of the pool comes from EMEA, followed by North America, Asia-Pacific, Brazil, Korea and China. Players with enough match stats are rated from them against the level of the league the stats come from; the others get a default rating for their league or tier. The pool stays on the market at the start of a new game, and AI clubs sign some of its players during a season. Speed (release build, pinned cores, median of 30 quiet days): the same save took 34.2 ms on the old build and 33.3 ms on the pool build, and a new game took 47.7 ms with the pool against 32.5 ms without it. New games only: saves that already exist are unchanged. The release before this one cannot read this roster file and keeps its own.
- The Youth tab shows the linked club's own finances: its balance, its monthly sponsor and its monthly player wages. The team card and profile of a linked club and the profile of its players carry a "Your Academy" badge. New games only.
- Nationalities for 170 players whose data had none, each confirmed on Leaguepedia by in-game name and real name. 21 more stay empty because the match was not certain. New games only.
- Nationalities for 4 pool players and 1 staff member whose country Leaguepedia gives as Moldova, DR Congo or Republic of Ireland. 15 pool players and 1 staff member have no country on Leaguepedia and stay without a flag. New games only.

### Fixed

- A best-of-N series you play live was stored as one game: the deciding game's report alone, so a 2-1 was recorded as 1-0 in the fixture, mails, standings and map difference, and games 1 to N-1 fed no player stats, progression or stamina. Each game of the series is now recorded, and the true score and the summed stats are stored together. A sweep counts +2 on map difference, and a 3-0 in a best-of-5 can earn the fan bonus. If a game is missing from a series, the deciding game is stored alone, as before. Applies to every save, to series played from now on; series already stored keep their score.
- A win, score and team stats were credited to the other team when the away club played on the blue side. This applied to single games too, and to skipped or delegated games. The game now reads the side from whose players are on blue, or from the blue team the page names. Applies to every save.
- A double click on Continue at the end of a game of a series no longer records the game twice.
- Hundreds of players reached a new game with a potential of 0, so the potential report read 0 to 3, they had no room to grow, and every weak match cost them a point. They now get a potential drawn from real players of the same age band (never below their rating). Before, these players could only decline; now they develop close to their peers. A save made earlier heals when you load it, and a potential estimate you already paid for becomes the healed potential plus the research bonus already earned (at most 3). Also applies to players added to a running game from the catalog.
- Players with no date of birth (about 500 in the data) now have one consistent age everywhere. Before, training, AI squad decisions, contracts and transfers each guessed their own (27, 25, 30 and 0), a missing age got the largest offer multiplier (x1.30) and extra readiness to move, and training counted calendar years instead of birthdays. The age is now drawn from the real age distribution of the shipped data (median 24), the same for every system, and it grows with the game clock. Tables show a dash for an unknown age and sort it last, and the Young Player award needs a known date of birth. A date written as "Month D, YYYY" now gives the real age. Applies to every save.
- Transfer lists sort by age on the game's date, not the computer's.
- A new game holds far fewer repeats of the same person. Stale copies of live players (from Prime League and LCK CL) were in a new game as free agents next to the live record of the same person, and the AI could sign them. The rule that dropped them needed the same name and an exact birth-date match, so copies whose date was a month off, mistyped or missing stayed: Kangin, Zephyr, DDoiV, Seaz and Smarty showed as free agents next to the contracted record of the same person, and Cracker and Pyeonsik appeared twice at HLE Challengers. A stale Prime League or LCK CL record now goes when a player in the league that replaced it has the same name, whatever the birth date. A free agent who shares a name (a nick or a real name, in either order) and the same birth date with a contracted player is now folded into the contracted record: Koldo, Macaquinho, DeadlyMark and Legolas. Some repeats remain: see Known issues. In a test dump of a new game, the same nick no longer appears twice on any club (4 before, 0 after) and the world holds 36 fewer player records (5,329 to 5,293). New games only; saves are untouched.
- Two records of one person on the same club now collapse to one, and a pool player who shares two names with a club player (a nick and a real name) is dropped in favour of the club record. This covers samkz, Kaii, Sankaizer and Ace, and the pool entries of BetaTwinz, Pauporter, Kellie, Papiteero and Lurox. New games only.
- Prime League free agents with every rating at 0 are no longer in a new game. They showed as OVR 1 and asked for €525K to €730K a year (14 in a test dump, 0 after; in the real app the lowest free-agent OVR is 41). New games only.
- Clubs in a new game start with every lane covered. The club page read a player's position, but the roster fill read a separate natural-position field that disagreed for 29 players (25 of them Jungle or Mid), so the fill signed junglers into Mid gaps and counted them closed. A new game now takes that field from the position. In a test dump, no club started a lane short. New games only: a save keeps its field.
- Flags show for players whose nationality the data writes as a full country name (for example Germany, France, Korea, South Korea, Hong Kong, Austria, Jordan or Belgium), whatever the capitalisation. Applies to every save.
- Old saves keep one copy of each LCK CL and Prime League club. A save from 2026.1113.2 or older that still plays a stale league held about 20 unscheduled twins of those clubs, which never played. They are now removed on load, and their players, wages and staff are released or dropped. A player is dropped, and every reference to them remapped, when the same person stays on the club's surviving academy or on the paired club: the same name (nick or real name, in either order), a birth date that matches, is missing or is about two months off, and no conflicting nationality. Before, only the surviving club was checked, so a released player whose twin sat on the academy came back as a free agent next to that twin. Any other player becomes a free agent. A record with two possible twins is released, not guessed. In the owner's save the repair removes 39 teams and 126 player records, and after load 12 free agents still have a contracted twin under the strict key, a shared real name where a birth date is missing (7 are moved players, which the repair protects, 2 were already teamless in the file and 3 were released with a stale academy whose twin is on the paired club). In a test on one real old save, the repair left no reference to a removed club or player, and a second load removed nothing more. Your club and academy, players who moved or have a transfer record, and players with a pending transfer offer are never dropped. Saves made with 2026.1113.2 or older only, and only while they still play a stale league. Saves made with 2026.1114.1 load with 0 players added or removed. This repair cannot be undone: see Known issues.
- AI clubs never sign a free agent who could be the same person as a contracted player. Before, every AI signing path picked from all teamless players, so a twin of a contracted player could be signed and one person would sit on two clubs. The check covers free-agent signings, contract expiry, the pre-match roster repair, season rollover and the starting fill of a new game. If every candidate is a possible twin, the club signs nobody; a twin at the top of the ranking does not end the search. It protects every save, including saves that already hold such twins. Applies to every save, from your next day.
- Old saves keep one copy of each academy. The same old saves held about 20 stale academies next to the canonical ones, so about 40 players showed twice in the ERL list and could be signed twice. The stale copy is now removed (or the canonical one, where your club links the stale academy), unless a league schedules either copy. A few other duplicate pairs (such as omon and dadou) remain in old saves. Saves made with 2026.1113.2 or older only. Both repairs run in memory when you load; the repaired save is written the next time the game saves, including when you leave to the main menu. The game makes no copy first and nothing restores the removed clubs or players: export the save before you load it if you want to keep one.
- Match days stay fast with the pool. The auto-draft's ban list rescanned every champion mastery for every comparison, which with the pool took most of a match day's time. It now builds an index once, and the bans are the same (a test pins the ban order against the old comparator). In a test on a loaded machine, a match day in a new game with the pool was about 20 times faster. Applies to every save; the gain is largest in new games with the pool.
- The Youth tab's weekly report orders a linked club like the league table (a full tie no longer shows "#1 of 10" while the table says 2nd). New games only, where linked clubs exist.
- Team cards and profiles read standings from the league each club plays in, so clubs outside your league no longer show a dash. Applies to every save.
- The end screen and the bar say "Split Complete" and "Start Next Split", with the split name when known, when a split ends in the middle of a season. Before, they said "Season Complete" and "Start Next Season", then opened the next split of the same season. Applies to every save.
- A club's "this season" income and expenses are reset at the end-of-season settlement. Before, they were cleared only by a new career, so the figures added up across seasons. Applies from the next settlement, in every save.

### Removed

- A new game no longer builds the roughly 200 academy copy clubs and their made-up players, or the parallel academy league. Old saves keep their copies.
- The second mail that announced the season prize. The board mail stays, with the amount and your position, and the CFO mail is gone.

### Known issues

- A new game can still list the same person twice. Daglas is Mid at Team Heretics and Jungle at Team Heretics Academy (two records with the same birth date). KUMEW and Chapters, and Cow and Coow, are each one person listed twice as free agents. About 29 reviewed pairs remain in total, these three among them, and they are under review. Legoman and Panda may be one person; that is not proven. None of them changes in this release.
- In a new game, Oscure and Feather are dateless free-agent records of the Barcelona Esports and TT Gaming players. They are hidden from the market and the AI never signs them, but they still exist.
- About a dozen nick-only, dateless free-agent records of live players, such as Lehends, Mihawk and SeTab, are hidden from AI signings (15 in a new game).
- Eclipse (T1 Esports Academy) and Howl (free agent) share the real name Kim Min-jun, with birth dates 6 days apart. They may be one person; it is under review.
- Saves made before this version can still hold duplicate players. Only the stale-club and academy repair under Fixed (saves made with 2026.1113.2 or older) removes players on load, and it leaves some twins: in the owner's save 12 free agents still have a contracted twin after load (a shared real name where a birth date is missing). The AI no longer signs them, nor 30 looser possible twins (nick-only records with no birth date), and the market hides them from you, except Markoon, who still shows. Saves made with 2026.1114.1 load unchanged.
- The old-save repair is one-way. It removes clubs and players, the game keeps no copy, and nothing brings them back. The repaired save is written the next time the game saves. Export the save first if you want to keep the original.
- Three players have no confirmed real birth date yet (Ace, Lurox and Kellie), so their age is an estimate.

## [2026.1114.1] - 2026-11-14

### Changed

- The game data now comes from a fork of the data repository, so a fresh clone with submodules builds. Before, the data commit the repository pointed to was not on any server. This matters only if you build from source.
- 22 more second-tier leagues are playable, so the team picker lists 29 leagues: 6 first-tier and 23 second-tier. Before, only the six top leagues and the Spanish one could be chosen. LCK CL and Prime League are among the new ones. Each new league plays a single round robin sized to its real number of teams (6, 8 or 10), then a four-team best-of-five playoff, with no promotion or relegation between leagues. In 10 simulated seasons every league finished with no error. A new game takes about the same time to build (about 33 ms with 29 leagues against 32 ms with 7). A day takes about 5 ms longer on ordinary days, a whole season about 18% longer (49.5 s against 42.1 s in the timing test), and a save is about 6% larger. New games only: a save keeps the leagues it already has.
- The team picker shows what a new game really starts with: each club's money, reputation and squad size equal the game's. Each card shows the league's full name (for example "LCKCL / LCK Challenger League Series"), and search finds a league by its long name, so "Prime", "Challenger" and "LCK CL" all work. A league's team count is the number of teams it lists.
- Second-tier clubs that shipped with no money or reputation now start with both, worked out from clubs of the same tier. 168 of the 200 second-tier clubs had none. Eight TCL clubs whose budget could not pay their own wages also get a workable budget. Leagues whose players have no real ratings use the typical rating of their own tier: LDL goes from about 73 to about 66 and EEC from 60 to about 66. New games only.
- Every club in a scheduled league now starts with a sponsor sized by its tier: €1.5M a year in the first tier and €950K in the second, paid monthly. Before, no club had one, and the median club of each tier lost money in a measured season: about €1.5M in the first tier and about €0.9M in the second. Now the median first-tier club ends its first season level (-€4K) and the median second-tier club gains about €61K. When a deal ends, the club gets a new 12-month deal for its current tier, so promotion and relegation change it. Random sponsor offers still arrive, but only when they pay more than your current deal; an accepted offer lasts 3 months, then the tier deal comes back. Tier deals send no inbox mail. In an old save, clubs get their sponsor on the next 1st of the month.
- Finishing below 10th place pays €30,000 in prize money. Before, it paid €150,000, more than 7th to 10th place got.
- Attribute gains are bounded. Before, attributes only went up. Over two years of play, the user league's starters rose from an overall of about 80 to 83.7, with discipline at 91.5 (9.9% of starters at 99) and teamfighting at 87.8. Now each gain shrinks as the attribute nears the player's potential, in matches and in training. In the same two years the overall ends at 81.0, discipline at 82.1 and teamfighting at 82.5, with none at 99. In the other leagues, starters at 99 in the attributes that used to pile up went from 5 to 8% to 0 to 0.5%. This applies to every save from now on; it slows gains and does not lower a rating.
- Post-match progression now judges damage as a player's share of the team's damage, compared with what the player's role should deal. Before, it expected real League of Legends damage per minute, and the game's matches produce about 10 against the 560 it expected, so the mechanics bonus never fired. Average ratings stay where they were (for example ADC 7.52 against 7.49).
- Watched matches have fewer kills again: about 21 per match (about 24 before), lasting about 36 minutes (about 37 before). Measured on 3,200 replays of match starts captured from the game. The difference is junglers no longer dying to the recall problems below.
- Jungler deaths per watched match went from about 5.9 to about 3.6 for each jungler in 3,200 replayed matches. A jungler now starts a recall only where no enemy can stop the channel, and otherwise walks toward its own jungle or base first. Stuck recalls fell from 534 to 371, and matches that ran past 50 minutes from 37 to 24, in the same 3,200 matches.
- AI clubs now conclude the renewals they open. Before, they opened renewal sessions and never finished them, so almost every AI starter whose contract ended walked away: of 1,618 AI starters in a two-season replay, 5 were renewed. Now about 222 are (about 14%). An open session renews at the player's expected wage before the contract ends, a player with no match stats is no longer read as playing badly, and the renewal score no longer counts a contract-security term that is close to zero for every player about to expire.
- The Continue menu's skip item now reads "Simulate to next match" ("Simular hasta la próxima partida" in Spanish, and so on in all 8 languages). It always simulated your next match, using your staff's draft, and the old name read as stopping before it. Pressing it once still plays one match.
- Academies are limited to clubs in a first-tier league, and the academy team must come from a second-tier league of the same region (EMEA, Korea, China, North America, Brazil, Latin America or Asia-Pacific). Before, any club could set one up with any of 232 second-tier teams worldwide. The Youth tab now says why a club cannot, in your language, and shows the real region. A custom club that replaces a second-tier club no longer inherits that club's academy; one that replaces a first-tier club still does. Academies you already own stay as they are.
- Player traits use League of Legends names and read in the game's language, with their description as text. Before, they were football terms: "Speedster" is now "Lightning Quick" ("Exceptional mechanics"), and "Tank" is now "Immovable" ("Unshaken under pressure").
- A new game no longer builds clubs that no league plays: 12 lists of historical rosters (the old LCK, LPL, LLA, LCS and similar lists) held 67 clubs that never played, and 20 more clubs came from duplicate copies of LCK CL and Prime League. A new game goes from 557 clubs to 470. The 189 real free agents the historical clubs had hired stay on the market (279 free agents instead of 90), and the 146 filler players generated for them are gone. Saves from older versions keep their historical clubs.

### Added

- Watched match, on the map:
  - the map is the official League of Legends Rift art in full colour, with marks that stay readable on its pale lanes. Before, the lanes were drawn in a flat vector style;
  - each side uses its club's colours and logo on the bar, the player columns, the champions, the beams, the chips, the wards and the minions. When two clubs' colours are too close (less than 30 degrees of hue apart), the game uses a fallback pair. "Blue side" and "Red side" tags and the circle and rounded-square shapes still tell the sides apart, and high contrast hides the colour washes and underlines each side;
  - a lane strip above the map shows which side is pushing each lane and where fights are on;
  - a timer rail shows the dragon or Elder, Voidgrubs, Herald and Baron timers, with a tag for the team that holds a Baron or Elder buff.
- Watched match, around the map:
  - each player card shows an icon chip for the champion's ultimate: ready, waiting with the seconds left, or locked below level 6. The trinket is an icon instead of a letter "W";
  - hovering an item, an empty slot or a cooldown chip with the mouse, or long-pressing it on a touch screen, shows its name;
  - the Fight board is always visible as two strips, one for fights and one for recalls and deaths, with a "+N" when more than fit, and screen readers get the full sentences;
  - on short windows the timer tiles and the feed stay readable, and each feed row is one line.
- Watched match, on small windows: five player cards per side fit with no scroll at 1280x800 and 1366x768 (no column scroll in 156 samples at six sizes), the score bar gives its buff chips their own row under 1205 px wide, the lane name sits over its track in a narrow lane strip, and the footer buttons become icons at 1360 px and below.
- The post-match screen is rebuilt, in the club colours of the two sides:
  - a scoreboard with level, CS, items and spells for each player, the objectives, and the series score with the game count;
  - a gold-difference chart with objective markers, a slider and a table, plus damage and gold bars per player, each with a table alternative. The gold line is the real per-minute gold, and minutes skipped with Skip show as a hatched gap labelled "partial". Before, the gold line was a straight line across a skip;
  - a timeline of kills and objectives that names the clubs;
  - after a Simulate from the tactics stage, the columns the simulator does not produce (level, CS, items, spells, the gold line) are hidden and the graphs say "not recorded", instead of showing 0;
  - the press conference is offered only at the end of a series.
- Export and import saves. "Export" on each save in the saves list writes it to a file through the system file picker, and "Import" in the list header adds a picked save file. Import refuses a file from another game version or a corrupt file with a message and leaves your saves unchanged, and asks before replacing a save with the same id. Use it to move a career between computers with Drive, Syncthing or a cable. The file pickers have not been tried on a real device.
- The champion page shows a card with the champions this one is strong against and the ones that counter it, up to five each, with a rating from 1 to 5 shown as "N/5", from the game's champion data.
- Matches you do not watch now record assists and creep score. Before, every assist and CS in them was 0. CS per minute now matches watched matches (about 5.5 for top and jungle, 6.0 for mid, 4.1 for ADC, 0.4 for support), and assists run about 1.1 per kill (1.08 in watched matches). Matches already stored keep their zeros, which lowers averages built from them. The assists award has winners again (it was empty), AI players' average ratings rose from about 6.2 to 6.8 to about 7.0 to 7.8 when this landed, and AI players at full morale rose from 75% to 93%.
- A notice in Settings says that team names, logos and player photos belong to their owners and that the game is an unofficial fan project, in the 8 languages.
- Screen readers now hear why the "Create club" button is disabled.

### Fixed

- AI clubs treated 1,968 of 3,078 players as having an overall rating of 0 until you first loaded a save, so purchases, sales, wage decisions and renewals ran on bad numbers. The rating is now computed when a new game's world is built and refreshed every day. Before, it went stale in a session: 875 of 1,563 players differed after two seasons.
- A renewal session now ends when the contract it was about changes, so a player who was renewed, released or signed elsewhere can get a new session later. Before, that never happened.
- Jungle and Support progression no longer drains while the game does not measure vision. In one league split, AI junglers' macro play went from -9.9 to +1.6 and supports' from -12.3 to -1.9, and consistency of every role went from -2.4 to +6.2. The champion page hides the vision tile until a value above zero exists, as the player profile already did.
- Duplicate copies of LCK CL and Prime League clubs (20 clubs with 100 players and no league) are no longer built in a new game, and the team picker never offers them. Saves from older versions keep these clubs as they are.
- The game finds its message templates when it is installed, not only when run from the source folder.
- The live feed names the club on every objective line where it said "Blue" or "Red", and it no longer prints a line for an unclaimed Scuttle Crab despawning, which read "Un equipo" in Spanish.
- Turkish no longer dots the capital I in player handles, club names and the title-bar edition. UI words keep their Turkish capitals.
- The league picker's team cards use your language for their labels, such as "Rep:".
- The academy search field is wide enough for its placeholder, and the Home inbox heading wraps instead of being cut.
- When contracts expire, an AI club is no longer limited to one free-agent signing a day to refill its roster, and for each role it signs the strongest free agent it may sign instead of the first one listed. Roles with no free agent available (often Top and Jungle) are still filled with generated players.
- Watched match: the score bar is no longer cut on windows 1540 px wide or more (1920x1080 included). It lost its second row there: the towers, gold and objectives, the "Paused" tag and the Soul chip.
- The board's financial summary mail no longer reads "stable months" when your monthly balance is not negative. It now says the trend is not negative. Mails already in an old save keep the old wording.
- The finance card's monthly sponsor value groups its thousands, like the card's other amounts.

### Removed

- After a series, the post-match screen no longer reopens an earlier game's full result. The Schedule tab still opens the old result screen for past matches.

## [2026.1113.2] - 2026-11-13

### Changed

- The watched match has a new screen. The map is sized from the window, and the page no longer scrolls at 1440x900, 1366x768 or 1280x800, so the map, the five player cards per side and the controls stay in view. Before, the map was 450 px, the kill feed was hidden at 1440x900, and the page scrolled once players had items.
- Watched matches have a few more kills and last about as long as before: about 24 kills per match (about 21 before) and about 37 minutes. Measured on 1,600 replays of match starts captured from the game. The extra kills come from champions now stopping recalls they can reach.
- Numbers with decimals use the decimal mark of the game language: ratings, KDA and per-match averages, win rates, multipliers, money in millions, contract years left and social counts. In Spanish a rating reads "6,1" and not "6.1". Only the mark changes, not the value or the rounding.
- A delegated match of yours is now simulated like the day's other matches. It gets a draft, so its champions and bans count on the champion page and in the stats. Your players gain champion mastery from it, and the draft affects the result. A delegated best-of-three or best-of-five now plays the full series. Before, a single game decided it.
- The post-match screen writes the events of the match in the game language. Before, the engine's English lines were shown.
- A split's trophy now goes to its playoff champion, as in the rest of the game. A split without a decided playoff final still gives it to the team first in the table. Trophies already counted in saves are not recomputed.
- Jungler Heralds go to the lane whose enemy tower has the least health, with the nearest lane as tie-break. Before, a Herald taken by a jungler always pushed the bottom lane. In 1,600 replayed matches, jungler Heralds went top, mid and bottom 238, 672 and 204 times (0, 0 and 794 before), and a Herald was put to use in 1,464 matches instead of 1,143.

### Added

- Watched match, on the map:
  - blue champions are circles and red champions are rounded squares, with level, health, a recall ring that drains and the seconds left to respawn for a dead champion;
  - a champion with a state (recalling, fighting, on an objective) has a tag, and tags no longer cover each other or the map labels (0 overlaps in 546 late-game frames at 1440x900 at x4; before, tags overlapped in about 5% of frames);
  - two fighting champions are joined by a line with a dot on the attacker;
  - a tower shot is a beam with an arrowhead and an "x" count of the shots in the last 3 seconds;
  - the lanes, towers, inhibitors, nexuses, jungle camps, wards and minions are drawn, and the dragon and top pits show their health or their respawn countdown.
- Watched match, around the map:
  - the score bar shows towers, gold, dragons, Voidgrubs, Barons, the Baron and Elder buffs and the soul for each team, with the kills and the clock;
  - each player card shows level, health, KDA, farm, gold, the gold gap against the opposing laner, item names and cooldowns with the seconds left; there is no mana bar, because the game has none;
  - a ticker lists the latest eight kills and objectives, and a caption sums up the main fight in one sentence;
  - the Fight board gives the same information as text, and the map key explains the shapes; both are closed until you open them;
  - the cards can be reached with the keyboard, and a screen reader hears only the newest event.
- Watched match controls: Pause, speeds from x1 to x12, and a Match options menu with Skip and Reset. Each asks before it acts. Skip now plays out the rest of the same match instead of simulating it again from minute 0. The result waits for Continue; before, it moved on by itself after about 0.4 s.
- The bug report button shows during new-career setup, in the footer of the team list so it covers nothing. A report sent without a game leaves the save out, instead of carrying an empty save file.
- The post-match screen has a header row naming the gold, damage and rating columns, and each team's damage is real. Before, it showed a dash.

### Fixed

- Match stats were lost when you loaded a saved game. Loading emptied the player, team and champion stats in memory, and the next save then wrote that empty history over the file. Loading now keeps the history, and every save writes the current one. History already lost in older saves cannot be brought back, because it is no longer in the file.
- The champion page showed a dash for every stat. It now shows real numbers, such as win rate, KDA and averages, from the matches played, and it still shows a dash with a note for a champion nobody has played. If the stats cannot be loaded, the page says so instead of staying silent. The weekly list shows the five most recent weeks of the ten kept; it showed the five oldest.
- "Export world database" in Settings did nothing. It now writes the file to the "exports" folder of the game data folder and shows where it is, or shows the error.
- Champions who met no longer stand on top of each other doing nothing. In 1,600 replayed matches, enemy champions standing within one bubble of each other for 3 seconds or more without a hit went from about 168 per match to about 21 (-88%). Laners now keep a gap while they farm.
- Champions now stop a recall they can reach, and do not dive a tower to do it. A recall that finishes next to an enemy who could have reached it went from about 9.8 per match to about 6.0 (-39%).
- Champions no longer stay "recalling" for minutes without recalling. Such stuck recalls went from about 2.3 to about 0.2 per match. A recaller kept from channeling by an enemy nearby now channels after 10 seconds.
- Pushers no longer freeze near their own base chasing a minion they cannot hit while their team goes for the enemy nexus. Such freezes went from about 0.17 to under 0.01 per match, and the longest went from 163 s to 49 s.
- A team that has taken every tower and sees an enemy nexus a few hits from falling, with no enemy champion at it, now goes straight to it. The final push also waits for teammates who are recalling, instead of going in with fewer players. Matches that stayed open for more than 5 minutes after the last tower went from 11 to 3 in 1,600.
- Unclaimed Voidgrubs no longer go to blue on a tie. In the replays no match reached this case, so it changes nothing measurable.
- Trades now take enemy towers into account. A check compared the structure kind with the wrong text, so the tower never counted. The effect is small: trades started within an enemy tower's reach went from 17.22% to 17.17% of all trades.
- Skip no longer freezes the window for 3 to 4 seconds. While the rest of the match is played, the screen says "Calculating the result" and the controls stay off. If the match cannot be played out, you get an alert with a "Try again" button.
- The saved starting five is seated in the right lanes when the lineup was saved out of lane order. Before, a match built from such a lineup could play a champion in the wrong lane.
- Map tags no longer hide behind a fading copy of another tag, no longer sit under a firing tower's ring, beam or counter, and are sized as drawn, so two nearby tags do not touch. The speed buttons and the Fight board and map key summaries meet the minimum touch size on Android.
- The controls row stays on one line, and the map keeps its height, at 1280x800 and 1366x768. At 1366x768 the map went from 394 px to 442 px and all five player cards per side fit.
- On the post-match screen, a player's gold is the gold earned, not the unspent purse. A player at 11.6k on the live card read 1225 here. The gold chart's labels are 12 px (about 11 before), and the chart uses the same number format as the rows, with the lower-case "k". The MVP score uses earned gold. The German gold column reads "Goldertrag".
- On the post-match screen, kills now show their team in the timeline and count in the momentum chart. Before, the side was read from English text, so kills showed a dash and were not counted.
- The manager's career counts every split. Before, trophies and best finish looked only at the last split of a season, so a title in split 1 followed by a worse split 2 showed neither. Each split is counted once.
- A save made in the middle of a season keeps the career totals it has, and later splits are counted once. Splits finished by a save from before version 2026.1111.2 stay missing from the totals, and the trophies and best finish of splits closed before this version cannot be recovered, because the save does not hold them.
- The profile's champion pool reads "1 partida" for one game and the plural for more, in all languages.
- The profile's contract block writes the expiry date in the game language's format, and the years left with its decimal mark.
- Spanish uses one term for a player's physical condition, "Estado físico", in the Squad column and on the player card.
- The Settings back arrow has a name for screen readers.

### Known issues

- In a watched match, a recall that starts next to an enemy who can reach it still finishes about 6 times per match. The one rule that cut this by 70% broke the balance of gold and player attributes, so it is not included. A few stuck recalls remain, about 0.2 per match: a champion whose route starts behind the champion, and a jungler who flees along the edge of the map.
- Champions who push after a won fight still die to towers more often than they should. When last measured, about 24 deaths in 100 were to towers. This version changes little here.
- Once every tower of a team is down, the match can still take about a minute to end. It no longer drags on for more than 5 minutes in most cases, but the average has not been measured again.
- Vision score and wards are recorded as 0 for every player in every match, so the vision figure on the champion page is always 0. Matches you do not watch (the AI's matches, and now your delegated matches too) also record 0 assists and 0 CS for every player, because they only track kills, deaths, gold and damage. KDA and CS built from those matches are lower than they should be. Watched matches record assists and CS.
- The file written by "Export world database" cannot be imported anywhere in the game yet.

## [2026.1113.1] - 2026-11-13

### Changed

- A day advances about twice as fast. Measured on a Europe league save over 60 days, the median day went from about 2.0 s to about 1.0 s, and a quiet day from about 0.9 s to about 25 ms, because the game no longer copies the whole world for every team each day or searches the full player list for every player.
- Starting a new season and the daily training are faster when the game holds many players. With about 10,000 extra free agents, setting up a season went from about 5.8 s to about 0.5 s, and a quiet day from about 1.6 s to about 0.5 s. With the players the game ships today, setting up a season went from about 0.3 s to about 0.15 s and a quiet day from about 1.1 s to about 70 ms.
- When the draft is skipped, the champions now depend on the teams: each pick weighs the masteries of that team's players, the meta, the counters and the roles still needed, with the same score the AI uses in a manual draft. Before, every match of a patch gave the same ten champions to the same sides.
- A player's training group now counts: a player in a group follows the group's plan in training and in SoloQ, after his own plan and before the team's. Before, the Training page showed the group's plan but the game used the team's.
- The scrim texts say what is true: the fatigue tags point in the right direction, the first week of a new career explains why it is locked, and the weekly notice speaks only about the days still ahead.
- The community panel in the main menu points to the Limón Edition.
- The README starts with how to download and play the Limón Edition, and explains the bug report file and where the game data comes from.
- Every language was reviewed for English left by mistake. Spanish was checked key by key; German, French, Italian, Portuguese, Brazilian Portuguese and Turkish had their leftovers translated, and a test now stops new ones.

### Added

- A player's profile shows a graph of his SoloQ LP over the last 90 days, with the tier, what he did each day and, when decay is on, the days of grace he has left. History is kept for the players you follow: your roster, your academy and the players you scout or shortlist.
- SoloQ decay, an option in Settings, Gameplay: a player who stops playing SoloQ for a while loses LP and wins it back when he returns, as in real life. There are four modes: Off, Soft, Real and Harsh. New careers start on Real; a saved game from an older version opens on Off until you turn it on. Players on a normal plan never lose anything.
- The Scrims tab is laid out as a decision desk. The week is a compact strip; the wide column shows the setup on planning days and the decision on the days after a scrim. Each decision card says what it costs and what it changes, a press confirms it and a line tells you what changed, and today's opponent and risk sit in the day header.
- The odds of the rival teams are shown in the Scrims tab.
- A Home notice says when the week's scrims are still unplanned, and an inbox message tells you when they can be planned.
- In the game, the photo of a player you created in a new club can be changed or removed from his profile.

### Fixed

- The SoloQ history of a day is read against the grace bank of that day, not against today's setting. After a change of mode, old rows no longer read "14 of 7".
- The Training page no longer shows the add-group form in English in other languages, and the Spanish text for energy has its accent.
- The Home notice that the week's scrims are open appears while any day of the week can still be planned, and the line about a scrim decision goes away once the day moves on.
- The "games" and "minutes" units on a champion page, and the days per week in the training schedule, are translated.
- Rerolling the founders of a new club now says that it also discards their photos.
- Spanish scrim review and loss-streak texts are correct, and the plural of the streak reads right.

### Known issues

- In a watched match, enemy champions who meet sometimes do nothing, and a recall that starts next to an enemy is not stopped. This is being fixed.
- Champions who push after a won fight still die to towers more often than they should.
- Once every tower of a team is down, the match takes about a minute to end.

## [2026.1112.2] - 2026-11-12

### Changed

- A watched match now uses the players' attributes. Until now the live match read every player as a 70, because it looked for the attributes under names the game does not use (this came from the original project), so only the champions, the fit of each player with their role and champion, the staff, the scrims and the tactics told two teams apart. Between teams that are otherwise equal, an edge of 5 points in the average of the nine attributes now wins about 59 matches in 100, 10 points about 67, 20 points about 78.
- The live match was rebalanced. Measured by replaying match starts captured from the game, 200 matches each, against the previous version: a match lasts about 36 minutes (it was about 40) with about 21 kills (it was about 26); a team 20 kills ahead no longer loses the match (up to 2 matches in 100 before), and a team 10 kills ahead loses 1 to 3.5 matches in 100 (6 to 15 in 100 before, on the same match starts).
- What you will see in a watched match: after a won fight the winners go together to take a structure instead of walking home; a team defends its nexus where it has the numbers; a team that has taken every tower gathers and goes into the enemy base together instead of one by one; the team with Baron or Elder pushes as a group; Baron and Elder are no longer taken by a single champion; champions no longer stand for a long time under an enemy tower that has no minions to shoot; supports leave the minions to their laner.
- A day now takes one press of Continue, or two on a day with scrims: the morning, then the scrims' result and the decision about them. It took five presses, three of which did nothing. What happens during a day is the same. A saved game that was in one of the removed phases opens in the scrim phase.
- On Linux the game asks at start which graphics mode to use, fast or compatibility, and can remember the answer; the choice is also in Settings. Until now the game always used the compatibility mode, which made it slow, most of all in fullscreen on a large screen.

### Added

- When creating a club, a profile photo can be chosen for each of its new players. It is saved with the game and shown wherever that player appears.
- Effect types for every ability of every champion, as data for a feature that is coming. The match does not use them yet.

### Fixed

- The World, Champions page in the game's language, with champion names ("Aurelion Sol") instead of internal ids.
- In Settings, the chosen option of each group is now also announced to screen readers, not only shown by colour.

## [2026.1111.4] - 2026-11-11

### Changed

- In a live match each champion buys the items professionals build on that champion in that role: boots first, then five items, from 12,921 professional games of the last twelve months (item data of patch 16.22.1). A champion with too few professional games in a role keeps the items of its class, where five items that no longer exist were replaced by current ones. The strength and the cost of a build are the same as before: what changes is which items they are.
- The champion meta of a career starts from the real professional meta (the champions professionals pick most, adjusted by how often they win) instead of a random one. The patch the game generates every two weeks still moves champions up and down, now around their real standing. An existing career keeps its tiers and moves toward the real meta over its next patches. Every role now gets the same share of each tier; before, supports were almost never in the top tier.

### Added

- The item, ward and summoner spell icons of the live scoreboard carry their name, for the pointer and for screen readers.
- A data file that describes what each champion's abilities do, for a feature that is coming. The match does not use it yet.

## [2026.1111.3] - 2026-11-11

### Changed

- A live match now plays the same at every speed button. The engine used a different time step at each speed, so the farm, the gold, the kills and the length of a match depended on how fast it was watched (at x1, a top laner reached about twelve minions per minute and matches ran close to an hour). It now always advances with the step the game is balanced for, and the map blends movement between steps so it stays smooth.
- The live match no longer downloads champion data and icons when it starts. Everything it needs ships with the game (data of patch 16.22.1), so a watched match is the same without an internet connection.
- In the draft the AI no longer puts a champion in a role it does not play, and the player is warned when doing so; a champion off its role plays worse in the match. The items a champion buys follow its class rather than its lane.

### Added

- A notice in Settings and in the README that the project is not endorsed or sponsored by Riot Games.
- Data files with the current item catalogue, the champions' abilities and the builds of professional play, for features that are coming. The match does not use them yet.

### Fixed

- The mid lane was decided by position: the red player reached the first wave first and got ahead in almost every even match.
- Schedule dates and the week heading in the game's language, and numbers grouped the way that language groups them.
- English left in the interface: the champion count, role names in filters and in the missing-role alert, the letters of a win and a loss, the name of a training option.
- A card of the Meta tab drawn over another one.
- The weekly scrim form did not say why it was disabled when only some days had passed.

## [2026.1111.2] - 2026-11-11

### Changed

- A player's season card shows games, wins, losses, KDA, creep score, kills and assists from the matches actually recorded, and each row of the match history names the champion played.
- The manager's career numbers count the running season, and every split of a season reaches the career totals (only the last one did).
- A contract is 1 to 5 years long on every path: renewals and delegated renewals now follow the rule the transfer negotiation already had, and the renewal dialog says so.
- The weekly scrim form says why it is disabled and when it opens again.

### Fixed

- The finances ledger is written in the game's language, and transfer lines name the player instead of printing an id.
- Raw keys instead of text in the Teams list headers and in about a hundred other labels that had no translation; a test now fails when a label is used in code and missing from a language.
- English text in the Spanish interface: the Manager tab, the press conference, the team profile, the league table header, the Meta tab, the match timeline, the scrim report. The same texts are translated in the other languages.
- "View standings" in a result message opens your league's table, and the Home standings panel lists all ten clubs of a ten-club league.
- The league header shows the season and the number of teams and matches.
- A victory message could print the score as "Club:2-1".
- Number formats in the renewal counter-offer and the team profile; a dash instead of 0 where a match recorded no damage; no vision figure where nothing records it; no founding year for clubs that have none.
- Labels that said one thing and showed another: the manager's losses, the "K / D / A" cell that shows objectives, the gold cell that shows damage.
- The settings switches have a name and a role for assistive technology and a larger target.
- A press question about a multi-game series after a single game.
- Spanish texts that addressed the reader as "usted".

## [2026.1111.1] - 2026-11-11

### Added

- "On Air" redesign of the dashboard: an icon rail, a broadcast-style bar with the tabs of the active section under it, a new Home (scoreboard for the next match, a "Needs your call" panel, inbox and standings) and a new Squad view with player cards. The interface takes the colours of the club you manage.
- Accessibility: a high-contrast theme, a visible keyboard focus ring, a larger minimum text size, a skip link and a 24 px minimum size for controls.
- Playable regional leagues at team selection. The LES has a three-split season (Winter, Spring, Summer), each a single round robin followed by a top-four playoff.
- Promotion and relegation between linked leagues (LES and LEC) at the end of the season, with the clubs repriced and the outcome shown in the season summary, the inbox and the news.
- Create your own club in a regional league: a wizard at team selection where you name the club, pick its colours, upload a badge, and either replace an existing club or join the league as an additional one. The club starts with a generated founding squad whose players you can rename, and gets a founding welcome and a news article on day one.
- Leagues with an odd number of clubs: each club has a rest week, shown on the Home scoreboard.
- Player ratings derived from 2025 and 2026 match statistics from Leaguepedia, credited in the about screen.
- Champion counters for the champions that had none.
- Background leagues now play their playoffs and roll over to the next split on their own.
- A notice with the result of your scrims when advancing the day resolves them.
- A confirmation before releasing a staff member, and the reason shown when a club name cannot be used in the club wizard.
- "Limón Edition" in the app titles.

### Changed

- The smallest interface scale on desktop is larger (a 12 px base instead of 9 px).
- The Spanish texts use one register throughout.
- Staff with no attributes in the database get generated attributes and a wage from the staff of the same role and league; an unknown age is hidden instead of shown as 0. Club owners cannot be released or hired and do not count as coaching staff.
- Inbox result headlines are written from the result's point of view and "View standings" opens the competitions view.
- In matches resolved from the draft result, champion synergies and counters count again (the evaluation had been failing silently).

### Fixed

- "Skip to match day" could run past the end of a split, and the clock could keep moving from the end-of-split screen. The clock now stops while the split is over, and the next split always starts with its first matchday in the future.
- For a club outside the first league of the list (any LEC or LES career), a watched league match was labelled a friendly and its champion picks were never recorded; the team list, the manager tab, the team profile, the post-match round results and the scrim context read the wrong league. Every screen now reads the league you play in.
- A watched match could crash on the champion counters catalogue; two console errors around the draft and the end of a watched match.
- The weekly scrim setup locked after the first rival was chosen when the setup window had already closed; the scrim setup blocker no longer fires on a rest week.
- The Home form strip and the inbox headlines could disagree with the standings.
- Staff shown as "0 OVR" and "Age 0"; hiring a staff member with no wage failed.
- Finances: the minus sign of a negative amount, a doubled currency symbol, an English word in a sentence, and the wage table's unit and role labels.
- The scrim objective whose label did not match its effect.
- English texts and raw keys in the Spanish interface (pre-match and post-match screens, staff market, transfer offers, scouting, market, competitions, inbox, urgent messages) and in the other locales.
- The Home panel of pending decisions now updates without pressing Continue; the keyboard focus returns to the field in error in the club wizard.
- Two tests that failed at random.

## [2026.1108.1] - 2026-11-08

### Added

- One-click self-update from the fork's GitHub releases (download, install, relaunch), verified with a fork-owned signing key.
- Local fork release script (`npm run release:fork`) and `docs/RELEASING-FORK.md`.

### Fixed

- The update download progress counted percent as bytes.

## [0.3.1] - 2026-06-26

### Added

- Added GitHub tarball data import, replacing the deprecated OLMDBManager external platform. The game now downloads game data directly from `OpenLeagueManager/olmanager-data` via `codeload.github.com` (no auth, no rate limits). Thanks @aalonsolopez.
- Added bundled game data as an offline fallback. A fresh install works without internet on first run, and the online import provides updates when available. Data is resolved through a 7-tier path chain (dev, bundled resource, imported). Thanks @aalonsolopez.
- Added global image error fallback: any broken player or staff photo is replaced with the default placeholder instead of showing the browser's broken-image icon. Thanks @aalonsolopez.

### Changed

- Moved the `data/` directory to a git submodule pointing to `github.com/OpenLeagueManager/olmanager-data`, decoupling game data versioning from the application codebase. Thanks @aalonsolopez.
- Switched the auto-import pipeline from OLMDBManager ZIP downloads to GitHub tarball extraction using `tar` + `flate2` crates, with 6 passing Rust unit tests. Thanks @aalonsolopez.
- Simplified bundled-resource path resolution: removed the Tauri `_up_` prefix hack in favor of direct `resource_dir/data` paths, fixing Android compatibility without affecting desktop builds. Thanks @aalonsolopez.
- Updated all CI workflows (build, PR, release) to clone submodules automatically via `submodules: true` in 10 checkout steps across 3 pipelines. Thanks @aalonsolopez.
- Separated auto-import and manual-ZIP cache paths to prevent format corruption: auto-import writes to `olmanager_export.tar.gz`, manual ZIP import writes to `olmanager_export.zip`. Thanks @aalonsolopez.

### Fixed

- Fixed player photos showing as broken images in production builds: the asset resolver now checks bundled `resource_dir` paths, making the 2193 committed player photos available without requiring an online import. Thanks @aalonsolopez. (#352)
- Fixed Android builds failing to find game data on fresh installs by using direct `resource_dir/data` paths instead of the Tauri `_up_` prefix, which did not resolve correctly on Android. Thanks @aalonsolopez.
- Fixed economy i18n texts that inherited weekly terminology from the football-era prototype: contract wages now display as annual (`€/yr`, `€/año`, `€/ano`, `€/an`, `€/Jahr`, `€/anno`, `€/yl`), sponsor deals use one-time payments, and the runway indicator correctly shows months in all 8 supported languages. Thanks @aalonsolopez.
- Fixed football-era "training ground" / "campo de entrenamiento" references in sponsor messages, replaced with esports-appropriate "club banners" / "carteles del club" across all languages. Thanks @aalonsolopez.
- Fixed German `weeklyTotal` label incorrectly showing "Wöchentliche Gesamt" instead of "Jährliche Gesamt". Thanks @aalonsolopez.
- Fixed academy acquired inbox message always displaying in Spanish regardless of the active language; the message now uses proper i18n keys with localized text across all 8 supported languages. Thanks @aalonsolopez.
- Fixed missing filter options for player search in multiple languages, restoring the filter UI labels across all supported locales. Thanks @aalonsolopez.
- Fixed generated player names falling back to emergency placeholders in roster generation by using plausible names when the catalog has no direct match. Thanks @aalonsolopez.
- Fixed multi-league system known issues (#306): removed dead standalone playoff generators superseded by the incremental scheduler, hardened competition-ID extraction to handle dashed IDs (e.g. `emea-masters-g2`) via manifest-aware longest-prefix matching, added safe clearing and re-derivation of legacy or unknown competition references during save load and refresh so stale saves do not silently break active-league resolution, and made background-season history recording idempotent to prevent duplicate entries when a competition manifest is missing. Thanks @aalonsolopez.
- Fixed empty or failed competition-manifest scans now preserving saved competition configs and references instead of destructively clearing them, preventing data loss on transient resource or packaging failures. Thanks @aalonsolopez.
- Fixed bot lane path routing in the live simulator so minions and champions no longer cross the closed wall near the dragon pit; the path now correctly routes east of the wall polygon instead of clipping through it diagonally. Thanks @aalonsolopez.
- Fixed stale integration test expectations across the Rust test suite (contract end dates, facility upgrade costs, sponsorship terms, league/schedule fixtures, and module-path references) so the full `cargo test -p olm_core` suite is green for the release. Thanks @aalonsolopez.
- Fixed stale frontend test fixtures for delegated-renewal wage suffixes to expect annual terminology (`/yr`, `/ano`) instead of the removed weekly suffixes. Thanks @aalonsolopez.
- Fixed `Facilities` struct serialization to omit unused optional module levels from save files, producing cleaner output while remaining fully backward-compatible with legacy saves via struct-level serde defaults. Thanks @aalonsolopez.


## [0.3.0] - 2026-06-21

### Added

- Added UI v2 as the only supported interface, replacing the legacy `src/components`, `src/pages` and `App.tsx` entry points with the new `src/ui-v2` shell, dashboard, pages and shadcn primitives. Thanks @NicoRuedaA, @joselaguilarhz and @aalonsolopez.
- Added native v2 dashboard tabs for Home, Squad, Players, Tactics, Training, SoloQ, Scrims, Scouting, Transfers, Market, Staff, Finances, Facilities, Youth, Inbox, Competitions, Teams, Meta and Manager workflows. Thanks @NicoRuedaA and @joselaguilarhz.
- Added keyboard/controller-style navigation across the main menu, league picker, team selection, dashboard sidebar, save list, create-manager form, nationality dropdown, community panel, patch notes and settings tabs. Thanks @NicoRuedaA.
- Added multi-league and multi-competition foundations: competition manifests, active competition routing, background league simulation, academy leagues, region/tier filtering, split tracking and save/load support for all leagues. Thanks @NicoRuedaA.
- Added competition browser views with standings, teams, players and all-competition calendar support. Thanks @NicoRuedaA and @joselaguilarhz.
- Added OLMDBManager-powered data import flows, including native desktop auto-import, manual local `.zip` import, cached re-import, progress reporting and safe staging/rollback. Thanks @joselaguilarhz and @NicoRuedaA.
- Added clickable staff profiles: staff cards now open a dedicated profile view with attributes, role-based gameplay impact, photo, nationality, contract details and hire/release actions. Thanks @joselaguilarhz.
- Added web/server foundations: adapter-based API layer, Supabase auth/profile/save persistence, server-side world assembly, WebSocket live match simulation and command parity groundwork. Thanks @NicoRuedaA and @joselaguilarhz.
- Added Discord Rich Presence integration with OLManager assets and activity states. Thanks @Juan / @TtvNekix.
- Added in-app bug report ZIP export to Desktop. Thanks @NicoRuedaA.
- Added a richer message/inbox system with sender metadata, trigger-based templates, high-density media messages and localized variations. Thanks @NicoRuedaA.
- Added social content foundations: JSON-backed templates, matchup conditions, avatar resolution and league-aware placeholders. Thanks @chasemrs.
- Added AI team-agent systems for roster stability, renewals, sales, purchases, strategic recruitment, free-agent signings and player-agent satisfaction decisions. Thanks @aalonsolopez.
- Added an economy ledger, dynamic simulation hooks, monthly financial processing and finance/facilities v2 UI improvements. Thanks @aalonsolopez and @NicoRuedaA.
- Added deterministic champion systems: initial champion discovery/pools, local champion splash assets, dynamic splash manifests and time-varying meta support. Thanks @NicoRuedaA and @joselaguilarhz.
- Added real SoloQ rank emblem assets and default staff imagery. Thanks @NicoRuedaA.
- Added new release-candidate build workflow for artifact generation. Thanks @aalonsolopez.

### Changed

- UI v2 is now the production UI: the old v1 toggle was removed, legacy code survives only under `src/ui-v2/_legacy` for wrappers that still need it, and `src/main.tsx` renders `AppV2` directly. Thanks @NicoRuedaA and @joselaguilarhz.
- Reworked the main menu into a game-style OLManager experience with champion splash slideshow, community/patch-notes panels, settings tabs, persistent navigation and version display. Thanks @joselaguilarhz.
- Reorganized shared frontend helpers into `src/lib`, including domain-specific modules for common helpers, dashboard, finance, formatting, home, inbox, players, schedule, scouting, scrims, season, social, squad, staff, teams, training and transfers. Thanks @NicoRuedaA and @joselaguilarhz.
- Consolidated core game logic into `olm_core`, unified command dispatch and moved academy, scrim, team-talk, time-blocker and OVR logic behind shared core seams. Thanks @NicoRuedaA.
- Reworked save persistence toward a single-file gzipped JSON format with diagnostics, format-version pruning and safer serialization checks. Thanks @NicoRuedaA.
- Reworked transfer-market behavior for AI teams, contract expiry, signing policy, player swaps, free agents, academy releases and own-club transfer/loan actions. Thanks @aalonsolopez, @NicoRuedaA, @TtvNekix and @mezxR.
- Staff are now shown by their esports nickname (e.g. "Zetz", "ZalFIRE"), falling back to the real name when no nickname is available. Thanks @joselaguilarhz.
- World (MUNDO) sidebar counters now reflect the real competitive world, excluding seeded youth-academy teams and their generated players so the totals match the imported catalog. Thanks @NicoRuedaA.
- Team roster now shows player OVR for every team, not only the user's own team. Thanks @joselaguilarhz.
- Added migration v056 introducing a `nickname` column on the staff table; existing saves are backfilled from the imported catalog on load. Thanks @joselaguilarhz.
- Replaced the financial system's weekly processing model with monthly processing and ledger-backed stabilization. Thanks @NicoRuedaA and @aalonsolopez.
- Updated data/catalog architecture around competition registries, team/player/staff image fields, competition-scoped repositories and OLMDBManager exports. Thanks @NicoRuedaA and @joselaguilarhz.
- Removed the football-era injury availability system and other football-specific dead code. Thanks @aalonsolopez, @NicoRuedaA and @joselaguilarhz.
- Improved the visual design system with zinc/orange v2 tokens, new background atmosphere utilities, page animations, Oswald/Barlow-style heading treatment, progress bars, scrollbars and better player/profile visuals. Thanks @NicoRuedaA and @joselaguilarhz.
- Migrated native v2 hardcoded strings to i18next and refreshed locale files across supported languages. Thanks @aalonsolopez, @NicoRuedaA, @chasemrs and @mezxR.
- Updated active world data, competition manifests, rosters, staff, champion assets and splash lists from current OLMDBManager/catalog sources. Thanks @NicoRuedaA and @joselaguilarhz.

### Fixed

- Fixed production data loading across Tauri installation layouts by resolving resources from executable-relative/resource paths instead of stale development locations. Thanks @NicoRuedaA and @joselaguilarhz.
- Fixed save compatibility and rehydration issues, including missing competition IDs, stale team assignments, missing teams/players, malformed player exports, null data fields and old incompatible saves. Thanks @NicoRuedaA and @joselaguilarhz.
- Fixed season and split progression issues: active league resolution, split summaries, playoff scheduling, first-day scrim setup, skip-to-match-day blockers and season preview filtering now respect the user's competition. Thanks @NicoRuedaA and @chasemrs.
- Fixed board objective scope and map-objective caps so objectives are based on the active league and winnable map totals. Thanks @aalonsolopez.
- Fixed match result mapping for press conferences and canonical score handling after live simulation/runtime winner resolution. Thanks @NicoRuedaA and @aalonsolopez.
- Imported staff now appear correctly inside active games: fixed `wage: null` (and other null fields) dropping entire staff files during parsing, and the active game's staff are now rehydrated from the imported catalog. Thanks @joselaguilarhz.
- The dashboard now refreshes the active game after an import, so newly imported players/teams/staff appear without restarting the app. Thanks @joselaguilarhz and @NicoRuedaA.
- Fixed background competition schedule generation to use `user_competition_id` and executable-relative paths. Thanks @NicoRuedaA.
- Replaced the legacy draft result screen with `DraftResultScreenV2` in match simulation. Thanks @NicoRuedaA.
- Fixed draft and champion UI issues: broken LEC logo fallback, champion splash naming, assistant-coach photos, draft-result crashes, ban icons, champion tile grids and champion-page navigation. Thanks @NicoRuedaA and @joselaguilarhz.
- Fixed condition and stamina behavior so condition affects the match engine and recovery respects post-training fatigue while reducing match stamina depletion. Thanks @joselaguilarhz and @NicoRuedaA.
- Fixed player data and display issues, including date-of-birth parsing, natural positions, null defaults, OVR refresh on load, player photos, real-name/IGN swaps, nationality flags and profile attributes without scout reports. Thanks @NicoRuedaA, @joselaguilarhz and @aalonsolopez.
- Fixed transfer-market table layout, SoloQ tier thresholds, nationality translations, SoloQ badges, action/status column alignment and navigation conflicts in v2 transfer views. Thanks @NicoRuedaA.
- Fixed UI v2 overflow, old-theme remnants and layout issues across match screens, pre-match setup, live match, Schedule, Youth, Staff, Transfers, Champion grid, Tactics and Home lineup cards. Thanks @NicoRuedaA, @joselaguilarhz and @aalonsolopez.
- Fixed inbox/message actions, effect toasts, mood-report translations, event action button translations and removed obsolete international call-up/charity-match content. Thanks @chasemrs.
- Fixed web/server crashes and command gaps around dashboard routing, finance/competitions/training imports, academy persistence, scrim context, stats overview, transfer bids and imported player/photo data. Thanks @NicoRuedaA and @joselaguilarhz.
- Fixed build, package and release-candidate validation blockers, including Rust package checks, current core-model tests, legacy test mocks, v2 color-token expectations and Tauri/Vite localhost issues. Thanks @aalonsolopez and @chasemrs.
- Fixed Android/build configuration issues and desktop window/icon configuration problems. Thanks @chasemrs, @NicoRuedaA and @Juan / @TtvNekix.

### Chores

- Removed the failed web implementation from the desktop release path, the legacy HTTP server crate, unused world IO, stale theme/avatar/profile commands, debug tooling and obsolete `world.json` references. Thanks @NicoRuedaA and @joselaguilarhz.
- Added and maintained Playwright E2E coverage for the main game flow, dashboard loading, tab navigation, advance-time, squad, training, schedule, settings and save/load flows. Thanks @NicoRuedaA.
- Updated documentation for dashboard architecture, inbox/message architecture, data model, web migration planning, UI v2 handoff, release process and data/attribute references. Thanks @NicoRuedaA, @joselaguilarhz and @aalonsolopez.
- Cleaned repository state after merge/rebase conflicts, removed dead files and synchronized generated asset manifests, Cargo lockfiles and locale data. Thanks @NicoRuedaA, @joselaguilarhz and @aalonsolopez.

### Contributors

- Thanks to @NicoRuedaA / Nico Rueda for the UI v2 migration, multi-league architecture, data/model cleanup, desktop release fixes, E2E coverage and many gameplay/UI fixes.
- Thanks to @joselaguilarhz for OLMDBManager import work, menu/web foundations, data import hardening, champion/market-value improvements and many data/UI fixes.
- Thanks to @aalonsolopez for AI team/player-agent systems, economy stabilization, release-candidate validation, localization work and core bug fixes.
- Thanks to @chasemrs for social templates, message/i18n fixes, Android/dev-server fixes and event-content cleanup.
- Thanks to @Juan / @TtvNekix for Discord Rich Presence work and player release/academy re-signing fixes.
- Thanks to @mezxR for transfer-market, negotiation and localization contributions.
- Thanks to @drumst0ck (Jose Sánchez) for expanded esports media commentary variants.

## [0.2.1] - 2026-05-13

### Added

- Added profile image URL support to player data and related frontend components.
- Added SoloQ rank and staff impact localisation strings across supported languages.

### Changed

- Improved transfer handling in squad flows, including roster destination behaviour and related transfer tests.
- Improved player role resolution so active lineup role data and natural position are handled consistently across live match, dashboard, squad and training views.

## [0.2.0] - 2026-05-07

### Added

- Added Turkish localisation and improved Turkish translations across the game. Thanks @aalonsolopez and Shammminggg on Discord. (#76, #202, #203)
- Added in-app auto-updater flow with Tauri updater integration, frontend updater UI, translations, signed bundles and `latest.json` support. Thanks @108M and @aalonsolopez. (#91, #153)
- Added the Champions/Meta system: champion catalog, champion pages, persistence, progression, stats, role distribution and stat cards. Thanks @NicoRuedaA. (#121, #192)
- Added Scrims and Social V1, including scrim planning, social posts, registry/templates, editor UI and dashboard/training integration. Thanks @chasemrs. (#160, #206)
- Added assistant-coach delegated training. Thanks @almuoluupv / @mezxR. (#136)
- Added x8 and x12 match simulation speed options. Thanks @almuoluupv / @mezxR. (#139)
- Added UI/UX quality-of-life improvements across player profiles, scouting, transfers, finances, academy, dashboard search, logos, photos, role icons and sortable tables. Thanks @NicoRuedaA. (#121, #124)
- Added Rust → TypeScript type generation foundations with `ts-rs`, plus validation groundwork with Rust `validator` and TypeScript Zod schemas. Thanks @NicoRuedaA. (#121)
- Added security hardening around CSP, Tauri capabilities, path traversal protection and safer game DB access patterns. Thanks @NicoRuedaA. (#121)

### Changed

- Completed a major football-to-League-of-Legends migration across domain, database, engine and frontend:
  - `Position` replaced with `LolRole`
  - football match events removed from the engine
  - goals renamed/replaced with LoL score/kills terminology
  - stadium fields renamed to arena fields
  - set-piece concepts replaced with `TeamRoles`
  - football-specific fields such as `football_nation` removed from active models and data  
  Thanks @NicoRuedaA and @aalonsolopez. (#65, #68, #69, #70, #72, #75, #80, #83, #121, #122, #123, #124, #151, #156, #159, #201, #207)
- Reworked the match engine from legacy football simulation toward LoL-native simulation concepts. Thanks @NicoRuedaA and @aalonsolopez. (#123, #124, #207)
- Replaced “Starting XI” terminology and UI with LoL lineup language and five-role lineup expectations. Thanks @aalonsolopez. (#151, #201)
- Unified OVR calculation across Squad, Tactics and Engine views, and renamed player attributes to visible LoL stat names. Thanks @NicoRuedaA. (#194)
- Replaced OpenFoot branding/menu assets and removed remaining football terminology from locale files. Thanks @aalonsolopez. (#158, #159)
- Updated README, roadmap, architecture docs and ADRs to reflect the LoL migration and technical direction. Thanks @NicoRuedaA and @aalonsolopez. (#121)

### Fixed

- Fixed first-year friendly scheduling getting locked. Thanks @aalonsolopez. (#187)
- Fixed player age calculation so ages are based on the in-game date. Thanks @aalonsolopez. (#189)
- Fixed database team upsert crashes and positional row mapping issues. Thanks @NicoRuedaA. (#191)
- Fixed missing scrim columns and related migration/index issues. Thanks @NicoRuedaA and @chasemrs. (#160, #192, #206)
- Fixed scouting of own players so own-team scouting can return perfect-accuracy reports, plus scouting UI overlap. Thanks @108M. (#205)
- Fixed draft champion count issues and progression requiring the five LoL roles. Thanks @almuoluupv / @mezxR and @aalonsolopez. (#132, #157)
- Fixed placeholder coach naming from a football manager reference to a LoL-appropriate placeholder. Thanks @almuoluupv / @mezxR. (#134)
- Fixed updater release metadata by publishing signed latest manifests and adding updater public-key configuration. Thanks @aalonsolopez. (#153)
- Fixed old-save and migration compatibility issues around champion data, profile images, role casing, corrupted locale JSON and DB schema evolution. Thanks @NicoRuedaA. (#121, #122, #124)
- Fixed Dashboard crash caused by conditional hooks and several ChampionPage/ChampionsWorld navigation issues. Thanks @NicoRuedaA. (#121, #124)
- Fixed Rust test compilation and DB runtime test expectations after the migration work. Thanks @aalonsolopez. (#196, #198)

### Chores

- Renamed backend crate from `openfootmanager_lib` to `olmanager_lib`. Thanks @NicoRuedaA. (#65)
- Removed dead frontend/backend code and renamed legacy identity files away from football-specific naming. Thanks @NicoRuedaA. (#66, #73)
- Enabled/expanded Rust checks, clippy validation and CI security/audit gates. Thanks @NicoRuedaA. (#67, #71, #121)
- Cleaned active seed data and locales to remove football remnants. Thanks @aalonsolopez. (#156, #159)

### Contributors

- Thanks to @keremozmeen (Kerem Özmen) for the LoL-native engine attribute/rating work that was manually ported in #207 from #204.
- Thanks to Shammminggg on Discord for the Turkish translation corrections captured in #202 and shipped via #203.

## [0.1.2] - 2026-04-30

### Added

- Added ScheduleCalendarView to display selected scrims with opponent name and logo when a scrim opponent is configured.
- Added realistic board objectives based on team strength: objectives are now generated based on the roster's average skill compared to the rest of the league, not static reputation thresholds.
- Added end-of-season board objective review message with objectives completed count and satisfaction delta.
- Added visible gold advantage chart with proper LoL-style formatting (blue advantage rises, red advantage falls) and chronological timeline plotting.
- Added i18n keys for board objective review messages (`be.msg.boardObjectiveReview.subject`, `be.msg.boardObjectiveReview.body`).
- Added roster destination selection for new signings: users can now choose to assign a new signing to either the Main Team or the Academy squad.
- Added updated world data with recalibrated player statistics and market costs.

### Changed

- Restyled the post-match gold advantage chart with improved visuals: gradient line, side-colored segments (blue above center, orange below center), final advantage summary, and peak display.
- Adapted tournament and schedule standings tables to LoL format: removed "drawn" column and "points", replaced goals with "Maps" (e.g., "12-4") and "Map Diff" (e.g., "+8", "-3").
- Changed series objective calculation to use roster skill comparison: strong teams get title-contender objectives, mid-table teams get playoff objectives, weak teams get survival objectives.
- NeutralTimersState now uses typed fallbacks instead of empty objects to satisfy TypeScript requirements.
- Refactored world data loading: the system now reads world data exclusively from `lec_world.json`.
- Improved Draft AI logic: refined pick selection to prevent nonsensical choices and ensure bans do not target roles already picked.

### Fixed

- Fixed Bo3/Bo5 series completion: the series now correctly detects when a team reaches the required wins (2 for Bo3, 3 for Bo5) and ends appropriately.
- Fixed Bo3 one-map finalization bug: added a hard invariant requiring both reaching target wins AND having enough played maps to support that score.
- Fixed stale series advance button label: after a Bo3/Bo5 completes, the button now shows "Continue" instead of a stale "Game 2/3" label.
- Fixed final series scoreboard reset: the 2-1 or 3-x final score now persists and displays correctly after series completion instead of resetting to 0-0.
- Fixed press conference availability: press conference is now correctly gated to only appear for single games or completed series, not for in-progress Bo3/Bo5.
- Fixed NeutralTimersState TypeScript error: added typed fallback helpers (`createEmptyNeutralTimersState`, `createDefaultObjectivesState`) to satisfy type requirements.
- Fixed missing handleStartGame function that prevented creating a new career after finishing a previous one.
- Fixed board objective end-of-season feedback: objectives now trigger a visible inbox message with results and satisfaction changes.
- Fixed football/soccer terminology in initial season objectives email: replaced football terms (matches, goals, top half) with LoL/esports terms (split, series, maps, LEC table).
- Fixed gold advantage chart trajectory: the chart now correctly plots blue advantage going up, red advantage going down, and crossing the centerline appropriately.
- Fixed standings table format: converted from soccer-style (drawn, goals for/against, points) to LoL-style (played, won, lost, maps, map difference) in both TournamentsTab and ScheduleTab.
- Fixed position swapping during the draft phase: players can now correctly change positions and roles.

### Contributors

- Thanks to @drumst0ck (Jose Sánchez) for the NeutralTimersState TypeScript fix, amd the help in changing some content in the events of the game to use real media!
- Thanks to @nicoruedaa (Nico Rueda) for all the changes to QoL in UI related to transfers, player list and team icons.
- Thanks to @rcfarah for the help in PT_BR translations.


## [0.1.1] - 2026-04-28

### Added

- Added quality-of-life improvements to champion draft, including faster draft skipping, better role ordering, and champion sorting/filtering by meta and mastery.
- Added spectator/delegated match flow improvements so AI-controlled drafts and simulations can progress more smoothly through series games.

### Changed

- Improved match simulation and draft-result handling for series play, including safer handling of persisted draft results between games.
- Improved translations and UI labels across player, squad, champions, academy, and localized text.
- Removed duplicated draft players and the unavailable Omon free-agent entry from draft data.

### Fixed

- Fixed season-end progression issues and added coverage for end-of-season behavior.
- Fixed repeated press-conference questions by rotating recent questions and selecting a more varied question set.
- Fixed transfer messages to display match names instead of full names.
- Fixed the continue menu dropdown overlapping other UI elements.
- Disabled the native browser context menu in the Tauri app so the desktop experience behaves consistently.
- Fixed multiple transfer, potential, live-match, and match-simulation edge cases.

### Contributors

- Thanks to @drumst0ck (Jose Sánchez) for the transfer-message, continue-menu z-index, and Tauri context-menu fixes.

### Notes

- Release artifacts remain source-first; signing, notarization, and binary packaging policy are still not finalized.

## [0.1.0]

### Added

- Live Game simulation
- Customizable draft
- Player trading
- Installation management
- Functional Academy
- Training plans
- Scouting
- FULLY PLAYABLE (maybe not for long plays, but playable)
- Post-Game Press Conference
- Champion Mastery
- Live Patch/Meta changes
- Repository governance docs, issue templates, PR template, and non-production CI workflow for public OSS preparation.
- Provenance guidance separating GPL-inherited code/assets from third-party datasets and generated caches.
- Inherited documentation audit checklist for deciding which original-repository docs to keep, update, move to legacy, or remove before public OSS release.

### Notes

- Release artifacts are source-first until maintainers decide signing, notarization, and binary packaging policy.
