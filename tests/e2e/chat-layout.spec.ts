import { test, expect, type Page } from '@playwright/test';
async function login(page:Page){
  await page.goto('/');await expect(page.locator('#auth-state')).toHaveText('auth-required');
  await page.getByLabel('Username',{exact:true}).fill('fixture');await page.getByLabel('Password',{exact:true}).fill('fixture-password');
  await page.locator('#login').click();await expect(page.locator('#gateway-state')).toHaveText('ready');
}
async function conversation(page:Page,text:string){
  await page.locator('#create').click();await expect(page.locator('#session-state')).toHaveText('idle');
  await page.locator('#prompt').fill(text);await page.locator('#send').click();
  await expect(page.locator('#transcript')).toContainText('SYNTHETIC_RESPONSE');await expect(page.locator('#session-state')).toHaveText('idle');
}
test('composer never covers the transcript or jump control in reduced-height layouts',async({page},info)=>{
  await login(page);await conversation(page,'Layout evidence');
  await page.setViewportSize({width:page.viewportSize()!.width,height:420});await page.locator('#prompt').fill('Draft with keyboard focus');
  const transcript=await page.locator('#transcript').boundingBox(),composer=await page.locator('#prompt-form').boundingBox(),jump=await page.locator('#latest').boundingBox();
  expect(transcript!.y+transcript!.height).toBeLessThanOrEqual(composer!.y);
  expect(jump!.y+jump!.height).toBeLessThanOrEqual(composer!.y);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.locator('.chat-panel').screenshot({path:info.outputPath('chat-reduced-height.png')});
});
test('back and forward restore only the selected draft and sign-out clears sidebar content',async({page},info)=>{
  await login(page);await conversation(page,`Navigation A ${info.project.name}`);const a=await page.locator('#session-key').inputValue();
  await page.locator('#prompt').fill('private draft A');await conversation(page,`Navigation B ${info.project.name}`);const b=await page.locator('#session-key').inputValue();
  await page.locator('#prompt').fill('private draft B');await page.goBack();
  await expect(page.locator('#session-state')).toHaveText('idle');await expect(page.locator('#session-key')).toHaveValue(a);await expect(page.locator('#prompt')).toHaveValue('private draft A');
  await page.goForward();await expect(page.locator('#session-state')).toHaveText('idle');await expect(page.locator('#session-key')).toHaveValue(b);await expect(page.locator('#prompt')).toHaveValue('private draft B');
  await page.locator('#signout').click();await expect(page.locator('#auth-state')).toHaveText('signed-out');
  await expect(page.locator('#session-list li')).toHaveCount(0);await expect(page.locator('#prompt')).toHaveValue('');expect(new URL(page.url()).hash).toBe('');
});
test('conversation controls remain keyboard reachable and the mobile drawer restores focus',async({page})=>{
  await login(page);
  if(await page.locator('#browse-sessions').isVisible()){
    await page.locator('#browse-sessions').click();await expect(page.locator('#sessions-dialog')).toBeVisible();
    await expect(page.locator('#close-sessions')).toBeFocused();await page.keyboard.press('Escape');
    await expect(page.locator('#sessions-dialog')).not.toBeVisible();await expect(page.locator('#browse-sessions')).toBeFocused();
  }else{
    await page.locator('#session-search').focus();await page.keyboard.press('Tab');await expect(page.locator('#search-button')).toBeFocused();
  }
  for(const id of ['create','search-button','refresh-sessions']){
    if(await page.locator(`#${id}`).isVisible())expect((await page.locator(`#${id}`).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
});
