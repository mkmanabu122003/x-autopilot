import { useState, useEffect, useCallback } from 'react';
import { useAPI } from './useAPI';

export function useSettings() {
  const [settings, setSettings] = useState({});
  const { get, put, loading } = useAPI();

  const fetchSettings = useCallback(async () => {
    try {
      const data = await get('/settings');
      setSettings(data);
    } catch (err) {
      console.error('Failed to fetch settings:', err);
    }
  }, [get]);

  const updateSettings = useCallback(async (updates) => {
    try {
      await put('/settings', updates);
      setSettings(prev => ({ ...prev, ...updates }));
    } catch (err) {
      console.error('Failed to update settings:', err);
      throw err;
    }
  }, [put]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  return { settings, updateSettings, loading, refetch: fetchSettings };
}
