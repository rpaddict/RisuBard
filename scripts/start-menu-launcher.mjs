import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverUrl = 'http://127.0.0.1:7777';
const developmentUrl = 'http://127.0.0.1:5174';
// Written by scripts/dev-launcher.mjs so the normal launcher can end a development session.
export const developmentPidPath = path.join(os.tmpdir(), 'risubard-dev-launcher.pid');
const { isBuildRequired } = createRequire(import.meta.url)('../server/node/server-build-cache.cjs');

async function isReady(url, development) {
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(2000) });
  } catch (error) {
    if (error.cause?.code === 'ECONNREFUSED') return false;
    throw new Error(`${url} 응답을 확인할 수 없습니다.`, { cause: error });
  }
  const html = await response.text();
  if (!response.ok || !html.includes('<title>RisuBard</title>') || html.includes('/@vite/client') !== development) {
    throw new Error(`${url} 포트에서 다른 서비스가 실행 중입니다.`);
  }
  return true;
}

export async function ensureService(url, development, start, timeoutMs = 90000) {
  if (await isReady(url, development)) return;
  const child = start();
  let spawnError;
  child.once?.('error', error => { spawnError = error; });
  const deadline = Date.now() + timeoutMs;
  // `start` hands the server to its own window and exits at once, so its exit says nothing
  // about the server; only the server's answer counts.
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    if (await isReady(url, development)) return;
    await delay(500);
  }
  throw new Error(`${url} 시작 시간이 초과되었습니다. 리스바드 서버 창의 오류 메시지를 확인하세요.`);
}

export function builtVersion(root = projectRoot) {
  try {
    return readFileSync(path.join(root, 'dist', 'index.html'), 'utf8').match(/data-startup-version[^>]*>v([^<]+)</)?.[1] ?? null;
  } catch { return null; }
}

// The normal server runs the screen compiled at launch. Rebuild when the version moved
// or any screen source is newer than the last build, so a fresh launch matches development.
export function needsBuild(root = projectRoot, buildRequired = isBuildRequired) {
  const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  return builtVersion(root) !== version || buildRequired(root);
}

function ensureCurrentBuild() {
  if (!needsBuild()) return;
  console.log('최신 개발 내역으로 화면을 컴파일합니다. 1~2분 걸릴 수 있습니다.');
  // Only warnings and errors are shown; the per-file size list is noise here.
  const result = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--sourcemap', '--logLevel', 'warn'], { cwd: projectRoot, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('빌드 실패. 위 로그를 확인하세요.');
  console.log('컴파일을 마쳤습니다.');
}

// Asks the hidden server to flush pending data and exit (see /api/local-shutdown).
async function stopServer() {
  let token;
  try { token = readFileSync(path.join(os.tmpdir(), 'risubard-shutdown-7777.token'), 'utf8').trim(); } catch {}
  if (!await isReady(serverUrl, false)) return console.log('실행 중인 리스바드 서버가 없습니다.');
  if (!token) throw new Error('종료 토큰이 없습니다. 이 기능이 없는 이전 서버이므로 한 번은 직접 종료하세요.');
  const response = await fetch(`${serverUrl}/api/local-shutdown`, { method: 'POST', headers: { 'x-risubard-shutdown-token': token } });
  if (!response.ok) throw new Error(`서버가 종료 요청을 거부했습니다 (${response.status}).`);
  const deadline = Date.now() + 60000;
  while (await isReady(serverUrl, false)) {
    if (Date.now() > deadline) throw new Error('저장 마무리가 끝나지 않아 종료 대기 시간이 초과되었습니다.');
    await delay(500);
  }
  console.log('리스바드 서버를 종료했습니다.');
}

// Each server gets its own console window so its log stays visible. Closing the window
// stops it after flushing saves; the window stays open if it exits on an error.
function startWindow(title, command, env = {}) {
  return spawn('cmd.exe', ['/d', '/c', `start "${title}" /d "${projectRoot}" cmd /d /c "${command} & if errorlevel 1 pause"`], {
    cwd: projectRoot,
    env: { ...process.env, PORT: '7777', OPEN_BROWSER: '0', RISU_DEV_SERVER_TARGET: serverUrl, ...env },
    windowsVerbatimArguments: true,
    windowsHide: true,
    stdio: 'ignore',
  });
}

const startServerWindow = () => startWindow('리스바드 일반서버', `"${process.execPath}" server\\node\\server.cjs`, { RISUBARD_CONSOLE_TITLE: '리스바드 일반서버' });
// dev-launcher.mjs runs the server from source (restarted on server changes) and Vite.
const startDevelopmentWindow = () => startWindow('리스바드 개발서버', `"${process.execPath}" scripts\\dev-launcher.mjs`);

const quietReady = (url, development) => isReady(url, development).catch(() => false);

// Development and normal servers share the data folder, so only one may run.
// The server saves and exits first; then the development supervisor (and Vite) stops.
async function stopDevelopment() {
  if (await quietReady(serverUrl, false)) await stopServer();
  let pid = 0;
  try { pid = Number(readFileSync(developmentPidPath, 'utf8').trim()); } catch {}
  if (pid > 0) spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  const deadline = Date.now() + 20000;
  while (await quietReady(developmentUrl, true)) {
    if (Date.now() > deadline) throw new Error('개발 서버를 끄지 못했습니다. "리스바드 개발서버" 창을 직접 닫은 뒤 다시 실행해 주세요.');
    await delay(500);
  }
  rmSync(developmentPidPath, { force: true });
}

async function openBrowser(url) {
  if (process.argv.includes('--no-open')) return;
  await new Promise((resolve, reject) => {
    const opener = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { windowsHide: true, stdio: 'ignore' });
    opener.once('error', reject);
    opener.once('exit', code => code === 0 ? resolve() : reject(new Error(`브라우저 열기 실패 (${code})`)));
  });
}

async function main() {
  const mode = process.argv[2];
  if (mode === 'stop') {
    if (await quietReady(developmentUrl, true)) return stopDevelopment();
    return stopServer();
  }
  if (!['normal', 'development'].includes(mode)) throw new Error('실행 모드는 normal, development 또는 stop이어야 합니다.');
  if (mode === 'development') {
    if (await quietReady(developmentUrl, true)) {
      console.log(`리스바드 개발: ${developmentUrl}`);
      return openBrowser(developmentUrl);
    }
    if (await quietReady(serverUrl, false)) {
      console.log('일반 서버를 저장 마무리 후 종료하고 개발 서버로 바꿉니다.');
      await stopServer();
    }
    // dev-launcher.mjs opens the browser itself once Vite answers.
    await ensureService(developmentUrl, true, startDevelopmentWindow, 180000);
    return console.log(`리스바드 개발: ${developmentUrl}`);
  }
  if (await quietReady(developmentUrl, true)) {
    console.log('개발 서버를 저장 마무리 후 종료하고 일반 서버로 바꿉니다.');
    await stopDevelopment();
  }
  // A running normal server keeps the screen it was compiled with until it is closed.
  if (!await quietReady(serverUrl, false)) {
    ensureCurrentBuild();
    await ensureService(serverUrl, false, startServerWindow);
  }
  console.log(`리스바드 일반: ${serverUrl}`);
  await openBrowser(serverUrl);
}

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
