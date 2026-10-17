import { newUuid } from './uuid';
import type { WorkBook, WorkSheet, CellObject } from 'xlsx';
import type { Customer } from '../types';
import { getCustomerPhoneLastDigits } from './customerDuplicates';

export const MAX_IMPORT_ROWS=1000;
export const MAX_IMPORT_BYTES=5*1024*1024;
export type ImportField='name'|'phone'|'email'|'notes';
export type ImportMapping=Record<ImportField,number>;
export interface ImportCell { text:string; formula:boolean; numericInvalid?:boolean; }
export interface ImportSheet { headers:string[]; rows:{row:number; cells:ImportCell[]; id:string}[]; }
export interface ImportRow { row:number; customer:Customer; status:'ready'|'invalid'|'duplicate'; reason:string; }
const aliases:Record<ImportField,string[]>={name:['name','fullname','completename','customername','clientname'],phone:['phone','number','numbers','phonenumber','mobile','mobilenumber','contact','contactnumber','whatsapp','whatsappnumber'],email:['email','emailaddress'],notes:['notes','note','address','remarks']};
const normalized=(value:string)=>value.toLowerCase().replace(/[^a-z0-9]/g,'');
export const suggestedMapping=(headers:string[]):ImportMapping=>Object.fromEntries(Object.entries(aliases).map(([field,names])=>[field,headers.findIndex(header=>names.includes(normalized(header)))])) as ImportMapping;
const digits=(value:string)=>value.replace(/[٠-٩۰-۹]/g,c=>String(c.charCodeAt(0)-(c.charCodeAt(0)>=0x6f0?0x6f0:0x660)));
export const customerImportPhoneKey=(phone:string)=>{
  const value=digits(phone);const suffix=getCustomerPhoneLastDigits(value);
  return suffix?`suffix:${suffix}`:`exact:${value.replace(/\D/g,'')}`;
};
export function extractImportSheet(sheet:WorkSheet, encodeCell:(cell:{r:number;c:number})=>string,decodeRange:(range:string)=>{s:{r:number;c:number};e:{r:number;c:number}}):ImportSheet {
  if(!sheet['!ref'])throw new Error('This worksheet is empty.');
  const full=decodeRange(sheet['!fullref']||sheet['!ref']);
  if(full.e.r>MAX_IMPORT_ROWS)throw new Error(`Use at most ${MAX_IMPORT_ROWS.toLocaleString()} customer rows per file, plus one header row.`);
  if(full.e.c>99)throw new Error('Use a worksheet with at most 100 columns.');
  const cell=(r:number,c:number):ImportCell=>{
    const item=sheet[encodeCell({r,c})] as CellObject|undefined;
    if(!item)return {text:'',formula:false};
    let text=String(item.w??item.v??'').trim();
    if(item.t==='n'&&/e[+-]?\d+/i.test(text)&&typeof item.v==='number')text=String(item.v);
    return {text,formula:!!item.f,numericInvalid:item.t==='n'&&(!Number.isSafeInteger(item.v)||Number(item.v)<=0)};
  };
  const headers=Array.from({length:full.e.c+1},(_,c)=>cell(0,c).text);
  if(!headers.some(Boolean))throw new Error('Put column headings in the first row.');
  const rows:ImportSheet['rows']=[];
  for(let row=1;row<=full.e.r;row++){
    const cells=headers.map((_,column)=>cell(row,column));
    if(cells.every(value=>!value.text&&!value.formula))continue;
    rows.push({row:row+1,cells,id:newUuid()});
  }
  if(!rows.length)throw new Error('No customer rows found below the headings.');
  return {headers,rows};
}
export async function readCustomerWorkbook(file:File):Promise<WorkBook>{
  if(!/\.(xlsx|xls|csv)$/i.test(file.name))throw new Error('Choose an Excel (.xlsx or .xls) or CSV file.');
  if(file.size>MAX_IMPORT_BYTES)throw new Error('Choose a file smaller than 5 MB.');
  if(!file.size)throw new Error('The selected file is empty.');
  const XLSX=await import('xlsx');
  try{return XLSX.read(await file.arrayBuffer(),{type:'array',sheetRows:MAX_IMPORT_ROWS+2,cellFormula:true,cellText:true,raw:true,cellHTML:false});}
  catch{throw new Error('Unable to read this workbook. Save it as a standard Excel file and try again.');}
}
export function prepareCustomerImport(sheet:ImportSheet,mapping:ImportMapping,existing:Customer[]):ImportRow[]{
  const seen=new Map<string,string>();existing.forEach(customer=>{if(customer.phone)seen.set(customerImportPhoneKey(customer.phone),customer.name);});
  return sheet.rows.map(source=>{
    const get=(field:ImportField)=>source.cells[mapping[field]]?.text.trim()||'';
    const customer:Customer={id:source.id,name:get('name'),phone:digits(get('phone')),active:true};
    if(get('email'))customer.email=get('email');if(get('notes'))customer.notes=get('notes');
    let reason='';
    if(mapping.name<0||mapping.phone<0)reason='Select both the name and phone columns.';
    else if(new Set(Object.values(mapping).filter(index=>index>=0)).size!==Object.values(mapping).filter(index=>index>=0).length)reason='Use a different column for each field.';
    else if(Object.values(mapping).some(index=>index>=0&&source.cells[index]?.formula))reason='Replace formulas with plain text values.';
    else if(!customer.name)reason='Customer name is required.';
    else if(customer.name.length>150)reason='Keep the name under 150 characters.';
    else if(source.cells[mapping.phone]?.numericInvalid||customer.phone.length>40||!/^\+?[0-9(][0-9() .-]*$/.test(customer.phone)||customer.phone.replace(/\D/g,'').length<7||customer.phone.replace(/\D/g,'').length>15||/^0+$/.test(customer.phone.replace(/\D/g,'')))reason='Enter a phone number with 7 to 15 digits.';
    else if(customer.email&&(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)||customer.email.length>254))reason='Enter a valid email address or leave it blank.';
    else if(customer.notes&&customer.notes.length>1000)reason='Keep notes under 1,000 characters.';
    if(reason)return {row:source.row,customer,status:'invalid',reason};
    const key=customerImportPhoneKey(customer.phone);const duplicate=seen.get(key);
    if(duplicate!==undefined)return {row:source.row,customer,status:'duplicate',reason:`Phone already used by ${duplicate}.`};
    seen.set(key,customer.name);
    return {row:source.row,customer,status:'ready',reason:'Ready to import'};
  });
}
