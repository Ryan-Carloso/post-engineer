// Apify entry point: thin glue around runActor (src/post-engineer.js).
// The run id is the idempotency key, so an Apify retry of the same run
// replays the accepted job instead of charging tokens twice.
import { Actor, log } from 'apify';
import { runActor } from './post-engineer.js';

await Actor.init();

try {
  const { actorRunId } = Actor.getEnv();
  const result = await runActor({
    input: await Actor.getInput(),
    fetchImpl: fetch,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    idempotencyKey: typeof actorRunId === 'string' ? `apify-run-${actorRunId}` : undefined,
    log: (message) => log.info(message),
  });
  await Actor.pushData(result);
  await Actor.setValue('OUTPUT', result);
  await Actor.exit();
} catch (error) {
  // Messages from runActor are already redacted (no API key).
  await Actor.fail(error instanceof Error ? error.message : String(error));
}
