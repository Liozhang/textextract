import { useStore } from './store';

/** Check if all required API settings are configured */
export function isApiConfigured(): boolean {
  const { apiSettings } = useStore.getState();
  return !!(apiSettings.baseUrl && apiSettings.apiKey && apiSettings.model);
}
