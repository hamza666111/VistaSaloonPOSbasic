import React from 'react';
import { categoryRemoteEnabled, useServiceCategories } from '../store/useServiceCategories';

export const CategorySyncStatus: React.FC = () => {
  const { isLoading, isSaving, syncError, lastSyncedAt, sync } = useServiceCategories();
  if (!categoryRemoteEnabled) return null;
  if (syncError) return <div role="alert" className="category-sync-error"><span>{syncError}</span><button type="button" disabled={isLoading} onClick={() => void sync()}>{isLoading ? 'Refreshing...' : 'Retry category sync'}</button></div>;
  return <div className="category-sync-status" role="status"><span>{isSaving ? 'Saving categories...' : isLoading ? 'Refreshing categories...' : lastSyncedAt ? 'Shared categories synced' : 'Loading shared categories...'}</span><button type="button" disabled={isLoading || isSaving} onClick={() => void sync()}>Refresh categories</button></div>;
};
