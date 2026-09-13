import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BottomFollow, enterSends } from '../../src/hermes/chat-behaviour.js';
test('scroll-up suspends follow until user returns to bottom or explicitly jumps',()=>{
  const follow=new BottomFollow();assert.equal(follow.changed(),true);
  follow.scroll(0,1000,300);assert.equal(follow.changed(),false);assert.equal(follow.unread,true);
  follow.latest();assert.equal(follow.changed(),true);assert.equal(follow.unread,false);
});
test('desktop Enter sends; mobile Enter, Shift+Enter and composition insert text instead',()=>{
  const event={key:'Enter',shiftKey:false,altKey:false,ctrlKey:false,metaKey:false,isComposing:false,keyCode:13};
  assert.equal(enterSends(event,false),true);assert.equal(enterSends(event,true),false);
  assert.equal(enterSends({...event,shiftKey:true},false),false);assert.equal(enterSends({...event,isComposing:true},false),false);
  assert.equal(enterSends({...event,keyCode:229},false),false);assert.equal(enterSends({...event,metaKey:true},true),true);
});
