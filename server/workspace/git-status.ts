import git from 'isomorphic-git';
import { projectPath } from './git-fs.js';
import { WorkspaceError } from './safe-open.js';

type Options = Parameters<typeof git.statusMatrix>[0];
/** Compute the public statusMatrix encoding without its second-resolution stat-cache shortcut.
 * The adapter still bounds and validates every read; WORKDIR never refreshes the index.
 * Encoding follows isomorphic-git's documented HEAD/WORKDIR/STAGE matrix (MIT).
 */
export async function contentStatus(options: Options): Promise<[string, number, number, number][]> {
  return git.walk({ ...options, trees: [git.TREE({ ref: 'HEAD' }), git.WORKDIR({ refresh: false }), git.STAGE()],
    map: async (path, entries) => {
      if (path !== '.' && !projectPath(path)) return null;
      const [head, work, stage] = entries;
      if (!head && !stage && work && path !== '.' && await git.isIgnored({ ...options, filepath: path })) return null;
      const types = await Promise.all(entries.map(entry => entry?.type()));
      if (types.includes('commit')) return null; // No submodule traversal.
      if (!types.includes('blob')) return undefined;
      const headOid = types[0] === 'blob' ? await head!.oid() : undefined;
      const stageOid = types[2] === 'blob' ? await stage!.oid() : undefined;
      let workOid: string | undefined;
      if (types[1] === 'blob') {
        if (!headOid && !stageOid) workOid = 'untracked';
        else {
          // Do not call work.oid(): it can reuse stale staged data for equal-size,
          // same-second edits (including rapid agent writes and container mounts).
          const content = await work!.content();
          if (!content) throw new WorkspaceError('GIT_CHANGED_RETRY', 409);
          workOid = (await git.hashBlob({ object: content })).oid;
        }
      }
      const versions = [undefined, headOid, workOid, stageOid];
      return [path, versions.indexOf(headOid), versions.indexOf(workOid), versions.indexOf(stageOid)];
    },
  });
}
