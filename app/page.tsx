'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

export default function DashboardPage() {
  const [stats, setStats] = useState({
    crm: 0,
    estimates: 0,
    proposals: 0,
    activeCrews: 0,
    openSafety: 0,
    equipment: 0
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchDashboardData() {
      try {
        const [crmRes, estRes, propRes, crewRes, safetyRes, equipRes] = await Promise.all([
          fetch('/api/crm').then(r => r.json()).catch(() => ({ data: [] })),
          fetch('/api/estimates').then(r => r.json()).catch(() => ({ data: [] })),
          fetch('/api/proposals').then(r => r.json()).catch(() => ({ data: [] })),
          fetch('/api/crew-schedule').then(r => r.json()).catch(() => ({ data: [] })),
          fetch('/api/safety-logs').then(r => r.json()).catch(() => ({ data: [] })),
          fetch('/api/equipment-rentals').then(r => r.json()).catch(() => ({ data: [] })),
        ]);

        setStats({
          crm: crmRes.data?.length || 0,
          estimates: estRes.data?.length || 0,
          proposals: propRes.data?.length || 0,
          activeCrews: crewRes.data?.length || 0,
          openSafety: safetyRes.data?.length || 0,
          equipment: equipRes.data?.length || 0,
        });
      } catch (err) {
        console.error('Failed to load dashboard metrics', err);
      } finally {
        setLoading(false);
      }
    }

    fetchDashboardData();
  }, []);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white">TradeQuote PRO Command Center</h1>
            <p className="text-slate-400 mt-1">Industrial Shutdown & Electrical Contracting Operations Hub</p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/estimates"
              className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-semibold px-4 py-2.5 rounded-lg shadow transition-colors"
            >
              + New Estimate
            </Link>
            <Link
              href="/proposals"
              className="bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold px-4 py-2.5 rounded-lg shadow transition-colors border border-slate-700"
            >
              View Proposals
            </Link>
          </div>
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-10">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Active CRM Clients</p>
            <p className="text-4xl font-extrabold text-white">{loading ? '...' : stats.crm}</p>
            <p className="text-xs text-amber-400 mt-2">Facility accounts & contacts</p>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Active Estimates</p>
            <p className="text-4xl font-extrabold text-white">{loading ? '...' : stats.estimates}</p>
            <p className="text-xs text-amber-400 mt-2">Costing & pricing spreadsheets</p>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Pending Proposals</p>
            <p className="text-4xl font-extrabold text-white">{loading ? '...' : stats.proposals}</p>
            <p className="text-xs text-amber-400 mt-2">Generated digital proposals</p>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Crew Schedules</p>
            <p className="text-4xl font-extrabold text-white">{loading ? '...' : stats.activeCrews}</p>
            <p className="text-xs text-amber-400 mt-2">Shift & personnel tracking</p>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Safety Incidents / Logs</p>
            <p className="text-4xl font-extrabold text-white">{loading ? '...' : stats.openSafety}</p>
            <p className="text-xs text-amber-400 mt-2">ESTS & compliance records</p>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Equipment Rentals</p>
            <p className="text-4xl font-extrabold text-white">{loading ? '...' : stats.equipment}</p>
            <p className="text-xs text-amber-400 mt-2">Site machinery & tool crib</p>
          </div>
        </div>

        {/* Quick Navigation Shortcuts */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-xl mb-8">
          <h2 className="text-xl font-bold text-white mb-4">Core Operational Modules</h2>
          <p className="text-slate-400 text-sm mb-6">Quickly jump to any of the 30 industrial management modules across your platform.</p>
          
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {[
              { name: 'CRM', path: '/crm' },
              { name: 'Estimates', path: '/estimates' },
              { name: 'Proposals', path: '/proposals' },
              { name: 'Job Costing', path: '/job-costing' },
              { name: 'Daily Logs', path: '/daily-logs' },
              { name: 'Cable Testing', path: '/cable-testing' },
              { name: 'Change Orders', path: '/change-orders' },
              { name: 'Commissioning', path: '/commissioning' },
              { name: 'Crew Schedule', path: '/crew-schedule' },
              { name: 'Field Logs', path: '/field-logs' },
              { name: 'LOTO Permits', path: '/loto-permits' },
              { name: 'Safety Logs', path: '/safety-logs' },
              { name: 'Timecards', path: '/timecards' },
              { name: 'Tool Crib', path: '/tool-crib' },
              { name: 'Vendors', path: '/vendors' },
              { name: 'Warehouse', path: '/warehouse-inventory' },
              { name: 'Warranty', path: '/warranty' },
              { name: 'Site Vault', path: '/site-vault' },
            ].map((mod) => (
              <Link
                key={mod.path}
                href={mod.path}
                className="bg-slate-950 hover:bg-amber-500/10 hover:border-amber-500/50 border border-slate-800 rounded-xl p-3 text-center text-sm font-medium text-slate-300 hover:text-amber-400 transition-all"
              >
                {mod.name}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
