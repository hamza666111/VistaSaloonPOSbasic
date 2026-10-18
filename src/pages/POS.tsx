import { newUuid } from '../utils/uuid';
import { roundMoney } from '../utils/money';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useServiceCategories } from '../store/useServiceCategories';
import { useStore } from '../store/useStore';
import { supabase } from '../api/supabase';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { ResponsiveDialog } from '../components/ResponsiveDialog';
import { CategorySyncStatus } from '../components/CategorySyncStatus';
import { useAppSettings } from '../store/useAppSettings';
import { ReceiptBrandHeader } from '../components/ReceiptBrandHeader';
import { InvoiceSaveActions } from '../components/InvoiceSaveActions';
import { InvoiceSaveAction, invoiceWhatsAppUrl, normalizeWhatsAppPhone, reserveWhatsAppWindow, openPreparedWhatsApp } from '../utils/invoiceWhatsApp';
import { CustomerModal } from '../components/CustomerModal';
import { DuplicateCustomerMatches } from '../components/DuplicateCustomerMatches';
import { Plus, Trash2, UserPlus, Search, X, Scissors, ChevronRight, ArrowLeft } from 'lucide-react';
import { Customer, Invoice, ServicePackage } from '../types';
import { useReceiptAssets } from '../hooks/useReceiptAssets';
import { DuplicateCustomerMatch, isDuplicateCustomerError } from '../utils/customerDuplicates';

interface QuickAddDuplicateState {
  name: string;
  phone: string;
  matches: DuplicateCustomerMatch[];
}

