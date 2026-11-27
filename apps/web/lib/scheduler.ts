export interface SchedulerJob {
  name: string;
  dueAfterMs: number;
  leaseTtlSeconds: number;
  successEvent: string;
  routeLabel: string;
  run: () => Promise<unknown>;
}

export interface SchedulerLogger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  error(message: string, error: unknown, context?: Record<string, unknown>): void;
}

export interface LeaseAcquisition {
  acquired: boolean;
  lastSuccessAt: Date | null;
}

export interface SchedulerDeps {
  jobs: SchedulerJob[];
  tickMs: number;
  acquireLease(job: string, ttlSeconds: number, holder: string): Promise<LeaseAcquisition>;
  recordSuccess(job: string): Promise<void>;
  releaseLease(job: string, holder: string): Promise<void>;
  track(event: string, properties?: Record<string, unknown>): void;
  logger: SchedulerLogger;
  holder: string;
  now: () => number;
}

export interface SchedulerHandle {
  start(): void;
  stop(): void;
}

export function createScheduler(deps: SchedulerDeps): SchedulerHandle {
  const timers: ReturnType<typeof setInterval>[] = [];
  const running = new Set<string>();

  const releaseLease = async (job: SchedulerJob): Promise<void> => {
    try {
      await deps.releaseLease(job.name, deps.holder);
    } catch (error) {
      deps.logger.error(`[scheduler] ${job.name}: lease release failed`, error, {});
    }
  };

  const runJob = async (job: SchedulerJob): Promise<void> => {
    if (running.has(job.name)) {
      deps.logger.debug(`[scheduler] ${job.name}: previous run still going, skipping tick`, {});
      return;
    }
    running.add(job.name);
    let leased = false;
    try {
      const { acquired, lastSuccessAt } = await deps.acquireLease(
        job.name,
        job.leaseTtlSeconds,
        deps.holder,
      );
      if (!acquired) {
        deps.logger.info(`[scheduler] ${job.name}: lease busy, skipping tick`, {
          holder: deps.holder,
        });
        return;
      }
      leased = true;
      const last = lastSuccessAt === null ? null : lastSuccessAt.getTime();
      if (last !== null && deps.now() - last < job.dueAfterMs) {
        deps.logger.debug(`[scheduler] ${job.name}: not due yet`, {
          lastSuccessAt: lastSuccessAt?.toISOString() ?? null,
          dueAfterMs: job.dueAfterMs,
        });
        return;
      }
      await job.run();
      await deps.recordSuccess(job.name);
      deps.track(job.successEvent, { route: job.routeLabel, status: 200 });
    } catch (error) {
      deps.logger.error(`[scheduler] ${job.name}: run failed`, error, {});
    } finally {
      if (leased) await releaseLease(job);
      running.delete(job.name);
    }
  };

  const tick = (): Promise<unknown[]> =>
    Promise.all(deps.jobs.map((job) => runJob(job)));

  return {
    start(): void {
      deps.track('scheduler_started', {
        jobs: deps.jobs.map((job) => ({
          name: job.name,
          dueAfterMs: job.dueAfterMs,
          leaseTtlSeconds: job.leaseTtlSeconds,
        })),
        holder: deps.holder,
        startedAt: new Date(deps.now()).toISOString(),
      });
      void tick();
      timers.push(setInterval(() => void tick(), deps.tickMs));
    },
    stop(): void {
      for (const timer of timers) clearInterval(timer);
      timers.length = 0;
    },
  };
}
