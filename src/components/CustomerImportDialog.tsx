import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { WorkBook } from 'xlsx';
import { Download, Upload, X } from 'lucide-react';
import { ResponsiveDialog } from './ResponsiveDialog';
import { useStore } from '../store/useStore';
import { supabase } from '../api/supabase';
import type { Customer } from '../types';
import { customerImportPhoneKey, extractImportSheet, ImportField, ImportMapping, ImportSheet, prepareCustomerImport, readCustomerWorkbook, suggestedMapping } from '../utils/customerImport';
import { isDuplicateCustomerError } from '../utils/customerDuplicates';

type Result={status:'imported'|'queued'|'failed'|'duplicate';reason:string};
async function fetchExistingCustomers(signal?:AbortSignal):Promise<Customer[]> {
  if(!supabase)return useStore.getState().customers;
  if(!navigator.onLine)throw new Error('Reconnect to check existing customers before importing.');
  const rows:Customer[]=[];
  for(let from=0;;from+=1000){
    if(signal?.aborted)throw new Error('Customer check cancelled.');
    const request=new AbortController();const abort=()=>request.abort();
    signal?.addEventListener('abort',abort,{once:true});
    const timeout=setTimeout(abort,15000);
    try{
      const {data,error}=await supabase.from('customers').select('id,name,phone').order('id',{ascending:true}).range(from,from+999).abortSignal(request.signal);
      if(error||!data)throw new Error('Unable to check existing customers. Refresh the check before importing.');
      rows.push(...data);if(data.length<1000)break;
    }finally{clearTimeout(timeout);signal?.removeEventListener('abort',abort);}
  }
  return rows;
}
const fields:{key:ImportField;label:string}[]=[{key:'name',label:'Customer name'},{key:'phone',label:'Phone number'},{key:'email',label:'Email (optional)'},{key:'notes',label:'Notes / address (optional)'}];
export const CustomerImportDialog:React.FC<{onClose:()=>void}>=({onClose})=>{
  const customers=useStore(state=>state.customers);
  const [book,setBook]=useState<WorkBook|null>(null),[sheetName,setSheetName]=useState(''),[sheet,setSheet]=useState<ImportSheet|null>(null);
  const [mapping,setMapping]=useState<ImportMapping>({name:-1,phone:-1,email:-1,notes:-1});
  const [existing,setExisting]=useState<Customer[]>([]),[checked,setChecked]=useState(!supabase),[checking,setChecking]=useState(false);
  const [parsing,setParsing]=useState(false),[importing,setImporting]=useState(false),[templateBusy,setTemplateBusy]=useState(false);
  const [error,setError]=useState(''),[fileName,setFileName]=useState(''),[results,setResults]=useState<Record<string,Result>>({}),[page,setPage]=useState(1),[progress,setProgress]=useState({done:0,total:0});
  const checkController=useRef<AbortController|null>(null),checkGeneration=useRef(0);
  const mounted=useRef(true),readGeneration=useRef(0),lock=useRef(false);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;++readGeneration.current;++checkGeneration.current;checkController.current?.abort();};},[]);
  useEffect(()=>{if(!importing)return;const prevent=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',prevent);return()=>window.removeEventListener('beforeunload',prevent);},[importing]);
  const refresh=async()=>{
    const generation=++checkGeneration.current;checkController.current?.abort();const controller=new AbortController();checkController.current=controller;
    setChecking(true);setChecked(false);
    try{const records=await fetchExistingCustomers(controller.signal);if(mounted.current&&generation===checkGeneration.current){setExisting(records);setChecked(true);}return generation===checkGeneration.current?records:null;}
    catch(cause){if(mounted.current&&generation===checkGeneration.current)setError(cause instanceof Error?cause.message:'Unable to check existing customers.');return null;}
    finally{if(mounted.current&&generation===checkGeneration.current)setChecking(false);}
  };
  useEffect(()=>{void refresh();},[]);
  const mergedExisting=useMemo(()=>[...existing,...customers],[existing,customers]);
  const rows=useMemo(()=>sheet?prepareCustomerImport(sheet,mapping,mergedExisting):[],[sheet,mapping,mergedExisting]);
  const pending=rows.filter(row=>row.status==='ready'&&!['imported','queued','duplicate'].includes(results[row.customer.id]?.status));
  const count=(status:string)=>rows.filter(row=>(results[row.customer.id]?.status||row.status)===status).length;
  const busy=parsing||importing||checking||templateBusy;
  const chooseSheet=async(workbook:WorkBook,name:string)=>{
    const XLSX=await import('xlsx');const parsed=extractImportSheet(workbook.Sheets[name],XLSX.utils.encode_cell,XLSX.utils.decode_range);
    if(!mounted.current)return;
    setSheetName(name);setSheet(parsed);setMapping(suggestedMapping(parsed.headers));setResults({});setPage(1);
  };
  const load=async(file?:File)=>{
    if(!file)return;const generation=++readGeneration.current;setParsing(true);setError('');setBook(null);setSheet(null);setFileName(file.name);setResults({});
    try{const workbook=await readCustomerWorkbook(file);if(!mounted.current||generation!==readGeneration.current)return;if(!workbook.SheetNames.length)throw new Error('No worksheets found.');setBook(workbook);setSheetName(workbook.SheetNames[0]);await chooseSheet(workbook,workbook.SheetNames[0]);}
    catch(cause){if(mounted.current&&generation===readGeneration.current)setError(cause instanceof Error?cause.message:'Unable to read file.');}
    finally{if(mounted.current&&generation===readGeneration.current)setParsing(false);}
  };
  const template=async()=>{
    setTemplateBusy(true);setError('');
    try{const XLSX=await import('xlsx');const example=XLSX.utils.aoa_to_sheet([['Complete Name','Numbers','Email','Notes'],['Example Customer','03001234567','customer@example.com','Optional note']]);example.B2.z='@';example['!cols']=[{wch:28},{wch:22},{wch:32},{wch:36}];const workbook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(workbook,example,'Customers');XLSX.writeFile(workbook,'vista-customer-import-template.xlsx');}
    catch{if(mounted.current)setError('Unable to download the template. Try again.');}finally{if(mounted.current)setTemplateBusy(false);}
  };
  const start=async()=>{
    if(lock.current||busy||!checked||!pending.length)return;
    lock.current=true;setImporting(true);setError('');setProgress({done:0,total:pending.length});
    try{
      const fresh=await refresh();if(!fresh||!mounted.current)return;
      const targets=pending.slice();let done=0;
      for(const row of targets){
        if(!mounted.current)break;
        const candidate=row.customer;
        const duplicate=[...fresh,...useStore.getState().customers].some(customer=>customer.id===candidate.id||customerImportPhoneKey(customer.phone)===customerImportPhoneKey(candidate.phone));
        let result:Result;
        if(duplicate)result={status:'duplicate',reason:'Phone already exists. No record was overwritten.'};
        else{
          try{
            await useStore.getState().addCustomer(candidate);
            const queued=!!supabase&&useStore.getState().pendingMutations.some(item=>item.type==='customer:add'&&item.payload.customer?.id===candidate.id);
            result=queued?{status:'queued',reason:'Added locally; waiting to sync.'}:{status:'imported',reason:supabase?'Saved to Supabase':'Imported locally'};
            fresh.push(candidate);
          }catch(cause){result=isDuplicateCustomerError(cause)?{status:'duplicate',reason:'Phone already exists. No record was overwritten.'}:{status:'failed',reason:cause instanceof Error?cause.message:'Unable to save this row. Retry when ready.'};}
        }
        if(mounted.current){setResults(current=>({...current,[candidate.id]:result}));setProgress({done:++done,total:targets.length});}
        if(done%10===0)await new Promise(resolve=>setTimeout(resolve,0));
        if(result.status==='queued'){if(mounted.current)setError('A row is waiting to sync. Reconnect before importing the remaining rows.');break;}
        if(result.status==='failed'){if(mounted.current)setError('Import paused after a save error. Saved rows are kept; you can retry the remaining rows.');break;}
      }
    }finally{lock.current=false;if(mounted.current)setImporting(false);}
  };
  const close=()=>{if(!lock.current)onClose();};
  const pageCount=Math.max(1,Math.ceil(rows.length/50));const visibleRows=rows.slice((Math.min(page,pageCount)-1)*50,Math.min(page,pageCount)*50);
  return <ResponsiveDialog label="Import customers" onClose={close} className="max-w-4xl customer-import-dialog">
    <div className="customer-import-heading"><div><h2>Import customers</h2><p>Add customers from a spreadsheet. Existing records stay unchanged.</p></div><button type="button" disabled={importing} aria-label="Close customer import" onClick={close}><X size={21}/></button></div>
    <div className="customer-import-instructions"><strong>Start with a name and phone number</strong><p>Use the exported Complete Name and Numbers columns, or match your own columns below. Email and notes are optional. Keep phone cells as Text to preserve leading zeros.</p><button type="button" disabled={busy} onClick={()=>void template()}><Download size={16}/>Download template</button></div>
    {error&&<p role="alert" className="customer-import-error">{error}</p>}
    {supabase&&<div className="customer-import-check"><span>{checking?'Checking existing customers...':checked?'Existing customers checked.':'Check existing customers before importing.'}</span><button type="button" disabled={busy} onClick={()=>{setError('');void refresh();}}>Refresh check</button></div>}
    <label className="customer-import-file"><Upload size={20}/><span><strong>{parsing?'Reading spreadsheet...':fileName||'Choose Excel file'}</strong><small>.xlsx, .xls or .csv / up to 5 MB / 1,000 rows</small></span><input type="file" aria-label="Customer spreadsheet" accept=".xlsx,.xls,.csv" disabled={busy} onChange={event=>{void load(event.target.files?.[0]);event.target.value='';}}/></label>
    {book&&book.SheetNames.length>1&&<label className="customer-import-sheet">Worksheet<select aria-label="Worksheet" disabled={busy} value={sheetName} onChange={event=>{setError('');void chooseSheet(book,event.target.value).catch(cause=>{setSheet(null);setSheetName(event.target.value);setError(cause.message);});}}>{book.SheetNames.map(name=><option key={name}>{name}</option>)}</select></label>}
    {sheet&&<>
      <div className="customer-import-mapping">{fields.map(({key,label})=><label key={key}>{label}<select aria-label={`Column for ${key}`} value={mapping[key]} disabled={busy||Object.keys(results).length>0} onChange={event=>{setMapping(current=>({...current,[key]:Number(event.target.value)}));setPage(1);}}><option value={-1}>{key==='name'||key==='phone'?'Choose column':'Do not import'}</option>{sheet.headers.map((header,index)=><option key={index} value={index}>{header||`Column ${index+1}`} ({index+1})</option>)}</select></label>)}</div>
      <div className="customer-import-counts" aria-label="Import summary"><span><strong>{count('ready')}</strong> ready</span><span><strong>{count('duplicate')}</strong> duplicates</span><span><strong>{count('invalid')}</strong> invalid</span><span><strong>{count('imported')}</strong> imported</span>{count('queued')>0&&<span><strong>{count('queued')}</strong> waiting to sync</span>}{count('failed')>0&&<span><strong>{count('failed')}</strong> failed</span>}</div>
      <p className="customer-import-note">Duplicate phone numbers and invalid rows are skipped. Preview all rows below; nothing is saved until you import.</p>
      <div className="customer-import-preview" aria-label="Customer import preview">{visibleRows.map(row=>{const result=results[row.customer.id];const status=result?.status||row.status;return <div className="customer-import-row" key={row.customer.id} data-status={status}><span className="customer-import-row-number">Row {row.row}</span><div><strong>{row.customer.name||'Missing name'}</strong><span>{row.customer.phone||'Missing phone'}</span>{row.customer.email&&<small>{row.customer.email}</small>}</div><div className="customer-import-row-status"><strong>{status==='ready'?'Ready':status==='queued'?'Waiting to sync':status[0].toUpperCase()+status.slice(1)}</strong><span>{result?.reason||row.reason}</span></div></div>;})}</div>
      {pageCount>1&&<div className="customer-import-pages"><button type="button" disabled={page===1||busy} onClick={()=>setPage(value=>value-1)}>Previous</button><span>Page {Math.min(page,pageCount)} of {pageCount}</span><button type="button" disabled={page>=pageCount||busy} onClick={()=>setPage(value=>value+1)}>Next</button></div>}
    </>}
    {importing&&<p role="status" className="customer-import-progress">Importing {progress.done} of {progress.total} customers...</p>}
    {!importing&&Object.keys(results).length>0&&<p role="status" className="customer-import-progress">{count('imported')} imported{count('queued')?`, ${count('queued')} waiting to sync`:''}. {pending.length?`${pending.length} remaining rows can be retried.`:'No remaining valid rows.'}</p>}
    <div className="customer-import-footer"><button type="button" disabled={importing} onClick={close}>Close</button><button type="button" disabled={busy||!checked||!pending.length} onClick={()=>void start()}><Upload size={17}/>{importing?'Importing...':`Import ${pending.length} ${pending.length===1?'customer':'customers'}`}</button></div>
  </ResponsiveDialog>;
};
