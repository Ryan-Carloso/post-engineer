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
  await Actor.fail(error instanceof Error ? error.message : String(error));
}
