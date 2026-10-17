import React, { useState } from 'react';
import { isDemoMode } from '../demo/mode';
import { resetDemoWorkspace } from '../demo/workspace';
import { AppSettingsPanel } from '../components/AppSettingsPanel';
import { ServiceCategoryManager } from '../components/ServiceCategoryManager';
import { useServiceCategories } from '../store/useServiceCategories';
import { useStore } from '../store/useStore';
import { Trash2, Plus, Lock, ChevronUp, ChevronDown, Pencil, Check, X } from 'lucide-react';
import { formatDuplicateCustomerMessage, isDuplicateCustomerError } from '../utils/customerDuplicates';

export const Settings: React.FC = () => {
  const { 
    services, packages, barbers, customers, userEmail, userPassword,
    addService, updateService, removeService, reorderServices,
    addPackage, updatePackage, removePackage, reorderPackages,
    addBarber, updateBarber, removeBarber,
    removeCustomer, updateCustomer, updateCredentials, updateInvoicePin
  } = useStore();

  const [activeTab, setActiveTab] = useState<'services' | 'categories' | 'packages' | 'barbers' | 'customers' | 'app' | 'account'>('services');
  
  const { categories, serviceCategories } = useServiceCategories();

  // Form States
  const [newService, setNewService] = useState({ name: '', price: '' });
  const [newPackage, setNewPackage] = useState({ name: '', price: '', services: '' });
  const [newBarber, setNewBarber] = useState('');
  const [credentialsDraft, setCredentialsDraft] = useState({ email: userEmail, password: userPassword });
  const [pinDraft, setPinDraft] = useState({ current: '', next: '' });

  // Edit states
  const [editingServiceId, setEditingServiceId] = useState<string | null>(null);
  const [serviceDraft, setServiceDraft] = useState({ name: '', price: '' });
  const [editingPackageId, setEditingPackageId] = useState<string | null>(null);
  const [packageDraft, setPackageDraft] = useState({ name: '', price: '', services: '' });
  const [editingBarberId, setEditingBarberId] = useState<string | null>(null);
  const [barberDraft, setBarberDraft] = useState({ name: '', commissionRate: '' });
  const [editingCustomerId, setEditingCustomerId] = useState<string | null>(null);
  const [customerDraft, setCustomerDraft] = useState({ name: '', phone: '' });
  const [serviceDeleteConfirm, setServiceDeleteConfirm] = useState<string | null>(null);
  const [packageDeleteConfirm, setPackageDeleteConfirm] = useState<string | null>(null);
  const [barberDeleteConfirm, setBarberDeleteConfirm] = useState<string | null>(null);
  const [customerDeleteConfirm, setCustomerDeleteConfirm] = useState<string | null>(null);

  const handleAddService = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newService.name || !newService.price) return;
    try {
      await addService({
        id: crypto.randomUUID(),
        name: newService.name,
        price: Number(newService.price),
        active: true
      });
      setNewService({ name: '', price: '' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to add service.';
      alert(message);
    }
  };

  const handleAddPackage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPackage.name || !newPackage.price) return;
    const servicesList = newPackage.services
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      await addPackage({
        id: crypto.randomUUID(),
        name: newPackage.name,
        price: Number(newPackage.price),
        services: servicesList,
        active: true,
      });
      setNewPackage({ name: '', price: '', services: '' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to add package.';
      alert(message);
    }
  };

  const handleAddBarber = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBarber) return;
    try {
      await addBarber({
        id: crypto.randomUUID(),
        name: newBarber,
        active: true,
        commissionRate: 0
      });
      setNewBarber('');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to add barber.';
      alert(message);
    }
  };

  const handleUpdateCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!credentialsDraft.email || !credentialsDraft.password) return;
    try {
      await updateCredentials(credentialsDraft.email.trim(), credentialsDraft.password);
      alert('Login credentials updated');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to update login.';
      alert(message);
    }
  };

  const handleUpdatePin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pinDraft.current || !pinDraft.next) return;
    try {
      const ok = await updateInvoicePin(pinDraft.current, pinDraft.next);
      if (ok) {
        alert('Invoice edit PIN updated');
        setPinDraft({ current: '', next: '' });
      } else {
        alert('Current PIN is incorrect');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to update PIN.';
      alert(message);
    }
  };

  const handleMoveService = (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex >= 0 && newIndex < services.length) {
      reorderServices(index, newIndex);
    }
  };

  const handleStartEditService = (serviceId: string) => {
    const service = services.find((s) => s.id === serviceId);
    if (!service) return;
    setServiceDeleteConfirm(null);
    setEditingServiceId(serviceId);
    setServiceDraft({ name: service.name, price: service.price.toString() });
  };

  const handleMovePackage = (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex >= 0 && newIndex < packages.length) {
      reorderPackages(index, newIndex);
    }
  };

  const handleStartEditPackage = (packageId: string) => {
    const pkg = packages.find((p) => p.id === packageId);
    if (!pkg) return;
    setPackageDeleteConfirm(null);
    setEditingPackageId(packageId);
    setPackageDraft({
      name: pkg.name,
      price: pkg.price.toString(),
      services: pkg.services.join(', '),
    });
  };

  const handleSavePackage = async (packageId: string) => {
    const pkg = packages.find((p) => p.id === packageId);
    if (!pkg) return;
    const servicesList = packageDraft.services
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      await updatePackage({
        ...pkg,
        name: packageDraft.name,
        price: Number(packageDraft.price) || 0,
        services: servicesList,
      });
      setEditingPackageId(null);
      setPackageDraft({ name: '', price: '', services: '' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to update package.';
      alert(message);
    }
  };

  const handleSaveService = async (serviceId: string) => {
    const service = services.find((s) => s.id === serviceId);
    if (!service) return;
    try {
      await updateService({ ...service, name: serviceDraft.name, price: Number(serviceDraft.price) || 0 });
      setEditingServiceId(null);
      setServiceDraft({ name: '', price: '' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to update service.';
      alert(message);
    }
  };

  const handleDeleteService = async (serviceId: string) => {
    try {
      await removeService(serviceId);
      setServiceDeleteConfirm(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to delete service.';
      alert(message);
    }
  };

  const handleToggleServiceActive = async (serviceId: string) => {
    const service = services.find((s) => s.id === serviceId);
    if (!service) return;
    try {
      await updateService({ ...service, active: !service.active });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to update service status.';
      alert(message);
    }
  };

  const handleStartEditBarber = (barberId: string) => {
    const barber = barbers.find((b) => b.id === barberId);
    if (!barber) return;
    setBarberDeleteConfirm(null);
    setEditingBarberId(barberId);
    setBarberDraft({ name: barber.name, commissionRate: (barber.commissionRate ?? 0).toString() });
  };

  const handleToggleBarberActive = async (barberId: string) => {
    const barber = barbers.find((b) => b.id === barberId);
    if (!barber) return;
    try {
      await updateBarber({ ...barber, active: !barber.active });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to update barber status.';
      alert(message);
    }
  };

  const handleSaveBarber = async (barberId: string) => {
    const barber = barbers.find((b) => b.id === barberId);
    if (!barber) return;
    try {
      await updateBarber({ 
        ...barber, 
        name: barberDraft.name, 
        commissionRate: Number(barberDraft.commissionRate) || 0 
      });
      setEditingBarberId(null);
      setBarberDraft({ name: '', commissionRate: '' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to update barber.';
      alert(message);
    }
  };

  const handleStartEditCustomer = (customerId: string) => {
    const customer = customers.find((c) => c.id === customerId);
    if (!customer) return;
    setCustomerDeleteConfirm(null);
    setEditingCustomerId(customerId);
    setCustomerDraft({ name: customer.name, phone: customer.phone });
  };

  const handleSaveCustomer = async (customerId: string) => {
    const customer = customers.find((c) => c.id === customerId);
    if (!customer) return;
    try {
      await updateCustomer({ ...customer, name: customerDraft.name, phone: customerDraft.phone });
      setEditingCustomerId(null);
      setCustomerDraft({ name: '', phone: '' });
    } catch (error) {
      const message = isDuplicateCustomerError(error)
        ? formatDuplicateCustomerMessage(error.matches)
        : error instanceof Error
          ? error.message
          : 'Unable to update customer.';
      alert(message);
    }
  };

  const handleDeletePackage = async (packageId: string) => {
    try {
      await removePackage(packageId);
      setPackageDeleteConfirm(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to delete package.';
      alert(message);
    }
  };

  const handleTogglePackageActive = async (packageId: string) => {
    const pkg = packages.find((p) => p.id === packageId);
    if (!pkg) return;
    try {
      await updatePackage({ ...pkg, active: pkg.active === false });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to update package status.';
      alert(message);
    }
  };

  const handleDeleteBarber = async (barberId: string) => {
    try {
      await removeBarber(barberId);
      setBarberDeleteConfirm(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to delete barber.';
      alert(message);
    }
  };

  const handleDeleteCustomer = async (customerId: string) => {
    try {
      await removeCustomer(customerId);
      setCustomerDeleteConfirm(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to delete customer.';
      alert(message);
    }
  };

  const [catalogSearch,setCatalogSearch]=useState('');
  const catalogLabel=activeTab==='services'?'services':activeTab==='packages'?'deals':activeTab==='barbers'?'team members':'customers';
  const catalogRows=activeTab==='services'?services:activeTab==='packages'?packages:activeTab==='barbers'?barbers:customers;
  const catalogMatches=(name:string,extra='')=>`${name} ${extra}`.toLowerCase().includes(catalogSearch.trim().toLowerCase());
  return (
    <div className="settings-page p-4 md:p-6 max-w-4xl mx-auto">
      <h1 className="text-xl md:text-2xl font-bold text-gray-900">Make it your own</h1><p className="page-description">Your services, your team, your way of working.</p>

      <div className="settings-tabs flex gap-4 mb-8 border-b border-teal-200 overflow-x-auto">
        {(['services', 'categories', 'packages', 'barbers', 'customers', 'app', 'account'] as const).map(tab => (
          <button
            key={tab === 'barbers' ? 'Team' : tab === 'packages' ? 'Deals & offers' : tab}
            aria-pressed={activeTab===tab} onClick={(event) => {setActiveTab(tab);setCatalogSearch('');event.currentTarget.scrollIntoView({block:'nearest',inline:'center'});}}
            className={`pb-4 px-4 font-medium capitalize transition-all duration-300 whitespace-nowrap ${
              activeTab === tab
                ? 'border-b-2 border-teal-500 text-teal-600'
                : 'text-gray-500 hover:text-teal-500'
            }`}
          >
            {tab === 'barbers' ? 'Team' : tab === 'packages' ? 'Deals & offers' : tab}
          </button>
        ))}
      </div>

      <label className="mobile-settings-picker">Manage<select aria-label="Settings section" value={activeTab} onChange={event=>{setActiveTab(event.target.value as typeof activeTab);setCatalogSearch('');}}><option value="services">Services</option><option value="categories">Categories</option><option value="packages">Deals &amp; offers</option><option value="barbers">Team</option><option value="customers">Customers</option><option value="app">App</option><option value="account">Account</option></select></label>
      {['services','packages','barbers','customers'].includes(activeTab)&&<div className="settings-catalog-search"><input type="search" aria-label={`Search ${catalogLabel}`} placeholder={`Search ${catalogLabel}...`} value={catalogSearch} onChange={event=>setCatalogSearch(event.target.value)}/><span>Results: {catalogRows.filter(item=>catalogMatches(item.name,'phone' in item ? item.phone : 'services' in item ? item.services.join(' ') : '')).length}</span></div>}
      {activeTab === 'app' && <AppSettingsPanel />}

      {activeTab === 'categories' && <ServiceCategoryManager />}

      {activeTab === 'services' && (
        <div className="space-y-6 animate-fadeIn">
          <form onSubmit={handleAddService} className="bg-stone-50 p-4 md:p-6 rounded-xl shadow-sm border border-teal-100 flex flex-col md:flex-row gap-4 items-start md:items-end">
            <div className="flex-1 w-full">
              <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="settings-field-1">Service Name</label>
              <input id="settings-field-1"
                type="text"
                value={newService.name}
                onChange={e => setNewService({ ...newService, name: e.target.value })}
                className="w-full border border-teal-200 rounded-lg p-2 focus:ring-2 focus:ring-teal-400 focus:border-teal-400 transition-all duration-200"
                placeholder="e.g. Haircut"
              />
            </div>
            <div className="w-full md:w-32">
              <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="settings-field-2">Price (Rs.)</label>
              <input id="settings-field-2"
                type="number"
                value={newService.price}
                onChange={e => setNewService({ ...newService, price: e.target.value })}
                className="w-full border border-teal-200 rounded-lg p-2 focus:ring-2 focus:ring-teal-400 focus:border-teal-400 transition-all duration-200"
                placeholder="0.00"
              />
            </div>
            <button type="submit" className="bg-teal-700 text-white px-4 py-2 rounded-lg hover:from-teal-600 hover:to-teal-600 flex items-center gap-2 shadow-sm hover:shadow-sm transition-all duration-300">
              <Plus className="w-4 h-4" /> Add
            </button>
          </form>

          <div className="bg-white rounded-xl shadow-sm border border-teal-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="mobile-card-table min-w-[520px] w-full text-left">
              <thead className="bg-gradient-to-r from-teal-100 to-teal-100 text-gray-700 text-sm">
                <tr>
                  <th className="p-4">Order</th>
                  <th className="p-4">Name</th>
                  <th className="p-4">Price</th>
                  <th className="p-4">Status</th>
                  <th className="p-4 w-44">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-teal-50">
                {services.map((service, index) => (
                  <tr hidden={!catalogMatches(service.name)} key={service.id} className="hover:bg-teal-50 transition-colors duration-200">
                    <td data-label="Order" className="p-4">
                      <div className="flex flex-col gap-1">
                        <button aria-label="Move up service" 
                          onClick={() => handleMoveService(index, 'up')}
                          disabled={index === 0}
                          className={`p-1 rounded transition-all duration-200 ${index === 0 ? 'text-gray-300 cursor-not-allowed' : 'text-teal-600 hover:bg-teal-100 hover:scale-110'}`}
                        >
                          <ChevronUp className="w-4 h-4" />
                        </button>
                        <button aria-label="Move down service" 
                          onClick={() => handleMoveService(index, 'down')}
                          disabled={index === services.length - 1}
                          className={`p-1 rounded transition-all duration-200 ${index === services.length - 1 ? 'text-gray-300 cursor-not-allowed' : 'text-teal-600 hover:bg-teal-100 hover:scale-110'}`}
                        >
                          <ChevronDown className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                    <td data-label="Name" className={`p-4 font-medium ${service.active ? 'text-gray-800' : 'text-gray-400 line-through'}`}>
                      {editingServiceId === service.id ? (
                        <input
                          value={serviceDraft.name}
                          onChange={(e) => setServiceDraft({ ...serviceDraft, name: e.target.value })}
                          className="w-full border border-teal-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-teal-400 focus:border-teal-400"
                        />
                      ) : (
                        <div>{service.name}<div className="mt-1 text-xs font-normal text-gray-500">{categories.filter(category => serviceCategories[service.id]?.includes(category.id)).map(category => category.name).join(', ') || 'Uncategorized'}</div></div>
                      )}
                    </td>
                    <td data-label="Price" className="p-4 text-teal-600 font-semibold">
                      {editingServiceId === service.id ? (
                        <input
                          type="number"
                          value={serviceDraft.price}
                          onChange={(e) => setServiceDraft({ ...serviceDraft, price: e.target.value })}
                          className="w-24 border border-teal-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-teal-400 focus:border-teal-400"
                        />
                      ) : (
                        <>Rs. {service.price}</>
                      )}
                    </td>
                    <td data-label="Status" className="p-4">
                      <div className="flex flex-col gap-2">
                        <span
                          className={`inline-flex items-center justify-center rounded-full px-2 py-1 text-xs font-semibold ${
                            service.active ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'
                          }`}
                        >
                          {service.active ? 'Active' : 'Inactive'}
                        </span>
                        {editingServiceId !== service.id && (
                          <button
                            onClick={() => handleToggleServiceActive(service.id)}
                            className="text-xs text-blue-600 hover:text-blue-700 hover:underline"
                          >
                            {service.active ? 'Mark Inactive' : 'Mark Active'}
                          </button>
                        )}
                      </div>
                    </td>
                    <td data-label="Action" className="p-4">
                      {editingServiceId === service.id ? (
                        <div className="flex items-center gap-2">
                          <button aria-label="Save service"
                            onClick={() => handleSaveService(service.id)}
                            className="text-green-600 hover:text-green-700 transition-colors duration-200"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                          <button aria-label="Cancel editing service"
                            onClick={() => { setEditingServiceId(null); setServiceDraft({ name: '', price: '' }); }}
                            className="text-gray-500 hover:text-gray-700 transition-colors duration-200"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-3">
                          <button aria-label="Edit service"
                            onClick={() => handleStartEditService(service.id)}
                            className="text-teal-500 hover:text-teal-600 transition-colors duration-200 hover:scale-110 transform"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          {serviceDeleteConfirm === service.id ? (
                            <div className="flex items-center gap-2 bg-red-50 p-1 rounded-lg border border-red-100">
                              <span className="text-xs text-red-600 font-medium">Del?</span>
                              <button
                                onClick={() => handleDeleteService(service.id)}
                                className="px-2 py-0.5 bg-red-500 text-white text-xs rounded hover:bg-red-600 transition-colors"
                              >
                                Yes
                              </button>
                              <button
                                onClick={() => setServiceDeleteConfirm(null)}
                                className="px-2 py-0.5 bg-gray-200 text-gray-700 text-xs rounded hover:bg-gray-300 transition-colors"
                              >
                                No
                              </button>
                            </div>
                          ) : (
                            <button aria-label="Delete service"
                              onClick={() => setServiceDeleteConfirm(service.id)}
                              className="text-red-400 hover:text-red-600 transition-colors duration-200 hover:scale-110 transform"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'packages' && (
        <div className="space-y-6 animate-fadeIn">
          <form onSubmit={handleAddPackage} className="bg-stone-50 p-4 md:p-6 rounded-xl shadow-sm border border-teal-100 flex flex-col md:flex-row gap-4 items-start md:items-end">
            <div className="flex-1 w-full">
              <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="settings-field-3">Deal name</label>
              <input id="settings-field-3"
                type="text"
                value={newPackage.name}
                onChange={(e) => setNewPackage({ ...newPackage, name: e.target.value })}
                className="w-full border border-teal-200 rounded-lg p-2 focus:ring-2 focus:ring-teal-400 focus:border-teal-400 transition-all duration-200"
                placeholder="e.g. Grooming Combo"
              />
            </div>
            <div className="w-full md:w-32">
              <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="settings-field-4">Price (Rs.)</label>
              <input id="settings-field-4"
                type="number"
                value={newPackage.price}
                onChange={(e) => setNewPackage({ ...newPackage, price: e.target.value })}
                className="w-full border border-teal-200 rounded-lg p-2 focus:ring-2 focus:ring-teal-400 focus:border-teal-400 transition-all duration-200"
                placeholder="0.00"
              />
            </div>
            <div className="flex-1 w-full">
              <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="settings-field-5">Included Services (comma separated)</label>
              <input id="settings-field-5"
                type="text"
                value={newPackage.services}
                onChange={(e) => setNewPackage({ ...newPackage, services: e.target.value })}
                className="w-full border border-teal-200 rounded-lg p-2 focus:ring-2 focus:ring-teal-400 focus:border-teal-400 transition-all duration-200"
                placeholder="Hair Cut - Regular, Beard Trim"
              />
            </div>
            <button type="submit" className="bg-teal-700 text-white px-4 py-2 rounded-lg hover:from-teal-600 hover:to-teal-600 flex items-center gap-2 shadow-sm hover:shadow-sm transition-all duration-300">
              <Plus className="w-4 h-4" /> Add
            </button>
          </form>

          <div className="bg-white rounded-xl shadow-sm border border-teal-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="mobile-card-table min-w-[640px] w-full text-left">
                <thead className="bg-gradient-to-r from-teal-100 to-teal-100 text-gray-700 text-sm">
                  <tr>
                    <th className="p-4">Order</th>
                    <th className="p-4">Name</th>
                    <th className="p-4">Included Services</th>
                    <th className="p-4">Price</th>
                    <th className="p-4">Status</th>
                    <th className="p-4 w-44">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-teal-50">
                  {packages.map((pkg, index) => (
                    <tr hidden={!catalogMatches(pkg.name,pkg.services.join(' '))} key={pkg.id} className="hover:bg-teal-50 transition-colors duration-200">
                      <td data-label="Order" className="p-4">
                        <div className="flex flex-col gap-1">
                          <button aria-label="Move up deal"
                            onClick={() => handleMovePackage(index, 'up')}
                            disabled={index === 0}
                            className={`p-1 rounded transition-all duration-200 ${index === 0 ? 'text-gray-300 cursor-not-allowed' : 'text-teal-600 hover:bg-teal-100 hover:scale-110'}`}
                          >
                            <ChevronUp className="w-4 h-4" />
                          </button>
                          <button aria-label="Move down deal"
                            onClick={() => handleMovePackage(index, 'down')}
                            disabled={index === packages.length - 1}
                            className={`p-1 rounded transition-all duration-200 ${index === packages.length - 1 ? 'text-gray-300 cursor-not-allowed' : 'text-teal-600 hover:bg-teal-100 hover:scale-110'}`}
                          >
                            <ChevronDown className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                      <td data-label="Name" className={`p-4 font-medium ${pkg.active === false ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
                        {editingPackageId === pkg.id ? (
                          <input
                            value={packageDraft.name}
                            onChange={(e) => setPackageDraft({ ...packageDraft, name: e.target.value })}
                            className="w-full border border-teal-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-teal-400 focus:border-teal-400"
                          />
                        ) : (
                          pkg.name
                        )}
                      </td>
                      <td data-label="Included Services" className="p-4 text-gray-700">
                        {editingPackageId === pkg.id ? (
                          <textarea
                            value={packageDraft.services}
                            onChange={(e) => setPackageDraft({ ...packageDraft, services: e.target.value })}
                            className="w-full border border-teal-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-teal-400 focus:border-teal-400 min-h-[68px]"
                          />
                        ) : (
                          <span className="block text-sm leading-snug text-gray-600">{pkg.services.join(', ')}</span>
                        )}
                      </td>
                      <td data-label="Price" className="p-4 text-teal-600 font-semibold">
                        {editingPackageId === pkg.id ? (
                          <input
                            type="number"
                            value={packageDraft.price}
                            onChange={(e) => setPackageDraft({ ...packageDraft, price: e.target.value })}
                            className="w-24 border border-teal-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-teal-400 focus:border-teal-400"
                          />
                        ) : (
                          <>Rs. {pkg.price}</>
                        )}
                      </td>
                      <td data-label="Status" className="p-4">
                        <div className="flex flex-col gap-2">
                          <span
                            className={`inline-flex items-center justify-center rounded-full px-2 py-1 text-xs font-semibold ${
                              pkg.active === false ? 'bg-gray-200 text-gray-600' : 'bg-green-100 text-green-700'
                            }`}
                          >
                            {pkg.active === false ? 'Inactive' : 'Active'}
                          </span>
                          {editingPackageId !== pkg.id && (
                            <button
                              onClick={() => handleTogglePackageActive(pkg.id)}
                              className="text-xs text-blue-600 hover:text-blue-700 hover:underline"
                            >
                              {pkg.active === false ? 'Mark Active' : 'Mark Inactive'}
                            </button>
                          )}
                        </div>
                      </td>
                      <td data-label="Action" className="p-4">
                        {editingPackageId === pkg.id ? (
                          <div className="flex items-center gap-2">
                            <button aria-label="Save deal"
                              onClick={() => handleSavePackage(pkg.id)}
                              className="text-green-600 hover:text-green-700 transition-colors duration-200"
                            >
                              <Check className="w-4 h-4" />
                            </button>
                            <button aria-label="Cancel editing deal"
                              onClick={() => { setEditingPackageId(null); setPackageDraft({ name: '', price: '', services: '' }); }}
                              className="text-gray-500 hover:text-gray-700 transition-colors duration-200"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-3">
                            <button aria-label="Edit deal"
                              onClick={() => handleStartEditPackage(pkg.id)}
                              className="text-teal-500 hover:text-teal-600 transition-colors duration-200 hover:scale-110 transform"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            {packageDeleteConfirm === pkg.id ? (
                              <div className="flex items-center gap-2 bg-red-50 p-1 rounded-lg border border-red-100">
                                <span className="text-xs text-red-600 font-medium">Del?</span>
                                <button
                                  onClick={() => handleDeletePackage(pkg.id)}
                                  className="px-2 py-0.5 bg-red-500 text-white text-xs rounded hover:bg-red-600 transition-colors"
                                >
                                  Yes
                                </button>
                                <button
                                  onClick={() => setPackageDeleteConfirm(null)}
                                  className="px-2 py-0.5 bg-gray-200 text-gray-700 text-xs rounded hover:bg-gray-300 transition-colors"
                                >
                                  No
                                </button>
                              </div>
                            ) : (
                              <button aria-label="Delete deal"
                                onClick={() => setPackageDeleteConfirm(pkg.id)}
                                className="text-red-400 hover:text-red-600 transition-colors duration-200 hover:scale-110 transform"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'barbers' && (
        <div className="space-y-6 animate-fadeIn">
          <form onSubmit={handleAddBarber} className="bg-stone-50 p-4 md:p-6 rounded-xl shadow-sm border border-teal-100 flex flex-col md:flex-row gap-4 items-start md:items-end">
            <div className="flex-1 w-full">
              <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="settings-field-6">Team member name</label>
              <input id="settings-field-6"
                type="text"
                value={newBarber}
                onChange={e => setNewBarber(e.target.value)}
                className="w-full border border-teal-200 rounded-lg p-2 focus:ring-2 focus:ring-teal-400 focus:border-teal-400 transition-all duration-200"
                placeholder="e.g. John Doe"
              />
            </div>
            <button type="submit" className="bg-teal-700 text-white px-4 py-2 rounded-lg hover:from-teal-600 hover:to-teal-600 flex items-center gap-2 shadow-sm hover:shadow-sm transition-all duration-300">
              <Plus className="w-4 h-4" /> Add
            </button>
          </form>

          <div className="bg-white rounded-xl shadow-sm border border-teal-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="mobile-card-table min-w-[420px] w-full text-left">
              <thead className="bg-gradient-to-r from-teal-100 to-teal-100 text-gray-700 text-sm">
                <tr>
                  <th className="p-4">Name</th>
                    <th className="p-4">Commission (%)</th>
                    <th className="p-4">Status</th>
                    <th className="p-4 w-44">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-teal-50">
                {barbers.map(barber => (
                  <tr hidden={!catalogMatches(barber.name)} key={barber.id} className="hover:bg-teal-50 transition-colors duration-200">
                    <td data-label="Name" className={`p-4 font-medium ${barber.active ? 'text-gray-800' : 'text-gray-400 line-through'}`}>
                      {editingBarberId === barber.id ? (
                        <input
                          value={barberDraft.name}
                          onChange={(e) => setBarberDraft({ ...barberDraft, name: e.target.value })}
                          className="w-full border border-teal-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-teal-400 focus:border-teal-400"
                        />
                      ) : (
                        barber.name
                      )}
                    </td>
                    <td data-label="Commission (%)" className="p-4 text-teal-600 font-semibold">
                      {editingBarberId === barber.id ? (
                        <input
                          type="number"
                          value={barberDraft.commissionRate}
                          onChange={(e) => setBarberDraft({ ...barberDraft, commissionRate: e.target.value })}
                          className="w-24 border border-teal-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-teal-400 focus:border-teal-400"
                        />
                      ) : (
                        `${barber.commissionRate ?? 0}%`
                      )}
                    </td>
                    <td data-label="Status" className="p-4">
                      <div className="flex flex-col gap-2">
                        <span
                          className={`inline-flex items-center justify-center rounded-full px-2 py-1 text-xs font-semibold ${
                            barber.active ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'
                          }`}
                        >
                          {barber.active ? 'Active' : 'Inactive'}
                        </span>
                        {editingBarberId !== barber.id && (
                          <button
                            onClick={() => handleToggleBarberActive(barber.id)}
                            className="text-xs text-blue-600 hover:text-blue-700 hover:underline"
                          >
                            {barber.active ? 'Mark Inactive' : 'Mark Active'}
                          </button>
                        )}
                      </div>
                    </td>
                    <td data-label="Action" className="p-4">
                      {editingBarberId === barber.id ? (
                        <div className="flex items-center gap-2">
                          <button aria-label="Save team member"
                            onClick={() => handleSaveBarber(barber.id)}
                            className="text-green-600 hover:text-green-700 transition-colors duration-200"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                          <button aria-label="Cancel editing team member"
                            onClick={() => { setEditingBarberId(null); setBarberDraft({ name: '', commissionRate: '' }); }}
                            className="text-gray-500 hover:text-gray-700 transition-colors duration-200"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-3">
                          <button aria-label="Edit team member"
                            onClick={() => handleStartEditBarber(barber.id)}
                            className="text-teal-500 hover:text-teal-600 transition-colors duration-200 hover:scale-110 transform"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          {barberDeleteConfirm === barber.id ? (
                            <div className="flex items-center gap-2 bg-red-50 p-1 rounded-lg border border-red-100">
                              <span className="text-xs text-red-600 font-medium">Del?</span>
                              <button
                                onClick={() => handleDeleteBarber(barber.id)}
                                className="px-2 py-0.5 bg-red-500 text-white text-xs rounded hover:bg-red-600 transition-colors"
                              >
                                Yes
                              </button>
                              <button
                                onClick={() => setBarberDeleteConfirm(null)}
                                className="px-2 py-0.5 bg-gray-200 text-gray-700 text-xs rounded hover:bg-gray-300 transition-colors"
                              >
                                No
                              </button>
                            </div>
                          ) : (
                            <button aria-label="Delete team member"
                              onClick={() => setBarberDeleteConfirm(barber.id)}
                              className="text-red-400 hover:text-red-600 transition-colors duration-200 hover:scale-110 transform"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'customers' && (
        <div className="bg-white rounded-xl shadow-sm border border-teal-100 overflow-hidden animate-fadeIn">
          <div className="overflow-x-auto">
            <table className="mobile-card-table min-w-[420px] w-full text-left">
            <thead className="bg-gradient-to-r from-teal-100 to-teal-100 text-gray-700 text-sm">
              <tr>
                <th className="p-4">Name</th>
                <th className="p-4">Phone</th>
                <th className="p-4">Status</th>
                <th className="p-4 w-44">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-teal-50">
              {[...customers].sort((a, b) => a.name.localeCompare(b.name)).map(customer => (
                <tr hidden={!catalogMatches(customer.name,customer.phone)} key={customer.id} className="hover:bg-teal-50 transition-colors duration-200">
                  <td data-label="Name" className={`p-4 font-medium ${customer.active === false ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
                    {editingCustomerId === customer.id ? (
                      <input
                        value={customerDraft.name}
                        onChange={(e) => setCustomerDraft({ ...customerDraft, name: e.target.value })}
                        className="w-full border border-teal-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-teal-400 focus:border-teal-400"
                      />
                    ) : (
                      customer.name
                    )}
                  </td>
                  <td data-label="Phone" className="p-4 text-gray-600">
                    {editingCustomerId === customer.id ? (
                      <input
                        value={customerDraft.phone}
                        onChange={(e) => setCustomerDraft({ ...customerDraft, phone: e.target.value })}
                        className="w-full border border-teal-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-teal-400 focus:border-teal-400"
                      />
                    ) : (
                      customer.phone
                    )}
                  </td>
                  <td data-label="Status" className="p-4">
                    <div className="flex flex-col gap-2">
                      <span
                        className={`inline-flex items-center justify-center rounded-full px-2 py-1 text-xs font-semibold ${
                          customer.active === false ? 'bg-gray-200 text-gray-600' : 'bg-green-100 text-green-700'
                        }`}
                      >
                        {customer.active === false ? 'Inactive' : 'Active'}
                      </span>
                      {editingCustomerId !== customer.id && (
                        <button
                          onClick={async () => {
                            try {
                              await updateCustomer({ ...customer, active: customer.active === false });
                            } catch (error) {
                              alert('Unable to update customer status.');
                            }
                          }}
                          className="text-xs text-blue-600 hover:text-blue-700 hover:underline"
                        >
                          {customer.active === false ? 'Mark Active' : 'Mark Inactive'}
                        </button>
                      )}
                    </div>
                  </td>
                  <td data-label="Action" className="p-4">
                    {editingCustomerId === customer.id ? (
                      <div className="flex items-center gap-2">
                        <button aria-label="Save customer"
                          onClick={() => handleSaveCustomer(customer.id)}
                          className="text-green-600 hover:text-green-700 transition-colors duration-200"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <button aria-label="Cancel editing customer"
                          onClick={() => { setEditingCustomerId(null); setCustomerDraft({ name: '', phone: '' }); }}
                          className="text-gray-500 hover:text-gray-700 transition-colors duration-200"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <button aria-label="Edit customer"
                          onClick={() => handleStartEditCustomer(customer.id)}
                          className="text-teal-500 hover:text-teal-600 transition-colors duration-200 hover:scale-110 transform"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        {customerDeleteConfirm === customer.id ? (
                          <div className="flex items-center gap-2 bg-red-50 p-1 rounded-lg border border-red-100">
                             <span className="text-xs text-red-600 font-medium">Del?</span>
                            <button
                              onClick={() => handleDeleteCustomer(customer.id)}
                              className="px-2 py-0.5 bg-red-500 text-white text-xs rounded hover:bg-red-600 transition-colors"
                            >
                              Yes
                            </button>
                            <button
                              onClick={() => setCustomerDeleteConfirm(null)}
                              className="px-2 py-0.5 bg-gray-200 text-gray-700 text-xs rounded hover:bg-gray-300 transition-colors"
                            >
                              No
                            </button>
                          </div>
                        ) : (
                          <button aria-label="Delete customer"
                            onClick={() => setCustomerDeleteConfirm(customer.id)}
                            className="text-red-400 hover:text-red-600 transition-colors duration-200 hover:scale-110 transform"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {customers.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-gray-400">No customers yet</td>
                </tr>
              )}
            </tbody>
            </table>
          </div>
        </div>
      )}

      {isDemoMode && activeTab === 'account' && <button className="mb-5 rounded-lg border border-teal-200 bg-white px-4 py-2 text-sm text-teal-700" onClick={() => { if (window.confirm('Reset only this demo workspace? Your demo edits will be replaced with fresh sample data.')) resetDemoWorkspace(); }}>Reset demo data</button>}

      {activeTab === 'account' && (
        <div className="bg-stone-50 p-5 md:p-6 rounded-xl shadow-sm border border-teal-100 max-w-md animate-fadeIn">
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2 text-gray-800">
            <Lock className="w-5 h-5 text-teal-500" />
            Account & Security
          </h2>
          <div className="space-y-6">
            <form onSubmit={handleUpdateCredentials} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="settings-field-7">Email</label>
                <input id="settings-field-7"
                  type="email"
                  value={credentialsDraft.email}
                  onChange={(e) => setCredentialsDraft({ ...credentialsDraft, email: e.target.value })}
                  className="w-full border border-teal-200 rounded-lg p-2 focus:ring-2 focus:ring-teal-400 focus:border-teal-400 transition-all duration-200"
                  placeholder="owner@your-salon.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="settings-field-8">Password</label>
                <input id="settings-field-8"
                  type="password"
                  value={credentialsDraft.password}
                  onChange={(e) => setCredentialsDraft({ ...credentialsDraft, password: e.target.value })}
                  className="w-full border border-teal-200 rounded-lg p-2 focus:ring-2 focus:ring-teal-400 focus:border-teal-400 transition-all duration-200"
                  placeholder="********"
                />
              </div>
              <button
                type="submit"
                className="w-full bg-teal-700 text-white py-2 rounded-lg hover:from-teal-600 hover:to-teal-600 shadow-sm hover:shadow-sm transition-all duration-300"
              >
                Save Login
              </button>
            </form>

            <div className="border-t border-teal-200 pt-4">
              <h3 className="text-sm font-semibold text-gray-800 mb-3">Invoice Edit PIN</h3>
              <form onSubmit={handleUpdatePin} className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="settings-field-9">Current PIN</label>
                  <input id="settings-field-9"
                    type="password"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={pinDraft.current}
                    onChange={(e) => setPinDraft({ ...pinDraft, current: e.target.value })}
                    className="w-full border border-teal-200 rounded-lg p-2 focus:ring-2 focus:ring-teal-400 focus:border-teal-400 transition-all duration-200"
                    placeholder="Enter current PIN"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="settings-field-10">New PIN</label>
                  <input id="settings-field-10"
                    type="password"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={pinDraft.next}
                    onChange={(e) => setPinDraft({ ...pinDraft, next: e.target.value })}
                    className="w-full border border-teal-200 rounded-lg p-2 focus:ring-2 focus:ring-teal-400 focus:border-teal-400 transition-all duration-200"
                    placeholder="Set new PIN"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full bg-teal-700 text-white py-2 rounded-lg hover:from-teal-600 hover:to-teal-600 shadow-sm hover:shadow-sm transition-all duration-300"
                >
                  Update PIN
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
