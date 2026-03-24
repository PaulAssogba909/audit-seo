import { useState, useEffect } from 'react';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import './App.css';

export function authHeaders(extra = {}) {
    const token = localStorage.getItem('token');
    const headers = { 'Content-Type': 'application/json', ...extra };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    return headers;
}

export async function authFetch(url, options = {}) {
    const headers = authHeaders(options.headers);
    const res = await fetch(url, { ...options, headers, credentials: 'include' });
    if (res.status === 401 || res.status === 403) {
          localStorage.removeItem('token');
          window.location.reload();
    }
    return res;
}

function App() {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

  useEffect(() => {
        const token = localStorage.getItem('token');
        if (!token) { setLoading(false); return; }
        fetch('/api/auth/me', {
                headers: { 'Authorization': 'Bearer ' + token },
                credentials: 'include'
        })
          .then(r => r.ok ? r.json() : Promise.reject())
          .then(data => setUser(data.user || data))
          .catch(() => { localStorage.removeItem('token'); })
          .finally(() => setLoading(false));
  }, []);

  const handleLogin = (userData, token) => {
        if (token) localStorage.setItem('token', token);
        setUser(userData);
  };

  const handleLogout = () => {
        authFetch('/api/auth/logout', { method: 'POST' })
          .catch(() => {})
          .finally(() => {
                    localStorage.removeItem('token');
                    setUser(null);
          });
  };

  if (loading) return <div className="loading">Chargement...</div>div>;
    if (!user) return <Login onLogin={handleLogin} />;
    return <Dashboard user={user} onLogout={handleLogout} />;
}

export default App;
</div>
