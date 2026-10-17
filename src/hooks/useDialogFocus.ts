import { RefObject, useEffect, useRef } from 'react';
let openDialogs: HTMLElement[] = [];
let previousOverflow = '';
export function useDialogFocus(ref: RefObject<HTMLElement>, open: boolean, onClose: () => void) {
  const closeRef=useRef(onClose); closeRef.current=onClose;
  useEffect(() => {
    const node = ref.current;
    if (!open || !node) return;
    const previous = document.activeElement as HTMLElement | null;
    if (!openDialogs.length) { previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; }
    openDialogs.push(node);
    const focusable = () => Array.from(node.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')).filter(item => item.getClientRects().length > 0);
    const timer = window.setTimeout(() => { (focusable()[0] || node).focus({ preventScroll: true }); }, 0);
    const keydown = (event: KeyboardEvent) => {
      if (openDialogs[openDialogs.length - 1] !== node) return;
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); }
      if (event.key === 'Tab') {
        const items = focusable(); const first = items[0]; const last = items[items.length - 1];
        if (!first) { event.preventDefault(); node.focus(); }
        else if (event.shiftKey && (document.activeElement === first || !node.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !node.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      clearTimeout(timer); document.removeEventListener('keydown', keydown);
      openDialogs = openDialogs.filter(item => item !== node);
      if (!openDialogs.length) document.body.style.overflow = previousOverflow;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [open, ref]);
}
