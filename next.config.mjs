// POLL_MS>0 selects notify's PollWatcher; 0 leaves the platform's native
// watcher in place. The probe sets it per run so both arms use one config.
const pollIntervalMs = Number(process.env.POLL_MS) || 0

export default {
  ...(pollIntervalMs > 0 ? { watchOptions: { pollIntervalMs } } : {}),
}
