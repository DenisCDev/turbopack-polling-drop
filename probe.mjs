// Boots a fresh `next dev` per session, edits one module N times in a row, and
// records whether each edit is reflected by the server.
//
// POLL_MS>0 sets `watchOptions.pollIntervalMs` (notify's PollWatcher);
// POLL_MS=0 leaves the platform's native watcher in place, as a control.
//
// Each session's dev server output is kept in probe-logs/session-N.log — it
// contains `watch error` lines that are relevant to any watching bug.
import { spawn, execFileSync } from 'node:child_process'
import { writeFileSync, rmSync, statSync, mkdirSync, createWriteStream } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url))
const MOD = join(ROOT, 'lib', 'mod.ts')
const PORT = Number(process.env.PORT ?? 3210)
const URL_ = `http://127.0.0.1:${PORT}/`
const POLL_MS = Number(process.env.POLL_MS ?? 1000)
const SESSIONS = Number(process.env.SESSIONS ?? 5)
const EDITS = Number(process.env.EDITS ?? 5)
// generous on purpose: a detected edit lands within about one poll interval, so
// a miss at this window is a loss and not slowness
const WINDOW_MS = Number(process.env.WINDOW_MS ?? 8000)
// Idle time inserted BETWEEN edits, on top of the previous edit's detection
// latency — not the resulting spacing, which the detection latency dominates.
const GAP_MS = Number(process.env.GAP_MS ?? 0)

const IS_WINDOWS = process.platform === 'win32'
const LOGS = join(ROOT, 'probe-logs')
const out = (s) => process.stdout.write(s + '\n')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function startServer(session) {
  const child = spawn(
    process.execPath,
    [join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next'), 'dev', '--port', String(PORT)],
    {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, POLL_MS: String(POLL_MS) },
      // POSIX: own process group so the whole tree can be signalled.
      // Windows has no process groups; taskkill /T handles the tree there.
      detached: !IS_WINDOWS,
    }
  )
  const log = createWriteStream(join(LOGS, `session-${session}.log`))
  child.stdout.pipe(log)
  child.stderr.pipe(log)
  return child
}

function stopServer(child) {
  try {
    if (IS_WINDOWS) {
      execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      process.kill(-child.pid, 'SIGKILL')
    }
  } catch { // smaug-ignore empty-catch: the kill only fails when the tree has already exited, which is the desired end state
    return
  }
}

async function body() {
  const res = await fetch(URL_)
  return res.text()
}

async function waitReady(timeoutMs = 240_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      if ((await body()).includes('value:')) return
    } catch { // smaug-ignore empty-catch: connection refused is the expected state until the dev server binds the port
      void 0
    }
    await sleep(250)
  }
  throw new Error('dev server never became ready')
}

// Writes `value` and returns { ms, mtimeChanged }. ms is null if the served page
// never showed the new value. mtimeChanged answers the first objection any
// maintainer will raise: that the write never landed on disk.
async function editAndWait(value) {
  const before = statSync(MOD).mtimeMs
  const marker = `value: ${value}`
  const started = Date.now()
  writeFileSync(MOD, `export const value = ${value}\n`)
  const mtimeChanged = statSync(MOD).mtimeMs !== before
  const deadline = started + WINDOW_MS
  while (Date.now() < deadline) {
    try {
      if ((await body()).includes(marker)) return { ms: Date.now() - started, mtimeChanged }
    } catch { // smaug-ignore empty-catch: the dev server drops in-flight connections while rebuilding, by design
      void 0
    }
    await sleep(5)
  }
  return { ms: null, mtimeChanged }
}

rmSync(LOGS, { recursive: true, force: true })
mkdirSync(LOGS, { recursive: true })

out(
  `${process.platform}/${process.arch} | node ${process.versions.node} | ` +
    `watcher=${POLL_MS > 0 ? `polling ${POLL_MS}ms` : 'native'} | ` +
    `${SESSIONS} sessions x ${EDITS} edits | idle gap ${GAP_MS}ms | window ${WINDOW_MS}ms`
)
out('')

const matrix = []
let value = 1000
let mtimeOk = 0
let writes = 0
for (let s = 1; s <= SESSIONS; s++) {
  // retries: on Windows a handle can outlive taskkill briefly, and force:true
  // only covers ENOENT
  rmSync(join(ROOT, '.next'), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  const server = startServer(s)
  const row = []
  try {
    await waitReady()
    for (let e = 0; e < EDITS; e++) {
      if (e > 0 && GAP_MS > 0) await sleep(GAP_MS)
      const r = await editAndWait(value++)
      writes++
      if (r.mtimeChanged) mtimeOk++
      row.push(r.ms)
    }
  } finally {
    stopServer(server)
  }
  matrix.push(row)
  out(`session ${String(s).padStart(2)}: ${row.map((x) => (x === null ? '   X' : String(x).padStart(4))).join(' ')}`)
}

const flat = matrix.flat()
out('')
out(`detected: ${flat.filter((x) => x !== null).length}/${flat.length}   (X = never reflected within ${WINDOW_MS}ms)`)
out(`file mtime advanced on ${mtimeOk}/${writes} writes`)
out('')
out('dev server output per session in probe-logs/')
