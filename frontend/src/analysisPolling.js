// Watch long-running jobs until the server reports a terminal state.
// Cancel on logout, unmount or before starting another upload.
export function watchAnalysis({ getStatus, onStatus, onError, schedule = setTimeout, cancel = clearTimeout, interval = 3000 }) {
  let stopped = false;
  let timer;
  let consecutiveErrors = 0;
  const stop = () => {
    stopped = true;
    if (timer !== undefined) cancel(timer);
  };
  const poll = async () => {
    try {
      const status = await getStatus();
      if (stopped) return;
      consecutiveErrors = 0;
      await onStatus(status);
      if (["Completed", "Failed", "Cancelled"].includes(status.status)) stop();
    } catch (error) {
      if (stopped) return;
      consecutiveErrors += 1;
      if ([401, 403, 404].includes(error.status) || consecutiveErrors >= 5) {
        stop();
        onError(error);
      }
    }
    if (!stopped) timer = schedule(poll, interval);
  };
  timer = schedule(poll, 0);
  return stop;
}