export const POS: React.FC = () => {
  const { 
    services, packages, barbers, customers, invoices, cart, 
    addToCart, removeFromCart, clearCart, 
    addCustomer, createInvoice, updateInvoice 
  } = useStore();

  const draftStorageKey = supabase ? `vistasaloon-bill-draft:${new URL(import.meta.env.VITE_SUPABASE_URL).host}:${useStore.getState().userId}` : `vistasaloon-local-bill-draft:${import.meta.env.VITE_DEMO_MODE}`;
  const [restoredDraft] = useState(()=>{try{return JSON.parse(sessionStorage.getItem(draftStorageKey)||'{}');}catch{return {};}});
  const { logoSrc } = useReceiptAssets();
  const salonName=useAppSettings(state=>state.settings.salonName);
  const { categories, serviceCategories } = useServiceCategories();
  const [selectedCategoryId, setSelectedCategoryId] = useState('all');
  const activeCategoryId = selectedCategoryId === 'all' || selectedCategoryId === 'uncategorized' || categories.some(category => category.id === selectedCategoryId) ? selectedCategoryId : 'all';
  const isUncategorized = (serviceId: string) => !categories.some(category => serviceCategories[serviceId]?.includes(category.id));
  const categoryCounts = categories.map(category => ({ ...category, count: services.filter(service => service.active !== false && serviceCategories[service.id]?.includes(category.id)).length }));
  const activeServiceCount = services.filter(service => service.active !== false).length;
  const uncategorizedCount = services.filter(service => service.active !== false && isUncategorized(service.id)).length;

  const [selectedBarberId, setSelectedBarberId] = useState<string>(restoredDraft.selectedBarberId||'');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>(restoredDraft.selectedCustomerId||'');
  const [isCustomerPickerOpen, setIsCustomerPickerOpen] = useState(true);
  const [customerSearch, setCustomerSearch] = useState<string>('');
  const [serviceSearch, setServiceSearch] = useState<string>('');
  const [quickCustomerName, setQuickCustomerName] = useState<string>('');
  const [quickCustomerPhone, setQuickCustomerPhone] = useState<string>('');
  const [discountValue, setDiscountValue] = useState<number>(restoredDraft.discountValue||0);
  const [discountType, setDiscountType] = useState<'amount' | 'percent'>(restoredDraft.discountType||'amount');
  const [isCustomerModalOpen, setIsCustomerModalOpen] = useState(false);
  const [lastInvoice, setLastInvoice] = useState<Invoice | null>(null);
  const [isPaid, setIsPaid] = useState<boolean>(restoredDraft.isPaid??true);
  const [paymentMode, setPaymentMode] = useState<'cash' | 'online'>(restoredDraft.paymentMode||'cash');
  const [currentInvoiceId, setCurrentInvoiceId] = useState<string | null>(null);
  const [quickAddDuplicateState, setQuickAddDuplicateState] = useState<QuickAddDuplicateState | null>(null);

  const teamPickerRef=useRef<HTMLDivElement>(null);
  const [mobileBillOpen,setMobileBillOpen]=useState(false);
  const [mobileCatalogTab,setMobileCatalogTab]=useState<'services'|'deals'>('services');
  const [quickCustomerOpen,setQuickCustomerOpen]=useState(false);
  const mobile=useMediaQuery('(max-width: 1023px)');
  const billRef=useRef<HTMLDivElement>(null);
  useDialogFocus(billRef,mobile && mobileBillOpen,()=>{if(!checkoutLock.current)setMobileBillOpen(false);});

  const checkoutLock = useRef(false);
  const lastSavedId=useRef<string|null>(null);
  const checkoutDraft = useRef<{id:string;date:string}|null>(restoredDraft.checkoutDraft||null);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');
  const [checkoutNotice, setCheckoutNotice] = useState('');
  const [whatsAppFallback, setWhatsAppFallback] = useState<string | null>(null);

  useEffect(()=>{
    try{sessionStorage.setItem(draftStorageKey,JSON.stringify({cart,selectedBarberId,selectedCustomerId,discountValue,discountType,isPaid,paymentMode,checkoutDraft:checkoutDraft.current}));}
    catch{setCheckoutError('Browser storage is unavailable. Keep this tab open until the bill is saved.');}
  },[cart,selectedBarberId,selectedCustomerId,discountValue,discountType,isPaid,paymentMode,draftStorageKey]);

  useEffect(()=>{
    const saved=invoices.find(invoice=>invoice.id===lastSavedId.current);
    if(saved?.version&&!saved.syncStatus)setCheckoutNotice(notice=>notice.replace('Invoice saved on this device. Pending sync to Supabase.','Invoice saved. Synced to Supabase.'));
  },[invoices]);

  const subtotal = roundMoney(cart.reduce((sum, item) => sum + roundMoney(item.price), 0));
  const discountAmount = roundMoney(Math.max(0, Math.min(
    discountType === 'percent' ? (subtotal * (discountValue / 100)) : discountValue,
    subtotal
  )));
  const total = roundMoney(Math.max(0, subtotal - discountAmount));

  const normalizedSearch = customerSearch.trim().toLowerCase();
  const filteredCustomers = useMemo(() => {
    const activeCustomers = customers.filter(c => c.active !== false);
    if (!normalizedSearch) return activeCustomers;
    return activeCustomers.filter((c) => {
      const nameMatch = c.name.toLowerCase().includes(normalizedSearch);
      const phoneMatch = c.phone.replace(/\s+/g, '').includes(normalizedSearch.replace(/\s+/g, ''));
      return nameMatch || phoneMatch;
    });
  }, [customers, normalizedSearch]);

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === selectedCustomerId),
    [customers, selectedCustomerId]
  );

  const customerOptions = useMemo(() => {
    let options = filteredCustomers;
    if (selectedCustomer && !filteredCustomers.some((c) => c.id === selectedCustomer.id)) {
      options = [selectedCustomer, ...filteredCustomers];
    }
    return [...options].sort((a, b) => a.name.localeCompare(b.name));
  }, [filteredCustomers, selectedCustomer]);

  const normalizedServiceSearch = serviceSearch.trim().toLowerCase();

  const activeBarbers = useMemo(
    () => barbers.filter((barber) => barber.active),
    [barbers]
  );

  useEffect(() => {
    if (selectedBarberId && !activeBarbers.some((barber) => barber.id === selectedBarberId)) {
      setSelectedBarberId('');
    }
  }, [activeBarbers, selectedBarberId]);
  
  const filteredPackages = useMemo(() => {
    return packages.filter(pkg => 
      pkg.active !== false && 
      (normalizedServiceSearch === '' || pkg.name.toLowerCase().includes(normalizedServiceSearch))
    );
  }, [packages, normalizedServiceSearch]);

  const filteredServices = useMemo(() => {
    return services.filter((service) =>
      service.active !== false &&
      (activeCategoryId === 'all' || (activeCategoryId === 'uncategorized' ? isUncategorized(service.id) : serviceCategories[service.id]?.includes(activeCategoryId))) &&
      (normalizedServiceSearch === '' || service.name.toLowerCase().includes(normalizedServiceSearch))
    );
  }, [services, normalizedServiceSearch, activeCategoryId, serviceCategories, categories]);

  const handleAddToCart = (service: any) => {
    if (!selectedBarberId) {
      alert('Please select a team member first');
      return;
    }
    const barber = barbers.find(b => b.id === selectedBarberId);
    addToCart({
      serviceId: service.id,
      serviceName: service.name,
      price: service.price,
      barberId: selectedBarberId,
      barberName: barber?.name || 'Unknown',
    });
  };

  const handleAddPackageToCart = (pkg: ServicePackage) => {
    if (!selectedBarberId) {
      alert('Please select a team member first');
      return;
    }
    const barber = barbers.find((b) => b.id === selectedBarberId);
    addToCart({
      serviceId: pkg.id,
      serviceName: `Package: ${pkg.name}`,
      price: pkg.price,
      barberId: selectedBarberId,
      barberName: barber?.name || 'Unknown',
    });
  };

  const handleCustomerSaved = async (customer: Customer) => {
    await addCustomer(customer);
    setSelectedCustomerId(customer.id);
    setIsCustomerPickerOpen(false);
    setCustomerSearch('');
    setQuickCustomerName('');
    setQuickCustomerPhone('');
    setQuickAddDuplicateState(null);
  };

  const handleUseExistingCustomer = (customer: Customer) => {
    setSelectedCustomerId(customer.id);
    setIsCustomerPickerOpen(false);
    setCustomerSearch(customer.name);
    setQuickCustomerName('');
    setQuickCustomerPhone('');
    setQuickAddDuplicateState(null);
    setIsCustomerModalOpen(false);
  };

  const handleQuickAddCustomer = async () => {
    if (!quickCustomerName.trim() || !quickCustomerPhone.trim()) {
      alert('Enter both name and phone to add a customer');
      return;
    }

    const newCustomer: Customer = {
      id: newUuid(),
      name: quickCustomerName.trim(),
      phone: quickCustomerPhone.trim(),
    };

    try {
      await handleCustomerSaved(newCustomer);
    } catch (error) {
      if (isDuplicateCustomerError(error)) {
        setQuickAddDuplicateState({
          name: newCustomer.name,
          phone: newCustomer.phone,
          matches: error.matches,
        });
        return;
      }

      const message = error instanceof Error ? error.message : 'Unable to save customer.';
      alert(message);
    }
  };

  const handleCheckout = async (action: InvoiceSaveAction) => {
    if (cart.length === 0 || checkoutLock.current) return;
    const phone = selectedCustomer?.phone || '';
    if (action === 'whatsapp' && !normalizeWhatsAppPhone(phone)) {
      setCheckoutError('Select a customer with a valid WhatsApp number, including the country code.');
      return;
    }
    checkoutLock.current = true;
    setIsCheckingOut(true);
    setCheckoutError(''); setCheckoutNotice(''); setWhatsAppFallback(null);
    // Reserve the tab during the click; navigate externally only after persistence succeeds.
    const whatsAppWindow = action === 'whatsapp' ? reserveWhatsAppWindow() : null;
    
    const customer = customers.find(c => c.id === selectedCustomerId);
    checkoutDraft.current ||= {id:newUuid(),date:new Date().toISOString()};
    const invoiceId = currentInvoiceId || checkoutDraft.current.id;
    const existingInvoice = currentInvoiceId
      ? invoices.find(inv => inv.id === currentInvoiceId)
      : undefined;
    
    const invoice: Invoice = {
      id: invoiceId,
      date: existingInvoice?.date || checkoutDraft.current.date,
      customerId: selectedCustomerId || undefined,
      customerName: customer?.name || 'Walk-in Customer',
      items: [...cart],
      subtotal,
      discount: discountAmount,
      discountType,
      discountValue,
      total,
      status: isPaid ? 'paid' : 'pending',
      paymentMode,
    };

    try {
      sessionStorage.setItem(draftStorageKey,JSON.stringify({...JSON.parse(sessionStorage.getItem(draftStorageKey)||'{}'),checkoutDraft:checkoutDraft.current}));
      if (existingInvoice) {
        await updateInvoice(invoice);
      } else {
        await createInvoice(invoice);
      }

      const pending=!!useStore.getState().invoices.find(item=>item.id===invoiceId)?.syncStatus;
      const saveNotice=pending?'Invoice saved on this device. Pending sync to Supabase.':'Invoice saved.';
      lastSavedId.current=invoiceId;
      setCurrentInvoiceId(invoiceId);
      setLastInvoice(invoice);

      if (action === 'print') {
        await new Promise(resolve => setTimeout(resolve, 300));
        let printFailed = false;
        try { window.print(); } catch { printFailed = true; }
        handleNewBill();
        setCheckoutNotice(printFailed ? `${saveNotice} Open it in Invoices to try printing again.` : saveNotice);
      } else {
        const url = action === 'whatsapp' ? invoiceWhatsAppUrl(invoice, phone) : null;
        const opened = url ? openPreparedWhatsApp(whatsAppWindow, url) : false;
        handleNewBill();
        setCheckoutNotice(action === 'whatsapp' ? `${saveNotice} Send the prepared message in WhatsApp.` : saveNotice);
        if (url && !opened) { setWhatsAppFallback(url); setCheckoutNotice(`${saveNotice} Your browser blocked the WhatsApp window.`); }
      }
    } catch (error) {
      try { whatsAppWindow?.close(); } catch { /* The browser may have closed it already. */ }
      setCheckoutError(error instanceof Error ? error.message : 'Failed to save invoice. Please try again.');
    } finally { checkoutLock.current = false; setIsCheckingOut(false); }
  };

  const handleNewBill = () => {
    checkoutDraft.current=null;
    setCheckoutError(''); setCheckoutNotice(''); setWhatsAppFallback(null);
    clearCart();
    setDiscountValue(0);
    setDiscountType('amount');
    setSelectedCustomerId('');
    setIsCustomerPickerOpen(true);
    setCustomerSearch('');
    setQuickCustomerName('');
    setQuickCustomerPhone('');
    setIsPaid(true);
    setPaymentMode('cash');
    setCurrentInvoiceId(null);
    setLastInvoice(null);
  };

  const receiptCustomerCode = useMemo(() => {
    if (!lastInvoice) return '';
    const rawName = (lastInvoice.customerName || 'Customer').replace(/[^a-zA-Z]/g, '');
    const namePart = (rawName || 'CU').slice(0, 2).toUpperCase().padEnd(2, 'X');

    let phoneDigits = '';
    if (lastInvoice.customerId) {
      phoneDigits = customers.find((c) => c.id === lastInvoice.customerId)?.phone ?? '';
    } else {
      const matched = customers.find(
        (c) => c.name.toLowerCase() === (lastInvoice.customerName || '').toLowerCase()
      );
      phoneDigits = matched?.phone ?? '';
    }

    const digitsOnly = phoneDigits.replace(/\D/g, '');
    const numberPart = digitsOnly.slice(-3).padStart(3, '0');
    return `${namePart}${numberPart || '000'}`;
  }, [customers, lastInvoice]);

  return (
    <fieldset disabled={isCheckingOut} className="pos-workspace m-0 w-full min-w-0 border-0 p-0 flex flex-col lg:flex-row min-h-[calc(100vh-126px)] animate-fadeIn">
      {/* Preload assets for printing */}
      <img src={logoSrc} className="fixed -left-[9999px] w-0 h-0" alt="" aria-hidden="true" />

      {/* Left: Services Grid */}
      <div data-mobile-catalog={mobileCatalogTab} data-searching={!!normalizedServiceSearch} className="pos-catalog flex-1 min-w-0 p-4 md:p-6 overflow-auto bg-stone-50 order-2 lg:order-1">
        <div className="pos-intro"><div><span className="eyebrow">THE SALON FLOOR</span><h1>Good service starts here.</h1><p>Select your team member, then build a beautiful visit.</p></div><span className="pos-edition">HAIR / BEAUTY / CARE</span></div>
        <div ref={teamPickerRef} className="pos-team-picker mb-4 md:mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">Select team member</label>
          <div className="flex gap-3 md:gap-4 overflow-x-auto pb-2">
            {activeBarbers.map(barber => (
              <button
                key={barber.id}
                aria-pressed={selectedBarberId===barber.id} onClick={() => setSelectedBarberId(barber.id)}
                className={`pos-team-tile shrink-0 whitespace-nowrap px-5 md:px-6 py-3 rounded-lg border transition-all duration-300 ${
                  selectedBarberId === barber.id
                    ? 'bg-teal-700 text-white border-teal-500 shadow-sm'
                    : 'bg-white text-gray-700 border-gray-200 hover:border-teal-300 hover:shadow-sm'
                }`}
              >
                {barber.name}
              </button>
            ))}
            {activeBarbers.length === 0 && (
              <div className="text-sm text-gray-500">No active team members. Activate a team member in Settings.</div>
            )}
          </div>
        </div>

        <div className="mb-4 md:mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              aria-label="Search services or deals" placeholder="Search services or deals..."
              value={serviceSearch}
              onChange={(e) => setServiceSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-3 rounded-xl border border-teal-200 focus:ring-2 focus:ring-teal-400 focus:border-teal-400 transition-all duration-200 shadow-sm"
            />
            {serviceSearch&&<button type="button" className="pos-search-clear" aria-label="Clear service search" onClick={()=>setServiceSearch('')}><X size={17}/></button>}
          </div>
        </div>

        <div className="pos-mobile-catalog-tabs" role="group" aria-label="Browse catalog"><button type="button" aria-pressed={mobileCatalogTab==='services'} onClick={()=>{setMobileCatalogTab('services');setServiceSearch('');}}>Services <span>{activeServiceCount}</span></button><button type="button" aria-pressed={mobileCatalogTab==='deals'} onClick={()=>{setMobileCatalogTab('deals');setServiceSearch('');}}>Deals &amp; offers <span>{packages.filter(pkg=>pkg.active!==false).length}</span></button></div>
        {filteredPackages.length > 0 && (
          <div className="pos-deals-section mb-4 md:mb-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base md:text-lg font-semibold text-gray-800">Deals &amp; offers</h3>
              <span className="text-xs text-teal-600">VALUE COMBINATIONS</span>
            </div>
            <div className="pos-deals-grid">
              {filteredPackages
                .map((pkg) => (
                  <button
                    key={pkg.id}
                    onClick={() => handleAddPackageToCart(pkg)}
                    className="pos-deal-tile bg-white p-3 md:p-4 rounded-xl shadow-sm border border-teal-200 hover:shadow-sm hover:border-teal-300 transition-all duration-300 text-left"
                  >
                    <div className="text-sm font-semibold text-gray-900 mb-1 leading-tight line-clamp-2">{pkg.name}</div>
                    <div className="text-xs text-gray-600 mb-2 line-clamp-2">
                      {pkg.services.join(', ')}
                    </div>
                    <div className="text-teal-600 font-bold text-lg">Rs. {pkg.price}</div>
                  </button>
                ))}
            </div>
          </div>
        )}

        {filteredPackages.length===0 && <p className="pos-mobile-deals-empty">{serviceSearch ? 'No deals match your search.' : 'No active deals yet.'}</p>}
        <section aria-label="Service menu" className="service-menu-section">
          <div className="service-menu-toolbar">
            <h3 className="catalog-heading">Service menu</h3>
            <button type="button" className="pos-current-team" aria-label="Change team member" onClick={()=>teamPickerRef.current?.scrollIntoView({block:'start',behavior:'auto'})}><span>{activeBarbers.find(barber=>barber.id===selectedBarberId)?.name||'Choose team'}</span><ArrowLeft size={13}/></button>
            <div className="service-category-filters" role="group" aria-label="Service categories">
              <button type="button" aria-pressed={activeCategoryId === 'all'} onClick={() => setSelectedCategoryId('all')}>All services <span>{activeServiceCount}</span></button>
              {categoryCounts.map(category => <button key={category.id} type="button" aria-pressed={activeCategoryId === category.id} onClick={() => setSelectedCategoryId(category.id)}>{category.name} <span>{category.count}</span></button>)}
              <button type="button" aria-pressed={activeCategoryId === 'uncategorized'} onClick={() => setSelectedCategoryId('uncategorized')}>Uncategorized <span>{uncategorizedCount}</span></button>
            </div>
          </div>
          <CategorySyncStatus />
          {filteredServices.length > 0 ? <div className="pos-services-grid">
            {filteredServices.map(service => (
              <button key={service.id} onClick={() => handleAddToCart(service)} className="pos-service-tile bg-white p-3 md:p-4 rounded-xl shadow-sm border border-teal-100 hover:shadow-sm hover:border-teal-300 transition-all duration-300 text-left">
                <span className="service-symbol" aria-hidden="true"><Scissors size={15} /></span><div className="text-sm font-medium text-gray-800 leading-tight mb-2 line-clamp-2">{service.name}</div>
                <div className="text-teal-600 font-bold text-lg">Rs. {service.price}</div>
                {cart.some(item=>item.serviceId===service.id)&&<span className="pos-service-count" aria-label={`${cart.filter(item=>item.serviceId===service.id).length} on bill`}>{cart.filter(item=>item.serviceId===service.id).length}</span>}
              </button>
            ))}
          </div> : <div className="service-category-empty"><p>{serviceSearch ? 'No services match this search in the selected category.' : 'No active services in this category yet.'}</p><button type="button" onClick={() => { setSelectedCategoryId('all'); setServiceSearch(''); }}>Show all services</button></div>}
        </section>
      </div>

      {/* Right: Cart */}
      <div ref={billRef} tabIndex={-1} role={mobile && mobileBillOpen ? 'dialog' : undefined} aria-modal={mobile && mobileBillOpen ? true : undefined} aria-label="Current bill" className={`pos-order-panel ${mobileBillOpen ? 'mobile-bill-open' : ''} w-full lg:w-96 bg-white border-t lg:border-t-0 lg:border-l border-teal-100 shadow-sm flex flex-col order-1 lg:order-2`}>
          <div className="mobile-bill-heading"><button type="button" onClick={()=>setMobileBillOpen(false)}><ArrowLeft size={19}/> Back to services</button><span>{cart.length} {cart.length===1?'item':'items'}</span></div>
        <div className="pos-bill-content">
        <div className="pos-customer-header p-4 md:p-6 border-b border-teal-100 bg-stone-50 sticky top-0 z-10">

          <div className="flex items-center justify-between gap-3 mb-4">
            <h2 className="text-lg md:text-xl font-bold text-gray-800">Current Order</h2>
            <button
              onClick={()=>{handleNewBill();setQuickCustomerOpen(false);}}
              className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:border-teal-300 hover:text-teal-600 transition-colors"
            >
              <Plus className="w-4 h-4" />
              New Bill
            </button>
          </div>
          
          {/* Keep the customer chooser compact once the bill has a customer. */}
          {!isCustomerPickerOpen ? (
            <div className="customer-summary flex items-center justify-between gap-3 rounded-lg border border-teal-100 bg-white px-3 py-2">
              <span className="min-w-0 truncate text-sm font-semibold text-gray-800" title={selectedCustomer?.name || 'Walk-in Customer'}>{selectedCustomer?.name || 'Walk-in Customer'}</span>
              <button type="button" onClick={() => { setCustomerSearch(''); setIsCustomerPickerOpen(true); }} className="shrink-0 text-xs font-medium text-teal-700 hover:underline" aria-label="Change customer">Change</button>
            </div>
          ) : <div className="customer-picker space-y-2">
            <button type="button" className="pos-walk-in" onClick={()=>{setSelectedCustomerId('');setCustomerSearch('');setIsCustomerPickerOpen(false);}}>Continue as walk-in <ChevronRight size={16}/></button>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Search by name or phone"
                className="flex-1 rounded-lg border-teal-200 border p-2 focus:ring-2 focus:ring-teal-400 focus:border-teal-400 transition-all duration-200 text-sm md:text-base"
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
              />
              <button
                onClick={() => setIsCustomerModalOpen(true)}
                className="p-2 bg-teal-100 text-teal-600 rounded-lg hover:bg-teal-200 transition-all duration-200 hover:scale-105"
                aria-label="Add customer"
              >
                <UserPlus className="w-5 h-5" />
              </button>
            </div>
            {customerSearch && filteredCustomers.length > 0 && (
              <div className="border border-teal-200 bg-white rounded-lg shadow-sm max-h-36 overflow-auto text-sm divide-y divide-teal-50">
                {filteredCustomers.slice(0, 6).map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => { setSelectedCustomerId(c.id); setCustomerSearch(c.name); setIsCustomerPickerOpen(false); }}
                    className="w-full text-left px-3 py-2 hover:bg-teal-50 flex justify-between"
                  >
                    <span className="text-gray-800">{c.name}</span>
                    <span className="text-gray-500 text-xs">{c.phone}</span>
                  </button>
                ))}
              </div>
            )}
            <select
              className="w-full rounded-lg border-teal-200 border p-2 focus:ring-2 focus:ring-teal-400 focus:border-teal-400 transition-all duration-200 text-sm md:text-base"
              aria-label="Select customer"
              value={selectedCustomerId || '__choose_customer__'}
              onChange={(e) => { setSelectedCustomerId(e.target.value); setCustomerSearch(''); setIsCustomerPickerOpen(false); }}
            >
              <option value="__choose_customer__" disabled>Select customer or walk-in</option>
              <option value="">Walk-in Customer</option>
              {customerOptions.map((c) => (
                <option key={c.id} value={c.id}>{c.name} ({c.phone})</option>
              ))}
              {customerOptions.length === 0 && (
                <option disabled>No customers match search</option>
              )}
            </select>

            <button type="button" className="pos-quick-customer-toggle" aria-expanded={quickCustomerOpen} onClick={()=>setQuickCustomerOpen(!quickCustomerOpen)}><Plus size={16}/>{quickCustomerOpen?'Hide new customer form':'Add by name & phone'}</button>
            <div className={`pos-quick-customer ${quickCustomerOpen?'pos-quick-customer-open':''}`}>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                placeholder="New customer name"
                className="rounded-lg border-teal-200 border p-2 focus:ring-2 focus:ring-teal-400 focus:border-teal-400 transition-all duration-200 text-sm"
                value={quickCustomerName}
                onChange={(e) => setQuickCustomerName(e.target.value)}
              />
              <input
                type="tel"
                placeholder="Phone"
                className="rounded-lg border-teal-200 border p-2 focus:ring-2 focus:ring-teal-400 focus:border-teal-400 transition-all duration-200 text-sm"
                value={quickCustomerPhone}
                onChange={(e) => setQuickCustomerPhone(e.target.value)}
              />
            </div>
            <button
              type="button"
              onClick={handleQuickAddCustomer}
              className="w-full flex items-center justify-center gap-2 bg-teal-100 text-teal-700 border border-teal-200 py-2 rounded-lg hover:bg-teal-200 transition-all duration-200"
            >
              <Plus className="w-4 h-4" />
              Add & Select Customer
            </button>
            </div>
            {selectedCustomerId && <button type="button" className="text-xs text-teal-700 hover:underline" onClick={() => setIsCustomerPickerOpen(false)}>Keep current customer</button>}
          </div>}
        </div>

        <div className="pos-cart-items flex-1 overflow-auto p-4 space-y-3">
          <div className="pos-bill-services-heading"><h3>Services <span>{cart.length}</span></h3><button type="button" onClick={()=>setMobileBillOpen(false)}><Plus size={16}/>Add more</button></div>
          {cart.length === 0 && <div className="empty-order"><span aria-hidden="true"><Scissors size={28} /></span><strong>A fresh start.</strong><p>Add a service or deal to begin this visit.</p></div>}
          {cart.map((item, idx) => (
            <div key={idx} className="pos-cart-line flex justify-between items-center bg-stone-50 p-3 rounded-xl border border-teal-100 hover:shadow-sm transition-all duration-200">
              <div>
                <div className="font-medium text-gray-800">{item.serviceName}</div>
                <div className="text-xs text-teal-600">{item.barberName}</div>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-bold text-teal-700">Rs. {item.price}</span>
                <button
                  aria-label={`Remove ${item.serviceName}`}
                  onClick={() => removeFromCart(idx)}
                  className="text-red-400 hover:text-red-600 transition-all duration-200 hover:scale-110"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="pos-payment-section p-4 md:p-6 border-t border-teal-100 bg-stone-50 space-y-3">
          <div className="flex justify-between text-sm text-gray-600">
            <span>Subtotal</span>
            <span>Rs. {subtotal.toFixed(2)}</span>
          </div>
          <div className="pos-discount-row flex justify-between items-center text-sm">
            <span className="text-gray-600">Discount</span>
            <div className="flex items-center gap-2">
              <select
                className="p-1 border border-teal-200 rounded-lg text-sm focus:ring-2 focus:ring-teal-400 focus:border-teal-400 transition-all duration-200"
                aria-label="Discount type" value={discountType}
                onChange={(e) => setDiscountType(e.target.value as 'amount' | 'percent')}
              >
                <option value="amount">Rs</option>
                <option value="percent">%</option>
              </select>
              <input
                type="number"
                className="w-24 p-1 border border-teal-200 rounded-lg text-right focus:ring-2 focus:ring-teal-400 focus:border-teal-400 transition-all duration-200"
                aria-label="Discount value" inputMode="decimal" value={discountValue}
                onChange={(e) => setDiscountValue(Number(e.target.value))}
              />
            </div>
          </div>
          <div className="pos-bill-total flex justify-between text-xl font-bold pt-2 border-t border-teal-200 text-gray-800">
            <span>Total</span>
            <span className="text-teal-600">Rs. {total.toFixed(2)}</span>
          </div>
          
          {/* Payment Status Toggle */}
          <div className="pos-payment-options flex items-center gap-3 md:gap-4 py-2 flex-wrap">
            <span className="text-sm font-medium text-gray-600">Payment</span>
            <div className="flex gap-2 flex-wrap">
              <button
                aria-pressed={isPaid} onClick={() => setIsPaid(true)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-300 ${
                  isPaid
                    ? 'bg-gradient-to-r from-green-500 to-emerald-500 text-white shadow-sm'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                Paid
              </button>
              <button
                aria-pressed={!isPaid} onClick={() => setIsPaid(false)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-300 ${
                  !isPaid
                    ? 'bg-teal-700 text-white shadow-sm'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                Unpaid
              </button>
              <select
                aria-label="Payment mode" value={paymentMode}
                onChange={(e) => setPaymentMode(e.target.value as 'cash' | 'online')}
                className="px-3 py-2 rounded-lg border border-teal-200 text-sm font-medium focus:ring-2 focus:ring-teal-400 focus:border-teal-400 transition-all duration-200"
              >
                <option value="cash">Cash</option>
                <option value="online">Online</option>
              </select>
            </div>
          </div>
          
        </div>
        </div>
        <div className="pos-checkout-footer">
          <div className="pos-checkout-summary"><div><span>Amount due</span><strong>Rs. {total.toFixed(2)}</strong></div><span>{cart.length} {cart.length===1?'item':'items'} / {isPaid?'Paid':'Unpaid'} / {paymentMode==='cash'?'Cash':'Online'}</span></div>
          <InvoiceSaveActions onAction={action => void handleCheckout(action)} busy={isCheckingOut} disabled={cart.length === 0} whatsAppUnavailable={!selectedCustomer ? 'Select a customer to share the invoice on WhatsApp.' : !normalizeWhatsAppPhone(selectedCustomer.phone) ? 'Add a valid customer WhatsApp number with its country code.' : undefined} />
          {checkoutError && <p role="alert" className="text-xs text-red-600">{checkoutError}</p>}
          {checkoutNotice && <p role="status" className="text-xs text-teal-700">{checkoutNotice}</p>}
          {whatsAppFallback && <a href={whatsAppFallback} target="_blank" rel="noopener noreferrer" className="inline-flex text-sm font-medium text-teal-700 underline">Open WhatsApp</a>}
        </div>
      </div>

      <div className="mobile-bill-bar no-print"><div aria-live="polite" aria-atomic="true"><span>{cart.length} {cart.length===1?'item':'items'}</span><strong>Rs. {total.toFixed(2)}</strong></div><button type="button" onClick={()=>setMobileBillOpen(true)}>Review bill <ChevronRight size={18} aria-hidden="true"/></button></div>

      <CustomerModal
        isOpen={isCustomerModalOpen}
        onClose={() => setIsCustomerModalOpen(false)}
        onSave={handleCustomerSaved}
        onUseExisting={handleUseExistingCustomer}
      />

      {quickAddDuplicateState && (
        <ResponsiveDialog label="Customer already exists" onClose={()=>setQuickAddDuplicateState(null)} className="max-w-lg">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-gray-900">Customer already exists</h3>
                <p className="mt-1 text-sm text-gray-600">
                  We found customers with the same name ignoring case or the same last 7 digits of the phone number.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setQuickAddDuplicateState(null)}
                className="rounded-lg p-1 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
                aria-label="Close duplicate customer popup"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
              Customer already exists. Review the matching records below before adding a new one.
            </div>

            <div className="mt-4 rounded-xl border border-teal-100 bg-teal-50/70 px-4 py-3 text-sm text-gray-700">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Attempted Entry</div>
              <div className="mt-1 font-semibold text-gray-900">{quickAddDuplicateState.name}</div>
              <div>{quickAddDuplicateState.phone}</div>
            </div>

            <div className="mt-4">
              <DuplicateCustomerMatches
                matches={quickAddDuplicateState.matches}
                onUseCustomer={handleUseExistingCustomer}
                actionLabel="Select customer"
              />
            </div>

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setQuickAddDuplicateState(null)}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                Close
              </button>
            </div>
        </ResponsiveDialog>
      )}

      {/* Hidden Print Template */}
      {lastInvoice && createPortal(
        <div id="printable-invoice" className="fixed -left-[9999px] top-0 text-black">
          <ReceiptBrandHeader />
          
          <div className="mb-4 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="font-medium">Date:</span> 
              <span className="font-bold">{new Date(lastInvoice.date).toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="font-medium">Inv:</span> 
              <span className="font-bold">#{lastInvoice.id.slice(0, 8)}</span>
            </div>
            {receiptCustomerCode && (
              <div className="flex justify-between">
                <span className="font-medium">Cust:</span>
                <span className="font-bold tracking-wider">{receiptCustomerCode}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="font-medium">Status:</span> 
              <span className="font-bold">{lastInvoice.status.toUpperCase()}</span>
            </div>
            {lastInvoice.paymentMode && (
              <div className="flex justify-between">
                <span className="font-medium">Payment:</span> 
                <span className="font-bold">{lastInvoice.paymentMode === 'cash' ? 'Cash' : 'Online'}</span>
              </div>
            )}
          </div>
          
          <table className="w-full text-left text-sm mb-4">
            <thead>
              <tr className="border-b-2 border-black">
                <th className="pb-2 font-bold uppercase">Item</th>
                <th className="text-right pb-2 font-bold uppercase">Price</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-300">
              {lastInvoice.items.map((item, i) => (
                <tr key={i}>
                  <td className="py-2 pr-2 font-medium">{item.serviceName}</td>
                  <td className="text-right py-2 font-bold">Rs. {item.price}</td>
                </tr>
              ))}
            </tbody>
          </table>
          
          <div className="border-t-2 border-black pt-2 space-y-1">
            <div className="flex justify-between text-sm">
              <span className="font-medium">Subtotal:</span>
              <span className="font-bold">Rs. {lastInvoice.subtotal}</span>
            </div>
            {lastInvoice.discount > 0 && (
              <div className="flex justify-between text-sm">
                <span className="font-medium">Discount:</span>
                <span className="font-bold">
                  -Rs. {lastInvoice.discount}
                  {lastInvoice.discountType === 'percent' && lastInvoice.discountValue !== undefined
                    ? ` (${lastInvoice.discountValue}%)`
                    : ''}
                </span>
              </div>
            )}
            <div className="flex justify-between font-bold text-lg mt-2 pt-2 border-t border-dashed border-black">
              <span className="uppercase">Total:</span>
              <span>Rs. {lastInvoice.total}</span>
            </div>
          </div>
          
          <div className="text-center mt-6 font-bold text-lg tracking-widest">
            {lastInvoice.status === 'paid' ? '*** PAID ***' : '*** UNPAID ***'}
          </div>
          
          <div className="text-center mt-8 mb-4">
            <p className="font-bold text-sm">Thank you for your visit!</p>
            <p className="mt-1 font-medium text-xs">{salonName}</p>
          </div>
        </div>,
        document.body
      )}
    </fieldset>
  );
};
