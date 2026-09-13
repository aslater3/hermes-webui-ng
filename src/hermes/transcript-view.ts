import { BottomFollow } from './chat-behaviour.js';
import type { Message } from './native-session.js';

function body(text: string): DocumentFragment {
  const result = document.createDocumentFragment();
  // A small code-fence renderer, not a permissive HTML/Markdown parser.
  const fence = /```[^\n`]*\n([\s\S]*?)```/g;
  let at = 0, count = 0;
  for (const match of text.matchAll(fence)) {
    if (++count > 50) break;
    result.append(document.createTextNode(text.slice(at, match.index)));
    const wrapper = document.createElement('div'); wrapper.className = 'code-block';
    const pre = document.createElement('pre'); pre.tabIndex = 0;
    const code = document.createElement('code'); code.textContent = match[1] ?? ''; pre.append(code);
    const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = 'Copy code';
    const status = document.createElement('span'); status.className = 'hint'; status.setAttribute('role','status');
    copy.addEventListener('click', () => {
      if (!navigator.clipboard) { status.textContent = 'Select the code to copy it.'; return; }
      void navigator.clipboard.writeText(code.textContent ?? '').then(() => { status.textContent = 'Copied.'; })
        .catch(() => { status.textContent = 'Select the code to copy it.'; });
    });
    wrapper.append(copy, status, pre); result.append(wrapper); at = match.index + match[0].length;
  }
  result.append(document.createTextNode(text.slice(at))); return result;
}

/** Stable completed nodes: streaming does not destroy selections in earlier messages. */
export class TranscriptView {
  readonly follow = new BottomFollow();
  private key = '';
  private rows: { signature: string; element: HTMLElement }[] = [];
  private streaming = document.createElement('div');
  private empty = document.createElement('p');
  private oldStream = '';
  constructor(private readonly root: HTMLElement, private readonly changed: () => void) {
    this.streaming.className = 'message streaming'; this.streaming.setAttribute('aria-label','Streaming assistant response');
    this.root.addEventListener('scroll', () => {
      this.follow.scroll(this.root.scrollTop, this.root.scrollHeight, this.root.clientHeight); this.changed();
    }, { passive:true });
  }
  update(key: string, messages: readonly Message[], streaming: string, empty: string): void {
    const switched = this.key !== key;
    if (switched) { this.key = key; this.root.replaceChildren(); this.rows = []; this.oldStream = ''; this.follow.latest(); }
    let changed = switched;
    const count = Math.min(100, messages.length);
    while (this.rows.length > count) { this.rows.pop()!.element.remove(); changed = true; }
    for (let i=0; i<count; i++) {
      const message = messages[i]!;
      const signature = JSON.stringify([message.role, message.text, message.truncated]);
      let row = this.rows[i];
      if (!row) {
        const node = document.createElement('article'); node.className = 'message';
        row = {signature:'',element:node}; this.rows.push(row); this.root.insertBefore(node, this.streaming.parentElement === this.root ? this.streaming : null);
      }
      if (row.signature !== signature) {
        row.signature = signature; changed = true;
        const role = document.createElement('strong'); role.textContent = message.role;
        const content = document.createElement('div'); content.className = 'message-body'; content.append(body(message.text));
        row.element.dataset.role = message.role; row.element.replaceChildren(role, content);
        if (message.truncated) { const note = document.createElement('p'); note.className = 'hint'; note.textContent = 'Entry truncated at 128 KiB in this view.'; row.element.append(note); }
      }
    }
    if (streaming !== this.oldStream || switched) { this.oldStream = streaming; this.streaming.textContent = streaming; changed = true; }
    if (streaming) { if (this.streaming.parentElement !== this.root) this.root.append(this.streaming); }
    else this.streaming.remove();
    this.empty.textContent = empty;
    if (!count && !streaming) { if (this.empty.parentElement !== this.root) this.root.append(this.empty); }
    else this.empty.remove();
    if (changed) {
      if (this.follow.changed()) this.root.scrollTop = this.root.scrollHeight;
      this.changed();
    }
  }
  latest(): void { this.follow.latest(); this.root.scrollTop = this.root.scrollHeight; this.changed(); }
  clear(): void { this.key = ''; this.rows = []; this.oldStream = ''; this.root.replaceChildren(); this.follow.latest(); }
}
