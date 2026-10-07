#requires -Version 5.1
<#
  tb-canvio.ps1 - Canvio-Konverter ueber den zentralen Online-Weg (Linkwerk-Queue).

  Ein Aufruf = senden UND empfangen (blockiert bis fertig). Intern async:
    1) Datei zu Linkwerk hochladen (files.ashx)
    2) Job in conversion_jobs anlegen (database.ashx, tier=iis)
    3) Job pollen bis status=done|failed (der Konverter auf SCMSERVICES01 zieht ihn)
    4) Ergebnis aus result_url holen

  Nutzung:
    powershell -NoProfile -File tb-canvio.ps1 extract <datei>
        -> extrahierter Klartext/Markdown auf stdout (Dokument fuer das LLM lesbar machen)
    powershell -NoProfile -File tb-canvio.ps1 convert <datei> <zielformat> [ausgabepfad]
        -> konvertierte Datei; Pfad auf stdout

  Bei Fehlschlag: Klartext-Grund auf stderr + Exit-Code 1 (dem Nutzer melden,
  dass/weshalb etwas NICHT konvertiert/gelesen werden konnte).

  Konfiguration (Env, optional):
    CANVIO_LINKWERK_BASE  (Default https://t78.ch/linkwerk/api)
    CANVIO_LINKWERK_KEY   (Default Canvio2026_Live)
    CANVIO_TIMEOUT_SEC    (Default 3600 - Konvertierungen koennen Minuten/Stunden dauern)
    CANVIO_POLL_SEC       (Default 5)
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0)][ValidateSet('extract', 'convert')][string]$Command,
  [Parameter(Mandatory = $true, Position = 1)][string]$Path,
  [Parameter(Position = 2)][string]$Target,
  [Parameter(Position = 3)][string]$Out
)

$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

$Base = ($env:CANVIO_LINKWERK_BASE); if (-not $Base) { $Base = 'https://t78.ch/linkwerk/api' }
$Base = $Base.TrimEnd('/')
$Key = ($env:CANVIO_LINKWERK_KEY); if (-not $Key) { $Key = 'Canvio2026_Live' }
$TimeoutMs = 1000 * ([int]($env:CANVIO_TIMEOUT_SEC)); if ($TimeoutMs -le 0) { $TimeoutMs = 3600 * 1000 }
$PollMs = 1000 * ([int]($env:CANVIO_POLL_SEC)); if ($PollMs -le 0) { $PollMs = 5000 }

function Info($msg) { [Console]::Error.WriteLine("[tb-canvio] $msg") }
function Die($msg) { [Console]::Error.WriteLine("[tb-canvio] FEHLER: $msg"); exit 1 }

if (-not (Test-Path -LiteralPath $Path)) { Die "Datei nicht gefunden: $Path" }
$srcName = [IO.Path]::GetFileName($Path)
$srcFormat = ([IO.Path]::GetExtension($Path)).TrimStart('.').ToLowerInvariant()
if (-not $srcFormat) { Die "Quelldatei hat keine Endung (Format nicht bestimmbar): $Path" }

Add-Type -AssemblyName System.Net.Http | Out-Null

# EIN gemeinsamer HttpClient fuer alle Aufrufe (konsistenter X-API-Key-Header, Verbindungs-Reuse).
$Client = [System.Net.Http.HttpClient]::new()
$Client.Timeout = [TimeSpan]::FromMinutes(10)
$Client.DefaultRequestHeaders.Add('X-API-Key', $Key)

function Invoke-GetString {
  param([string]$url, [int]$retries = 4)
  for ($i = 0; $i -le $retries; $i++) {
    try {
      $resp = $Client.GetAsync($url).GetAwaiter().GetResult()
      $body = $resp.Content.ReadAsStringAsync().GetAwaiter().GetResult()
      if (-not $resp.IsSuccessStatusCode) { throw "HTTP $([int]$resp.StatusCode): $body" }
      return $body
    } catch {
      if ($i -eq $retries) { throw }
      Start-Sleep -Milliseconds 1500
    }
  }
}

function Invoke-GetBytes {
  param([string]$url, [int]$retries = 4)
  for ($i = 0; $i -le $retries; $i++) {
    try {
      $resp = $Client.GetAsync($url).GetAwaiter().GetResult()
      if (-not $resp.IsSuccessStatusCode) {
        $t = $resp.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        throw "HTTP $([int]$resp.StatusCode): $t"
      }
      return $resp.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
    } catch {
      if ($i -eq $retries) { throw }
      Start-Sleep -Milliseconds 1500
    }
  }
}

function Invoke-PostJson {
  param([string]$url, [string]$json)
  $content = [System.Net.Http.StringContent]::new($json, [Text.Encoding]::UTF8, 'application/json')
  $resp = $Client.PostAsync($url, $content).GetAwaiter().GetResult()
  $body = $resp.Content.ReadAsStringAsync().GetAwaiter().GetResult()
  if (-not $resp.IsSuccessStatusCode) { throw "HTTP $([int]$resp.StatusCode): $body" }
  return $body
}

