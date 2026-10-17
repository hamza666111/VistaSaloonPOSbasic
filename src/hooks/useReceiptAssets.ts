import { useEffect, useState } from 'react';
import { useAppSettings } from '../store/useAppSettings';

type ReceiptAssetType = 'logo';

const ASSET_PATHS: Record<ReceiptAssetType, string> = {
  logo: '/logo.svg',
};

const STORAGE_KEYS: Record<ReceiptAssetType, string> = {
  logo: 'vistasaloon-receipt-logo-v1',
};

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(blob);
  });

const getCachedDataUrl = (type: ReceiptAssetType) => {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(STORAGE_KEYS[type]);
  } catch {
    return null;
  }
};

const getAssetSrc = (type: ReceiptAssetType) => getCachedDataUrl(type) || ASSET_PATHS[type];

const cacheAsset = async (type: ReceiptAssetType) => {
  if (typeof window === 'undefined') return;
  if (getCachedDataUrl(type)) return;
  try {
    const response = await fetch(ASSET_PATHS[type], { cache: 'force-cache' });
    if (!response.ok) throw new Error(`Failed to fetch ${ASSET_PATHS[type]}`);
    const blob = await response.blob();
    const dataUrl = await blobToDataUrl(blob);
    localStorage.setItem(STORAGE_KEYS[type], dataUrl);
  } catch (error) {
    console.warn('[ReceiptAssets] Failed to cache asset', type, error);
  }
};

export const warmReceiptAssetsCache = async () => {
  await Promise.all([cacheAsset('logo')]);
};

export const useReceiptAssets = () => {
  const customLogo=useAppSettings(state=>state.settings.logoDataUrl);
  const [assets, setAssets] = useState(() => ({
    logoSrc: getAssetSrc('logo'),
  }));

  useEffect(() => {
    let cancelled = false;

    const warm = async () => {
      await warmReceiptAssetsCache();
      if (cancelled) return;
      setAssets({
        logoSrc: getAssetSrc('logo'),
      });
    };

    warm();

    return () => {
      cancelled = true;
    };
  }, []);

  return { logoSrc: customLogo || assets.logoSrc };
};
