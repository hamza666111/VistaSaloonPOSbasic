import React, { useRef } from 'react';
import { createPortal } from 'react-dom';
import { useDialogFocus } from '../hooks/useDialogFocus';
export const ResponsiveDialog: React.FC<{ children: React.ReactNode; label: string; onClose: () => void; className?: string }> = ({children,label,onClose,className=''}) => {
  const ref=useRef<HTMLDivElement>(null);
  useDialogFocus(ref,true,onClose);
  return createPortal(<div className="dialog-backdrop no-print"><div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={label} className={`responsive-dialog ${className}`}>{children}</div></div>,document.body);
};
