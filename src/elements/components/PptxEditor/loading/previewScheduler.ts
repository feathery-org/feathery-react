type Job = { run: () => void; background: boolean };
const queue: Job[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;

function schedule() {
  if (timer !== undefined || !queue.length) return;
  // One SVG per task, yielding between previews for input and browser paint.
  timer = setTimeout(() => {
    timer = undefined;
    const foreground = queue.findIndex((job) => !job.background);
    const [job] = queue.splice(foreground < 0 ? 0 : foreground, 1);
    try {
      job?.run();
    } finally {
      schedule();
    }
  }, 0);
}

export function schedulePreview(
  run: () => void,
  background = false
): () => void {
  const job = { run, background };
  queue.push(job);
  schedule();
  return () => {
    const index = queue.indexOf(job);
    if (index >= 0) queue.splice(index, 1);
    if (!queue.length && timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
}
