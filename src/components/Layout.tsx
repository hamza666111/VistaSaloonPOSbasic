import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Scissors, Settings, ShoppingCart, LogOut, Users, Receipt, PieChart, Menu, X, ArrowUpRight, MoreHorizontal } from 'lucide-react';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { SalonBrand } from './SalonBrand';
import { useAppSettings } from '../store/useAppSettings';
import { useStore } from '../store/useStore';

const navigation = [
  { path: '/', label: 'Point of sale', icon: ShoppingCart, group: 'WORKSPACE' },
  { path: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { path: '/invoices', label: 'Invoices', icon: Receipt },
  { path: '/customers', label: 'Client book', icon: Users },
  { path: '/statistics', label: 'Insights', icon: PieChart },
  { path: '/settings', label: 'Settings', icon: Settings, group: 'MANAGEMENT' },
];

export const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const settings=useAppSettings(state=>state.settings);
  const location = useLocation();
  const navigate = useNavigate();
  const { logout, lastSyncMessage, cacheWarning, syncData } = useStore();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const drawerRef=useRef<HTMLElement>(null);
  const mobile=useMediaQuery('(max-width: 1023px)');
  useDialogFocus(drawerRef,mobile && isSidebarOpen,()=>setIsSidebarOpen(false));
  useEffect(()=>{setIsSidebarOpen(false);window.scrollTo({top:0,left:0,behavior:'auto'});},[location.pathname]);
  const handleLogout = () => { logout(); navigate('/login'); };
  return (
    <div className="app-shell">
      {isSidebarOpen && <button className="sidebar-backdrop lg:hidden" aria-label="Close navigation" onClick={() => setIsSidebarOpen(false)} />}
      <aside ref={drawerRef} tabIndex={-1} role={mobile && isSidebarOpen ? 'dialog' : undefined} aria-modal={mobile && isSidebarOpen ? true : undefined} aria-label="Navigation" id="main-navigation" className={`sidebar no-print ${isSidebarOpen ? 'sidebar-open' : ''}`}>
        <button type="button" className="drawer-close" aria-label="Close navigation" onClick={()=>setIsSidebarOpen(false)}><X size={20}/></button>
        <Link to="/" className="brand" onClick={() => setIsSidebarOpen(false)}>
          <SalonBrand />
        </Link>
        <nav aria-label="Main navigation">
          {navigation.map(({ path, label, icon: Icon, group }) => (
            <React.Fragment key={path}>
              {group && <p className="nav-group">{group}</p>}
              <Link to={path} aria-current={location.pathname === path ? 'page' : undefined} className={`nav-link ${location.pathname === path ? 'active' : ''}`} onClick={() => setIsSidebarOpen(false)}>
                <Icon size={19} /><span>{label}</span>{location.pathname === path && <span className="nav-dot" />}
              </Link>
            </React.Fragment>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note"><Scissors size={18} /><p>A little more style.<br /><span>A lot less admin.</span></p><ArrowUpRight size={16} /></div>
          <button onClick={handleLogout} className="nav-link logout"><LogOut size={18} />Sign out</button>
          <div className="sidebar-contact">{settings.address&&<p title={settings.address}>{settings.address}</p>}{settings.phone&&<p>{settings.phone}</p>}</div><p className="sidebar-version">{settings.salonName} / POS System</p>
        </div>
      </aside>
      <main className="workspace-main">
        <div className="mobile-toolbar no-print"><div className="mobile-toolbar-brand"><img src={settings.logoDataUrl||'/logo.svg'} alt="" aria-hidden="true"/><div><span className="mobile-salon-name">{settings.salonName}</span><span className="mobile-page-name">{navigation.find(item=>item.path===location.pathname)?.label}</span></div></div><button aria-label={isSidebarOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={isSidebarOpen} aria-controls="main-navigation" onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="mobile-menu"><Menu size={21}/></button></div>
        <div className="workspace-content">{cacheWarning&&<p role="status" className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{cacheWarning}</p>}{lastSyncMessage&&<div role="status" className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><span>{lastSyncMessage}</span><button type="button" className="shrink-0 underline" onClick={()=>void syncData().catch(()=>{})}>Refresh</button></div>}{children}</div>
        <footer className="workspace-footer no-print"><span>{settings.salonName} POS System</span><span className="developer-watermark">Developed by FlagVista</span></footer>
        <nav className="mobile-bottom-nav no-print" aria-label="Quick navigation">
          {navigation.slice(0,4).map(({path,label,icon:Icon})=><Link key={path} to={path} aria-current={location.pathname===path?'page':undefined} onClick={()=>setIsSidebarOpen(false)}><Icon size={21}/><span>{path==='/'?'POS':path==='/customers'?'Clients':label}</span></Link>)}
          <button type="button" aria-label="More navigation" aria-expanded={isSidebarOpen} aria-controls="main-navigation" className={['/settings','/statistics'].includes(location.pathname)?'active':''} onClick={()=>setIsSidebarOpen(true)}><MoreHorizontal size={22}/><span>More</span></button>
        </nav>
      </main>
    </div>
  );
};
