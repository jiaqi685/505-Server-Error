import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Activity, Bell, FileSpreadsheet, FileText, FlaskConical, LogOut, Package, LayoutDashboard, Menu, ScrollText, ShieldCheck, ShoppingCart, type LucideIcon } from "lucide-react";
import { useDashboardData } from "@/hooks/use-ngate";
import { isDemoMode, isConnectedMode } from "@/data";
import { isRfqPending } from "@/lib/inventory";
import { useModal } from "@/components/modals/modal-context";
import { APP_NAME, BUSINESS_NAME, OWNER } from "@/lib/brand";

const NAV: { href: string; label: string; icon: LucideIcon; match: (l: string) => boolean }[] = [
  { href: "/", label: "Home", icon: LayoutDashboard, match: (l) => l === "/" },
  { href: "/purchasing", label: "Purchasing", icon: ShoppingCart, match: (l) => l.startsWith("/purchasing") },
  { href: "/supplier-quotations", label: "Supplier Quotations", icon: FileText, match: (l) => l.startsWith("/supplier-quotations") },
  { href: "/orders", label: "My Orders", icon: Package, match: (l) => l.startsWith("/orders") },
  { href: "/pos-import", label: "Import POS Data", icon: FileSpreadsheet, match: (l) => l.startsWith("/pos-import") },
  { href: "/activity", label: "Activity History", icon: ScrollText, match: (l) => l.startsWith("/activity") },
];

function crumbFor(location: string): string {
  if (location === "/dev/flask-products") return "Flask catalogue · read-only";
  return NAV.find((n) => n.match(location))?.label ?? "Not found";
}

function Sidebar({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  const [location] = useLocation();
  const { data } = useDashboardData();
  const { open: openModal } = useModal();
  const pending = data ? data.quotationRequests.filter((r) => isRfqPending(r, data.quotes, data.purchaseOrders)).length : 0;
  const drafts = data?.purchaseOrders.filter((o) => o.status === "draft").length ?? 0;

  return (
    <aside className={`sidebar ${open ? "open" : ""}`} aria-label="Main navigation">
      <div className="brand">
        <div className="brand-mark"><Activity size={22} strokeWidth={2.2} /></div>
        <div>
          <div className="brand-name">ngate<span style={{ color: "#53d0b4" }}>.</span></div>
          <div className="brand-caption">Purchasing assistant</div>
        </div>
      </div>
      <div className="nav-heading">MAIN MENU</div>
      {NAV.map(({ href, label, icon: Icon, match }) => (
        <Link key={href} href={href} onClick={onNavigate} className={`nav-btn ${match(location) ? "active" : ""}`} data-testid={`link-nav-${label.toLowerCase().replace(/\s+/g, "-")}`}>
          <Icon size={18} />
          <span>{label}</span>
          {href === "/purchasing" && pending > 0 && <span className="count" title="Quotations waiting for replies">{pending}</span>}
          {href === "/orders" && drafts > 0 && <span className="count" title="PO drafts pending approval">{drafts}</span>}
        </Link>
      ))}
      <div className="nav-heading">YOUR ACCOUNT</div>
      <button className="nav-btn" onClick={() => { onNavigate(); openModal({ type: "help" }); }} data-testid="button-how-to-use">
        <ShieldCheck size={18} /> <span>How to Use {APP_NAME}</span>
      </button>
      <div className="sidebar-foot">
        <div className="avatar">{OWNER.initials}</div>
        <div>
          <div className="sidename">{OWNER.name}</div>
          <div className="siderole">{BUSINESS_NAME} · {OWNER.role}</div>
        </div>
      </div>
    </aside>
  );
}

export function AppShell({ children, onLogout, userName }: { children: ReactNode; onLogout: () => void; userName: string }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
    window.scrollTo(0, 0);
  }, [location]);

  return (
    <div className="app">
      <Sidebar open={mobileOpen} onNavigate={() => setMobileOpen(false)} />
      <div className={`mobile-scrim ${mobileOpen ? "show" : ""}`} onClick={() => setMobileOpen(false)} />
      <div className="workspace">
        {isDemoMode && (
          <div className="demo-banner" role="note" data-testid="banner-demo-mode">
            <FlaskConical size={16} />
      <span><strong>Demo Mode · Browser Demo Storage</strong> · Synthetic/example business data. RFQs, quotations, orders and activity are saved in this browser only. NGate never sends WhatsApp messages or purchase orders.</span>
          </div>
        )}
        {isConnectedMode && <div className="demo-banner" role="note" data-testid="banner-connected-mode"><FlaskConical size={16} /><span><strong>Connected Procurement · Flask SQLite</strong> · POS Synthetic Demo (browser-local). Procurement is saved to your authenticated account; synthetic POS imports remain local. No messages or POs are sent automatically.</span></div>}
        <header className="topbar">
          <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
            <button className="mobile-nav-trigger" onClick={() => setMobileOpen((o) => !o)} aria-label="Open navigation" data-testid="button-mobile-menu">
              <Menu size={18} />
            </button>
            <div className="crumb">
              {APP_NAME} <span>›</span> <b>{crumbFor(location)}</b>
            </div>
          </div>
          <div className="top-actions">
            <Link href="/activity" className="btn sm" aria-label="Open activity history" data-testid="link-topbar-activity">
              <Bell size={17} />
            </Link>
            <span className="sidename topbar-user">{userName}</span>
            <button className="btn sm" onClick={onLogout} aria-label="Log out" title="Log out" data-testid="button-logout">
              <LogOut size={15} /> Log out
            </button>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
