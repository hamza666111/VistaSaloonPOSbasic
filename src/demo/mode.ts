// Demo data is available only in local development with remote sync disabled.
export const isDemoMode = import.meta.env.DEV &&
  import.meta.env.VITE_DEMO_MODE === 'true' &&
  import.meta.env.VITE_ENABLE_REMOTE_SYNC !== 'true';
