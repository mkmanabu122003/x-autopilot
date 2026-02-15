import { useState, useCallback } from 'react';

const API_BASE = '/api';
const BASIC_AUTH = btoa('admin:373536');

export function useAPI() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const request = useCallback(async (path, options = {}) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}${path}`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${BASIC_AUTH}`,
          ...options.headers
        },
        ...options
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || `Request failed: ${response.status}`);
      }
      return data;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const get = useCallback((path) => request(path), [request]);

  const post = useCallback((path, body) => request(path, {
    method: 'POST',
    body: JSON.stringify(body)
  }), [request]);

  const put = useCallback((path, body) => request(path, {
    method: 'PUT',
    body: JSON.stringify(body)
  }), [request]);

  const del = useCallback((path) => request(path, {
    method: 'DELETE'
  }), [request]);

  return { get, post, put, del, loading, error };
}
