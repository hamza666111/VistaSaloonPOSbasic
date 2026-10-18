import { InvoiceSyncBadge } from '../components/InvoiceSyncBadge';
import { roundMoney } from '../utils/money';
import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../store/useStore';
import { Invoice, InvoiceItem } from '../types';
import { FileSpreadsheet, Filter, RefreshCw, Trash2, Calendar, X, Pencil, Shield, Plus } from 'lucide-react';
import { useAppSettings } from '../store/useAppSettings';
import { ReceiptBrandHeader } from '../components/ReceiptBrandHeader';
import { ResponsiveDialog } from '../components/ResponsiveDialog';
import { InvoiceSaveActions } from '../components/InvoiceSaveActions';
import { InvoiceSaveAction, invoiceWhatsAppUrl, normalizeWhatsAppPhone, reserveWhatsAppWindow, openPreparedWhatsApp } from '../utils/invoiceWhatsApp';
import { useReceiptAssets } from '../hooks/useReceiptAssets';

export const Invoices: React.FC = () => {
  const { invoices, services, barbers, customers, updateInvoiceStatus, deleteInvoice, updateInvoice, verifyInvoicePin } = useStore();
  const { logoSrc } = useReceiptAssets();
  const {salonName,address:salonAddress,phone:salonPhone}=useAppSettings(state=>state.settings);
  const [filterBarber, setFilterBarber] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterMonth, setFilterMonth] = useState<string>('');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');
  const [isExporting,setIsExporting]=useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportStartDate, setExportStartDate] = useState('');
  const [exportEndDate, setExportEndDate] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    customerName: '',
    status: 'paid',
    paymentMode: 'cash' as 'cash' | 'online',
    discountType: 'amount' as 'amount' | 'percent',
    discountValue: 0,
  });
  const [editItems, setEditItems] = useState<InvoiceItem[]>([]);
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  const [pendingAction, setPendingAction] = useState<{type: 'edit' | 'delete', id: string} | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [printingInvoice, setPrintingInvoice] = useState<Invoice | null>(null);
  const [viewInvoice, setViewInvoice] = useState<Invoice | null>(null);
  const previewLock = useRef(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [previewNotice, setPreviewNotice] = useState('');
  const [previewWhatsAppFallback, setPreviewWhatsAppFallback] = useState<string | null>(null);
  const itemsPerPage = 10;

  const receiptCustomer = viewInvoice ? customers.find((c) => c.id === viewInvoice.customerId) : undefined;

  React.useEffect(() => {
    setCurrentPage(1);
  }, [filterBarber, filterStatus, filterMonth, filterStartDate, filterEndDate]);

  const editSubtotal = roundMoney(editItems.reduce((sum, item) => sum + roundMoney(item.price), 0));
  const editDiscountAmount = roundMoney(Math.max(
    0,
    Math.min(
      editForm.discountType === 'percent'
        ? editSubtotal * (editForm.discountValue / 100)
        : editForm.discountValue,
      editSubtotal
    )
  ));
  const editTotal = roundMoney(Math.max(0, editSubtotal - editDiscountAmount));

  const uniqueBarbers = [...new Set(invoices.flatMap(inv => inv.items.map(i => i.barberName)))];

  const filteredInvoices = invoices.filter(inv => {
    const barberMatch = !filterBarber || inv.items.some(i => i.barberName === filterBarber);
    const statusMatch = !filterStatus || inv.status === filterStatus;

    // Date range filter
    const invDate = new Date(inv.date).setHours(0, 0, 0, 0);
    let inRange = true;
    if (filterStartDate) {
      const start = new Date(filterStartDate).setHours(0, 0, 0, 0);
      inRange = inRange && invDate >= start;
    }
    if (filterEndDate) {
      const end = new Date(filterEndDate).setHours(23, 59, 59, 999);
      inRange = inRange && invDate <= end;
    }

    return barberMatch && statusMatch && inRange;
  });

  const sortedInvoices = [...filteredInvoices].sort((a, b) => {
    const aTime = new Date(a.date).getTime();
    const bTime = new Date(b.date).getTime();
    const safeATime = Number.isFinite(aTime) ? aTime : 0;
    const safeBTime = Number.isFinite(bTime) ? bTime : 0;
    return safeBTime - safeATime;
  });

  const handleExport = async () => {
    if(isExporting)return;
    setIsExporting(true);
    try {
    const XLSX=await import('xlsx');
    let dataToExport = sortedInvoices;

    if (exportStartDate || exportEndDate) {
      dataToExport = sortedInvoices.filter(inv => {
        const invDate = new Date(inv.date).setHours(0, 0, 0, 0);
        const start = exportStartDate ? new Date(exportStartDate).setHours(0, 0, 0, 0) : -Infinity;
        const end = exportEndDate ? new Date(exportEndDate).setHours(23, 59, 59, 999) : Infinity;
        return invDate >= start && invDate <= end;
      });
    }

    const data = dataToExport.map(inv => {
      const customer = inv.customerId ? customers.find(c => c.id === inv.customerId) : undefined;
      return {
        ID: inv.id.slice(0, 8),
        Date: new Date(inv.date).toLocaleString(),
        Customer: inv.customerName,
        CustomerPhone: customer?.phone || '',
        Barber: [...new Set(inv.items.map(i => i.barberName))].join(', '),
        Items: [...new Set(inv.items.map(i => i.serviceName))].join(', '),
        Subtotal: inv.subtotal,
        Discount: inv.discount,
        DiscountType: inv.discountType || 'amount',
        PaymentMode: inv.paymentMode || 'cash',
        Total: inv.total,
        Status: inv.status
      };
    });

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Invoices');

    const dateStr = exportStartDate && exportEndDate
      ? `${exportStartDate}_to_${exportEndDate}`
      : new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `vistasaloonmanagement-invoices-${dateStr}.xlsx`);

    setShowExportModal(false);
    setExportStartDate('');
    setExportEndDate('');
    } catch(error) { alert(error instanceof Error?error.message:'Unable to export invoices. Please try again.'); }
    finally {setIsExporting(false);}
  };

  const handleToggleStatus = async (id: string, currentStatus: string) => {
    const newStatus = currentStatus === 'paid' ? 'pending' : 'paid';
    try {
      await updateInvoiceStatus(id, newStatus);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to update invoice status.';
      alert(message);
    }
  };

  const handleDeleteInvoice = async (id: string) => {
    try {
      await deleteInvoice(id);
      setDeleteConfirm(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to delete invoice.';
      alert(message);
    }
  };

  const applyMonthRange = (value: string) => {
    setFilterMonth(value);
    if (!value) {
      setFilterStartDate('');
      setFilterEndDate('');
      return;
    }
    const [yearStr, monthStr] = value.split('-');
    const year = Number(yearStr);
    const month = Number(monthStr) - 1; // JS months 0-based
    const start = new Date(year, month, 1);
    const end = new Date(year, month + 1, 0);

    const formatLocal = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };

    setFilterStartDate(formatLocal(start));
    setFilterEndDate(formatLocal(end));
  };

  const editingVersion = useRef<number|undefined>();
  const openEdit = (id: string) => {
    const invoice = invoices.find((inv) => inv.id === id);
    if (!invoice) return;
    editingVersion.current=invoice.version;
    const discountType = invoice.discountType || 'amount';
    const discountValue = invoice.discountValue ?? invoice.discount;
    setEditForm({
      customerName: invoice.customerName,
      status: invoice.status,
      paymentMode: invoice.paymentMode === 'online' ? 'online' : 'cash',
      discountType,
      discountValue,
    });
    setEditItems(invoice.items.map((item) => ({ ...item })));
    setEditingInvoiceId(id);
  };

  const handleItemServiceChange = (index: number, serviceId: string) => {
    const service = services.find((s) => s.id === serviceId);
    setEditItems((items) =>
      items.map((item, idx) =>
        idx === index
          ? {
              ...item,
              serviceId,
              serviceName: service?.name || item.serviceName,
              price: service?.price ?? item.price,
            }
          : item
      )
    );
  };

  const handleItemBarberChange = (index: number, barberId: string) => {
    const barber = barbers.find((b) => b.id === barberId);
    setEditItems((items) =>
      items.map((item, idx) =>
        idx === index
          ? {
              ...item,
              barberId,
              barberName: barber?.name || item.barberName,
            }
          : item
      )
    );
  };

  const handleRemoveItem = (index: number) => {
    setEditItems((items) => items.filter((_, idx) => idx !== index));
  };

  const handleAddItem = () => {
    const fallbackService = services[0] || { id: 'custom', name: 'Custom Item', price: 0, active: true };
    const fallbackBarber = barbers[0] || { id: 'unassigned', name: 'Unassigned', active: true };
    const newItem: InvoiceItem = {
      serviceId: fallbackService.id,
      serviceName: fallbackService.name,
      price: fallbackService.price,
      barberId: fallbackBarber.id,
      barberName: fallbackBarber.name,
    };
    setEditItems((items) => [...items, newItem]);
  };

  const handleSaveEdit = async () => {
    if (!editingInvoiceId) return;
    const existing = invoices.find((inv) => inv.id === editingInvoiceId);
    if (!existing) return;
    if (editItems.length === 0) {
      alert('Invoice must have at least one item');
      return;
    }
    const discountAmount = editDiscountAmount;
    const updated: typeof existing = {
      ...existing,
      version: editingVersion.current,
      customerName: editForm.customerName,
      status: editForm.status as 'paid' | 'pending' | 'cancelled',
      paymentMode: editForm.paymentMode,
      discount: discountAmount,
      discountType: editForm.discountType,
      discountValue: editForm.discountValue,
      items: editItems,
      subtotal: editSubtotal,
      total: editTotal,
    };
    try {
      await updateInvoice(updated);
      setEditingInvoiceId(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to update invoice.';
      alert(message);
    }
  };

  const handleVerifyPin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
    if (await verifyInvoicePin(pinInput, pendingAction?.id, pendingAction?.type)) {
      setShowPinModal(false);
      setPinInput('');
      setPinError('');
      
      if (pendingAction?.type === 'edit') {
        openEdit(pendingAction.id);
      } else if (pendingAction?.type === 'delete') {
        handleDeleteInvoice(pendingAction.id);
      }
      setPendingAction(null);
    } else {
      setPinError('Incorrect PIN, PIN not configured, or too many attempts.');
    }
    } catch(error) {setPinError(error instanceof Error?error.message:'Unable to verify PIN.');}
  };

  const openInvoice = (invoice: Invoice) => {
    setPreviewError(''); setPreviewNotice(''); setPreviewWhatsAppFallback(null); setViewInvoice(invoice);
  };
  const handlePreviewAction = async (action: InvoiceSaveAction) => {
    if (!viewInvoice || previewLock.current) return;
    const invoice = invoices.find(item => item.id === viewInvoice.id);
    if (!invoice) { setPreviewError('This invoice is no longer available. Refresh the list.'); return; }
    // Previewed invoices are already persisted: do not create or overwrite them again.
    setPreviewError(''); setPreviewNotice(''); setPreviewWhatsAppFallback(null);
    if (action === 'save') { setViewInvoice(null); return; }
    if (action === 'whatsapp') {
      const phone = customers.find(customer => customer.id === invoice.customerId)?.phone || '';
      const url = invoiceWhatsAppUrl(invoice, phone);
      if (!url) { setPreviewError('Add a valid WhatsApp number to this customer before sharing.'); return; }
      const target = reserveWhatsAppWindow();
      if (!openPreparedWhatsApp(target, url)) { setPreviewWhatsAppFallback(url); setPreviewNotice('Your browser blocked the WhatsApp window. Use the link below.'); }
      else setPreviewNotice('Send the prepared invoice message in WhatsApp.');
      return;
    }
    previewLock.current = true; setPreviewBusy(true);
    setPrintingInvoice(invoice);
    try { await new Promise(resolve => setTimeout(resolve, 300)); window.print(); }
    catch { setPreviewError('Printing could not start. The invoice is already saved; please try again.'); }
    finally { setPrintingInvoice(null); previewLock.current = false; setPreviewBusy(false); }
  };

  const totalPages = Math.ceil(sortedInvoices.length / itemsPerPage);
  const paginatedInvoices = sortedInvoices.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  return (
    <>
      {/* Preload assets for printing */}
      <img src={logoSrc} className="fixed -left-[9999px] w-0 h-0" alt="" aria-hidden="true" />

      <div className="p-4 md:p-6 animate-fadeIn space-y-4 md:space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 md:gap-6">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900">Sales & invoices</h1>
          <p className="text-gray-500 text-sm">Keep every transaction in view and every detail in order.</p>
        </div>
        <button
          onClick={() => setShowExportModal(true)}
          className="inline-flex items-center justify-center gap-2 bg-gradient-to-r from-green-500 to-emerald-600 text-white px-4 md:px-5 py-2.5 rounded-lg hover:from-green-600 hover:to-emerald-700 shadow-sm hover:shadow-sm transition-all duration-300"
        >
          <FileSpreadsheet className="w-5 h-5" />
          Export to Excel
        </button>
      </div>

      {showExportModal && (
        <ResponsiveDialog label="Export to Excel" onClose={()=>setShowExportModal(false)} className="max-w-md">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-gray-800">Export to Excel</h2>
              <button aria-label="Close export" onClick={() => setShowExportModal(false)} className="text-gray-400 hover:text-gray-600 transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2" htmlFor="invoices-field-1">
                  <Calendar className="w-4 h-4 text-teal-500" />
                  Start Date
                </label>
                <input id="invoices-field-1"
                  type="date"
                  value={exportStartDate}
                  onChange={(e) => setExportStartDate(e.target.value)}
                  className="w-full border border-teal-200 rounded-lg p-2 focus:ring-2 focus:ring-teal-400 focus:border-teal-400 transition-all duration-200"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2" htmlFor="invoices-field-2">
                  <Calendar className="w-4 h-4 text-teal-500" />
                  End Date
                </label>
                <input id="invoices-field-2"
                  type="date"
                  value={exportEndDate}
                  onChange={(e) => setExportEndDate(e.target.value)}
                  className="w-full border border-teal-200 rounded-lg p-2 focus:ring-2 focus:ring-teal-400 focus:border-teal-400 transition-all duration-200"
                />
              </div>
              <p className="text-xs text-gray-500">Leave empty to export all data</p>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setShowExportModal(false)}
                  className="flex-1 py-2 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 transition-all duration-200"
                >
                  Cancel
                </button>
                <button
                  disabled={isExporting} onClick={handleExport}
                  className="flex-1 py-2 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-lg hover:from-green-600 hover:to-emerald-700 shadow-sm hover:shadow-sm transition-all duration-300"
                >
                  {isExporting ? 'Exporting...' : 'Export'}
                </button>
              </div>
            </div>
          </ResponsiveDialog>
      )}

      <div className="invoice-filters bg-stone-50 p-4 rounded-xl shadow-sm border border-teal-100 flex gap-4 items-center flex-wrap">
        <Filter className="w-5 h-5 text-teal-500" />
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-600" htmlFor="invoices-field-3">Barber:</label>
          <select id="invoices-field-3"
            value={filterBarber}
            onChange={(e) => setFilterBarber(e.target.value)}
            className="border border-teal-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-teal-400 focus:border-teal-400 transition-all duration-200"
          >
            <option value="">All Team members</option>
            {uniqueBarbers.map(barber => (
              <option key={barber} value={barber}>{barber}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-600" htmlFor="invoices-field-4">Status:</label>
          <select id="invoices-field-4"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="border border-teal-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-teal-400 focus:border-teal-400 transition-all duration-200"
          >
            <option value="">All</option>
            <option value="paid">Paid</option>
            <option value="pending">Unpaid</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-600" htmlFor="invoices-field-5">Month:</label>
          <select id="invoices-field-5"
            value={filterMonth}
            onChange={(e) => applyMonthRange(e.target.value)}
            className="border border-teal-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-teal-400 focus:border-teal-400 transition-all duration-200"
          >
            <option value="">All</option>
            {Array.from({ length: 12 }).map((_, idx) => {
              const date = new Date();
              date.setMonth(idx);
              const label = date.toLocaleString('default', { month: 'short' });
              const value = `${date.getFullYear()}-${String(idx + 1).padStart(2, '0')}`;
              return (
                <option key={value} value={value}>{label} {date.getFullYear()}</option>
              );
            })}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-600" htmlFor="invoices-field-6">From:</label>
          <input id="invoices-field-6"
            type="date"
            value={filterStartDate}
            onChange={(e) => { setFilterStartDate(e.target.value); setFilterMonth(''); }}
            className="border border-teal-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-teal-400 focus:border-teal-400 transition-all duration-200"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-600" htmlFor="invoices-field-7">To:</label>
          <input id="invoices-field-7"
            type="date"
            value={filterEndDate}
            onChange={(e) => { setFilterEndDate(e.target.value); setFilterMonth(''); }}
            className="border border-teal-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-teal-400 focus:border-teal-400 transition-all duration-200"
          />
        </div>
        {(filterBarber || filterStatus || filterMonth || filterStartDate || filterEndDate) && (
          <button
            onClick={() => {
              setFilterBarber('');
              setFilterStatus('');
              setFilterMonth('');
              setFilterStartDate('');
              setFilterEndDate('');
            }}
            className="text-sm text-teal-600 hover:text-teal-700 hover:underline transition-colors duration-200"
          >
            Clear Filters
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-teal-100 overflow-hidden">
        <div className="p-4 md:p-6 border-b border-teal-100 bg-stone-50">
          <h2 className="font-bold text-lg text-gray-800">Invoices</h2>
        </div>
        <div className="invoice-table-wrap">
          <table className="invoice-table w-full text-left">
            <colgroup><col style={{ width: '9%' }} /><col style={{ width: '11%' }} /><col style={{ width: '16%' }} /><col style={{ width: '18%' }} /><col style={{ width: '11%' }} /><col style={{ width: '8%' }} /><col style={{ width: '8%' }} /><col style={{ width: '19%' }} /></colgroup>
            <thead className="bg-gradient-to-r from-teal-100 to-teal-100 text-gray-700 text-sm">
              <tr>
                <th className="p-4">ID</th>
                <th className="p-4">Date</th>
                <th className="p-4">Customer</th>
                <th className="p-4">Services</th>
                <th className="p-4 text-right">Total</th>
                <th className="p-4">Payment</th>
                <th className="p-4">Status</th>
                <th className="p-4">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-teal-50">
              {paginatedInvoices.map(invoice => {
                const customer = customers.find(c => c.id === invoice.customerId);
                return (
                <tr key={invoice.id} tabIndex={0} aria-label={`View invoice ${invoice.id.slice(0, 8)} for ${customer?.name || invoice.customerName}`} onClick={() => openInvoice(invoice)} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openInvoice(invoice); } }} className="invoice-row cursor-pointer hover:bg-teal-50 transition-colors duration-200">
                  <td data-label="ID" className="p-4 font-mono text-xs text-gray-500">
                    {invoice.id.slice(0, 8)}
                  </td>
                  <td data-label="Date" className="p-4 text-sm">
                    {new Date(invoice.date).toLocaleDateString()}
                  </td>
                  <td data-label="Customer" className="p-4">
                    <div className="font-medium text-gray-800">{customer ? customer.name : invoice.customerName}</div>
                    {customer?.phone && <div className="text-xs text-gray-500">{customer.phone}</div>}
                  </td>
                  <td data-label="Services" className="p-4 text-sm text-gray-600 invoice-services" title={[...new Set(invoice.items.map(i => i.serviceName))].join(', ')}>
                    <div className="line-clamp-2">{[...new Set(invoice.items.map(i => i.serviceName))].join(', ')}</div>
                  </td>
                  <td data-label="Total" className="p-4 text-right font-bold text-teal-600">
                    Rs. {invoice.total.toFixed(2)}
                  </td>
                  <td data-label="Payment" className="p-4 text-sm text-gray-700">
                    {invoice.paymentMode === 'online' ? 'Online' : 'Cash'}
                  </td>
                  <td data-label="Status" className="p-4">
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                      invoice.status === 'paid'
                        ? 'bg-green-100 text-green-700'
                        : 'bg-teal-100 text-teal-700'
                    }`}>
                      {invoice.status === 'paid' ? 'Paid' : 'Unpaid'}
                    </span><InvoiceSyncBadge invoice={invoice}/>
                  </td>
                  <td data-label="Actions" className="p-4" onClick={(event) => event.stopPropagation()}>
                    <div className="invoice-actions flex items-center gap-2">
                      <button disabled={!!invoice.syncStatus} title={invoice.syncStatus?'Sync this invoice before editing.':undefined}
                        onClick={() => {
                          setPendingAction({ type: 'edit', id: invoice.id });
                          setShowPinModal(true);
                        }}
                        className="flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-medium bg-blue-50 text-blue-600 hover:bg-blue-100 transition-all duration-200 hover:scale-105"
                      >
                        <Pencil className="w-3 h-3" />
                        Edit
                      </button>
                      <button
                        disabled={!!invoice.syncStatus} title={invoice.syncStatus?'Sync this invoice before changing payment status.':undefined} onClick={() => handleToggleStatus(invoice.id, invoice.status)}
                        className={`flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-medium transition-all duration-200 hover:scale-105 ${
                          invoice.status === 'paid'
                            ? 'bg-teal-50 text-teal-600 hover:bg-teal-100'
                            : 'bg-green-50 text-green-600 hover:bg-green-100'
                        }`}
                      >
                        <RefreshCw className="w-3 h-3" />
                        {invoice.status === 'paid' ? 'Mark Unpaid' : 'Mark Paid'}
                      </button>
                      {deleteConfirm === invoice.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => {
                              setPendingAction({ type: 'delete', id: invoice.id });
                              setShowPinModal(true);
                            }}
                            className="px-2 py-1 bg-red-500 text-white text-xs rounded-lg hover:bg-red-600 transition-colors duration-200"
                          >
                            Yes
                          </button>
                          <button
                            onClick={() => setDeleteConfirm(null)}
                            className="px-2 py-1 bg-gray-200 text-gray-600 text-xs rounded-lg hover:bg-gray-300 transition-colors duration-200"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button
                          disabled={!!invoice.syncStatus} title={invoice.syncStatus?'Sync this invoice before deleting.':undefined} onClick={() => setDeleteConfirm(invoice.id)}
                          className="flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-medium bg-red-50 text-red-600 hover:bg-red-100 transition-all duration-200 hover:scale-105"
                        >
                          <Trash2 className="w-3 h-3" />
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )})}
              {paginatedInvoices.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-gray-400">
                    No invoices found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        
        {totalPages > 1 && (
          <div className="invoice-pagination p-4 border-t border-teal-100 flex items-center justify-between bg-teal-50/30">
            <div className="text-sm text-gray-600">
              Showing {((currentPage - 1) * itemsPerPage) + 1} to {Math.min(currentPage * itemsPerPage, sortedInvoices.length)} of {sortedInvoices.length} invoices
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1.5 rounded-lg border border-teal-200 text-sm font-medium text-gray-700 hover:bg-teal-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Previous
              </button>
              <select className="mobile-page-select" aria-label="Invoice page" value={currentPage} onChange={event=>setCurrentPage(Number(event.target.value))}>{Array.from({length:totalPages},(_,index)=><option key={index} value={index+1}>Page {index+1} of {totalPages}</option>)}</select>
              <div className="invoice-pages flex items-center gap-1">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                  <button
                    key={page}
                    onClick={() => setCurrentPage(page)}
                    className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${
                      currentPage === page
                        ? 'bg-teal-500 text-white'
                        : 'text-gray-700 hover:bg-teal-100'
                    }`}
                  >
                    {page}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="px-3 py-1.5 rounded-lg border border-teal-200 text-sm font-medium text-gray-700 hover:bg-teal-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Receipt Modal */}
      {viewInvoice && (
        <ResponsiveDialog label="Invoice Receipt" onClose={()=>{if(!previewBusy)setViewInvoice(null);}} className="max-w-3xl invoice-receipt-dialog">
            <div className="sticky top-0 z-10 flex justify-between items-start gap-3 mb-4 bg-white pb-3 border-b border-teal-100">
              <div>
                <h2 id="invoice-receipt-title" className="text-xl font-bold text-gray-800">Invoice Receipt</h2>
                <p className="text-xs text-gray-500 mt-1">ID: {viewInvoice.id.slice(0, 8)}</p>
              </div>
              <button aria-label="Close invoice" onClick={() => setViewInvoice(null)} className="text-gray-400 hover:text-gray-600 transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>

            <InvoiceSyncBadge invoice={invoices.find(invoice=>invoice.id===viewInvoice.id)||viewInvoice}/><div className="invoice-preview-salon"><img src={logoSrc} alt={`${salonName} logo`} /><div><strong>{salonName}</strong>{salonAddress&&<p className="receipt-salon-address">{salonAddress}</p>}{salonPhone&&<p>{salonPhone}</p>}</div></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm text-gray-700 mb-4">
              <div className="bg-teal-50 border border-teal-100 rounded-xl p-3 space-y-1">
                <div className="receipt-detail-row flex justify-between"><span className="font-medium">Date</span><span>{new Date(viewInvoice.date).toLocaleString()}</span></div>
                <div className="receipt-detail-row flex justify-between"><span className="font-medium">Status</span><span className="font-semibold">{viewInvoice.status.toUpperCase()}</span></div>
                <div className="receipt-detail-row flex justify-between"><span className="font-medium">Payment</span><span className="font-semibold">{viewInvoice.paymentMode === 'online' ? 'Online' : 'Cash'}</span></div>
              </div>
              <div className="bg-teal-50 border border-teal-100 rounded-xl p-3 space-y-1">
                {viewInvoice.customerName && (
                  <div className="receipt-detail-row flex justify-between"><span className="font-medium">Customer</span><span className="font-semibold">{viewInvoice.customerName}</span></div>
                )}
                {receiptCustomer?.phone && (
                  <div className="receipt-detail-row flex justify-between"><span className="font-medium">Phone</span><span className="font-semibold">{receiptCustomer.phone}</span></div>
                )}
                <div className="receipt-detail-row flex justify-between"><span className="font-medium">Invoice No.</span><span className="font-mono">{viewInvoice.id}</span></div>
              </div>
            </div>

            <div className="space-y-2 mb-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-800">Items</h3>
                <span className="text-xs text-gray-500">{viewInvoice.items.length} line(s)</span>
              </div>
              <div className="divide-y divide-teal-100 border border-teal-100 rounded-xl overflow-hidden">
                {viewInvoice.items.map((item: any, idx: number) => (
                  <div key={`${item.serviceId}-${idx}`} className="flex items-start justify-between gap-3 p-3">
                    <div>
                      <div className="font-medium text-gray-900">{item.serviceName}</div>
                      <div className="text-xs text-gray-500">Barber: {item.barberName}</div>
                    </div>
                    <div className="text-sm font-semibold text-teal-700">Rs. {item.price}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-stone-50 rounded-xl border border-teal-100 p-4 space-y-2 text-sm text-gray-800">
              <div className="flex justify-between"><span>Subtotal</span><span className="font-semibold">Rs. {viewInvoice.subtotal}</span></div>
              {viewInvoice.discount > 0 && (
                <div className="flex justify-between"><span>Discount</span><span className="font-semibold">- Rs. {viewInvoice.discount}{viewInvoice.discountType === 'percent' && viewInvoice.discountValue !== undefined ? ` (${viewInvoice.discountValue}%)` : ''}</span></div>
              )}
              <div className="flex justify-between text-base font-bold text-gray-900 pt-1 border-t border-teal-200">
                <span>Total</span>
                <span className="text-teal-700">Rs. {viewInvoice.total}</span>
              </div>
            </div>

            <div className="invoice-preview-footer mt-6">
              <InvoiceSaveActions alreadySaved busy={previewBusy} onAction={action => void handlePreviewAction(action)} whatsAppUnavailable={!receiptCustomer ? 'This invoice needs a customer with a WhatsApp number to share.' : !normalizeWhatsAppPhone(receiptCustomer.phone) ? 'Add a valid customer WhatsApp number with its country code.' : undefined} />
              <button type="button" disabled={previewBusy} onClick={() => setViewInvoice(null)} className="rounded-lg border border-gray-200 px-4 py-2 text-gray-700 hover:bg-gray-50">Close</button>
            </div>
            {previewError && <p role="alert" className="mt-3 text-sm text-red-600">{previewError}</p>}
            {previewNotice && <p role="status" className="mt-3 text-sm text-teal-700">{previewNotice}</p>}
            {previewWhatsAppFallback && <a href={previewWhatsAppFallback} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex text-sm font-medium text-teal-700 underline">Open WhatsApp</a>}
          </ResponsiveDialog>
      )}

              {/* Edit Invoice Modal */}
              {editingInvoiceId && (
                <ResponsiveDialog label="Edit Invoice" onClose={()=>setEditingInvoiceId(null)} className="max-w-4xl invoice-edit-dialog">
                    <div className="flex justify-between items-center mb-4">
                      <h2 className="text-xl font-bold text-gray-800">Edit Invoice</h2>
                      <button aria-label="Close invoice editor" onClick={() => setEditingInvoiceId(null)} className="text-gray-400 hover:text-gray-600 transition-colors">
                        <X className="w-6 h-6" />
                      </button>
                    </div>
                    <div className="space-y-5">
                      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                        <div className="lg:col-span-1">
                          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="invoices-field-8">Customer Name</label>
                          <input id="invoices-field-8"
                            value={editForm.customerName}
                            onChange={(e) => setEditForm({ ...editForm, customerName: e.target.value })}
                            className="w-full border border-teal-200 rounded-lg p-2 focus:ring-2 focus:ring-teal-400 focus:border-teal-400 transition-all duration-200"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="invoices-field-9">Status</label>
                          <select id="invoices-field-9"
                            value={editForm.status}
                            onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                            className="w-full border border-teal-200 rounded-lg p-2 focus:ring-2 focus:ring-teal-400 focus:border-teal-400 transition-all duration-200"
                          >
                            <option value="paid">Paid</option>
                            <option value="pending">Unpaid</option>
                            <option value="cancelled">Cancelled</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="invoices-field-10">Payment Mode</label>
                          <select id="invoices-field-10"
                            value={editForm.paymentMode}
                            onChange={(e) => setEditForm({ ...editForm, paymentMode: e.target.value as 'cash' | 'online' })}
                            className="w-full border border-teal-200 rounded-lg p-2 focus:ring-2 focus:ring-teal-400 focus:border-teal-400 transition-all duration-200"
                          >
                            <option value="cash">Cash</option>
                            <option value="online">Online</option>
                          </select>
                        </div>
                      </div>

                      <div className="space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <h3 className="text-sm font-semibold text-gray-800">Items</h3>
                            <p className="text-xs text-gray-500">Edit services, assign barbers, or add new lines.</p>
                          </div>
                          <button
                            onClick={handleAddItem}
                            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 transition-all duration-200 hover:scale-105"
                          >
                            <Plus className="w-4 h-4" />
                            Add Item
                          </button>
                        </div>

                        <div className="invoice-edit-items space-y-3 max-h-72 overflow-y-auto pr-1">
                          {editItems.map((item, idx) => (
                            <div
                              key={`${item.serviceId}-${idx}`}
                              className="grid grid-cols-1 sm:grid-cols-12 gap-3 bg-stone-50 p-3 rounded-xl border border-teal-100"
                            >
                              <div className="sm:col-span-5">
                                <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="invoices-field-11">Service</label>
                                <select id="invoices-field-11"
                                  value={item.serviceId}
                                  onChange={(e) => handleItemServiceChange(idx, e.target.value)}
                                  className="w-full border border-teal-200 rounded-lg p-2 focus:ring-2 focus:ring-teal-400 focus:border-teal-400 transition-all duration-200"
                                >
                                  {services.map((service) => (
                                    <option key={service.id} value={service.id}>
                                      {service.name} (Rs. {service.price})
                                    </option>
                                  ))}
                                  {!services.find((s) => s.id === item.serviceId) && (
                                    <option value={item.serviceId}>{item.serviceName}</option>
                                  )}
                                </select>
                              </div>
                              <div className="sm:col-span-4">
                                <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="invoices-field-12">Team member</label>
                                <select id="invoices-field-12"
                                  value={item.barberId}
                                  onChange={(e) => handleItemBarberChange(idx, e.target.value)}
                                  className="w-full border border-teal-200 rounded-lg p-2 focus:ring-2 focus:ring-teal-400 focus:border-teal-400 transition-all duration-200"
                                >
                                  {barbers.map((barber) => (
                                    <option key={barber.id} value={barber.id}>{barber.name}</option>
                                  ))}
                                  {!barbers.find((b) => b.id === item.barberId) && (
                                    <option value={item.barberId}>{item.barberName}</option>
                                  )}
                                </select>
                              </div>
                              <div className="sm:col-span-2">
                                <label className="block text-sm font-medium text-gray-700 mb-1">Price</label>
                                <div className="font-bold text-teal-700 text-sm">Rs. {item.price}</div>
                              </div>
                              <div className="sm:col-span-1 flex items-end justify-end">
                                <button
                                  onClick={() => handleRemoveItem(idx)}
                                  className="px-3 py-2 rounded-lg text-xs font-medium bg-red-50 text-red-600 hover:bg-red-100 transition-all duration-200 hover:scale-105 disabled:opacity-50"
                                  disabled={editItems.length === 1}
                                >
                                  Remove
                                </button>
                              </div>
                            </div>
                          ))}
                          {editItems.length === 0 && (
                            <div className="text-sm text-gray-500 border border-dashed border-teal-200 rounded-lg p-3 text-center">
                              No items. Add at least one service to save.
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-end">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="invoices-field-13">Discount Type</label>
                          <select id="invoices-field-13"
                            value={editForm.discountType}
                            onChange={(e) => setEditForm({ ...editForm, discountType: e.target.value as 'amount' | 'percent' })}
                            className="w-full border border-teal-200 rounded-lg p-2 focus:ring-2 focus:ring-teal-400 focus:border-teal-400 transition-all duration-200"
                          >
                            <option value="amount">Amount (Rs)</option>
                            <option value="percent">Percent</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="invoices-field-14">Discount Value</label>
                          <input id="invoices-field-14"
                            type="number"
                            value={editForm.discountValue}
                            onChange={(e) => setEditForm({ ...editForm, discountValue: Number(e.target.value) })}
                            className="w-full border border-teal-200 rounded-lg p-2 focus:ring-2 focus:ring-teal-400 focus:border-teal-400 transition-all duration-200"
                          />
                        </div>
                        <div className="bg-stone-50 rounded-xl border border-teal-100 p-3 space-y-1">
                          <div className="flex justify-between text-sm text-gray-700">
                            <span>Subtotal</span>
                            <span>Rs. {editSubtotal.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between text-sm text-gray-700">
                            <span>Discount</span>
                            <span>- Rs. {editDiscountAmount.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between text-base font-bold text-gray-900 pt-1 border-t border-teal-100">
                            <span>Total</span>
                            <span className="text-teal-700">Rs. {editTotal.toFixed(2)}</span>
                          </div>
                        </div>
                      </div>
                      <p className="text-xs text-gray-500">Totals update live as you adjust services, barbers, or discounts.</p>
                      <div className="flex gap-3 pt-2">
                        <button
                          onClick={() => setEditingInvoiceId(null)}
                          className="flex-1 py-2 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 transition-all duration-200"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleSaveEdit}
                          className="flex-1 py-2 bg-teal-700 text-white rounded-lg hover:from-teal-600 hover:to-teal-600 shadow-sm hover:shadow-sm transition-all duration-300"
                        >
                          Save Changes
                        </button>
                      </div>
                    </div>
                  </ResponsiveDialog>
              )}

              {/* PIN Modal */}
              {showPinModal && (
                <ResponsiveDialog label="Enter Edit PIN" onClose={()=>{setShowPinModal(false);setPinInput('');setPinError('');setPendingAction(null);}} className="max-w-sm">
                    <div className="flex justify-between items-center mb-4">
                      <div className="flex items-center gap-2">
                        <Shield className="w-5 h-5 text-teal-500" />
                        <h2 className="text-lg font-bold text-gray-800">Enter Edit PIN</h2>
                      </div>
                      <button aria-label="Close invoice PIN" onClick={() => { setShowPinModal(false); setPinInput(''); setPinError(''); setPendingAction(null); }} className="text-gray-400 hover:text-gray-600 transition-colors">
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                    <form onSubmit={handleVerifyPin} className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="invoices-field-15">PIN</label>
                        <input id="invoices-field-15"
                          type="password"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={pinInput}
                          onChange={(e) => setPinInput(e.target.value)}
                          className="w-full border border-teal-200 rounded-lg p-3 focus:ring-2 focus:ring-teal-400 focus:border-teal-400 transition-all duration-200"
                          placeholder="Enter PIN"
                        />
                        {pinError && <p className="text-red-500 text-xs mt-1">{pinError}</p>}
                      </div>
                      <button
                        type="submit"
                        className="w-full bg-teal-700 text-white py-2 rounded-lg hover:from-teal-600 hover:to-teal-600 shadow-sm hover:shadow-sm transition-all duration-300"
                      >
                        Unlock Editing
                      </button>
                    </form>
                </ResponsiveDialog>
              )}
              </div>

              {/* Hidden Printable Invoice */}
              {printingInvoice && createPortal(
        <div id="printable-invoice" className="fixed top-0 left-0 bg-white z-[9999] min-h-screen p-0 m-0 w-full" style={{ display: 'none' }}>
          <ReceiptBrandHeader />
          
          <div className="border-t-2 border-b-2 border-black py-2 mb-4 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="font-medium">Date:</span> 
              <span>{new Date(printingInvoice.date).toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="font-medium">Invoice No:</span> 
              <span className="font-mono">{printingInvoice.id.slice(0, 8)}</span>
            </div>
            {printingInvoice.customerName && (
              <div className="flex justify-between">
                <span className="font-medium">Customer:</span> 
                <span className="font-bold">{printingInvoice.customerName}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="font-medium">Status:</span> 
              <span className="font-bold">{printingInvoice.status.toUpperCase()}</span>
            </div>
            {printingInvoice.paymentMode && (
              <div className="flex justify-between">
                <span className="font-medium">Payment:</span> 
                <span className="font-bold">{printingInvoice.paymentMode === 'cash' ? 'Cash' : 'Online'}</span>
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
              {printingInvoice.items.map((item: any, i: number) => (
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
              <span className="font-bold">Rs. {printingInvoice.subtotal}</span>
            </div>
            {printingInvoice.discount > 0 && (
              <div className="flex justify-between text-sm">
                <span className="font-medium">Discount:</span>
                <span className="font-bold">
                  -Rs. {printingInvoice.discount}
                  {printingInvoice.discountType === 'percent' && printingInvoice.discountValue !== undefined
                    ? ` (${printingInvoice.discountValue}%)`
                    : ''}
                </span>
              </div>
            )}
            <div className="flex justify-between font-bold text-lg mt-2 pt-2 border-t border-dashed border-black">
              <span className="uppercase">Total:</span>
              <span>Rs. {printingInvoice.total}</span>
            </div>
          </div>
          
          <div className="text-center mt-6 font-bold text-lg tracking-widest">
            {printingInvoice.status === 'paid' ? '*** PAID ***' : '*** UNPAID ***'}
          </div>
          
          <div className="text-center mt-8 mb-4">
            <p className="font-bold text-sm">Thank you for your visit!</p>
            <p className="mt-1 font-medium text-xs">{salonName}</p>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};
