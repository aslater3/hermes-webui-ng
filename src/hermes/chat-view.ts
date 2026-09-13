import { type ChatController, draftKey, navigation, navigationRef } from './chat-controller.js';
import type { ConnectionStore } from './connection-store.js';
import type { GatewayClient } from './gateway-client.js';
import { ClientError } from './protocol.js';
import { enterSends } from './chat-behaviour.js';
import { TranscriptView } from './transcript-view.js';
import type { SessionRef } from './session-rest.js';
function element<T extends HTMLElement>(id:string):T { const node = document.getElementById(id); if (!node) throw new Error('Missing chat element'); return node as T; }
export class ChatView {
  private readonly prompt = element<HTMLTextAreaElement>('prompt');
  private readonly search = element<HTMLInputElement>('session-search');
  private readonly dialog = element<HTMLDialogElement>('sessions-dialog');
  private readonly sidebar = element('conversation-sidebar');
  private readonly transcript = new TranscriptView(element('transcript'), () => this.scrollStatus());
  private readonly mobile = matchMedia('(max-width: 760px)');
  private indexSignature = '';
  private searchTimer?: ReturnType<typeof setTimeout>;
  private openedLocation = false;
  private invalidLocation = false;
  constructor(readonly chat: ChatController, private readonly foundation: ConnectionStore, private readonly gateway: GatewayClient) {
    const action = (id:string, fn:()=>void) => element(id).addEventListener('click',fn);
    action('create', () => { history.pushState(null,'',location.pathname); void chat.create(); });
    element('resume-form').addEventListener('submit', (event) => { event.preventDefault(); this.open({id:element<HTMLInputElement>('session-key').value}); });
    element('prompt-form').addEventListener('submit', (event) => { event.preventDefault(); chat.setDraft(this.prompt.value); this.transcript.latest(); void chat.send(); });
    this.prompt.addEventListener('input', () => { chat.setDraft(this.prompt.value); this.composer(); });
    this.prompt.addEventListener('keydown', (event) => {
      if (enterSends(event, matchMedia('(pointer: coarse)').matches)) { event.preventDefault(); element<HTMLFormElement>('prompt-form').requestSubmit(); }
    });
    action('interrupt',()=>{void chat.interrupt();}); action('refresh',()=>{void chat.latest();});
    action('latest',()=>this.transcript.latest()); action('return-live',()=>{void chat.latest();});
    action('older-history',()=>{void chat.historyPage((chat.historical ? chat.browser.history.page?.offset ?? 0 : 0)+100);});
    action('newer-history',()=>{ const offset = Math.max(0,(chat.browser.history.page?.offset ?? 0)-100); if (offset===0) void chat.latest(); else void chat.historyPage(offset); });
    const search = () => { clearTimeout(this.searchTimer); if (this.canRead()) void chat.browser.list(this.search.value.trim()); };
    element('search-form').addEventListener('submit',(event)=>{event.preventDefault();search();});
    this.search.addEventListener('input',()=>{clearTimeout(this.searchTimer); this.searchTimer=setTimeout(search,300);});
    action('clear-search',()=>{this.search.value='';search();}); action('refresh-sessions',()=>{if(this.canRead()) void chat.browser.refresh();});
    action('previous-sessions',()=>{if(this.canRead()) void chat.browser.list('',Math.max(0,chat.browser.index.offset-20));});
    action('next-sessions',()=>{if(this.canRead()) void chat.browser.list('',chat.browser.index.offset+20);});
    action('browse-sessions',()=>{this.dialog.showModal();element('close-sessions').focus({preventScroll:true});});
    action('close-sessions',()=>this.closeDrawer());
    this.dialog.addEventListener('click',(event)=>{if(event.target===this.dialog)this.closeDrawer();});
    this.dialog.addEventListener('close',()=>element('browse-sessions').focus({preventScroll:true}));
    const layout=()=>{
      if(this.mobile.matches) { if(this.sidebar.parentElement!==this.dialog)this.dialog.append(this.sidebar); }
      else {this.closeDrawer();element('sidebar-slot').append(this.sidebar);}
    };
    this.mobile.addEventListener('change',layout); layout();
    const navigate=()=>{
      if(!this.canRead())return;
      try {const ref=navigationRef(location.hash);
        if(ref && draftKey(ref)!==draftKey(chat.selected)) void chat.open(ref);
        else if(!ref && chat.selected) {chat.clear();chat.setEnabled(this.canRead());}
      } catch {this.invalidLocation=true; this.render();}
    };
    window.addEventListener('popstate',navigate); window.addEventListener('hashchange',navigate);
  }
  private canRead():boolean{return this.foundation.state.auth==='signed-in'&&!this.foundation.state.offline;}
  activate():void {
    this.chat.setEnabled(this.canRead());
    if(this.canRead()&&!this.openedLocation){
      this.openedLocation=true;
      try {const ref=navigationRef(location.hash);if(ref)void this.chat.open(ref);}
      catch {this.invalidLocation=true;}
    }
  }
  private closeDrawer():void { if(this.dialog.open)this.dialog.close(); }
  private open(ref:SessionRef):void {
    if(!this.canRead())return;
    try { const hash=navigation(ref);history.pushState(null,'',hash);this.invalidLocation=false;void this.chat.open(ref);this.closeDrawer(); }
    catch {this.invalidLocation=true;this.render();}
  }
  private scrollStatus():void {
    element('new-activity').textContent=this.transcript.follow.unread?'New activity below.':'';
    element('transcript').dataset.following=String(this.transcript.follow.following);
  }
  private composer():void {
    const state=this.chat.native.state;
    const writable=this.canRead()&&this.gateway.state.phase==='ready'&&!this.chat.busy&&!this.chat.historical&&state.phase==='idle';
    this.prompt.disabled=!writable;
    element<HTMLButtonElement>('send').disabled=!writable||!this.prompt.value.trim();
    element('draft-count').textContent=`${this.prompt.value.length.toLocaleString()} / 32,768`;
  }
  render():void {
    const {chat}=this, state=chat.native.state, index=chat.browser.index, historyState=chat.browser.history;
    const ready=this.canRead()&&this.gateway.state.phase==='ready';
    const snapshot=chat.historical||(!state.runtimeId && !!historyState.page);
    const messages=snapshot?historyState.page?.messages??[]:state.messages;
    const streaming=snapshot?'':state.streaming;
    element('session-state').textContent=snapshot&&!chat.historical?'read-only':state.phase;
    if(this.prompt.value!==chat.draft)this.prompt.value=chat.draft;
    this.composer();
    element<HTMLButtonElement>('create').disabled=!ready||chat.busy;
    element<HTMLButtonElement>('resume').disabled=!this.canRead()||chat.busy;
    const stopping=!!state.interrupting;
    element<HTMLButtonElement>('interrupt').disabled=!ready||chat.historical||chat.busy||!!state.submitting||stopping||!['running','waiting'].includes(state.phase);
    element('interrupt').textContent=stopping?'Interrupting…':'Interrupt';
    element<HTMLButtonElement>('refresh').disabled=!this.canRead()||chat.busy||!chat.selected;
    element('attention').hidden=state.phase!=='waiting';
    element('delivery-unknown').hidden=!state.deliveryUnknown;
    const current=index.rows.find((row)=>row.id===chat.selected?.id && (!chat.selected?.profile||row.profile===chat.selected.profile));
    element('chat-title').textContent=current?.title||(!chat.selected?'Start a conversation':'Conversation');
    element('chat-context').textContent=chat.selected?`Hermes profile: ${chat.selected.profile??'default'} · ${chat.historical?'History snapshot':ready?'Native Gateway':'Read-only until connected'}`:'Choose a saved conversation or create a native session.';
    if(chat.selected){
      const key=element<HTMLInputElement>('session-key');if(document.activeElement!==key)key.value=chat.selected.id;
      const hash=navigation(chat.selected);if(location.hash!==hash)history.replaceState(null,'',hash);
    }
    const error=chat.error??historyState.error??state.error;
    const alert=element('chat-error');alert.hidden=!error&&!this.invalidLocation;
    if(!alert.hidden)alert.textContent=this.invalidLocation?'The conversation link is invalid.':error instanceof ClientError?error.message:'Conversation unavailable.';
    const older=element<HTMLButtonElement>('older-history'), newer=element<HTMLButtonElement>('newer-history');
    const running=['running','waiting'].includes(state.phase);
    older.disabled=!this.canRead()||chat.busy||running||!chat.selected||(chat.historical?historyState.page?.returned!==100:(state.totalMessages??historyState.page?.returned??0)<100);
    newer.disabled=!chat.historical||chat.busy||!historyState.page?.offset;
    element<HTMLButtonElement>('return-live').hidden=!chat.historical;
    element<HTMLButtonElement>('return-live').disabled=chat.busy||!this.canRead();
    element('history-status').textContent=chat.historical?`Read-only history · ${historyState.page?.returned??0} entries · newest offset ${historyState.page?.offset??0}. Return to latest to send.`:`Latest ${messages.length} entries. Earlier history is paged, never merged with a live turn.`;
    const loading=historyState.phase==='loading'||state.phase==='attaching';
    this.transcript.update(`${draftKey(chat.selected)}:${chat.historical?historyState.page?.offset??'loading':'live'}`,messages,streaming,
      loading?'Loading conversation…':error?'Conversation could not be loaded. Refresh or choose another session.':chat.selected?'No messages in this session yet.':'Your conversations stay in Hermes. Start a new session or open one from the sidebar.');
    const indexSignature=JSON.stringify([index.rows,chat.selected]);
    if(indexSignature!==this.indexSignature){
      this.indexSignature=indexSignature;
      element('session-list').replaceChildren(...index.rows.map((row)=>{
        const li=document.createElement('li'),button=document.createElement('button');button.type='button';button.className='session-row';
        button.dataset.sessionId=row.id;const title=row.title||row.preview||'Untitled conversation';
        button.setAttribute('aria-label',`Open conversation: ${title}`);
        if(row.id===chat.selected?.id)button.setAttribute('aria-current','page');
        const name=document.createElement('strong');name.textContent=title;
        const meta=document.createElement('span');meta.textContent=`${row.profile??'default'} · ${row.messageCount} messages`;
        button.append(name,meta);button.addEventListener('click',()=>this.open(row));li.append(button);return li;
      }));
    }
    element('session-list').setAttribute('aria-busy',String(index.phase==='loading'));
    element('list-status').textContent=!this.canRead()?'Sign in to browse Hermes sessions.':index.phase==='loading'?'Loading sessions…':index.phase==='error'?`${index.error?.message??'Session list unavailable'}.${index.rows.length?' Previously loaded rows are shown.':''}`:index.rows.length?index.query?`${index.rows.length} search results (up to 50).`:`${index.offset+1}–${index.offset+index.rows.length} of ${index.total} sessions`:'No conversations found.';
    for(const id of ['refresh-sessions','search-button','clear-search'])element<HTMLButtonElement>(id).disabled=!this.canRead();
    this.search.disabled=!this.canRead();
    element<HTMLButtonElement>('previous-sessions').disabled=!this.canRead()||index.phase==='loading'||!!index.query||index.offset===0;
    element<HTMLButtonElement>('next-sessions').disabled=!this.canRead()||index.phase==='loading'||!index.hasNext;
    this.scrollStatus();
  }
  clear():void {
    this.openedLocation=false;this.invalidLocation=false;clearTimeout(this.searchTimer);this.search.value='';this.prompt.value='';element<HTMLInputElement>('session-key').value='';
    this.transcript.clear();this.indexSignature='';this.closeDrawer();
  }
}
