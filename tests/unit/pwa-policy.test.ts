import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { pwaAsset } from '../../server/pwa.js';

function worker() {
  const events = new Map<string, (event: Record<string, unknown>) => void>();
  const responses = new Map<string, Response>(), fetched: Request[] = [];
  let windows = [{id:'current'}], activated = 0;
  const cache = { put: async (key:string, response:Response) => { responses.set(key,response); } };
  const self = {location:{origin:'https://chat.example'}, addEventListener:(type:string, fn:(event:Record<string,unknown>)=>void)=>events.set(type,fn),
    clients:{matchAll:async()=>windows,claim:async()=>{}},skipWaiting:async()=>{activated++;}};
  const policy = readFileSync('pwa/service-worker.js','utf8').replace('__BUILD_ID__','test').replace('__PRECACHE__',JSON.stringify(['/','/assets/client.js']));
  runInNewContext(policy,{self,Set,URL,Request,Response,caches:{open:async()=>cache,delete:async()=>{},keys:async()=>[],match:async(key:string)=>responses.get(key)},
    fetch:async (req:Request)=>{fetched.push(req);return new Response('STATIC',{headers:{'x-webui-static':'1'}});}});
  return {events,responses,fetched,setWindows:(count:number)=>{windows=Array.from({length:count},(_,i)=>({id:i?'other':'current'}));},activated:()=>activated};
}
test('service worker precaches only explicit unauthenticated static fetches', async () => {
  const w=worker(); let done!:Promise<void>; w.events.get('install')!({waitUntil:(p:Promise<void>)=>{done=p;}});await done;
  assert.deepEqual([...w.responses.keys()],['/','/assets/client.js']);
  assert.ok(w.fetched.every(req=>req.credentials==='omit' && req.redirect==='error')); assert.equal(w.activated(),0);
});
test('worker bypasses APIs, auth, diagnostics, workspace, foreign origins, queries and writes', () => {
  const w=worker(); for(const path of ['/__hermes/api/ws','/__hermes/auth/password-login','/api/webui/access','/api/workspace','/diagnostic','/?ticket=secret','/assets/client.js?credential=secret','https://elsewhere.example/']) {
    let intercepted=false;w.events.get('fetch')!({request:new Request(new URL(path,'https://chat.example')),respondWith:()=>{intercepted=true;}});assert.equal(intercepted,false,path);
  }
  let intercepted=false;w.events.get('fetch')!({request:new Request('https://chat.example/',{method:'POST'}),respondWith:()=>{intercepted=true;}});assert.equal(intercepted,false);
});
test('an update waits for an explicit request and refuses activation with another open tab', async () => {
  const w=worker();const replies:unknown[]=[];let done!:Promise<void>;
  const event={source:{url:'https://chat.example/',id:'current'},ports:[{postMessage:(value:unknown)=>replies.push(value)}],data:{type:'HERMES_ACTIVATE'},waitUntil:(p:Promise<void>)=>{done=p;}};
  w.setWindows(2);w.events.get('message')!(event);await done;assert.equal(w.activated(),0);
  assert.equal(JSON.stringify(replies[0]),JSON.stringify({result:'other-tabs'}));
  w.setWindows(1);w.events.get('message')!(event);await done;assert.equal(w.activated(),1);
});
test('static PWA routes never expose certificate files, inventories or traversal', () => {
  for(const path of ['/sw.js','/manifest.webmanifest','/pwa/icon-192.png'])assert.ok(pwaAsset(path));
  for(const path of ['/pwa/../server.key','/.local/tls/ca/ca.key','/pwa/build.json','/pwa/icon-192.png?x'])assert.equal(pwaAsset(path),undefined);
});
