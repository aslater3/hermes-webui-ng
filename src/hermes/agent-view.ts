import type { AgentInput, Question, ToolActivity } from './agent-activity.js';
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
interface InputCard {
  root: HTMLElement; status: HTMLElement; error: HTMLElement;
  controls: HTMLElement; questions: Map<string, HTMLFieldSetElement>; signature: string;
}
interface ToolCard { root: HTMLDetailsElement; summary: HTMLElement; input: HTMLElement; output: HTMLElement; note: HTMLElement; }
const names = { approval:'Operation approval', clarify:'Question from Hermes', sudo:'Sudo password request', secret:'Secret requested by Hermes' };
const labels = { pending:'Needs your input', sending:'Sending — awaiting Hermes', answered:'Response confirmed', expired:'No longer pending',
  unknown:'Delivery or pending status unknown — not resent', unsupported:'Not supported by this Hermes version' };

/** Stable keyed DOM: streaming never replaces focused input forms. No response values in view state. */
export class AgentView {
  private owner?: NativeSession;
  private readonly summary = node('p', '', 'hint');
  private readonly warning = node('p', '', 'agent-warning');
  private readonly requests = node('div', '', 'agent-requests');
  private readonly reasoning = node('details');
  private readonly reasoningText = node('pre');
  private readonly thinking = node('p', '', 'hint');
  private readonly tools = node('div', '', 'agent-tools');
  private readonly inputs = new Map<string, InputCard>();
  private readonly toolCards = new Map<string, ToolCard>();
  private unlisten?: () => void;
  private visibility = () => { if (document.visibilityState !== 'visible') this.clearCredentials(); };
  private pagehide = () => this.clearCredentials();
  dispose(): void { this.clear(); document.removeEventListener('visibilitychange', this.visibility); window.removeEventListener('pagehide', this.pagehide); }
  constructor(private readonly root: HTMLElement) {
    const heading = node('h3', 'Agent activity and input'); heading.id = 'agent-title';
    this.root.setAttribute('aria-labelledby', heading.id);
    this.summary.setAttribute('role', 'status'); this.warning.setAttribute('role', 'status');
    this.reasoning.append(node('summary', 'Reasoning supplied by Hermes'), this.reasoningText);
    this.requests.setAttribute('aria-label', 'Agent requests');
    this.root.append(heading, this.summary, this.warning, this.requests, this.thinking, this.reasoning, this.tools);
    document.addEventListener('visibilitychange', this.visibility);
    window.addEventListener('pagehide', this.pagehide);
  }
  private clearCredentials(): void { for (const input of this.root.querySelectorAll<HTMLInputElement>('input[type="password"]')) input.value = ''; }
  clear(): void {
    this.clearCredentials(); this.unlisten?.(); this.unlisten = undefined; this.owner = undefined;
    this.inputs.clear(); this.toolCards.clear(); this.requests.replaceChildren(); this.tools.replaceChildren();
    this.reasoningText.textContent = ''; this.thinking.textContent = ''; this.reasoning.open = false; this.root.hidden = true;
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
    this.root.hidden = historical || !(activity.inputs.length || activity.tools.length || activity.reasoning || activity.thinking || activity.recoveryGap || activity.malformed);
    if (!enabled || historical) this.clearCredentials();
    this.summary.textContent = `${count ? `${count} request${count === 1 ? '' : 's'} awaiting confirmation. ` : ''}Current or most recent turn only. Tool output and reasoning are bounded.`;
    this.warning.hidden = !activity.recoveryGap && !activity.malformed && !activity.droppedTools && !activity.truncated;
    this.warning.textContent = [activity.recoveryGap ? 'A credential request lost its connection. This Hermes version cannot recover a pending sudo/secret form. Use the original client or interrupt the turn; nothing is resent.' : '',
      activity.malformed ? 'Some agent data could not be displayed safely. Do not approve an operation with incomplete details.' : '',
      activity.droppedTools ? `${activity.droppedTools} earlier tool cards omitted from this bounded view.` : '',
      activity.truncated ? 'Reasoning output reached the display limit.' : ''].filter(Boolean).join(' ');
    const liveKeys = new Set(activity.inputs.map(p => p.key));
    for (const [key, card] of this.inputs) if (!liveKeys.has(key)) { this.erase(card); card.root.remove(); this.inputs.delete(key); }
    for (const input of activity.inputs) this.input(owner, input, enabled && !historical && !owner.state.interrupting);
    this.reasoning.hidden = !activity.reasoning; this.reasoningText.textContent = activity.reasoning;
    this.thinking.hidden = !activity.thinking; this.thinking.textContent = activity.thinking;
    const toolIds = new Set(activity.tools.map(t => t.id));
    for (const [id, card] of this.toolCards) if (!toolIds.has(id)) {card.root.remove();this.toolCards.delete(id);}
    for (const tool of activity.tools) this.tool(tool);
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
    card.status.textContent = input.blocked ? 'Response disabled — incomplete or unsupported request details' : labels[input.status];
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
    const controls=node('div','','agent-input-controls'); const questions=new Map<string,HTMLFieldSetElement>();
    root.append(node('h4',names[input.kind]),status);
    if(input.prompt) root.append(node('p',input.prompt));
    const respond = (value: string, questionId?: string) => {
      error.hidden=true;
      void owner.respond(input.key,value,questionId).catch(() => {
        if(this.owner!==owner || !root.isConnected)return;
        error.textContent='Hermes did not confirm this response. Check its status or refresh; the response has not been resent.'; error.hidden=false;
      });
    };
    if(input.kind==='approval') {
      root.append(node('pre',input.command??'No complete command supplied'));
      root.append(node('p','Review the exact operation. Allow once applies only to this request; it does not change your saved approval policy.','hint'));
      for(const choice of input.choices) controls.append(button(choice==='once'?'Allow once':'Deny',()=>respond(choice)));
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
  private tool(tool: ToolActivity): void {
    let card=this.toolCards.get(tool.id);
    if(!card){
      const root=node('details','','agent-tool'),summary=node('summary'),input=node('pre'),output=node('pre'),note=node('p','','hint');
      root.dataset.toolId=tool.id;root.append(summary,node('h4','Arguments'),input,node('h4','Output'),output,note);card={root,summary,input,output,note};this.toolCards.set(tool.id,card);this.tools.append(root);
    }
    card.root.dataset.state=tool.state;
    card.summary.textContent=`${tool.name} · ${tool.state}${tool.duration!==undefined?` · ${tool.duration.toFixed(2)}s`:''}${tool.context?` · ${tool.context}`:''}`;
    card.input.textContent=tool.input||'No arguments provided';card.output.textContent=tool.output||'No output supplied yet';
    card.note.textContent=tool.truncated?'Display truncated. This is not the full tool output.':'Untrusted tool output is shown as text, never executed.';
  }
}
