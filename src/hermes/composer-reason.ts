/** Why the composer is closed, in the order `writable` checks its terms (client/Conversation.tsx). Empty when writable. */
export interface ComposerGate {
  writable: boolean; openRequests: number; ready: boolean;
  commands: { uncertain?: boolean; confirmation?: unknown; busy?: boolean; browserPanel?: boolean };
  settings: { busy: boolean; outcome: string; confirmation?: unknown };
  loading: boolean; historical: boolean; phase: string;
}
export function composerBlockedReason(gate: ComposerGate): string {
  if (gate.writable) return '';
  if (gate.openRequests) return 'Answer the open request from Hermes first.';
  if (!gate.ready) return 'Waiting for the connection to Hermes.';
  if (gate.commands.uncertain) return 'A command may have had effects. Open Commands to review it before sending again.';
  if (gate.commands.confirmation) return 'A command is waiting for your confirmation.';
  if (gate.commands.busy) return 'A command is still running.';
  if (gate.commands.browserPanel) return 'Finish or close the open command panel first.';
  if (gate.settings.busy) return 'Applying a model or profile change…';
  if (gate.settings.outcome === 'unknown') return 'A model or profile change was not confirmed by Hermes. Reopen the conversation to check it.';
  if (gate.settings.confirmation) return 'A model or profile change is waiting for your confirmation.';
  if (gate.loading) return 'Opening the conversation…';
  if (gate.historical) return 'You are viewing earlier messages. Return to latest to continue.';
  if (gate.phase === 'waiting') return 'Hermes is waiting for input on this turn.';
  if (gate.phase === 'attaching') return 'Reattaching to the conversation…';
  return `This conversation is not ready (${gate.phase}).`;
}
