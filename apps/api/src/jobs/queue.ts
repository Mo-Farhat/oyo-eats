/** What features need from the job runner. pg-boss in the app; a recording fake in tests. */
export interface JobQueue {
  /** Registers a handler. Call from onModuleInit; workers start after bootstrap. */
  define<T extends object>(queue: string, handler: (data: T) => Promise<void>): void;
  /** Runs the queue's handler with `data` after `seconds`. */
  sendAfter(queue: string, data: object, seconds: number): Promise<void>;
  /** Runs the queue's handler on a cron schedule, Asia/Colombo time. Call from onModuleInit. */
  schedule(queue: string, cron: string): void;
}

/** For tests and `jobs: false`: remembers what was scheduled and can run it on demand. */
export class RecordingJobQueue implements JobQueue {
  readonly handlers = new Map<string, (data: object) => Promise<void>>();
  readonly sent: { queue: string; data: object; seconds: number }[] = [];
  readonly schedules = new Map<string, string>();

  schedule(queue: string, cron: string): void {
    this.schedules.set(queue, cron);
  }

  define<T extends object>(queue: string, handler: (data: T) => Promise<void>): void {
    this.handlers.set(queue, handler as (data: object) => Promise<void>);
  }

  async sendAfter(queue: string, data: object, seconds: number): Promise<void> {
    this.sent.push({ queue, data, seconds });
  }

  /** Runs every scheduled job for `queue` now. */
  async runAll(queue: string): Promise<void> {
    const handler = this.handlers.get(queue);
    if (!handler) throw new Error(`No handler for ${queue}`);
    for (const job of this.sent.filter((j) => j.queue === queue)) await handler(job.data);
  }
}
