// TB-Software: Headless E2E-Service-Runner fuer TB-Goose.
//
// Startet ein eigenes `goose serve` (headless, plain ws, localhost) gegen ein kontrolliertes
// Config-Verzeichnis, verbindet sich als ACP-Client (wie die Desktop-UI und die Wolke-Bridge),
// faehrt eine Testfall-Datei durch (Prompt rein, Antwort/Tool-Aufrufe/Dateien pruefen) und meldet
// bestanden/durchgefallen. Kein UI, kein manuelles Klicken, von der Shell steuerbar.
//
// Lage bewusst UNTER ui/desktop/, damit die ACP-SDK-Bare-Imports aufloesen:
//   @agentclientprotocol/sdk      -> ui/node_modules
//   @aaif/goose-acp-client        -> ui/desktop/node_modules/@aaif (Workspace-Link)
//
// Aufruf (portable Node 24):
//   node tools/tb-e2e/run-cases.mjs --cases tools/tb-e2e/cases/smoke.json
// Optionen: --model auto:code | --config min|real | --goose <exe> | --keep (Config behalten)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { createWebSocketStream } from '@agentclientprotocol/sdk/experimental/ws-client';
import { client, methods, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import {
  GOOSE_EXT_AGENT_REQUESTS,
  GOOSE_EXT_NOTIFICATIONS,
  GooseExtClient,
  zGooseSessionNotification_unstable,
  zProviderDeviceCodeNotification_unstable,
  zRequestRecipeParams_unstable,
  DEFAULT_GOOSE_MCP_HOST_CAPABILITIES,
} from '@aaif/goose-acp-client';

// Nachbildung von src/acp/gooseAcpClient.ts (connectGooseAcpClient ist ein lokaler Wrapper der App).
function connectGooseAcpClient(stream, callbacks) {
  const [gooseSessionUpdate, providerDeviceCode] = GOOSE_EXT_NOTIFICATIONS;
  const [gooseRecipeParamsRequest] = GOOSE_EXT_AGENT_REQUESTS;
  const app = client({ name: 'goose' })
    .onRequest(methods.client.session.requestPermission, (ctx) => callbacks.requestPermission(ctx.params))
    .onNotification(methods.client.session.update, (ctx) => callbacks.sessionUpdate(ctx.params))
    .onRequest(methods.client.elicitation.create, (ctx) => callbacks.unstable_createElicitation(ctx.params))
    .onRequest(gooseRecipeParamsRequest.method, zRequestRecipeParams_unstable, (ctx) => callbacks.unstable_sessionRecipeRequestParams(ctx.params))
    .onNotification(gooseSessionUpdate.method, zGooseSessionNotification_unstable, (ctx) => callbacks.unstable_sessionUpdate(ctx.params))
    .onNotification(providerDeviceCode.method, zProviderDeviceCodeNotification_unstable, (ctx) => callbacks.unstable_providerDeviceCode(ctx.params));
  const connection = app.connect(stream);
  const goose = new GooseExtClient(connection.agent);
  return { connection, goose };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_DIR = path.resolve(__dirname, '..', '..'); // ui/desktop

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < process.argv.length && !process.argv[i + 1].startsWith('--')) return process.argv[i + 1];
  return process.argv.includes(`--${name}`) ? true : def;
}

function findGooseExe() {
  const given = arg('goose', null);
  if (typeof given === 'string') return given;
  const cands = [
    path.join(DESKTOP_DIR, 'out-deploy', 'TB-Goose-win32-x64', 'resources', 'bin', 'goose.exe'),
    path.join(DESKTOP_DIR, 'src', 'bin', 'goose.exe'),
  ];
  for (const c of cands) if (fs.existsSync(c)) return c;
  throw new Error('goose.exe nicht gefunden: ' + cands.join(', '));
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms, label) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`Zeitueberschreitung: ${label}`)), ms))]);

