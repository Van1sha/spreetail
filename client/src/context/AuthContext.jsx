import React, { createContext, useState, useEffect, useContext } from 'react';
import client from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('fairshare_token'));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadCurrentUser() {
      if (token) {
        try {
          const res = await client.get('/auth/me');
          setUser(res.data.user);
        } catch (err) {
          console.error('Failed to load user profile, token might be expired:', err);
          logout();
        }
      }
      setLoading(false);
    }
    loadCurrentUser();
  }, [token]);

  const login = async (email, password) => {
    try {
      const res = await client.post('/auth/login', { email, password });
      setUser(res.data.user);
      setToken(res.data.token);
      localStorage.setItem('fairshare_token', res.data.token);
      return res.data;
    } catch (err) {
      throw err.response?.data?.error || 'Login failed. Please check your credentials.';
    }
  };

  const register = async (name, email, password) => {
    try {
      const res = await client.post('/auth/register', { name, email, password });
      setUser(res.data.user);
      setToken(res.data.token);
      localStorage.setItem('fairshare_token', res.data.token);
      return res.data;
    } catch (err) {
      throw err.response?.data?.error || 'Registration failed.';
    }
  };

  const logout = () => {
    setUser(null);
    setToken(null);
    localStorage.removeItem('fairshare_token');
  };

  return (
    <AuthContext.Provider value={{ user, token, login, register, logout, isAuthenticated: !!token, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
