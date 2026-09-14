import { test, expect, type Page } from '@playwright/test';
async function start(page:Page,scenario=''){
  await page.goto('/');await expect(page.locator('#auth-state')).toHaveText('auth-required');
  await page.getByLabel('Username',{exact:true}).fill('fixture');await page.getByLabel('Password',{exact:true}).fill('fixture-password');
  await page.locator('#login').click();await expect(page.locator('#gateway-state')).toHaveText('ready');
  await page.locator('#create').click();await expect(page.locator('#session-state')).toHaveText('idle');
  await page.locator('#prompt').fill(`[agent-test] ${scenario}`);await page.locator('#send').click();
}
test('tool activity and all four input types work without exposing credentials',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await start(page);
  const approval=page.getByRole('article',{name:'Operation approval'});
  await expect(approval).toContainText('printf');
  await expect(approval.getByRole('button',{name:'Allow once',exact:true})).toBeEnabled();
  await expect(approval.getByRole('button',{name:'Approve for session',exact:true})).toBeEnabled();
  await expect(approval.getByRole('button',{name:'YOLO',exact:true})).toBeEnabled();
  await expect(approval.getByRole('button',{name:/Always/})).toHaveCount(0);
  await approval.getByRole('button',{name:'Approve for session',exact:true}).click();
  const clarify=page.getByRole('article',{name:'Question from Hermes'});
  await clarify.getByLabel('Blue',{exact:true}).check();await clarify.getByLabel('Green',{exact:true}).check();
  await clarify.getByLabel('Your answer',{exact:true}).fill('Keep this second answer while confirming the first');
  await clarify.getByRole('button',{name:'Confirm answer',exact:true}).first().click();
  await expect(clarify).toContainText('Answer confirmed');
  await expect(clarify.getByLabel('Your answer',{exact:true})).toHaveValue('Keep this second answer while confirming the first');
  await clarify.getByRole('button',{name:'Confirm answer',exact:true}).last().click();
  const password=page.getByLabel('Sudo password',{exact:true});await password.fill('ONLY_FIXTURE_PASSWORD');
  await expect(password).toHaveAttribute('type','password');await page.getByRole('button',{name:'Send password',exact:true}).click();await expect(password).toHaveValue('');
  const secret=page.getByLabel('Secret value',{exact:true});await secret.fill('ONLY_FIXTURE_SECRET');
  await expect(secret).toHaveAttribute('type','password');await page.getByRole('button',{name:'Save in Hermes',exact:true}).click();await expect(secret).toHaveValue('');
  await expect(page.locator('#session-state')).toHaveText('idle');await expect(page.locator('#transcript')).toContainText('SYNTHETIC_AGENT_COMPLETE');
  await expect(page.locator('#transcript')).not.toContainText('ONLY_FIXTURE_');
  await expect(page.locator('#agent-activity img')).toHaveCount(0);
  await page.locator('.agent-tool summary').click();await expect(page.locator('.agent-tool')).toContainText('SYNTHETIC_AGENT_COMPLETE');
  expect(await page.evaluate(()=>[localStorage.length,sessionStorage.length])).toEqual([0,0]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
  await page.locator('#agent-activity').screenshot({path:info.outputPath('agent-interactions.png')});
});
test('approval is recoverable after reload and can be explicitly denied',async({page})=>{
  await start(page,'approval');await expect(page.getByRole('button',{name:'Allow once',exact:true})).toBeEnabled();
  await expect(page.getByRole('button',{name:'Approve for session',exact:true})).toBeEnabled();
  await page.reload();await expect(page.getByRole('button',{name:'Deny',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Deny',exact:true}).click();await expect(page.locator('#transcript')).toContainText('Operation denied');
  await expect(page.locator('#session-state')).toHaveText('idle');
});
test('YOLO approval enables the session switch and the composer can disable it again',async({page})=>{
  await start(page,'approval');
  const yolo=page.getByRole('switch',{name:'YOLO mode for this conversation'});
  await expect(yolo).not.toBeChecked();await expect(yolo).toBeDisabled();
  await page.getByRole('button',{name:'YOLO',exact:true}).click();
  await expect(page.locator('#session-state')).toHaveText('idle');
  await expect(yolo).toBeEnabled();await expect(yolo).toBeChecked();
  await yolo.uncheck();await expect(yolo).not.toBeChecked();
});
test('disconnect clears a masked field and does not resurrect a credential prompt',async({page})=>{
  await start(page,'secret');await page.getByLabel('Secret value',{exact:true}).fill('DO_NOT_RETAIN');
  await page.getByRole('button',{name:'Disconnect transport',exact:true}).click();
  await expect(page.getByLabel('Secret value',{exact:true})).toHaveValue('');await expect(page.getByRole('button',{name:'Save in Hermes',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Reconnect',exact:true}).click();await expect(page.locator('#gateway-state')).toHaveText('ready');
  await expect(page.locator('.agent-warning')).toContainText('cannot recover');await expect(page.getByRole('button',{name:'Save in Hermes',exact:true})).toBeDisabled();
  await page.locator('#interrupt').click();await expect(page.locator('#session-state')).toHaveText('idle');
});
test('expired credentials become non-actionable and their entered values are removed',async({page})=>{
  await start(page,'expire');await page.getByLabel('Secret value',{exact:true}).fill('DO_NOT_SEND_EXPIRED');
  await expect(page.locator('.agent-secret')).toHaveAttribute('data-status','expired');
  await expect(page.getByLabel('Secret value',{exact:true})).toHaveValue('');await expect(page.getByRole('button',{name:'Save in Hermes',exact:true})).toBeDisabled();
});
test('clarify forms preserve DOM identity and remain usable at reduced viewport height',async({page},info)=>{
  await start(page,'clarify');const note=page.getByLabel('Your answer',{exact:true});await note.fill('Draft for the current question');
  await note.evaluate(n=>n.setAttribute('data-preserved','yes'));await page.setViewportSize({width:page.viewportSize()!.width,height:420});
  await page.locator('#refresh').click();await expect(note).toHaveAttribute('data-preserved','yes');await expect(note).toHaveValue('Draft for the current question');
  for(const btn of await page.locator('.agent-card button').all())expect((await btn.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.locator('.agent-card').screenshot({path:info.outputPath('agent-reduced-height.png')});
  await page.getByRole('button',{name:'Cancel question request',exact:true}).click();await expect(page.locator('#session-state')).toHaveText('idle');
});
test('changing selection and signing out remove pending secrets and tool content',async({page})=>{
  await start(page,'secret');await page.getByLabel('Secret value',{exact:true}).fill('OLD_SELECTION_SECRET');
  await page.locator('#create').click();await expect(page.locator('#agent-activity')).not.toBeVisible();await expect(page.locator('#agent-activity input[type="password"]')).toHaveCount(0);
  await page.locator('#signout').click();await expect(page.locator('#auth-state')).toHaveText('signed-out');
  await expect(page.locator('#agent-activity .agent-card')).toHaveCount(0);
});
