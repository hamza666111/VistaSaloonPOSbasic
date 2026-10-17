import React from 'react';
import { useAppSettings } from '../store/useAppSettings';
import { useReceiptAssets } from '../hooks/useReceiptAssets';
export const ReceiptBrandHeader:React.FC=()=>{
  const {salonName,address,phone}=useAppSettings(state=>state.settings);
  const {logoSrc}=useReceiptAssets();
  return <div className="receipt-brand-header text-center mb-4 flex flex-col items-center">
    <img src={logoSrc} alt={`${salonName} logo`} className="w-24 h-24 mb-2 object-contain grayscale" />
    <h1 className="font-bold text-xl uppercase tracking-wider">{salonName}</h1>
    {address && <p className="receipt-salon-address mt-1 text-xs">{address}</p>}
    {phone && <p className="mt-1 text-xs font-medium">Contact: {phone}</p>}
    <p className="mt-2 font-bold text-base uppercase border-b border-black pb-1 inline-block">Invoice Receipt</p>
  </div>;
};
