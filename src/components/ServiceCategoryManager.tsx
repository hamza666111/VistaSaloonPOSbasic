import React, { useState } from 'react';
import { Plus, Trash2, Search } from 'lucide-react';
import { useStore } from '../store/useStore';
import { categoryRemoteEnabled, localCategoryImportAvailable, useServiceCategories } from '../store/useServiceCategories';
import { CategorySyncStatus } from './CategorySyncStatus';

export const ServiceCategoryManager: React.FC = () => {
  const services = useStore(state => state.services);
  const { categories, serviceCategories, addCategory, renameCategory, removeCategory, setMembership, importLocalCategories, isSaving, remoteReady } = useServiceCategories();
  const [selectedId, setSelectedId] = useState(categories[0]?.id || '');
  const [newName, setNewName] = useState('');
  const [renameDraft, setRenameDraft] = useState<{ id: string; name: string; version?: number } | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const blocked = isSaving || (categoryRemoteEnabled && !remoteReady);
  const selected = categories.find(category => category.id === selectedId) || categories[0];
  const renameDirty = renameDraft?.id === selected?.id && !!renameDraft;
  const categoryNameDraft = renameDirty ? renameDraft.name : selected?.name || '';
  const renameVersion = renameDirty ? renameDraft.version : selected?.version;
  const matching = services.filter(service => service.name.toLowerCase().includes(search.trim().toLowerCase()));
  const count = (categoryId: string) => services.filter(service => serviceCategories[service.id]?.includes(categoryId)).length;
  const createCategory = async (event: React.FormEvent) => {
    event.preventDefault();
    try { const id = await addCategory(newName); setSelectedId(id); setNewName(''); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to add category.'); }
  };
  const rename = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    try { await renameCategory(selected.id, categoryNameDraft, renameVersion); setRenameDraft(null); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to rename category.'); }
  };
  const remove = async (id: string, name: string, version?: number) => {
    if (!window.confirm(`Remove the category "${name}"? Services and invoice history will stay intact.`)) return;
    try { await removeCategory(id, version); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to remove category.'); }
  };
  const changeMembership = async (serviceId: string, included: boolean) => {
    if (!selected) return;
    try { await setMembership(serviceId, selected.id, included); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to update the category.'); }
  };
  const importLocal = async () => {
    if (!window.confirm('Merge categories saved in this browser into the shared catalog? Existing shared categories and assignments will remain.')) return;
    try { const skipped = await importLocalCategories(); setError(''); setNotice(skipped ? `Categories merged. ${skipped} assignments were skipped because their services are not in the shared catalog.` : 'Local categories merged into the shared catalog.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to import local categories.'); }
  };
  return <section className="category-manager">
    <div className="category-manager-intro"><h2>Organize your service menu</h2><p>Create categories, then tick the services to include. A service can belong to more than one category.</p></div>
    <CategorySyncStatus />
    {notice && <p role="status" className="text-sm text-teal-700">{notice}</p>}
    {localCategoryImportAvailable() && <button type="button" disabled={blocked} onClick={() => void importLocal()} className="justify-self-start rounded-lg border border-teal-200 px-3 py-2 text-sm text-teal-700">Import local categories</button>}
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <form onSubmit={createCategory} className="category-create-form">
      <div className="flex-1"><label htmlFor="new-category-name">New category</label><input disabled={blocked} id="new-category-name" value={newName} onChange={event => setNewName(event.target.value)} maxLength={50} placeholder="e.g. Signature services" className="w-full rounded-lg border p-2" /></div>
      <button disabled={blocked} type="submit" className="inline-flex items-center justify-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-sm text-white"><Plus size={16} />Add category</button>
    </form>
    <div className="category-manager-grid">
      <div className="category-list" aria-label="Manage service categories">
        {categories.map(category => <div key={category.id} className="category-list-row">
          <button type="button" aria-pressed={selected?.id === category.id} onClick={() => { setSelectedId(category.id); setRenameDraft(null); setSearch(''); setError(''); }} className={selected?.id === category.id ? 'selected' : ''}><span>{category.name}</span><small>{count(category.id)}</small></button>
          <button type="button" disabled={blocked} aria-label={`Delete category ${category.name}`} className="category-delete" onClick={() => void remove(category.id, category.name, category.version)}><Trash2 size={15} /></button>
        </div>)}
        {categories.length === 0 && <p className="p-4 text-sm text-gray-500">Add your first category above.</p>}
      </div>
      <div className="category-members">
        {selected ? <>
          <form onSubmit={rename} className="category-rename-form"><div className="flex-1"><label htmlFor="rename-category">Category name</label><input disabled={blocked} id="rename-category" value={categoryNameDraft} onChange={event => setRenameDraft({ id: selected.id, name: event.target.value, version: renameVersion })} maxLength={50} className="w-full rounded-lg border p-2" /></div><button disabled={blocked} type="submit" className="rounded-lg border border-teal-200 px-3 py-2 text-sm text-teal-700">Save name</button></form>
          {categoryRemoteEnabled && renameDirty && selected.version !== renameVersion && <p className="mt-3 text-xs text-amber-700">This category changed on another device. Your draft is kept. <button type="button" className="underline" onClick={() => { setRenameDraft(null); setError(''); }}>Use latest name</button></p>}
          <div className="category-member-heading"><h3>Services in this category <span>{count(selected.id)}</span></h3><p>Untick a service to remove it from this category.</p></div>
          <div className="relative"><Search size={16} className="absolute left-3 top-3 text-gray-400" /><input aria-label="Search category services" value={search} onChange={event => setSearch(event.target.value)} placeholder="Find a service to include..." className="w-full rounded-lg border py-2 pl-9 pr-3" /></div>
          <div className="category-service-list">{matching.map(service => <label key={service.id} className="category-service-option"><input type="checkbox" disabled={blocked} checked={serviceCategories[service.id]?.includes(selected.id) || false} onChange={event => void changeMembership(service.id, event.target.checked)} /><span><strong>{service.name}</strong>{!service.active && <small>Inactive</small>}</span><span className="category-service-price">Rs. {service.price}</span></label>)}{matching.length === 0 && <p className="p-4 text-sm text-gray-500">No services match your search.</p>}</div>
        </> : <div className="p-6 text-sm text-gray-500">Create a category to start organizing services. Services without a category stay available under All services and Uncategorized.</div>}
      </div>
    </div>
    <p className="category-storage-note">{categoryRemoteEnabled ? 'Categories are shared across devices. Removing a category never deletes its services.' : 'Categories are saved in this browser. Removing a category never deletes its services.'}</p>
  </section>;
};
