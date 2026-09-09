# TB-Vorschau-Panel (`src/tb/preview/`)

Rechtes Vorschau-Panel für angeklickte Datei-Links. SRP-getrennt:

| Datei | Verantwortung |
|---|---|
| `previewKind.ts` | Endung → Vorschau-Typ (rein, ohne Seiteneffekt) |
| `PreviewContext.tsx` | Auswahl-Zustand (welche Datei), `open`/`close` |
| `PreviewPanel.tsx` | Layout + je-Typ-Renderer; liest Datei über `window.electron.tbReadFile` |
| `PreviewPanel.test.tsx` | Render-Pipeline (Text/Bild/Fallback), 3/3 grün |

Datenzugriff (SRP getrennt vom Rendering): IPC `tb-read-file` in `main.ts`
(Text=utf8, Binär=base64, 40-MB-Cap), Brücke `tbReadFile` in `preload.ts`.

Einbindung: `AppLayout.tsx` umschliesst mit `PreviewProvider` und rendert
`<PreviewPanel/>` als rechtes Flex-Geschwister; `MarkdownContent.tsx` öffnet bei
Klick auf einen lokalen Datei-Link das Panel (vorschaubarer Typ) bzw. den
Explorer (sonst). Wegen `webSecurity: true` kein `file://` — daher IPC + data-URL
/ iframe-`srcdoc`.

**Bewusste Grenze:** Video/grosse Binärdateien laufen aktuell über base64-data-URL
(Speicher). Für grosse Medien wäre ein Streaming-Protokoll (`protocol.handle`)
der nächste Schritt.
