import { test, expect, type Page } from '@playwright/test';
async function signIn(page:Page){
  await page.goto('/');await expect(page.locator('#auth-state')).toHaveText('auth-required');
  await page.getByLabel('Username',{exact:true}).fill('fixture');await page.getByLabel('Password',{exact:true}).fill('fixture-password');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.locator('#gateway-state')).toHaveText('ready');
}
async function create(page:Page,text:string){
  await page.getByRole('button',{name:'New session',exact:true}).click();await expect(page.locator('#session-state')).toHaveText('idle');
  await page.getByLabel('Prompt',{exact:true}).fill(text);await page.getByRole('button',{name:'Send prompt',exact:true}).click();
  await expect(page.locator('#transcript')).toContainText('SYNTHETIC_RESPONSE');await expect(page.locator('#session-state')).toHaveText('idle');
}
async function browse(page:Page,search:string){
  if(await page.locator('#browse-sessions').isVisible())await page.locator('#browse-sessions').click();
  await page.getByLabel('Search conversations',{exact:true}).fill(search);await page.getByRole('button',{name:'Search',exact:true}).click();
  await expect(page.locator('#session-list')).toHaveAttribute('aria-busy','false');
}
test('two conversations can be searched, opened, continued and reloaded without local history',async({page},info)=>{
  await signIn(page);const a=`P2-A-${info.project.name}-${Date.now()}`, b=`P2-B-${info.project.name}-${Date.now()}`;
  await create(page,a);const key=await page.locator('#session-key').inputValue();await create(page,b);
  await browse(page,a);await page.getByRole('button',{name:`Open conversation: ${a}`,exact:true}).click();
  await expect(page.locator('#session-state')).toHaveText('idle');await expect(page.locator('#transcript')).toContainText(a);
  await expect(page.locator('#transcript')).not.toContainText(b);await expect(page.locator('#session-key')).toHaveValue(key);
  await page.getByLabel('Prompt',{exact:true}).fill('Continue the selected conversation');await page.getByRole('button',{name:'Send prompt',exact:true}).click();
  await expect(page.locator('#transcript [data-role="assistant"]')).toHaveCount(2);await page.reload();
  await expect(page.locator('#session-state')).toHaveText('idle');await expect(page.locator('#transcript')).toContainText(a);
  expect(await page.evaluate(()=>[localStorage.length,sessionStorage.length])).toEqual([0,0]);
  await page.locator('.chat-panel').screenshot({path:info.outputPath('native-chat.png')});
});
test('saved history remains readable without a Gateway and resumes after reconnect',async({page},info)=>{
  await signIn(page);const title=`Read-only-${info.project.name}-${Date.now()}`;await create(page,title);
  await page.getByRole('button',{name:'Disconnect transport',exact:true}).click();await browse(page,title);
  await page.getByRole('button',{name:`Open conversation: ${title}`,exact:true}).click();
  await expect(page.locator('#transcript')).toContainText(title);await expect(page.locator('#session-state')).toHaveText('read-only');
  await expect(page.locator('#send')).toBeDisabled();await page.getByRole('button',{name:'Reconnect',exact:true}).click();
  await expect(page.locator('#session-state')).toHaveText('idle');await expect(page.locator('#prompt')).toBeEnabled();
});
test('interrupt ends a controlled running turn and the next prompt can complete',async({page})=>{
  await signIn(page);await page.locator('#create').click();await expect(page.locator('#session-state')).toHaveText('idle');
  await page.locator('#prompt').fill('[slow-test] stop this controlled turn');await page.locator('#send').click();
  await expect(page.locator('#transcript')).toContainText('Controlled turn is running');await page.locator('#interrupt').click();
  await expect(page.locator('#session-state')).toHaveText('idle');await expect(page.locator('#transcript [data-role="assistant"]')).toHaveCount(0);
  await page.locator('#prompt').fill('After interruption');await page.locator('#send').click();await expect(page.locator('#transcript')).toContainText('SYNTHETIC_RESPONSE');
  await expect(page.locator('#session-state')).toHaveText('idle');
});
test('history windows replace rather than append and return to the live composer',async({page})=>{
  await signIn(page);await browse(page,'Seed 0 entry 0');await page.getByRole('button',{name:'Open conversation: Seed 0 entry 0',exact:true}).click();
  await expect(page.locator('#session-state')).toHaveText('idle');await expect(page.locator('#transcript article')).toHaveCount(100);
  await page.getByRole('button',{name:'Older messages',exact:true}).click();await expect(page.locator('#history-status')).toContainText('newest offset 100');
  await expect(page.locator('#transcript article')).toHaveCount(10);await expect(page.locator('#transcript')).toContainText('Seed 0 entry 0');
  await expect(page.locator('#send')).toBeDisabled();await page.getByRole('button',{name:'Return to latest',exact:true}).click();
  await expect(page.locator('#prompt')).toBeEnabled();await expect(page.locator('#transcript article')).toHaveCount(100);
});
test('streaming preserves completed nodes and respects scroll-up until Jump to latest',async({page})=>{
  await signIn(page);await page.locator('#create').click();await expect(page.locator('#session-state')).toHaveText('idle');
  await page.locator('#prompt').fill('[stream-test] '+('Long user context\n'.repeat(70)));await page.locator('#send').click();
  await expect(page.locator('#transcript')).toContainText('Streaming line 4');
  await page.locator('#transcript article').first().evaluate(node=>node.setAttribute('data-preserved','true'));
  await page.locator('#transcript').evaluate(node=>{node.scrollTop=0;node.dispatchEvent(new Event('scroll'));});
  await expect(page.locator('#transcript')).toHaveAttribute('data-following','false');
  await expect(page.locator('#transcript')).toContainText('Streaming line 20');
  expect(await page.locator('#transcript').evaluate(node=>node.scrollTop)).toBeLessThan(2);
  await expect(page.locator('#transcript article').first()).toHaveAttribute('data-preserved','true');
  await page.locator('#latest').click();await expect(page.locator('#transcript')).toHaveAttribute('data-following','true');
  await expect(page.locator('#session-state')).toHaveText('idle');await expect(page.locator('#transcript article')).toHaveCount(2);
});
test('keyboard composition does not send, desktop Enter sends and touch Enter adds a line',async({page},info)=>{
  await signIn(page);await page.locator('#create').click();await expect(page.locator('#session-state')).toHaveText('idle');
  await page.locator('#prompt').fill('Keyboard test');await page.locator('#prompt').dispatchEvent('keydown',{key:'Enter',isComposing:true,keyCode:229});
  await expect(page.locator('#transcript article')).toHaveCount(0);
  await page.locator('#prompt').press('Enter');
  if(info.project.name!=='desktop-chromium') {await expect(page.locator('#prompt')).toHaveValue('Keyboard test\n');await expect(page.locator('#transcript article')).toHaveCount(0);await page.locator('#send').click();}
  await expect(page.locator('#transcript')).toContainText('SYNTHETIC_RESPONSE');
});
test('code fences and hostile HTML stay inert without horizontal viewport overflow',async({page})=>{
  await signIn(page);await create(page,'```html\n<img src=x onerror=alert(1)>\n```\n'+'unbroken'.repeat(300));
  await expect(page.locator('#transcript img')).toHaveCount(0);await expect(page.locator('#transcript code')).toContainText('<img');
  await expect(page.locator('#transcript').getByRole('button',{name:'Copy code',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
