/** Stop delayed requests when this document is actually leaving, not when cached.
 * Mobile Safari can otherwise run a queued sidebar refresh during navigation. */
export function onDocumentExit(target: EventTarget, dispose: () => void): () => void {
  const remove = () => target.removeEventListener('pagehide', hide);
  const hide = (event: Event) => {
    if ((event as PageTransitionEvent).persisted) return;
    remove();
    dispose();
  };
  target.addEventListener('pagehide', hide);
  return remove;
}
