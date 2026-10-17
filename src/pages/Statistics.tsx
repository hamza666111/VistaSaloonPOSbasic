import React, { useMemo, useState } from 'react';
import { PieChart, Sparkles, Trophy } from 'lucide-react';
import { useStore } from '../store/useStore';

interface ServiceSlice {
  name: string;
  sold: number;
  revenue: number;
  color: string;
  percent: number;
  startAngle: number;
  endAngle: number;
}

interface RankedService {
  name: string;
  sold: number;
  revenue: number;
}

const COLORS = [
  '#276b58',
  '#9bac78',
  '#629e88',
  '#b6c4a0',
  '#527d85',
  '#c4a16b',
  '#9b927e',
  '#ad796c',
  '#7f8299',
];

const polarToCartesian = (cx: number, cy: number, radius: number, angle: number) => {
  const rad = (angle * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(rad),
    y: cy + radius * Math.sin(rad),
  };
};

const describeSlice = (cx: number, cy: number, radius: number, startAngle: number, endAngle: number) => {
  const start = polarToCartesian(cx, cy, radius, endAngle);
  const end = polarToCartesian(cx, cy, radius, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? 0 : 1;

  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y} Z`;
};

const formatDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatMonthKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
};

export const Statistics: React.FC = () => {
  const { invoices } = useStore();
  const [showOthersBreakdown, setShowOthersBreakdown] = useState(false);
  const [dateFilterMode, setDateFilterMode] = useState<'all' | 'day' | 'month'>('all');
  const [selectedDay, setSelectedDay] = useState(() => formatDateKey(new Date()));
  const [selectedMonth, setSelectedMonth] = useState(() => formatMonthKey(new Date()));

  const filteredInvoices = useMemo(() => {
    if (dateFilterMode === 'all') return invoices;

    return invoices.filter((invoice) => {
      const invoiceDate = new Date(invoice.date);
      if (Number.isNaN(invoiceDate.getTime())) return false;

      if (dateFilterMode === 'day') {
        return formatDateKey(invoiceDate) === selectedDay;
      }

      return formatMonthKey(invoiceDate) === selectedMonth;
    });
  }, [dateFilterMode, invoices, selectedDay, selectedMonth]);

  const activeFilterLabel =
    dateFilterMode === 'day'
      ? `Day: ${selectedDay}`
      : dateFilterMode === 'month'
        ? `Month: ${selectedMonth}`
        : 'All Dates';

  const { serviceSlices, othersBreakdown } = useMemo(() => {
    const salesMap = new Map<string, { sold: number; revenue: number }>();

    filteredInvoices.forEach((invoice) => {
      invoice.items.forEach((item) => {
        const key = item.serviceName || 'Unknown Service';
        const current = salesMap.get(key) ?? { sold: 0, revenue: 0 };
        salesMap.set(key, {
          sold: current.sold + 1,
          revenue: current.revenue + (Number(item.price) || 0),
        });
      });
    });

    const ranked: RankedService[] = Array.from(salesMap.entries())
      .map(([name, data]) => ({
        name,
        sold: data.sold,
        revenue: data.revenue,
      }))
      .sort((a, b) => b.sold - a.sold);

    const top = ranked.slice(0, 8);
    const othersBreakdown = ranked.slice(8);

    if (othersBreakdown.length > 0) {
      const others = othersBreakdown.reduce(
        (acc, item) => ({
          sold: acc.sold + item.sold,
          revenue: acc.revenue + item.revenue,
        }),
        { sold: 0, revenue: 0 }
      );
      if (others.sold > 0) {
        top.push({ name: 'Others', sold: others.sold, revenue: others.revenue });
      }
    }

    const totalSold = top.reduce((sum, item) => sum + item.sold, 0);
    let cursor = 0;

    const serviceSlices = top.map((item, index) => {
      const ratio = totalSold > 0 ? item.sold / totalSold : 0;
      const startAngle = cursor * 360 - 90;
      cursor += ratio;
      const endAngle = cursor * 360 - 90;

      return {
        ...item,
        color: COLORS[index % COLORS.length],
        percent: ratio * 100,
        startAngle,
        endAngle,
      } as ServiceSlice;
    });

    return {
      serviceSlices,
      othersBreakdown,
    };
  }, [filteredInvoices]);

  const totalSold = serviceSlices.reduce((sum, slice) => sum + slice.sold, 0);
  const topService = serviceSlices[0];
  const hasOthers = othersBreakdown.length > 0 && serviceSlices.some((slice) => slice.name === 'Others');
  const othersTotalSold = othersBreakdown.reduce((sum, service) => sum + service.sold, 0);

  const handleToggleOthersBreakdown = () => {
    if (!hasOthers) return;
    setShowOthersBreakdown((prev) => !prev);
  };

  return (
    <div className="statistics-page p-4 md:p-6 space-y-6 animate-fadeIn">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900">Salon insights</h1>
          <p className="text-gray-500 text-sm">Discover the services and trends shaping your business.</p>
        </div>

        <div className="bg-white rounded-xl border border-teal-100 shadow-sm p-3 md:p-4 w-full lg:w-auto">
          <div className="text-xs font-semibold text-gray-500 mb-2">Filter Statistics</div>
          <div className="flex flex-wrap items-center gap-2">
            {(['all', 'day', 'month'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setDateFilterMode(mode)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 ${
                  dateFilterMode === mode
                    ? 'bg-teal-700 text-white shadow-sm'
                    : 'bg-teal-50 text-teal-700 hover:bg-teal-100'
                }`}
              >
                {mode === 'all' ? 'All' : mode === 'day' ? 'Day' : 'Month'}
              </button>
            ))}
            {dateFilterMode === 'day' && (
              <input
                aria-label="Statistics day" type="date"
                value={selectedDay}
                onChange={(e) => setSelectedDay(e.target.value)}
                className="border border-teal-200 rounded-lg p-2 text-xs focus:ring-2 focus:ring-teal-400 focus:border-teal-400"
              />
            )}
            {dateFilterMode === 'month' && (
              <input
                aria-label="Statistics month" type="month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="border border-teal-200 rounded-lg p-2 text-xs focus:ring-2 focus:ring-teal-400 focus:border-teal-400"
              />
            )}
          </div>
          <p className="text-xs text-gray-500 mt-2">Viewing: {activeFilterLabel}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-teal-100 p-4 md:p-6">
        <div className="insights-chart-heading flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-gray-800 font-semibold">
            <PieChart className="w-5 h-5 text-teal-500" />
            Most Sold Services (Pie Chart)
          </div>
          {topService && (
            <div className="text-xs md:text-sm inline-flex items-center gap-2 bg-teal-50 border border-teal-100 text-teal-700 rounded-lg px-3 py-1.5">
              <Trophy className="w-4 h-4" />
              Leader: {topService.name}
            </div>
          )}
        </div>

        {serviceSlices.length === 0 ? (
          <div className="h-72 rounded-xl border border-dashed border-teal-200 bg-teal-50/40 flex flex-col items-center justify-center text-gray-500">
            <Sparkles className="w-6 h-6 text-teal-500 mb-2" />
            No service sales found for the selected filter.
          </div>
        ) : (
          <div className="flex flex-col items-center">
            <div className="insights-chart w-full max-w-xl">
              <svg viewBox="0 0 320 320" className="w-full h-auto">
                <circle cx="160" cy="160" r="120" fill="#e7eddf" opacity="0.35" />
                {serviceSlices.length === 1 ? (
                  <circle cx="160" cy="160" r="120" fill={serviceSlices[0].color} />
                ) : (
                  serviceSlices.map((slice) => {
                    const isOthersSlice = hasOthers && slice.name === 'Others';
                    return (
                      <path
                        key={slice.name}
                        d={describeSlice(160, 160, 120, slice.startAngle, slice.endAngle)}
                        fill={slice.color}
                        stroke="#ffffff"
                        strokeWidth="2"
                        onClick={isOthersSlice ? handleToggleOthersBreakdown : undefined}
                        className={isOthersSlice ? 'cursor-pointer transition-opacity hover:opacity-85' : undefined}
                      >
                        {isOthersSlice && (
                          <title>
                            {showOthersBreakdown
                              ? 'Hide Others services breakdown'
                              : `Show ${othersBreakdown.length} services inside Others`}
                          </title>
                        )}
                      </path>
                    );
                  })
                )}
                <circle cx="160" cy="160" r="66" fill="#ffffff" />
                <text x="160" y="153" textAnchor="middle" className="fill-gray-500 text-[12px] font-semibold">
                  Total Sold
                </text>
                <text x="160" y="178" textAnchor="middle" className="fill-gray-900 text-[28px] font-bold">
                  {totalSold}
                </text>
              </svg>
            </div>
            {hasOthers && (
              <p className="text-xs text-gray-500 mt-2">
                Tip: tap the Others slice in the pie chart to view detailed services.
              </p>
            )}
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-teal-100 p-4 md:p-6">
        <div className="text-sm font-semibold text-gray-800 mb-3">Color Guide</div>
        {serviceSlices.length === 0 ? (
          <p className="text-sm text-gray-500">Legend will appear when sales data is available.</p>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {serviceSlices.map((slice) => {
                const isOthersSlice = hasOthers && slice.name === 'Others';
                const legendClasses = `flex items-center justify-between rounded-lg border p-3 bg-gray-50/60 ${
                  isOthersSlice
                    ? showOthersBreakdown
                      ? 'border-teal-300 ring-2 ring-teal-100'
                      : 'border-teal-200 hover:border-teal-300'
                    : 'border-gray-100'
                }`;

                const legendContent = (
                  <>
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-3.5 h-3.5 rounded-sm" style={{ backgroundColor: slice.color }} />
                      <span className="text-sm font-medium text-gray-800 truncate">{slice.name}</span>
                    </div>
                    <div className="text-right text-xs text-gray-600">
                      <div>{slice.sold} sold</div>
                      <div>{slice.percent.toFixed(1)}% / Rs. {slice.revenue.toFixed(0)}</div>
                      {isOthersSlice && (
                        <div className="text-teal-700 font-medium mt-0.5">
                          {showOthersBreakdown ? 'Tap to hide details' : `Tap to view ${othersBreakdown.length} services`}
                        </div>
                      )}
                    </div>
                  </>
                );

                if (isOthersSlice) {
                  return (
                    <button
                      key={`${slice.name}-legend`}
                      type="button"
                      aria-expanded={showOthersBreakdown} onClick={handleToggleOthersBreakdown}
                      className={`${legendClasses} text-left transition-all duration-200`}
                    >
                      {legendContent}
                    </button>
                  );
                }

                return (
                  <div key={`${slice.name}-legend`} className={legendClasses}>
                    {legendContent}
                  </div>
                );
              })}
            </div>

            {hasOthers && showOthersBreakdown && (
              <div className="mt-4 border-t border-teal-100 pt-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-800">Others Services Breakdown</h3>
                  <button
                    type="button"
                    onClick={handleToggleOthersBreakdown}
                    className="text-xs text-teal-700 hover:text-teal-800 hover:underline"
                  >
                    Hide
                  </button>
                </div>

                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {othersBreakdown.map((service, idx) => (
                    <div
                      key={`${service.name}-${idx}`}
                      className="flex items-center justify-between rounded-lg border border-gray-100 p-3 bg-white"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs text-gray-500 w-7">{idx + 9}.</span>
                        <span className="text-sm font-medium text-gray-800 truncate">{service.name}</span>
                      </div>
                      <div className="text-right text-xs text-gray-600">
                        <div>{service.sold} sold</div>
                        <div>
                          {othersTotalSold > 0 ? ((service.sold / othersTotalSold) * 100).toFixed(1) : '0.0'}% of Others
                          {' '} / Rs. {service.revenue.toFixed(0)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
