import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

export const DEV_URL = 'http://127.0.0.1:5174';

export function createChildSpecs(projectRoot) {
  return [
    {
      label: 'SERVER',
      args: ['--watch-path=server/node', '--watch-preserve-output', 'server/node/server.cjs'],
    },
    {
      label: 'WEB',
      args: [`${projectRoot}/node_modules/vite/bin/vite.js`, '--host', '127.0.0.1'],
    },
  ];
}

export function isRestartKey(key) {
  return key?.name === 'r' && !key.ctrl && !key.meta;
}

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(scriptPath), '..');
const children = new Set();
let browserOpened = false;
let restarting = false;
let shuttingDown = false;
let readinessGeneration = 0;

function log(message) {
  console.log(`\n[LAUNCHER] ${message}`);
}

function startChild({ label, args }) {
  const child = spawn(process.execPath, args, {
    cwd: projectRoot,
    stdio: ['ignore', 'inherit', 'inherit'],
    windowsHide: false,
  });

  children.add(child);
  child.on('error', (error) => {
    console.error(`[${label}] 실행 실패: ${error.message}`);
  });
  child.on('exit', (code, signal) => {
    children.delete(child);
    if (!restarting && !shuttingDown) {
      log(`${label}가 종료되었습니다 (code=${code ?? '-'}, signal=${signal ?? '-'}). R 키로 다시 시작할 수 있습니다.`);
    }
  });

  return child;
}

async function waitForWeb(generation) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (generation !== readinessGeneration || shuttingDown) return;
    try {
      await fetch(DEV_URL, { signal: AbortSignal.timeout(1000) });
      if (generation !== readinessGeneration || browserOpened) return;
      browserOpened = true;
      spawn('rundll32.exe', ['url.dll,FileProtocolHandler', DEV_URL], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      }).unref();
      log(`브라우저를 열었습니다: ${DEV_URL}`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  if (generation === readinessGeneration && !shuttingDown) {
    log(`웹 서버 준비를 확인하지 못했습니다. 로그를 확인한 뒤 R 키를 눌러 주세요.`);
  }
}

function startAll() {
  readinessGeneration += 1;
  const generation = readinessGeneration;
  for (const spec of createChildSpecs(projectRoot)) startChild(spec);
  void waitForWeb(generation);
}

function waitForExit(child, timeoutMs = 5000) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, timeoutMs);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function stopChild(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;

  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.once('error', resolve);
      killer.once('exit', resolve);
    });
  } else {
    child.kill('SIGTERM');
  }

  await waitForExit(child);
}

async function stopAll() {
  readinessGeneration += 1;
  const running = [...children];
  await Promise.all(running.map(stopChild));
  children.clear();
}

async function restartAll() {
  if (restarting || shuttingDown) return;
  restarting = true;
  log('프런트엔드와 서버를 다시 시작합니다...');
  await stopAll();
  restarting = false;
  startAll();
}

function restoreTerminal() {
  if (process.stdin.isTTY && process.stdin.isRaw) process.stdin.setRawMode(false);
  process.stdin.pause();
}

async function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  log('프런트엔드와 서버를 종료합니다...');
  await stopAll();
  restoreTerminal();
  process.exit(exitCode);
}

function isMainModule() {
  if (!process.argv[1]) return false;
  const entryPath = path.resolve(process.argv[1]);
  return process.platform === 'win32'
    ? entryPath.toLowerCase() === scriptPath.toLowerCase()
    : entryPath === scriptPath;
}

function run() {
  const viteEntry = createChildSpecs(projectRoot)[1].args[0];
  if (!existsSync(viteEntry)) {
    console.error('[LAUNCHER] 개발 의존성이 없습니다. 먼저 저장소에서 pnpm install을 실행해 주세요.');
    process.exitCode = 1;
    return;
  }

  console.log('RisuBard Dev');
  console.log(`- 웹: ${DEV_URL}`);
  console.log('- API: http://127.0.0.1:7777');
  console.log('- R: 모두 재시작 / Ctrl+C: 모두 종료');

  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('keypress', (_text, key) => {
      if (key?.ctrl && key.name === 'c') void shutdown();
      else if (isRestartKey(key)) void restartAll();
    });
  }

  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
  startAll();
}

if (isMainModule()) run();
