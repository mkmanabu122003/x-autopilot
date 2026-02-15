import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAPI } from '../hooks/useAPI';

const AccountContext = createContext(null);

export function AccountProvider({ children }) {
  const [accounts, setAccounts] = useState([]);
  const [currentAccount, setCurrentAccount] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const { get } = useAPI();

  const fetchAccounts = useCallback(async () => {
    try {
      const data = await get('/accounts');
      setAccounts(data);

      // Restore last selected account from localStorage
      const savedId = localStorage.getItem('x_autopilot_current_account');
      if (savedId) {
        const found = data.find(a => a.id === Number(savedId));
        if (found) {
          setCurrentAccount(found);
        } else if (data.length > 0) {
          setCurrentAccount(data[0]);
        }
      } else if (data.length > 0) {
        setCurrentAccount(data[0]);
      }
    } catch (err) {
      // ignore - no accounts yet
    } finally {
      setLoaded(true);
    }
  }, [get]);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

  const switchAccount = useCallback((account) => {
    setCurrentAccount(account);
    localStorage.setItem('x_autopilot_current_account', String(account.id));
  }, []);

  const refreshAccounts = useCallback(async () => {
    await fetchAccounts();
  }, [fetchAccounts]);

  return (
    <AccountContext.Provider value={{
      accounts,
      currentAccount,
      switchAccount,
      refreshAccounts,
      loaded,
      hasAccounts: accounts.length > 0
    }}>
      {children}
    </AccountContext.Provider>
  );
}

export function useAccount() {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error('useAccount must be used within AccountProvider');
  return ctx;
}
