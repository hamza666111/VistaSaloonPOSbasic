import React, { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { SalonBrand } from '../components/SalonBrand';
import { useAppSettings } from '../store/useAppSettings';
import { useStore } from '../store/useStore';
import { Scissors, ArrowRight, Sparkles, LockKeyhole } from 'lucide-react';

export const Login: React.FC = () => {
  const settings=useAppSettings(state=>state.settings);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { login, isAuthenticated } = useStore();
  if (isAuthenticated) return <Navigate to="/" replace />;
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const ok = await login(email.trim(), password);
      setError(ok ? '' : 'The email or password does not match. Please try again.');
    } catch { setError('Unable to sign in. Please try again.'); }
    finally { setIsSubmitting(false); }
  };
  return (
    <div className="login-screen">
      <section className="login-story">
        <div className="brand"><SalonBrand /></div>
        <div className="story-copy"><span className="eyebrow"><Sparkles size={16} /> A FRESH PERSPECTIVE ON SALON MANAGEMENT</span><h1>Great style.<br />Beautifully<br /><em>managed.</em></h1><p>More time for your craft. More care for your clients. One thoughtful workspace for your whole salon.</p><div className="story-tags"><span>Hair & grooming</span><span>Beauty & wellness</span></div></div>
        <div className="story-footer"><span>FOR EVERY STYLE. FOR EVERYONE.</span><span>01 / VISTA</span></div>
        <div className="story-orbit" aria-hidden="true"><Scissors /></div>
      </section>
      <section className="login-form-panel">
        <div className="login-form-wrap"><span className="eyebrow">YOUR SALON, IN FOCUS</span><h2>Welcome back.</h2><p className="login-intro">Sign in and make room for a great day.</p>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div><label htmlFor="login-email">Email address</label><input id="login-email" type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required placeholder="you@your-salon.com" /></div>
            <div><label htmlFor="login-password">Password</label><input id="login-password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required placeholder="Enter your password" /></div>
            {error && <p role="alert" className="text-red-600 text-sm">{error}</p>}
            <button disabled={isSubmitting} className="login-submit" type="submit">{isSubmitting ? 'Signing in...' : 'Enter workspace'}<ArrowRight size={18} /></button>
          </form>
          <p className="login-privacy"><LockKeyhole size={14} /> Your space to run things beautifully.</p>
        </div>
        <p className="login-copyright"><span>{settings.salonName} POS System</span><span className="developer-watermark">Developed by FlagVista</span></p>
      </section>
    </div>
  );
};
