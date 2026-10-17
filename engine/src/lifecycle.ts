// Process plumbing shared by every service.

// Run cleanup once on Ctrl+C or `docker stop`, then exit. A second signal while stopping is ignored.
export function onShutdown(cleanup: () => Promise<void> | void) {
  let stopping = false;
  const handler = async () => {
    if (stopping) return;
    stopping = true;
    await cleanup();
    process.exit(0);
  };
  process.on('SIGINT', handler);
  process.on('SIGTERM', handler);
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
