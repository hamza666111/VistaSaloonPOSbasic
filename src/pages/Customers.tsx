import React, { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store/useStore';
import { CalendarClock, CreditCard, Download, MapPin, Phone, Scissors, Search, User, Wallet, ArrowLeft, Upload } from 'lucide-react';
import { supabase } from '../api/supabase';
import { CustomerImportDialog } from '../components/CustomerImportDialog';
import { isDemoMode } from '../demo/mode';

export const Customers: React.FC = () => {
  const { customers, invoices } = useStore();
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>(customers[0]?.id || '');
  const [mobileDetailOpen,setMobileDetailOpen]=useState(false);
  const [search, setSearch] = useState('');
  const [visitStatusFilter, setVisitStatusFilter] = useState<'all' | 'paid' | 'pending'>('all');
  const [importOpen,setImportOpen]=useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const filteredCustomers = useMemo(() => {
    const term = search.toLowerCase();
    return customers.filter((c) => {
      const matchesText = [c.name, c.phone, c.email ?? ''].some((field) => (field || '').toLowerCase().includes(term));
      if (!matchesText) return false;

      if (visitStatusFilter === 'all') return true;

      const customerVisits = invoices.filter(
        (inv) => inv.customerId === c.id || (!inv.customerId && inv.customerName === c.name)
      );
      if (visitStatusFilter === 'paid') {
        return customerVisits.some((v) => v.status === 'paid');
      }
      return customerVisits.some((v) => v.status !== 'paid');
    });
  }, [customers, invoices, search, visitStatusFilter]);

  const lastVisitByCustomer = useMemo(() => {
    const map = new Map<string, number>();
    invoices.forEach((inv) => {
      const key = inv.customerId || inv.customerName;
      if (!key) return;
      const ts = new Date(inv.date).getTime();
      const prev = map.get(key) ?? 0;
      if (ts > prev) map.set(key, ts);
    });
    return map;
  }, [invoices]);

  const sortedCustomers = useMemo(() => {
    if (filteredCustomers.length === 0) return [];
    
    let latestCustomer = filteredCustomers[0];
    let maxVisit = -1;
    
    filteredCustomers.forEach(c => {
      const key = c.id || c.name;
      const visit = lastVisitByCustomer.get(key) || 0;
      if (visit > maxVisit) {
        maxVisit = visit;
        latestCustomer = c;
      }
    });

    const rest = filteredCustomers.filter(c => c.id !== latestCustomer.id);
    rest.sort((a, b) => a.name.localeCompare(b.name));

    if (maxVisit > 0) {
      return [latestCustomer, ...rest];
    } else {
      return [...filteredCustomers].sort((a, b) => a.name.localeCompare(b.name));
    }
  }, [filteredCustomers, lastVisitByCustomer]);

  useEffect(() => {
    if (sortedCustomers.length === 0) {
      setSelectedCustomerId('');
      return;
    }
    const stillVisible = sortedCustomers.find((c) => c.id === selectedCustomerId);
    if (!stillVisible) {
      setSelectedCustomerId(sortedCustomers[0].id);
    }
  }, [sortedCustomers, selectedCustomerId]);

  const selectedCustomer = sortedCustomers.find((c) => c.id === selectedCustomerId) || null;

  const customerInvoices = useMemo(() => {
    if (!selectedCustomer) return [] as typeof invoices;
    return invoices.filter((inv) =>
      inv.customerId === selectedCustomer.id || (!inv.customerId && inv.customerName === selectedCustomer.name)
    );
  }, [invoices, selectedCustomer]);

  const visits = useMemo(() => {
    return [...customerInvoices].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [customerInvoices]);

  const lastVisit = visits[0];
  const totalSpent = visits
    .filter((v) => v.status === 'paid')
    .reduce((sum, v) => sum + v.total, 0);
  const paidVisits = visits.filter((v) => v.status === 'paid').length;
  const pendingVisits = visits.filter((v) => v.status !== 'paid').length;
  const firstVisitDate = visits.length ? visits[visits.length - 1].date : null;

  const handleExportCustomers = async () => {
    if(isExporting)return;
    setIsExporting(true);
    try {
      const XLSX=await import('xlsx');
      if(supabase) await useStore.getState().syncData();
      const exportCustomers=supabase?useStore.getState().customers:customers;
      if(!exportCustomers.length){alert('No customers available to export.');return;}
      const rows=[...exportCustomers].sort((a,b)=>a.name.localeCompare(b.name)).map(customer=>({'Complete Name':customer.name,Numbers:customer.phone}));
      const workbook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(workbook,XLSX.utils.json_to_sheet(rows),'Customers');
      const date=new Date().toISOString().slice(0,10);
      XLSX.writeFile(workbook,isDemoMode?'vistasaloonmanagement-demo-customers.xlsx':`vistasaloonmanagement-customers-${date}.xlsx`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to export customers from database.';
      alert(message);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className={`client-book ${mobileDetailOpen?'client-detail-open':''} p-4 md:p-6 space-y-6 animate-fadeIn`}>
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900">Your client book</h1>
          <p className="text-gray-500 text-sm">Every visit, every detail. Build relationships that last.</p>
        </div>
        <div className="flex flex-wrap gap-3 items-center justify-end w-full sm:w-auto">
          <div className="customer-transfer-actions">
          <button
            onClick={handleExportCustomers}
            disabled={isExporting}
            className="inline-flex items-center gap-2 bg-gradient-to-r from-emerald-500 to-green-600 text-white px-4 py-2 rounded-lg hover:from-emerald-600 hover:to-green-700 shadow-sm hover:shadow-sm transition-all duration-300"
          >
            <Download className="w-4 h-4" />
            {isExporting ? 'Exporting...' : 'Export Excel'}
          </button>
          <button type="button" onClick={()=>setImportOpen(true)} className="customer-import-trigger inline-flex items-center justify-center gap-2 border border-teal-200 bg-white text-teal-700 px-4 py-2 rounded-lg"><Upload size={16}/>Import Excel</button>
          </div>
          <div className="flex items-center gap-2 bg-white border border-teal-100 rounded-lg px-3 py-2 shadow-sm w-full sm:w-80">
            <Search className="w-4 h-4 text-teal-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or phone"
              className="w-full outline-none text-sm"
            />
          </div>
          <div className="flex items-center gap-2 bg-white border border-teal-100 rounded-lg px-2 py-2 shadow-sm">
            <span className="text-xs font-medium text-gray-600">Invoices:</span>
            {(['all', 'paid', 'pending'] as const).map((opt) => (
              <button
                key={opt}
                onClick={() => setVisitStatusFilter(opt)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all duration-200 ${
                  visitStatusFilter === opt
                    ? 'bg-teal-700 text-white shadow-sm'
                    : 'text-gray-600 hover:bg-teal-50'
                }`}
              >
                {opt === 'all' ? 'All' : opt === 'paid' ? 'Paid' : 'Unpaid'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {importOpen&&<CustomerImportDialog onClose={()=>setImportOpen(false)}/>}
      <div className="client-layout grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="client-list-pane bg-white rounded-xl shadow-sm border border-teal-100 overflow-hidden">
          <div className="p-4 border-b border-teal-100 bg-stone-50 font-semibold text-gray-700">
            Customers
          </div>
          <div className="max-h-[60vh] overflow-y-auto divide-y divide-teal-50">
            {sortedCustomers.map((customer) => (
              <button
                key={customer.id}
                aria-label={`View ${customer.name}`} onClick={() => {setSelectedCustomerId(customer.id);setMobileDetailOpen(true);window.scrollTo({top:0});}}
                className={`w-full text-left p-4 flex items-center gap-3 hover:bg-teal-50 transition-colors duration-200 ${
                  selectedCustomerId === customer.id ? 'bg-teal-50' : ''
                }`}
              >
                <div className="w-10 h-10 rounded-full bg-teal-700 text-white flex items-center justify-center font-semibold">
                  {customer.name.slice(0, 1).toUpperCase()}
                </div>
                <div className="flex-1">
                  <div className="font-semibold text-gray-800">{customer.name}</div>
                  <div className="text-sm text-gray-500">{customer.phone}</div>
                </div>
                <div className="text-xs text-gray-400">
                  {invoices.filter((inv) => inv.customerId === customer.id).length} visits
                </div>
              </button>
            ))}
            {sortedCustomers.length === 0 && (
              <div className="p-6 text-center text-gray-400">No customers found</div>
            )}
          </div>
        </div>

        <div className="client-detail-pane lg:col-span-2 space-y-4">
          <button type="button" className="client-back" onClick={()=>setMobileDetailOpen(false)}><ArrowLeft size={18}/>All customers</button>
          {!selectedCustomer && (
            <div className="bg-white rounded-xl shadow-sm border border-teal-100 p-8 text-center text-gray-500">
              Select a customer to view details
            </div>
          )}

          {selectedCustomer && (
            <>
              <div className="bg-white rounded-xl shadow-sm border border-teal-100 p-5 md:p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 rounded-full bg-teal-700 text-white flex items-center justify-center font-semibold text-lg">
                    {selectedCustomer.name.slice(0, 1).toUpperCase()}
                  </div>
                  <div>
                    <div className="text-xl font-bold text-gray-800">{selectedCustomer.name}</div>
                    <div className="text-sm text-gray-500">
                      {firstVisitDate ? `Customer since ${new Date(firstVisitDate).toLocaleDateString()}` : 'No visits yet'}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm text-gray-700">
                  <div className="flex items-center gap-2"><Phone className="w-4 h-4 text-teal-500" />{selectedCustomer.phone}</div>
                  {selectedCustomer.email && <div className="flex items-center gap-2"><User className="w-4 h-4 text-teal-500" />{selectedCustomer.email}</div>}
                  {selectedCustomer.notes && <div className="flex items-center gap-2"><MapPin className="w-4 h-4 text-teal-500" />{selectedCustomer.notes}</div>}
                </div>
              </div>

              <div className="client-metrics grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white p-4 md:p-5 rounded-xl shadow-sm border border-teal-100">
                  <div className="text-sm text-gray-500">Total Spent (paid)</div>
                  <div className="text-2xl font-bold text-teal-700">Rs. {totalSpent.toFixed(2)}</div>
                </div>
                <div className="bg-white p-4 md:p-5 rounded-xl shadow-sm border border-green-100">
                  <div className="text-sm text-gray-500">Paid Visits</div>
                  <div className="text-2xl font-bold text-green-700">{paidVisits}</div>
                </div>
                <div className="bg-white p-4 md:p-5 rounded-xl shadow-sm border border-teal-100">
                  <div className="text-sm text-gray-500">Pending</div>
                  <div className="text-2xl font-bold text-teal-600">{pendingVisits}</div>
                </div>
              </div>

              {lastVisit && (
                <div className="bg-white rounded-xl shadow-sm border border-teal-100 p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2 text-gray-800 font-semibold">
                      <CalendarClock className="w-5 h-5 text-teal-500" />
                      Last Visit
                    </div>
                    <div className="text-sm text-gray-500">{new Date(lastVisit.date).toLocaleString()}</div>
                  </div>
                  <div className="space-y-3">
                    {lastVisit.items.map((item, idx) => (
                      <div key={idx} className="flex items-center justify-between p-3 bg-stone-50 rounded-lg border border-teal-100">
                        <div className="flex items-center gap-3">
                          <Scissors className="w-4 h-4 text-teal-500" />
                          <div>
                            <div className="font-semibold text-gray-800">{item.serviceName}</div>
                            <div className="text-xs text-gray-500">{item.barberName}</div>
                          </div>
                        </div>
                        <div className="font-semibold text-teal-700">Rs. {item.price}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="bg-white rounded-xl shadow-sm border border-teal-100 overflow-hidden">
                <div className="p-4 border-b border-teal-100 bg-stone-50 font-semibold text-gray-800 flex items-center gap-2">
                  <CalendarClock className="w-4 h-4 text-teal-500" />
                  Visit History
                </div>
                <div className="overflow-x-auto">
                  <table className="mobile-card-table min-w-[680px] w-full text-left">
                    <thead className="bg-gradient-to-r from-teal-100 to-teal-100 text-gray-700 text-sm">
                      <tr>
                        <th className="p-3">Date</th>
                        <th className="p-3">Services</th>
                        <th className="p-3">Team members</th>
                        <th className="p-3">Payment</th>
                        <th className="p-3 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-teal-50">
                      {visits.map((visit) => (
                        <tr key={visit.id} className="hover:bg-teal-50 transition-colors duration-200">
                          <td data-label="Date" className="p-3 text-sm text-gray-700">{new Date(visit.date).toLocaleDateString()}</td>
                          <td data-label="Services" className="p-3 text-sm text-gray-700">{[...new Set(visit.items.map((i) => i.serviceName))].join(', ')}</td>
                          <td data-label="Team members" className="p-3 text-sm text-gray-700">{[...new Set(visit.items.map((i) => i.barberName))].join(', ')}</td>
                          <td data-label="Payment" className="p-3 text-sm text-gray-700 flex items-center gap-2">
                            {visit.paymentMode === 'online' ? <CreditCard className="w-4 h-4 text-purple-600" /> : <Wallet className="w-4 h-4 text-emerald-600" />}
                            <span className={visit.status === 'paid' ? 'text-green-600' : 'text-teal-600'}>
                              {visit.paymentMode === 'online' ? 'Online' : 'Cash'} / {visit.status === 'paid' ? 'Paid' : 'Pending'}
                            </span>
                          </td>
                          <td data-label="Total" className="p-3 text-right font-semibold text-teal-700">Rs. {visit.total.toFixed(2)}</td>
                        </tr>
                      ))}
                      {visits.length === 0 && (
                        <tr>
                          <td colSpan={5} className="p-6 text-center text-gray-400">No visits yet</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