// Kontrolliertes Config-Verzeichnis aufbauen. 'min' = nur developer-Extension (schneller, stabil,
// kein lenax-db-Selbstladen); 'real' = die echte Nutzer-Config (volle Extensions).
function buildConfigRoot(mode, seedHints) {
  const realCfgDir = path.join(process.env.APPDATA || '', 'Block', 'goose', 'config');
  if (mode === 'real') {
    return { root: process.env.APPDATA, cfgDir: realCfgDir, temp: false };
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tbgoose-e2e-'));
  const cfgDir = path.join(root, 'Block', 'goose', 'config');
  fs.mkdirSync(cfgDir, { recursive: true });
  // Proxy-/Provider-Keys aus der echten Config uebernehmen, Extensions auf developer reduzieren.
  const realCfgFile = path.join(realCfgDir, 'config.yaml');
  const parsed = fs.existsSync(realCfgFile) ? YAML.parse(fs.readFileSync(realCfgFile, 'utf8')) || {} : {};
  parsed.extensions = {
    developer: { enabled: true, type: 'platform', name: 'developer', display_name: 'Developer', bundled: true },
  };
  parsed.GOOSE_MODE = parsed.GOOSE_MODE || 'auto';
  fs.writeFileSync(path.join(cfgDir, 'config.yaml'), YAML.stringify(parsed));
  if (seedHints) fs.writeFileSync(path.join(cfgDir, '.goosehints'), seedHints);
  return { root, cfgDir, temp: true };
}

async function startServe(gooseExe, appDataRoot) {
  const port = await freePort();
  const secret = `e2e-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const args = ['serve', '--platform', 'desktop', '--enable-scheduler', '--host', '127.0.0.1', '--port', String(port)];
  const env = {
    ...process.env,
    APPDATA: appDataRoot,
    GOOSE_SERVER__SECRET_KEY: secret,
    Path: path.dirname(gooseExe) + path.delimiter + (process.env.Path || ''),
  };
  const child = spawn(gooseExe, args, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const stderr = [];
  child.stderr.on('data', (d) => stderr.push(d.toString()));
  // Auf /status warten (max 30s).
  const statusUrl = `http://127.0.0.1:${port}/status`;
  const deadline = Date.now() + 30000;
  let ready = false;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 1000);
      const res = await fetch(statusUrl, { signal: ctl.signal });
      clearTimeout(t);
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {
      /* noch nicht bereit */
    }
    await sleep(150);
  }
  if (!ready) {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
    throw new Error(`goose serve nicht bereit auf ${statusUrl}. stderr:\n${stderr.join('').slice(-1500)}`);
  }
  const acpUrl = `ws://127.0.0.1:${port}/acp?token=${secret}`;
  const kill = () => {
    try {
      if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/f', '/t']);
      else child.kill('SIGKILL');
    } catch {
      /* ignore */
    }
  };
  return { acpUrl, kill, stderr };
}

async function connectAcp(acpUrl, cwd) {
  const stream = createWebSocketStream(acpUrl, { protocols: [] });
  const chunkSinks = new Map();
  const toolSinks = new Map();
  const callbacks = {
    sessionUpdate: (params) => {
      const sid = params?.sessionId;
      const u = params?.update;
      if (!sid || !u) return;
      if (u.sessionUpdate === 'agent_message_chunk' && u.content?.type === 'text') {
        chunkSinks.get(sid)?.(u.content.text ?? '');
      }
      if (u.sessionUpdate === 'tool_call' || u.sessionUpdate === 'tool_call_update') {
        const name = u.title || u.toolCallId || u.kind || 'tool';
        toolSinks.get(sid)?.(String(name));
      }
    },
    unstable_sessionUpdate: () => {},
    requestPermission: async () => ({ outcome: { outcome: 'selected', optionId: 'allow_always' } }),
    unstable_createElicitation: async () => ({ outcome: 'cancelled' }),
    unstable_sessionRecipeRequestParams: async () => ({}),
    unstable_providerDeviceCode: () => {},
  };
  const client = connectGooseAcpClient(stream, callbacks);
  // Setup mit Timeout, damit der Runner bei haengendem ACP/Extension (z. B. --config real mit lenax-db)
  // nicht unbegrenzt blockiert, sondern sauber als Infrastruktur-Fehler abbricht.
  await withTimeout(
    client.connection.agent.request(methods.agent.initialize, {
      protocolVersion: PROTOCOL_VERSION,
      _meta: { 'goose/useLoginShellPath': true },
      clientCapabilities: {
        elicitation: { form: {} },
        _meta: { goose: { mcpHostCapabilities: DEFAULT_GOOSE_MCP_HOST_CAPABILITIES, customNotifications: true } },
      },
      clientInfo: { name: 'tb-e2e', version: '1.0.0' },
    }),
    30000,
    'initialize'
  );
  const res = await withTimeout(
    client.connection.agent.request(methods.agent.session.new, { cwd, mcpServers: [] }),
    60000,
    'session.new'
  );
  const sid = res.sessionId;
  let appliedModel = null;
  async function setModel(model) {
    if (!model || appliedModel === model) return;
    try {
      await client.connection.agent.request(methods.agent.session.setConfigOption, { sessionId: sid, configId: 'model', value: model });
      appliedModel = model;
    } catch {
      /* Session-Default nutzen */
    }
  }
  async function runTurn(text, timeoutMs) {
    let acc = '';
    const tools = [];
    chunkSinks.set(sid, (t) => (acc += t));
    toolSinks.set(sid, (n) => tools.push(n));
    const started = Date.now();
    try {
      const prompt = client.connection.agent.request(methods.agent.session.prompt, { sessionId: sid, prompt: [{ type: 'text', text }] });
      const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('Zeitueberschreitung')), timeoutMs));
      await Promise.race([prompt, timeout]);
      return { text: acc, tools, ms: Date.now() - started, timedOut: false };
    } catch (e) {
      return { text: acc, tools, ms: Date.now() - started, timedOut: String(e).includes('Zeitueberschreitung'), error: String(e) };
    } finally {
      chunkSinks.delete(sid);
      toolSinks.delete(sid);
    }
  }
  const close = () => {
    try {
      client.connection.close();
    } catch {
      /* ignore */
    }
  };
  return { setModel, runTurn, close };
}

