# TB-Goose E2E-Service-Runner (headless)

Treibt TB-Goose **ohne UI** und ohne manuelles Klicken: startet ein eigenes `goose serve`
(genau der Laufzeit-Pfad der App), verbindet sich als ACP-Client und faehrt eine Testfall-Datei
durch. Fuer wiederholbare E2E-Tests, von der Shell oder vom Agenten steuerbar.

## Warum headless statt UI-Fernsteuerung
Die alte CDP-Harness (`modules/client_desktop_goose/tools/e2e/`) tippt in das echte Fenster und
wartet feste Zeiten, ohne Zusicherungen. Dieser Runner spricht stattdessen dieselbe ACP-Schnittstelle
wie die Desktop-UI und die Wolke-Bridge: Prompt rein, Antwort/Tool-Aufrufe/Dateien pruefen,
bestanden/durchgefallen melden. Stabil, zusicherbar, kein Fenster noetig.

## Start (portable Node 24)
```
cd vendor/goose-src/ui/desktop
<node24> tools/tb-e2e/run-cases.mjs --cases tools/tb-e2e/cases/smoke.json
```
Die Lage unter `ui/desktop/` ist noetig, damit die ACP-SDK-Imports aufloesen
(`@agentclientprotocol/sdk` aus `ui/node_modules`, `@aaif/goose-acp-client` aus dem Workspace-Link).

## Optionen
- `--cases <datei>`   Testfall-Datei (Standard: `cases/smoke.json`).
- `--model <name>`    LLM (Standard aus der Datei oder `auto:code`).
- `--config min|real` `min` (Standard) = Temp-Config mit nur der developer-Extension (schnell,
  stabil, kein lenax-db-Selbstladen). `real` = die echte Nutzer-Config (volle Extensions).
- `--goose <exe>`     Pfad zu goose.exe (Standard: `out-deploy/.../resources/bin/goose.exe`, sonst
  `src/bin/goose.exe`).
- `--keep`            Temp-Config nach dem Lauf behalten (zur Fehlersuche).

## Testfall-Format
```json
{
  "model": "auto:code",
  "seedHints": "optionaler .goosehints-Inhalt (z. B. ein Qualitaets-Block)",
  "cases": [
    {
      "id": "kurzname",
      "prompt": "Aufgabe an den Agenten; <tmp> wird durch das Arbeitsverzeichnis ersetzt.",
      "timeoutMs": 90000,
      "expect": {
        "regex": "OK",
        "contains": ["Text"],
        "notContains": ["Fehler"],
        "toolUsed": ["developer"],
        "fileExists": "<tmp>/x.txt",
        "fileContains": { "path": "<tmp>/x.txt", "text": "HALLO" },
        "maxMs": 60000
      }
    }
  ]
}
```
Jede Zusicherung ist optional; alle muessen erfuellt sein, damit der Fall besteht. Mit
`"optional": true` wird ein Fall gelaufen und berichtet, zaehlt aber NICHT zum Exit-Code (fuer
nicht-deterministische Modell-Befolgung, z. B. ob das Modell eine Stil-Regel aus den Hints einhaelt).
Exit-Code 0 = alle harten Faelle bestanden, 1 = mindestens ein harter Fall durchgefallen,
2 = Infrastruktur-Fehler.

Hinweis Nichtdeterminismus: Deterministische Faelle (Datei erstellen, Rechnen, Tool-Nutzung,
Faktenantwort) eignen sich als harter Gate. Ob das Modell eine Stil-/Verhaltensregel aus den Hints
genau befolgt, schwankt (v. a. auto:code) und gehoert als `optional` in die Suite.

## Qualitaetsregler testen
Mit `seedHints` (oder `--config real`, sofern die Stufe ueber den Regler gesetzt wurde) laesst sich
pruefen, ob der Agent die Qualitaets-Direktiven befolgt (z. B. Rollen-Pruefung, lenax-db-Nutzung).
Hinweis: Laeufe gegen das echte Modell sind nicht voll deterministisch; Zusicherungen robust fassen.
