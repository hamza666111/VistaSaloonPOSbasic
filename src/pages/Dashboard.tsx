import React, { useMemo, useState } from 'react';
import { useStore } from '../store/useStore';
import { Calendar } from 'lucide-react';

export const Dashboard: React.FC = () => {
  const { invoices, barbers } = useStore();

  const [filterType, setFilterType] = useState<'all' | 'today' | 'month' | 'range'>('today');
  const [selectedMonth, setSelectedMonth] = useState<string>('all');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  const monthOptions = useMemo(() => {
    const months = new Set<string>();
    invoices.forEach((inv) => {
      const d = new Date(inv.date);
      if (Number.isNaN(d.getTime())) return;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      months.add(key);
    });
    return Array.from(months)
      .sort((a, b) => (a > b ? -1 : 1))
      .map((key) => {
        const [year, month] = key.split('-').map(Number);
        const label = new Date(year, month - 1, 1).toLocaleString('default', { month: 'long', year: 'numeric' });
        return { key, label };
      });
  }, [invoices]);

  const filteredInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      const d = new Date(inv.date);
      if (Number.isNaN(d.getTime())) return false;

      if (filterType === 'all') return true;

      if (filterType === 'today') {
        const today = new Date();
        return d.getDate() === today.getDate() &&
               d.getMonth() === today.getMonth() &&
               d.getFullYear() === today.getFullYear();
      }

      if (filterType === 'month') {
        if (selectedMonth === 'all') return true;
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        return key === selectedMonth;
      }

      if (filterType === 'range') {
        const invDate = d.setHours(0, 0, 0, 0);
        let inRange = true;
        if (startDate) {
          const start = new Date(startDate).setHours(0, 0, 0, 0);
          inRange = inRange && invDate >= start;
        }
        if (endDate) {
          const end = new Date(endDate).setHours(23, 59, 59, 999);
          inRange = inRange && invDate <= end;
        }
        return inRange;
      }

      return true;
    });
  }, [invoices, filterType, selectedMonth, startDate, endDate]);

  const paidInvoices = filteredInvoices.filter(inv => inv.status === 'paid');
  const filteredPaidInvoices = paidInvoices;

  const totalRevenue = filteredInvoices.reduce((sum, inv) => sum + inv.total, 0);
  const paidRevenue = paidInvoices.reduce((sum, inv) => sum + inv.total, 0);
  const unpaidRevenue = filteredInvoices.filter(inv => inv.status === 'pending').reduce((sum, inv) => sum + inv.total, 0);
  const cashRevenue = paidInvoices
    .filter((inv) => inv.paymentMode !== 'online')
    .reduce((sum, inv) => sum + inv.total, 0);
  const onlineRevenue = paidInvoices
    .filter((inv) => inv.paymentMode === 'online')
    .reduce((sum, inv) => sum + inv.total, 0);

  // Commission per barber (paid invoices only, discount shared by price weight)
  const commissionByBarber = barbers.map((barber) => {
    let commission = 0;
    filteredPaidInvoices.forEach((inv) => {
      const items = inv.items.filter((item) => item.barberId === barber.id);
      if (items.length === 0) return;
      items.forEach((item) => {
        const discountShare = inv.subtotal > 0 ? (inv.discount || 0) * (item.price / inv.subtotal) : 0;
        const net = item.price - discountShare;
        commission += net * ((barber.commissionRate ?? 0) / 100);
      });
    });
    return { barber, commission };
  });

  const totalCommission = commissionByBarber.reduce((sum, entry) => sum + entry.commission, 0);

  return (
    <div className="dashboard-page p-4 md:p-6 space-y-6 animate-fadeIn">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-4 md:mb-6">
        <div><h1 className="text-xl md:text-2xl font-bold text-gray-900">Business overview</h1><p className="page-description">A clear view of your salon, from the first appointment to the final sale.</p></div>
        
        <div className="flex flex-wrap items-center gap-2 bg-white p-2 rounded-xl shadow-sm border border-teal-100">
          <button
            onClick={() => setFilterType('all')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${filterType === 'all' ? 'bg-teal-500 text-white' : 'text-gray-600 hover:bg-teal-50'}`}
          >
            All Time
          </button>
          <button
            onClick={() => setFilterType('today')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${filterType === 'today' ? 'bg-teal-500 text-white' : 'text-gray-600 hover:bg-teal-50'}`}
          >
            Today
          </button>
          <button
            onClick={() => setFilterType('month')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${filterType === 'month' ? 'bg-teal-500 text-white' : 'text-gray-600 hover:bg-teal-50'}`}
          >
            Monthly
          </button>
          <button
            onClick={() => setFilterType('range')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${filterType === 'range' ? 'bg-teal-500 text-white' : 'text-gray-600 hover:bg-teal-50'}`}
          >
            Custom Range
          </button>
        </div>
      </div>

      {filterType === 'month' && (
        <div className="flex items-center gap-2 bg-white p-3 rounded-xl shadow-sm border border-teal-100 w-fit">
          <span className="text-sm font-medium text-gray-700">Select Month:</span>
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="border border-teal-200 rounded-lg px-3 py-1.5 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-teal-400 text-sm"
          >
            <option value="all">All Months</option>
            {monthOptions.map((opt) => (
              <option key={opt.key} value={opt.key}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {filterType === 'range' && (
        <div className="flex flex-wrap items-center gap-3 bg-white p-3 rounded-xl shadow-sm border border-teal-100 w-fit">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-teal-500" />
            <span className="text-sm font-medium text-gray-700">From:</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="border border-teal-200 rounded-lg px-2 py-1.5 text-sm focus:ring-2 focus:ring-teal-400 focus:border-teal-400"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700">To:</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="border border-teal-200 rounded-lg px-2 py-1.5 text-sm focus:ring-2 focus:ring-teal-400 focus:border-teal-400"
            />
          </div>
        </div>
      )}

      <div className="dashboard-metrics grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6 gap-4 md:gap-6">
        <div className="bg-white p-5 md:p-6 rounded-xl shadow-sm border border-teal-100 hover:shadow-sm transition-all duration-300">
          <div className="text-gray-500 text-sm mb-1">Total Revenue</div>
          <div className="text-2xl md:text-3xl font-bold text-gray-800">
            Rs. {totalRevenue.toFixed(2)}
          </div>
        </div>
        <div className="bg-white p-5 md:p-6 rounded-xl shadow-sm border border-green-100 hover:shadow-sm transition-all duration-300">
          <div className="text-gray-500 text-sm mb-1">Paid</div>
          <div className="text-2xl md:text-3xl font-bold text-green-600">
            Rs. {paidRevenue.toFixed(2)}
          </div>
        </div>
        <div className="bg-white p-5 md:p-6 rounded-xl shadow-sm border border-teal-100 hover:shadow-sm transition-all duration-300">
          <div className="text-gray-500 text-sm mb-1">Unpaid</div>
          <div className="text-2xl md:text-3xl font-bold text-teal-500">
            Rs. {unpaidRevenue.toFixed(2)}
          </div>
        </div>
        <div className="bg-white p-5 md:p-6 rounded-xl shadow-sm border border-blue-100 hover:shadow-sm transition-all duration-300">
          <div className="text-gray-500 text-sm mb-1">Total Invoices</div>
          <div className="text-2xl md:text-3xl font-bold text-blue-600">{filteredInvoices.length}</div>
        </div>
        <div className="bg-white p-5 md:p-6 rounded-xl shadow-sm border border-emerald-100 hover:shadow-sm transition-all duration-300">
          <div className="text-gray-500 text-sm mb-1">Cash Revenue</div>
          <div className="text-2xl md:text-3xl font-bold text-emerald-600">Rs. {cashRevenue.toFixed(2)}</div>
        </div>
        <div className="bg-white p-5 md:p-6 rounded-xl shadow-sm border border-purple-100 hover:shadow-sm transition-all duration-300">
          <div className="text-gray-500 text-sm mb-1">Online Revenue</div>
          <div className="text-2xl md:text-3xl font-bold text-purple-700">Rs. {onlineRevenue.toFixed(2)}</div>
        </div>
      </div>

      {/* Commission summary */}
      <div className="bg-white rounded-xl shadow-sm border border-teal-100 overflow-hidden">
        <div className="p-4 md:p-6 border-b border-teal-100 bg-stone-50 flex flex-col md:flex-row md:items-center md:justify-between gap-3 md:gap-4">
          <div className="commission-heading flex items-center gap-3 w-full md:w-auto">
            <h2 className="font-bold text-lg text-gray-800">Team commissions</h2>
            <span className="text-sm text-teal-600 font-semibold">Total: Rs. {totalCommission.toFixed(2)}</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="mobile-card-table min-w-[560px] w-full text-left">
            <thead className="bg-gradient-to-r from-teal-100 to-teal-100 text-gray-700 text-sm">
              <tr>
                <th className="p-4">Team member</th>
                <th className="p-4">Rate</th>
                <th className="p-4 text-right">Commission</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-teal-50">
              {commissionByBarber.map(({ barber, commission }) => (
                <tr key={barber.id} className="hover:bg-teal-50 transition-colors duration-200">
                  <td data-label="Team member" className="p-4 font-medium text-gray-800">{barber.name}</td>
                  <td data-label="Rate" className="p-4 text-gray-600">{(barber.commissionRate ?? 0).toFixed(1)}%</td>
                  <td data-label="Commission" className="p-4 text-right font-semibold text-teal-700">Rs. {commission.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
