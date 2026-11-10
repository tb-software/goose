# TB-Goose: Modellliste ergaenzen und fremde Endpunkte verbinden

Stand 10.11.2026 (ab TB-Goose 1.53.61). Alle Einstellungen pro Rechner in
`%APPDATA%\Block\goose\config\config.yaml`. Im Modell-Popup oeffnet der Button
"Eigene Modelle hinzufuegen: config.yaml im Explorer zeigen" genau diese Datei.

## Woher die Modellliste kommt

Das kuratierte Dropdown wird LIVE aus dem Proxy `/v1/models` gebaut (nur die `auto:*`-Tags) und
laesst sich ueber zwei optionale `config.yaml`-Bloecke ergaenzen bzw. reduzieren. Kein XML/JSON,
sondern die YAML-`config.yaml`, die goose ohnehin liest. Zusammenfuehrung mit Dedup; wird bei jedem
Oeffnen des Pickers frisch gelesen (kein Neustart fuer Listenaenderungen).

### `tb_extra_models` - eigene Modelle ins Dropdown

```yaml
tb_extra_models:
  - name: qwen3.8-27b-tbs          # exakte Modell-ID, wie der Tenant sie bedient
    alias: "Qwen3.8 27B"
    subtext: "Konkret, ueber t78.ch"
    context_limit: 131072
  - name: auto:chat                # vorhandenes Live-Tag nur umbenennen
    alias: "Auto: Chat (schnell)"
  - name: deepseek-v4-flash        # Modell eines EIGENEN Providers (siehe tb_providers)
    alias: "DeepSeek Flash"
    provider: custom_deepseek
```

- Gleiche ID wie ein Live-Tag => nur Umbenennung, kein Duplikat.
- Ohne `provider` laeuft das Modell ueber den Standard-Provider (t78/gericom). Mit `provider`
  ueber einen eigenen Endpunkt (siehe unten).

### `tb_hide_models` - Live-Tags ausblenden

```yaml
tb_hide_models:
  - auto:vision
  - auto:image
```

Reduziert die Liste z. B. auf `auto:code` / `auto:chat` / `auto:fast`.

## Fremde openai-kompatible Endpunkte (`tb_providers`)

goose unterstuetzt eigene Provider NATIV ueber Dateien in
`%APPDATA%\Block\goose\config\custom_providers\<id>.json` (Rust:
`crates/goose/src/config/declarative_providers.rs`). TB-Goose erzeugt diese Dateien automatisch aus
einem benutzerfreundlichen `config.yaml`-Block und hinterlegt Keys in
`%APPDATA%\Block\goose\config\secrets.yaml` (Windows-Keyring ist aus).

```yaml
tb_providers:
  - id: deepseek                       # -> Provider "custom_deepseek", Secret CUSTOM_DEEPSEEK_API_KEY
    name: DeepSeek
    base_url: https://api.deepseek.com/v1
    api_key: <DEIN_DEEPSEEK_KEY>       # weglassen, wenn der Endpunkt keinen Key braucht
    models:
      - deepseek-v4-flash
      - { name: deepseek-v4-pro, context_limit: 131072 }
```

- Die Modelle erscheinen in der Modellauswahl unter "anderen Anbieter verwenden". Mit einem
  `tb_extra_models`-Eintrag inkl. `provider:` lassen sie sich zusaetzlich in die kuratierte Liste
  heben.
- `base_url` endet auf `/v1` (openai-kompatibel). Braucht der Endpunkt Pflicht-Header (z. B. ein
  TB-Proxy-Tenant die Client-Identity), lassen die sich pro Provider setzen - bei Bedarf die
  erzeugte JSON um `"headers": { ... }` erweitern.
- Zerstoerungsfrei: TB-Goose schreibt nur `custom_<slug>.json`; per UI angelegte Provider bleiben
  unberuehrt. `tb_providers` ist die Quelle der Wahrheit und wird beim Start gespiegelt.

## Lokal verifiziert (10.11.2026)

- **Mechanik end-to-end bestaetigt:** `goose.exe run` mit einem Custom-Provider
  (`custom_providers/custom_gtest.json`, Engine openai, eigener `base_url`+`headers`+Key aus
  `secrets.yaml`) lieferte eine gueltige Antwort. Session-Zeile: `custom_gtest auto:chat`.
- **DeepSeek** war zum Testzeitpunkt an keinem erreichbaren Endpunkt bedienbar:
  `api.deepseek.com` ohne Key => 401; der Tenant-Node (schott) => 503 "No node online";
  lokales LM Studio (127.0.0.1:1234) aus. DeepSeek antwortet, sobald ein gueltiger Key gesetzt
  bzw. ein Node online ist - die Verdrahtung ueber `tb_providers` ist fertig.

## Wichtig

- Pro Rechner nur Modelle eintragen, die der dortige Tenant/Endpunkt wirklich bedient; sonst bricht
  das Senden mit HTTP 400 `model_not_available` ab (goose wiederholt 4xx NICHT; eine evtl. Wartezeit
  entsteht serverseitig bei der Node-Suche).
- Keys gehoeren in die lokale `config.yaml`/`secrets.yaml`, NICHT ins Repository.