function Upload-Input {
  param([string]$filePath, [string]$fileName)
  $fs = [IO.File]::OpenRead($filePath)
  try {
    $form = [System.Net.Http.MultipartFormDataContent]::new()
    $sc = [System.Net.Http.StreamContent]::new($fs)
    $sc.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::new('application/octet-stream')
    $form.Add($sc, 'file', $fileName)
    $resp = $Client.PostAsync("$Base/files.ashx", $form).GetAwaiter().GetResult()
    $body = $resp.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    if (-not $resp.IsSuccessStatusCode) { Die "Upload HTTP $([int]$resp.StatusCode): $body" }
  } finally { $fs.Dispose() }
  $json = $null
  try { $json = $body | ConvertFrom-Json } catch { Die "Upload: keine JSON-Antwort: $($body.Substring(0,[Math]::Min(200,$body.Length)))" }
  if ($json.success -eq $false) { Die "Upload abgelehnt: $body" }
  $data = if ($json.data) { $json.data } else { $json }
  if (-not $data.id) { Die "Upload lieferte keine id: $body" }
  $outName = if ($data.originalName) { $data.originalName } else { $fileName }
  [pscustomobject]@{ fileId = $data.id; name = $outName }
}

function New-Job {
  param([string]$fileId, [string]$name, [string]$targetFormat)
  $id = [guid]::NewGuid().ToString()
  $data = @{
    id                 = $id
    org_id             = 'org_canvio_system'
    user_id            = 'user_superadmin_canvio'
    tier               = 'iis'
    status             = 'pending'
    progress           = 0
    created_at         = (Get-Date).ToUniversalTime().ToString('o')
    source_file_url    = "/api/files/$fileId/$name"
    source_file_name   = $name
    source_format      = $srcFormat
    target_format      = $targetFormat
    generate_thumbnail = $false
  }
  $payload = @{ table = 'conversion_jobs'; id = $id; data = $data } | ConvertTo-Json -Depth 6
  $body = Invoke-PostJson -url "$Base/database.ashx" -json $payload
  try { $r = $body | ConvertFrom-Json } catch { $r = $null }
  if ($r -and $r.success -eq $false) { Die "Job-Anlage abgelehnt: $body" }
  return $id
}

function Wait-Job {
  param([string]$id)
  $t0 = Get-Date
  $last = ''
  while ($true) {
    $body = Invoke-GetString -url "$Base/database.ashx?table=conversion_jobs&id=$id"
    $d = ($body | ConvertFrom-Json).data
    $key = "$($d.status):$($d.progress)"
    if ($key -ne $last) { Info "Status $($d.status) ($($d.progress)%) nach $([int]((Get-Date) - $t0).TotalSeconds)s"; $last = $key }
    if ($d.status -eq 'done') { return $d }
    if ($d.status -eq 'failed' -or $d.status -eq 'cancelled') {
      $reason = if ($d.error) { $d.error } elseif ($d.error_message) { $d.error_message } else { 'unbekannt' }
      Die "Konvertierung fehlgeschlagen ($($d.status)): $reason"
    }
    if (((Get-Date) - $t0).TotalMilliseconds -gt $TimeoutMs) { Die "Timeout nach $([int]($TimeoutMs/1000))s (Job noch $($d.status))" }
    Start-Sleep -Milliseconds $PollMs
  }
}

function Get-ResultFileId {
  param($job)
  if ($job.output_file_id) { return $job.output_file_id }
  $ru = if ($job.result_url) { $job.result_url } elseif ($job.result_file_url) { $job.result_file_url } else { '' }
  $m = [regex]::Match([string]$ru, '/api/files/([^/]+)')
  if ($m.Success) { return $m.Groups[1].Value }
  Die "Kein Ergebnis-Dateiverweis im fertigen Job."
}

if ($Command -eq 'extract') {
  Info "Extrahiere Text aus '$srcName' (ueber Online-Konverter) ..."
  $up = Upload-Input -filePath $Path -fileName $srcName
  $jobId = New-Job -fileId $up.fileId -name $up.name -targetFormat 'txt'
  $job = Wait-Job -id $jobId
  $bytes = Invoke-GetBytes -url "$Base/files.ashx?id=$(Get-ResultFileId $job)&download=1"
  [Console]::Out.Write([Text.Encoding]::UTF8.GetString($bytes))
  exit 0
}

if ($Command -eq 'convert') {
  if (-not $Target) { Die "Zielformat fehlt: tb-canvio convert <datei> <zielformat> [ausgabepfad]" }
  $Target = $Target.ToLowerInvariant()
  Info "Konvertiere '$srcName' -> $Target (ueber Online-Konverter) ..."
  $up = Upload-Input -filePath $Path -fileName $srcName
  $jobId = New-Job -fileId $up.fileId -name $up.name -targetFormat $Target
  $job = Wait-Job -id $jobId
  if (-not $Out) { $Out = Join-Path (Get-Location).Path ("{0}.{1}" -f [IO.Path]::GetFileNameWithoutExtension($Path), $Target) }
  $bytes = Invoke-GetBytes -url "$Base/files.ashx?id=$(Get-ResultFileId $job)&download=1"
  [IO.File]::WriteAllBytes($Out, $bytes)
  Info "Ergebnis: $Out ($($bytes.Length) Bytes)"
  [Console]::Out.WriteLine($Out)
  exit 0
}
