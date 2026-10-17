import React, { useEffect, useState } from 'react';
import { Save, Upload, Trash2 } from 'lucide-react';
import { AppBranding, appSettingsRemoteEnabled, useAppSettings } from '../store/useAppSettings';
import { applyAppTheme } from '../theme/appTheme';
import { prepareSalonLogo } from '../utils/salonLogo';
const themes=[['Evergreen','#245b49'],['Ocean','#245a91'],['Plum','#744497'],['Rose','#984b66'],['Amber','#8b641e'],['Slate','#465568']];
export const AppSettingsPanel:React.FC=()=>{
  const {settings,isLoading,isSaving,remoteReady,syncError,save,sync}=useAppSettings();
  const [draft,setDraft]=useState<{fields:AppBranding;baseVersion:number}|null>(null);
  const [uploading,setUploading]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const value=draft?.fields||settings;
  const blocked=isSaving||uploading||(appSettingsRemoteEnabled&&!remoteReady);
  const validColor=/^#[0-9a-f]{6}$/i.test(value.themeColor);
  const update=(patch:Partial<AppBranding>)=>{setDraft({fields:{...value,...patch},baseVersion:draft?.baseVersion??settings.version});setNotice('');};
  useEffect(()=>{applyAppTheme(value.themeColor);return()=>applyAppTheme(useAppSettings.getState().settings.themeColor);},[value.themeColor,settings.version]);
  const submit=async(event:React.FormEvent)=>{
    event.preventDefault();if(!draft)return;
    try {await save(draft.fields,draft.baseVersion);setDraft(null);setError('');setNotice('App settings saved. Your branding is ready for the app and receipts.');}
    catch(cause){setError(cause instanceof Error?cause.message:'Unable to save app settings.');}
  };
  const upload=async(file?:File)=>{
    if(!file)return;setUploading(true);setError('');
    try{update({logoDataUrl:await prepareSalonLogo(file)});}catch(cause){setError(cause instanceof Error?cause.message:'Unable to read logo.');}finally{setUploading(false);}
  };
  return <section className="app-settings-panel">
    <div className="app-settings-heading"><h2>Your salon, your identity</h2><p>Personalize the workspace and the details your customers see on receipts.</p></div>
    {appSettingsRemoteEnabled&&<div className={syncError?'category-sync-error':'category-sync-status'} role={syncError?'alert':'status'}><span>{syncError|| (isSaving?'Saving app settings...':isLoading?'Refreshing app settings...':'App settings are shared across devices.')}</span><button type="button" disabled={isLoading||isSaving} onClick={()=>void sync()}>Refresh app settings</button></div>}
    {error&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {notice&&<p role="status" className="rounded-lg bg-teal-50 p-3 text-sm text-teal-700">{notice}</p>}
    {draft&&settings.version!==draft.baseVersion&&<p className="app-settings-conflict">Settings changed on another device. Your draft is kept. <button type="button" onClick={()=>{setDraft(null);setError('');}}>Load latest settings</button></p>}
    <form onSubmit={submit}>
      <fieldset disabled={blocked} className="app-settings-grid">
        <div className="app-settings-fields">
          <div className="app-settings-card"><h3>Salon details</h3><label htmlFor="salon-name">Salon name</label><input id="salon-name" value={value.salonName} onChange={event=>update({salonName:event.target.value})} maxLength={80} required />
            <label htmlFor="salon-address">Address</label><textarea id="salon-address" value={value.address} onChange={event=>update({address:event.target.value})} maxLength={300} rows={3} placeholder="Your salon address" />
            <label htmlFor="salon-phone">Contact number</label><input id="salon-phone" type="tel" value={value.phone} onChange={event=>update({phone:event.target.value})} maxLength={40} placeholder="e.g. +92 300 1234567" />
          </div>
          <div className="app-settings-card"><h3>Theme color</h3><div className="theme-presets">{themes.map(([name,color])=><button key={name} type="button" aria-label={`Use ${name} theme`} aria-pressed={value.themeColor.toLowerCase()===color} onClick={()=>update({themeColor:color})}><i style={{backgroundColor:color}} />{name}</button>)}</div><div className="custom-theme-input"><label htmlFor="app-theme-color">Custom color</label><input id="app-theme-color" type="color" value={validColor?value.themeColor:'#245b49'} onChange={event=>update({themeColor:event.target.value})} /><input aria-label="Theme hex color" value={value.themeColor} maxLength={7} onChange={event=>update({themeColor:event.target.value})} /></div><p className="app-settings-hint">Color shades adjust automatically to keep text and buttons readable. Save to keep this theme.</p></div>
          <div className="app-settings-card"><h3>Salon logo</h3><div className="logo-upload-controls"><label className="logo-upload-button"><Upload size={16}/>{uploading?'Preparing logo...':'Upload logo'}<input aria-label="Upload salon logo" type="file" accept="image/png,image/jpeg,image/webp" onChange={event=>{void upload(event.target.files?.[0]);event.target.value='';}} /></label><button type="button" disabled={!value.logoDataUrl} onClick={()=>update({logoDataUrl:null})}><Trash2 size={15}/>Remove logo</button></div><p className="app-settings-hint">PNG, JPG, or WebP up to 5 MB. The logo is resized for a clear, lightweight app and receipt.</p></div>
        </div>
        <aside className="app-brand-preview"><span className="eyebrow">RECEIPT PREVIEW</span><div className="receipt-brand-sample"><img src={value.logoDataUrl||'/logo.svg'} alt="Salon logo preview"/><h3>{value.salonName||'Your salon'}</h3>{value.address&&<p className="receipt-salon-address">{value.address}</p>}{value.phone&&<p>Contact: {value.phone}</p>}<hr/><strong>Invoice Receipt</strong><div className="receipt-preview-line"><span>Sample service</span><span>Rs. 1,000</span></div><div className="receipt-preview-line"><strong>Total</strong><strong>Rs. 1,000</strong></div><p className="receipt-preview-thanks">Thank you for your visit!</p></div><p className="app-settings-hint">The saved logo and contact details appear in both receipt print flows. Receipts remain printer-friendly in black and white.</p></aside>
      </fieldset>
      <div className="app-settings-actions"><button type="submit" disabled={blocked||!draft||!validColor} className="app-settings-save"><Save size={16}/>{isSaving?'Saving...':'Save app settings'}</button><button type="button" disabled={isSaving||uploading||!draft} onClick={()=>{setDraft(null);setError('');setNotice('');}}>Cancel changes</button></div>
    </form>
  </section>;
};
