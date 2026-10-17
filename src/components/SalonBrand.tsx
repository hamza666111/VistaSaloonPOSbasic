import React from 'react';
import { Scissors } from 'lucide-react';
import { useAppSettings } from '../store/useAppSettings';
export const SalonBrand: React.FC = () => {
  const settings=useAppSettings(state=>state.settings);
  return <><span className="brand-mark">{settings.logoDataUrl ? <img src={settings.logoDataUrl} alt={`${settings.salonName} logo`} /> : <Scissors size={23} />}</span><span className="brand-copy"><strong>{settings.salonName}</strong><small>POS SYSTEM</small></span></>;
};
