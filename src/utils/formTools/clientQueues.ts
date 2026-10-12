// Waits for the requests a tool call queued to settle, so none lands after
// the driver reports finished. Twice, since a settling request can chain
// another; only settling counts, not failure.
export async function awaitClientQueues(client: any): Promise<void> {
  const settle = async () => {
    await client.whenUserEventsReplayed();
    await Promise.all([
      client.submitQueue.catch(() => undefined),
      client.eventQueue.catch(() => undefined)
    ]);
  };
  await settle();
  await settle();
}
