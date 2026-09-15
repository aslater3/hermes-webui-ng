import { useSyncExternalStore } from 'react';
import type { NativeCommands } from '../src/hermes/native-commands.js';
import './commands.css';

export function CommandTaskResults({ commands }: { commands: NativeCommands }) {
  useSyncExternalStore(commands.subscribe, commands.getSnapshot);
  if (!commands.tasks.state.length) return null;
  return <section className="native-command-tasks" aria-label="Native command tasks">
    {commands.tasks.state.map(task => <details key={task.id} className="native-command-task">
      <summary>{task.command} · {task.status === 'running' ? 'Running in Hermes' : 'Result received'}</summary>
      {task.status === 'running' ? <p role="status">The task was accepted. Its answer has not arrived yet.</p> : <>
        <pre className="command-output" role="region" aria-label={`${task.command} task result`} tabIndex={0}>{task.output || 'Hermes returned an empty answer.'}</pre>
        {task.truncated && <p>Output limited to 32,768 characters.</p>}
        <button type="button" className="secondary" onClick={() => commands.tasks.dismiss(task.id)}>Dismiss task result</button>
      </>}
    </details>)}
  </section>;
}
