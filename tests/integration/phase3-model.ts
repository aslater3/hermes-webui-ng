import { m3Tool } from './m3-model.js';
/** Controlled model decisions for real, unmodified Hermes tool execution. */
export interface FixtureToolCall { id: string; type: 'function'; function: { name: string; arguments: string }; }
export function phase3Tool(messages: unknown[], tools: unknown): FixtureToolCall | undefined {
  const m3 = m3Tool(messages, tools); if (m3) return m3;
  const object=(value:unknown):Record<string,unknown>=>typeof value==='object'&&value!==null&&!Array.isArray(value)?value as Record<string,unknown>:{};
  let at=messages.length-1;while(at>=0&&object(messages[at]).role!=='user')at--;
  const prompt=object(messages[at]).content;
  if(typeof prompt!=='string'||!prompt.startsWith('PHASE3_CLARIFY_'))return;
  // A tool result after this turn's user message is authoritative; never call twice.
  if(messages.slice(at+1).some(m=>object(m).role==='tool'))return;
  const offered=Array.isArray(tools)&&tools.some(t=>object(object(t).function).name==='clarify');
  if(!offered)throw new Error('Pinned Hermes did not advertise the required clarify tool');
  return {id:'call_phase3_clarify',type:'function',function:{name:'clarify',arguments:JSON.stringify({questions:[
    {question:'Choose the controlled test transport',choices:['HTTP','WebSocket'],multi_select:true},
    {question:'Give the controlled acceptance note'}
  ]})}};
}