function checkExpect(expect, result, workdir) {
  const problems = [];
  const text = result.text || '';
  const sub = (s) => String(s).replaceAll('<tmp>', workdir);
  if (expect.regex && !new RegExp(expect.regex, expect.regexFlags || 'i').test(text)) problems.push(`regex /${expect.regex}/ nicht gefunden`);
  for (const c of [].concat(expect.contains || [])) if (!text.includes(c)) problems.push(`enthaelt nicht: ${JSON.stringify(c)}`);
  for (const c of [].concat(expect.notContains || [])) if (text.includes(c)) problems.push(`enthaelt faelschlich: ${JSON.stringify(c)}`);
  for (const t of [].concat(expect.toolUsed || [])) if (!result.tools.some((x) => x.toLowerCase().includes(String(t).toLowerCase()))) problems.push(`Tool nicht benutzt: ${t} (benutzt: ${result.tools.join(', ') || 'keine'})`);
  for (const f of [].concat(expect.fileExists || [])) if (!fs.existsSync(sub(f))) problems.push(`Datei fehlt: ${sub(f)}`);
  if (expect.fileContains) {
    const fc = expect.fileContains;
    if (!fc || typeof fc !== 'object' || !fc.path || !fc.text) {
      problems.push('fileContains braucht { path, text }');
    } else {
      const f = sub(fc.path);
      const got = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
      if (!got.includes(fc.text)) problems.push(`Datei ${f} enthaelt nicht ${JSON.stringify(fc.text)}`);
    }
  }
  if (typeof expect.maxMs === 'number' && result.ms > expect.maxMs) problems.push(`zu langsam: ${result.ms}ms > ${expect.maxMs}ms`);
  if (result.timedOut) problems.push('Zeitueberschreitung');
  return problems;
}

async function main() {
  const casesFile = arg('cases', path.join(__dirname, 'cases', 'smoke.json'));
  const configMode = arg('config', 'min');
  const spec = JSON.parse(fs.readFileSync(casesFile, 'utf8'));
  const model = arg('model', spec.model || 'auto:code');
  const gooseExe = findGooseExe();

  const { root, cfgDir, temp } = buildConfigRoot(configMode, spec.seedHints);
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'tbgoose-work-'));
  console.log(`[tb-e2e] goose=${gooseExe}`);
  console.log(`[tb-e2e] config=${configMode} (${cfgDir})`);
  console.log(`[tb-e2e] model=${model} · workdir=${workdir}`);

  let serve, acp;
  const results = [];
  try {
    serve = await startServe(gooseExe, root);
    console.log('[tb-e2e] goose serve bereit, verbinde ACP …');
    acp = await connectAcp(serve.acpUrl, workdir);
    await acp.setModel(model);
    for (const c of spec.cases) {
      const timeoutMs = c.timeoutMs || 90000;
      process.stdout.write(`[tb-e2e] Fall ${c.id} … `);
      const prompt = String(c.prompt).replaceAll('<tmp>', workdir);
      const r = await acp.runTurn(prompt, timeoutMs);
      const problems = checkExpect(c.expect || {}, r, workdir);
      const ok = problems.length === 0;
      const optional = !!c.optional; // optionale Faelle (z. B. nicht-deterministische Modell-Befolgung)
      results.push({ id: c.id, ok, optional, ms: r.ms, problems, tools: r.tools });
      const tag = optional ? (ok ? 'PASS (optional)' : 'FAIL (optional, zaehlt nicht)') : ok ? 'PASS' : 'FAIL';
      console.log(`${tag} (${r.ms}ms)` + (ok ? '' : `: ${problems.join('; ')}`));
    }
  } finally {
    try {
      acp?.close();
    } catch {
      /* ignore */
    }
    serve?.kill();
    if (temp && !arg('keep', false)) {
      try {
        fs.rmSync(root, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
    try {
      fs.rmSync(workdir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }

  const required = results.filter((r) => !r.optional);
  const reqPassed = required.filter((r) => r.ok).length;
  const optional = results.filter((r) => r.optional);
  const optPassed = optional.filter((r) => r.ok).length;
  console.log(`\n[tb-e2e] Harte Faelle: ${reqPassed}/${required.length} bestanden.` + (optional.length ? ` Optional: ${optPassed}/${optional.length}.` : ''));
  process.exit(reqPassed === required.length ? 0 : 1);
}

main().catch((e) => {
  console.error('[tb-e2e] FEHLER:', e && e.message ? e.message : e);
  process.exit(2);
});
