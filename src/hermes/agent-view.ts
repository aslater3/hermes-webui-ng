import type { AgentInput, Question, ToolActivity, ActivityTurn, ReasoningActivity } from './agent-activity.js';
import { ApprovalAttentionTone } from './attention-tone.js';
import type { NativeSession } from './native-session.js';

function node<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (text) element.textContent = text;
  if (className) element.className = className;
  return element;
}
function button(label: string, action: () => void): HTMLButtonElement {
  const control = node('button', label); control.type = 'button'; control.addEventListener('click', action); return control;
}
function reasoningSummary(value: string, truncated = false): string {
  const compact = value.replace(/[*_`#]+/g, '').replace(/\s+/g, ' ').trim();
  const preview = compact.length > 100 ? `${compact.slice(0, 97)}…` : compact;
  return `Reasoning supplied by Hermes${preview ? ` · ${preview}` : ''}${truncated ? ' · truncated' : ''}`;
}
interface InputCard {
  root: HTMLElement; status: HTMLElement; error: HTMLElement;
  controls: HTMLElement; questions: Map<string, HTMLFieldSetElement>; signature: string;
}
interface ToolCard { root: HTMLDetailsElement; summary: HTMLElement; input: HTMLElement; output: HTMLElement; note: HTMLElement; }
interface ReasoningCard { root: HTMLDetailsElement; summary: HTMLElement; text: HTMLElement; }
const names = { approval:'Operation approval', clarify:'Question from Hermes', sudo:'Sudo password request', secret:'Secret requested by Hermes' };
const labels = { pending:'Needs your input', sending:'Sending — awaiting Hermes', answered:'Response confirmed', expired:'No longer pending',
  unknown:'Delivery or pending status unknown — not resent', unsupported:'Not supported by this Hermes version' };

/** Stable keyed DOM: streaming never replaces focused input forms. No response values in view state. */
export class AgentView {
  private owner?: NativeSession;
  private readonly summary = node('p', '', 'hint');
  private readonly warning = node('p', '', 'agent-warning');
  private readonly requests = node('div', '', 'agent-requests');
  private readonly thinking = node('p', '', 'hint');
  private readonly timeline = node('div', '', 'agent-timeline');
  private readonly earlier = node('details', '', 'agent-earlier');
  private readonly earlierLabel = node('summary', 'Earlier activity in this tab');
  private readonly earlierBody = node('div', '', 'agent-archive');
  private archiveSource?: ActivityTurn[];
  private readonly inputs = new Map<string, InputCard>();
  private readonly toolCards = new Map<string, ToolCard>();
  private readonly reasoningCards = new Map<string, ReasoningCard>();
  private readonly approvalTone = new ApprovalAttentionTone();
  private readonly announcedApprovals = new WeakMap<NativeSession, Set<string>>();
  private unlisten?: () => void;
  private visibility = () => { if (document.visibilityState !== 'visible') this.clearCredentials(); };
  private pagehide = () => this.clearCredentials();
  dispose(): void { this.clear(); this.approvalTone.dispose(); document.removeEventListener('visibilitychange', this.visibility); window.removeEventListener('pagehide', this.pagehide); }
  constructor(private readonly root: HTMLElement) {
    const heading = node('h2', 'Agent activity and input'); heading.id = 'agent-title';
    this.root.setAttribute('aria-labelledby', heading.id);
    this.summary.setAttribute('role', 'status'); this.warning.setAttribute('role', 'status');
    this.requests.setAttribute('role', 'group');
    this.requests.setAttribute('aria-label', 'Agent requests');
    this.timeline.setAttribute('aria-label', 'Chronological Hermes activity');
    this.earlier.append(this.earlierLabel, this.earlierBody);
    this.earlier.addEventListener('toggle', () => this.renderArchive());
    this.root.append(heading, this.summary, this.warning, this.requests, this.thinking, this.timeline, this.earlier);
    document.addEventListener('visibilitychange', this.visibility);
    window.addEventListener('pagehide', this.pagehide);
  }
  private clearCredentials(): void { for (const input of this.root.querySelectorAll<HTMLInputElement>('input[type="password"]')) input.value = ''; }
  clear(): void {
    this.clearCredentials(); this.unlisten?.(); this.unlisten = undefined; this.owner = undefined;
    this.earlier.open = false; this.earlierBody.replaceChildren(); this.archiveSource = undefined;
    this.inputs.clear(); this.toolCards.clear(); this.reasoningCards.clear(); this.requests.replaceChildren(); this.timeline.replaceChildren();
    this.thinking.textContent = ''; this.root.hidden = true;
  }
  update(owner: NativeSession, enabled: boolean, historical: boolean): void {
    if (this.owner !== owner) {
      this.clear(); this.owner = owner;
      this.unlisten = owner.subscribe(state => {
        if (['unknown','attaching','error','empty'].includes(state.phase)) this.clearCredentials();
      });
    }
    const activity = owner.activity.state;
    const active = activity.inputs.filter(p => ['pending','sending'].includes(p.status));
    const count = active.length;
    if (enabled && !historical) {
      let announced = this.announcedApprovals.get(owner);
      if (!announced) { announced = new Set<string>(); this.announcedApprovals.set(owner, announced); }
      const fresh = active.filter(input => input.kind === 'approval' && input.status === 'pending' && !input.blocked && !announced!.has(input.key));
      for (const input of fresh) announced.add(input.key);
      if (fresh.length) this.approvalTone.notify();
    }
    this.root.hidden = historical || !(owner.activity.archive.length || activity.inputs.length || activity.timeline.length || activity.tools.length || activity.reasoning || activity.thinking || activity.recoveryGap || activity.malformed);
    if (!enabled || historical) this.clearCredentials();
    this.summary.textContent = `${count ? `${count} request${count === 1 ? '' : 's'} awaiting confirmation. ` : ''}Current turn activity is shown chronologically. Saved history stays in Hermes.`;
    this.warning.hidden = !activity.recoveryGap && !activity.malformed && !activity.droppedTools && !activity.truncated;
    this.warning.textContent = [activity.recoveryGap ? 'A credential request lost its connection. This Hermes version cannot recover a pending sudo/secret form. Use Stop response to cancel the pending turn, then ask again for a fresh request; nothing is resent.' : '',
      activity.malformed ? 'Some agent data could not be displayed safely. Do not approve an operation with incomplete details.' : '',
      activity.droppedTools ? `${activity.droppedTools} earlier tool cards omitted from this bounded view.` : '',
      activity.truncated ? 'Some activity or reasoning output reached the display limit.' : ''].filter(Boolean).join(' ');
    const liveKeys = new Set(activity.inputs.map(p => p.key));
    for (const [key, card] of this.inputs) if (!liveKeys.has(key)) { this.erase(card); card.root.remove(); this.inputs.delete(key); }
    for (const input of activity.inputs) this.input(owner, input, enabled && !historical && !owner.state.interrupting);
    this.thinking.hidden = !activity.thinking; this.thinking.textContent = activity.thinking;

    const toolIds = new Set(activity.tools.map(t => t.id));
    for (const [id, card] of this.toolCards) if (!toolIds.has(id)) { card.root.remove(); this.toolCards.delete(id); }
    const hasTimelineReasoning = activity.timeline.some(entry => entry.kind === 'reasoning');
    const fallback = activity.reasoning && !hasTimelineReasoning ? {
      kind:'reasoning' as const, id:'reasoning-fallback', text:activity.reasoning, truncated:activity.truncated,
    } : undefined;
    const reasoningIds = new Set(activity.timeline.flatMap(entry => entry.kind === 'reasoning' ? [entry.id] : []));
    if (fallback) reasoningIds.add(fallback.id);
    for (const [id, card] of this.reasoningCards) if (!reasoningIds.has(id)) { card.root.remove(); this.reasoningCards.delete(id); }

    const tools = new Map(activity.tools.map(tool => [tool.id, tool]));
    const renderedTools = new Set<string>();
    for (const entry of activity.timeline) {
      if (entry.kind === 'reasoning') this.timeline.append(this.reasoning(entry).root);
      else {
        const tool = tools.get(entry.id);
        if (tool) { this.timeline.append(this.tool(tool).root); renderedTools.add(tool.id); }
      }
    }
    for (const tool of activity.tools) if (!renderedTools.has(tool.id)) this.timeline.append(this.tool(tool).root);
    if (fallback) this.timeline.append(this.reasoning(fallback).root);

    this.earlier.hidden = owner.activity.archive.length === 0;
    this.earlierLabel.textContent = `Earlier activity in this tab (${owner.activity.archive.length} turns)`;
    if (this.archiveSource !== owner.activity.archive) { this.archiveSource = owner.activity.archive; this.renderArchive(); }
  }
  private renderArchive(): void {
    this.earlierBody.replaceChildren();
    if (!this.earlier.open) return;
    this.earlierBody.append(node('p', 'Up to six observed turns; no request answers are stored here. Reload fetches only the history Hermes exposes.', 'hint'));
    for (const turn of [...this.archiveSource ?? []].reverse()) {
      const root = node('details', '', 'agent-archived-turn');
      root.append(node('summary', `Observed turn ${turn.id} · ${turn.tools.length} tools${turn.truncated ? ' · bounded' : ''}`));
      root.addEventListener('toggle', () => {
        for (const child of [...root.children].slice(1)) child.remove();
        if (!root.open) return;
        if (turn.thinking) root.append(node('p', turn.thinking, 'hint'));
        const tools = new Map(turn.tools.map(tool => [tool.id, tool]));
        for (const entry of turn.timeline) {
          if (entry.kind === 'reasoning') root.append(this.archivedReasoning(entry));
          else {
            const tool = tools.get(entry.id);
            if (tool) root.append(this.archivedTool(tool));
          }
        }
      });
      this.earlierBody.append(root);
    }
  }
  private archivedReasoning(entry: ReasoningActivity): HTMLDetailsElement {
    const root = node('details', '', 'agent-card agent-reasoning-card');
    root.dataset.reasoningId = entry.id;
    root.append(node('summary', reasoningSummary(entry.text, entry.truncated)), node('pre', entry.text || 'No reasoning text supplied'));
    return root;
  }
  private archivedTool(tool: ToolActivity): HTMLDetailsElement {
    const detail = node('details', '', 'agent-tool');
    detail.append(node('summary', `${tool.name} · ${tool.state}${tool.duration !== undefined ? ` · ${tool.duration.toFixed(2)}s` : ''}`),
      node('p', 'Arguments', 'agent-field-label'), node('pre', tool.input || 'No arguments supplied'),
      node('p', 'Output', 'agent-field-label'), node('pre', tool.output || 'No output supplied'),
      node('p', tool.truncated ? 'Archived display truncated.' : 'Observed output only; never executed.', 'hint'));
    return detail;
  }
  private reasoning(entry: ReasoningActivity): ReasoningCard {
    let card = this.reasoningCards.get(entry.id);
    if (!card) {
      const root = node('details', '', 'agent-card agent-reasoning-card'), summary = node('summary'), text = node('pre');
      root.dataset.reasoningId = entry.id; root.append(summary, text); card = { root, summary, text }; this.reasoningCards.set(entry.id, card);
    }
    card.root.dataset.truncated = String(entry.truncated);
    card.summary.textContent = reasoningSummary(entry.text, entry.truncated);
    card.text.textContent = entry.text || 'No reasoning text supplied';
    return card;
  }
  private erase(card: InputCard): void {
    for (const input of card.controls.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input,textarea')) { if(input instanceof HTMLInputElement && ['radio','checkbox'].includes(input.type)) input.checked=false; else input.value=''; }
  }
  private input(owner: NativeSession, input: AgentInput, enabled: boolean): void {
    const signature = JSON.stringify([input.kind,input.prompt,input.command,input.envVar,input.choices,input.questions,input.blocked]);
    let card = this.inputs.get(input.key);
    if (!card || card.signature !== signature) {
      if (card) {this.erase(card);card.root.remove();}
      card = this.createInput(owner, input, signature); this.inputs.set(input.key, card); this.requests.append(card.root);
    }
    const interactive = input.status === 'pending' && enabled && !input.blocked;
    card.root.dataset.status = input.status;
    card.status.textContent = input.blocked ? 'Response disabled — incomplete or unsupported request details' :
      input.kind === 'approval' && input.status === 'pending' ? 'Action paused — choose an approval scope, YOLO, or Deny' : labels[input.status];
    if (['answered','expired','unknown','unsupported'].includes(input.status) || input.blocked) this.erase(card);
    for (const control of card.controls.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLTextAreaElement>('button,input,textarea')) control.disabled = !interactive;
    for (const [qid, fieldset] of card.questions) {
      const answered = input.answered.includes(qid); fieldset.disabled = !interactive || answered;
      const note = fieldset.querySelector<HTMLElement>('.question-status'); if (note) note.textContent = answered ? 'Answer confirmed by Hermes' : '';
      if (answered) for (const field of fieldset.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input,textarea')) { if(field instanceof HTMLInputElement) field.checked=false; else field.value=''; }
    }
  }
  private createInput(owner: NativeSession, input: AgentInput, signature: string): InputCard {
    const root=node('article','',`agent-card agent-${input.kind}`); root.dataset.requestKey=input.key;
    root.setAttribute('aria-label',names[input.kind]);
    const status=node('p','','agent-input-status'), error=node('p','','agent-input-error'); status.setAttribute('role','status'); error.setAttribute('role','alert'); error.hidden=true;
    if (input.kind === 'approval') status.setAttribute('aria-live', 'assertive');
    const controls=node('div','','agent-input-controls'); const questions=new Map<string,HTMLFieldSetElement>();
    root.append(node('h3',input.kind === 'approval' ? 'Permission required' : names[input.kind]),status);
    if(input.prompt) root.append(node('p',input.prompt));
    const respond = (value: string, questionId?: string) => {
      error.hidden=true;
      void owner.respond(input.key,value,questionId).catch(() => {
        if(this.owner!==owner || !root.isConnected)return;
        error.textContent='Hermes did not confirm this response. Check its status or refresh; the response has not been resent.'; error.hidden=false;
      });
    };
    if(input.kind==='approval') {
      root.append(node('p','Hermes is paused until you decide. Requests can expire in Hermes; the supported baseline defaults to five minutes.','agent-attention-copy'));
      root.append(node('pre',input.command??'No complete command supplied'));
      root.append(node('p','Allow once approves only this request. Approve for session allows this operation pattern for this conversation. YOLO enables the session approval bypass and approves this request; Hermes hardline blocks and explicit deny rules still apply.','hint'));
      if (input.choices.includes('once')) controls.append(button('Allow once',()=>respond('once')));
      if (input.choices.includes('session')) controls.append(button('Approve for session',()=>respond('session')));
      if (input.choices.includes('once')) controls.append(button('YOLO',()=>{
        error.hidden=true;
        void owner.enableYoloAndApprove(input.key).catch(() => {
          if(this.owner!==owner || !root.isConnected)return;
          error.textContent='Hermes did not confirm YOLO and this approval. Refresh the conversation before trying another action; nothing is replayed automatically.'; error.hidden=false;
        });
      }));
      if (input.choices.includes('deny')) controls.append(button('Deny',()=>respond('deny')));
    } else if(input.kind==='clarify') {
      input.questions.forEach((q,i)=>{
        const fieldset=node('fieldset'); fieldset.append(node('legend',q.text)); const note=node('p','','question-status');
        const formId=`q-${input.id}-${i}`;
        const field=this.question(q,fieldset,formId);
        fieldset.append(button(q.id?'Confirm answer':'Send answer',()=>{const value=field(); if(value!==undefined)respond(value,q.id);}),note);
        controls.append(fieldset);if(q.id)questions.set(q.id,fieldset);
      });
      controls.append(button('Cancel question request',()=>respond('')));
    } else {
      if(input.envVar)root.append(node('p',`Hermes setting: ${input.envVar}`));
      root.append(node('p',input.kind==='secret'?'Sending allows Hermes to store this value in its own credential configuration. The WebUI does not retain the value.':'Sent only to the pending Hermes sudo request. The WebUI never retains or displays this password.','hint'));
      const label=node('label',input.kind==='sudo'?'Sudo password':'Secret value');const field=node('input');field.type='password';field.autocomplete='off';field.spellcheck=false;field.maxLength=16384;
      field.setAttribute('autocapitalize','none');label.append(field);controls.append(label);
      controls.append(button(input.kind==='sudo'?'Send password':'Save in Hermes',()=>{const value=field.value;if(!value){field.focus();return;}field.value='';respond(value);}),button('Skip credential request',()=>{field.value='';respond('');}));
    }
    root.append(controls,error);
    return {root,status,error,controls,questions,signature};
  }
  private question(q: Question, fieldset: HTMLFieldSetElement, group: string): () => string | undefined {
    const fields:HTMLInputElement[]=[];
    for(const choice of q.choices){
      const label=node('label','', 'agent-choice'),field=node('input');field.type=q.multiple?'checkbox':'radio';field.name=group;field.value=choice;
      label.append(field,node('span',choice));fieldset.append(label);fields.push(field);
    }
    const label=node('label',q.choices.length?'Other answer (overrides selected choices)':'Your answer');const custom=node('textarea');custom.rows=2;custom.maxLength=16384;label.append(custom);fieldset.append(label);
    return ()=>{
      const chosen=fields.filter(f=>f.checked).map(f=>f.value),value=custom.value.trim();
      if(!value&&!chosen.length){custom.focus();return undefined;}
      custom.value='';fields.forEach(f=>{f.checked=false;});
      return value||(q.multiple?JSON.stringify(chosen):chosen[0]);
    };
  }
  private tool(tool: ToolActivity): ToolCard {
    let card=this.toolCards.get(tool.id);
    if(!card){
      const root=node('details','','agent-tool'),summary=node('summary'),input=node('pre'),output=node('pre'),note=node('p','','hint');
      root.dataset.toolId=tool.id;root.append(summary,node('p','Arguments','agent-field-label'),input,node('p','Output','agent-field-label'),output,note);card={root,summary,input,output,note};this.toolCards.set(tool.id,card);
    }
    card.root.dataset.state=tool.state;
    card.summary.textContent=`${tool.name} · ${tool.state}${tool.duration!==undefined?` · ${tool.duration.toFixed(2)}s`:''}${tool.context?` · ${tool.context}`:''}`;
    card.input.textContent=tool.input||'No arguments provided';card.output.textContent=tool.output||'No output supplied yet';
    card.note.textContent=tool.truncated?'Display truncated. This is not the full tool output.':'Untrusted tool output is shown as text, never executed.';
    return card;
  }
}
