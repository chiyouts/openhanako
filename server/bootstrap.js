import path from "path";
import { pathToFileURL } from "url";
import { Worker } from "worker_threads";

function log(line) {
  try {
    process.stdout.write(`${line}\n`);
  } catch {}
}

function logError(line) {
  try {
    process.stderr.write(`${line}\n`);
  } catch {}
}

const hanaRoot = process.env.HANA_ROOT || import.meta.dirname;
const serverEntry = process.env.HANA_SERVER_ENTRY || path.join(hanaRoot, "bundle", "index.js");

log(`[server-bootstrap] process started pid=${process.pid} platform=${process.platform} arch=${process.arch}`);
log(`[server-bootstrap] node=${process.version} hanaHome=${process.env.HANA_HOME || "unset"}`);
log(`[server-bootstrap] root=${hanaRoot}`);
log(`[server-bootstrap] entry=${serverEntry}`);

const importStartedAt = Date.now();
const importTimer = setInterval(() => {
  const elapsedSec = Math.round((Date.now() - importStartedAt) / 1000);
  log(`[server-bootstrap] server entry import still pending after ${elapsedSec}s`);
}, 15000);
importTimer.unref?.();

// Independent keepalive thread.
//
// 主线程被 native module 加载（better-sqlite3 等）或重型 import 阻塞时，
// 上面的 setInterval 不会 fire，Electron 因 progress grace 用尽误判启动失败
// (#719 / #736 根因)。Worker 跑在独立 V8 isolate，不受主线程 event loop
// 影响，stdout 直连父进程 pipe，能持续输出"我还活着"信号。
let keepaliveWorker = null;
try {
  keepaliveWorker = new Worker(
    "setInterval(() => { try { process.stdout.write('[server-bootstrap] keepalive\\n'); } catch {} }, 5000);",
    { eval: true },
  );
  keepaliveWorker.on("error", (err) => {
    logError(`[server-bootstrap] keepalive worker error: ${err?.message || err}`);
  });
} catch (err) {
  logError(`[server-bootstrap] failed to start keepalive worker: ${err?.message || err}`);
}

try {
  log("[server-bootstrap] importing server entry");
  await import(pathToFileURL(serverEntry).href);
  log("[server-bootstrap] server entry import completed");
} catch (err) {
  logError(`[server-bootstrap] failed to import server entry: ${err?.stack || err?.message || String(err)}`);
  process.exitCode = 1;
  throw err;
} finally {
  clearInterval(importTimer);
  if (keepaliveWorker) {
    keepaliveWorker.terminate().catch(() => {});
  }
}
