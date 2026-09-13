export class BottomFollow {
  following = true;
  unread = false;
  scroll(top: number, height: number, viewport: number): void {
    this.following = height - top - viewport <= 64;
    if (this.following) this.unread = false;
  }
  changed(): boolean { if (!this.following) this.unread = true; return this.following; }
  latest(): void { this.following = true; this.unread = false; }
}
export function enterSends(event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey' | 'isComposing' | 'keyCode'>, touch: boolean): boolean {
  return event.key === 'Enter' && !event.isComposing && event.keyCode !== 229 && !event.shiftKey && !event.altKey && (!touch || event.ctrlKey || event.metaKey);
}
