/** Explicitly synthetic interaction driver. No tools are executed, no credentials retained. */
import { randomUUID } from 'node:crypto';
type Emit = (type: string, payload: unknown) => void;
type Kind = 'approval' | 'clarify' | 'sudo' | 'secret';
interface Case {
  kind: Kind; payload: Record<string, unknown>; steps: Kind[]; at: number;
  emit: Emit; finish: (text: string) => void; answers: Set<string>;
}
export class AgentScenarios {
  private cases = new Map<string, Case>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  readonly responseCounts = { approval: 0, clarify: 0, sudo: 0, secret: 0 };
  private later(fn: () => void, delay = 30): void {const timer=setTimeout(()=>{this.timers.delete(timer);fn();},delay);this.timers.add(timer);}
  start(sid: string, prompt: string, emit: Emit, finish: (text: string) => void): boolean {
    if (!prompt.startsWith('[agent-test]')) return false;
    emit('reasoning.delta', {text:'Testing an explicit, controlled interaction. <img src=x onerror=alert(1)>'});
    emit('thinking.delta', {text:'Waiting for operator input.'});
    emit('tool.start', {tool_id:'fixture-tool',name:'fixture_operation',args:{purpose:'Synthetic browser contract'}});
    emit('tool.progress', {tool_id:'fixture-tool',name:'fixture_operation',text:'Requesting confirmation…'});
    const steps: Kind[] = prompt.includes('secret') || prompt.includes('expire') ? ['secret'] : prompt.includes('clarify') ? ['clarify'] : prompt.includes('approval') ? ['approval'] : ['approval','clarify','sudo','secret'];
    const current:Case={kind:steps[0]!,steps,at:0,payload:{},emit,finish,answers:new Set()};
    this.cases.set(sid,current);this.issue(current);
    if (prompt.includes('expire')) this.later(()=>{
      if(this.cases.get(sid)!==current)return;
      current.emit('secret.expire',{request_id:current.payload.request_id});this.complete(sid,current,'Expired without a response');
    },1600);
    return true;
  }
  private issue(c:Case):void {
    c.kind=c.steps[c.at]!;c.answers.clear();c.payload={request_id:randomUUID()};
    if(c.kind==='approval')Object.assign(c.payload,{command:'printf "synthetic only"',description:'The browser fixture will not execute this command.',choices:['once','session','always','deny']});
    if(c.kind==='clarify')Object.assign(c.payload,{questions:[{qid:'colour',question:'Select colours',choices:['Blue','Green'],multi_select:true},{qid:'note',question:'Add a note'}]});
    if(c.kind==='secret')Object.assign(c.payload,{prompt:'Provide a synthetic test value. Do not enter a real credential.',env_var:'FIXTURE_ONLY_KEY'});
    c.emit(`${c.kind}.request`,c.payload);
  }
  snapshot(sid:string,emit:Emit):Record<string,unknown>{
    const c=this.cases.get(sid);if(!c)return {};
    c.emit=emit;
    return {status:'waiting',...(['approval','clarify'].includes(c.kind)?{[`pending_${c.kind}`]:c.payload}:{})};
  }
  respond(sid:string,method:string,params:Record<string,unknown>,reply:(value:unknown)=>void):boolean {
    const kind=method.split('.')[0] as Kind;
    if(!['approval.respond','clarify.respond','sudo.respond','secret.respond'].includes(method))return false;
    const c=this.cases.get(sid);
    if(!c||c.kind!==kind||c.payload.request_id!==params.request_id){reply(kind==='approval'?{resolved:0}:{status:'expired'});return true;}
    this.responseCounts[kind]++;
    if(kind==='approval'&&!['once','deny'].includes(String(params.choice))){reply({resolved:0});return true;}
    if(kind==='clarify'&&params.question_id){
      if(!['colour','note'].includes(String(params.question_id))){reply({status:'expired'});return true;}
      c.answers.add(String(params.question_id));
      const remaining=['colour','note'].filter(q=>!c.answers.has(q));
      c.payload.answers=Object.fromEntries([...c.answers].map(q=>[q,'confirmed']));
      reply({status:'ok',remaining});
      if(remaining.length){c.emit('session.info',{running:true});return true;}
    } else reply(kind==='approval'?{resolved:1}:{status:'ok'});
    this.later(()=>{
      if(this.cases.get(sid)!==c)return;
      if(kind==='approval'&&params.choice==='deny'){this.complete(sid,c,'Operation denied');return;}
      if(++c.at<c.steps.length)this.issue(c);else this.complete(sid,c,'SYNTHETIC_AGENT_COMPLETE');
    });
    return true;
  }
  private complete(sid:string,c:Case,text:string):void {
    this.cases.delete(sid);
    c.emit('tool.complete',{tool_id:'fixture-tool',name:'fixture_operation',duration_s:0.3,result:{success:true,output:text}});
    c.emit('message.complete',{text});c.finish(text);c.emit('session.info',{running:false});
  }
  interrupt(sid:string):void {const c=this.cases.get(sid);if(c){c.emit(`${c.kind}.expire`,{request_id:c.payload.request_id});this.cases.delete(sid);}}
  close():void {this.timers.forEach(clearTimeout);this.cases.clear();}
}
