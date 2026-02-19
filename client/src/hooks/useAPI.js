import { useState, useCallback } from 'react';

const API_BASE = '/api';

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
          ...options.headers
        },
        ...options
      });
      // Parse response body as text first to avoid JSON parse errors
      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (parseErr) {
        throw new Error(
          !response.ok
            ? `サーバーエラー (${response.status})`
            : `レスポンスの解析に失敗しました`
        );
      }
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
