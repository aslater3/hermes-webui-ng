import { Worker } from 'node:worker_threads';
import { WorkspaceError, type WorkspaceRoot } from './files.js';
import { GIT_LIMITS } from './git-fs.js';
import type { GitRequest } from './git-worker.js';

/** Read-only Git parsing lives off the HTTP thread, with bounded concurrency, heap and wall time. */
export class WorkspaceGit {
  private workers = new Set<Worker>();
  private closed = false;
  async read(root: WorkspaceRoot, repo: string, action: GitRequest['action'], path?: string, staged = false): Promise<unknown> {
    if (this.closed || this.workers.size >= 2) throw new WorkspaceError('WORKSPACE_BUSY', 429);
    const worker = new Worker(new URL('./git-worker.js', import.meta.url), {
      workerData: { root, repo, action, path, staged } satisfies GitRequest,
      env: {}, resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
    });
    this.workers.add(worker);
    try {
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new WorkspaceError('GIT_TIMEOUT', 504)), GIT_LIMITS.timeoutMs);
        const done = () => clearTimeout(timer);
        worker.once('message', value => { done();
          if (value?.ok === true) resolve(value.result);
          else reject(new WorkspaceError(typeof value?.code === 'string' && /^(GIT|WORKSPACE)_[A-Z_]+$/.test(value.code) ? value.code : 'GIT_UNAVAILABLE', [400, 403, 404, 409, 413, 415, 422, 429, 503, 504].includes(value?.status) ? value.status : 503));
        });
        worker.once('error', () => { done(); reject(new WorkspaceError('GIT_UNAVAILABLE', 503)); });
        worker.once('exit', () => { done(); reject(new WorkspaceError('GIT_UNAVAILABLE', 503)); });
      });
    } finally { await worker.terminate(); this.workers.delete(worker); }
  }
  async close() { this.closed = true; await Promise.all([...this.workers].map(worker => worker.terminate())); this.workers.clear(); }
}
