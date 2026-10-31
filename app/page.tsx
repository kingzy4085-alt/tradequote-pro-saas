"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

export default function DashboardHub() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedTab, setSelectedTab] = useState("All");
  const [currentTime, setCurrentTime] = useState("");

  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setCurrentTime(now.toLocaleTimeString("en-CA", { hour12: false }));
    };
    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, []);

  const modules = [
    { title: "Estimating & Pricing", desc: "Labor multipliers, material markups, and electrical unit pricing structures.", href: "/estimates", category: "Core", tag: "FINANCE", glow: "from-blue-500/20 via-cyan-500/5 to-transparent", border: "border-blue-500/40", text: "text-blue-400" },
    { title: "Digital Proposals", desc: "Itemized client proposals with instant professional PDF document export.", href: "/proposals/export", category: "Core", tag: "SALES", glow: "from-indigo-500/20 via-blue-500/5 to-transparent", border: "border-indigo-500/40", text: "text-indigo-400" },
    { title: "Client CRM Directory", desc: "Commercial plant clients, project sites, and active account standings.", href: "/crm", category: "Core", tag: "ADMIN", glow: "from-emerald-500/20 via-teal-500/5 to-transparent", border: "border-emerald-500/40", text: "text-emerald-400" },
    { title: "Site Photo & Doc Vault", desc: "Secure cloud folders, field progress photos, and compliance documentation.", href: "/site-vault", category: "Core", tag: "FILES", glow: "from-purple-500/20 via-indigo-500/5 to-transparent", border: "border-purple-500/40", text: "text-purple-400" },
    { title: "Superintendent Daily Logs", desc: "Manpower hour tracking, site weather conditions, and shift summaries.", href: "/daily-logs", category: "Core", tag: "OPS", glow: "from-amber-500/20 via-orange-500/5 to-transparent", border: "border-amber-500/40", text: "text-amber-400" },
    { title: "Progress Billing & SOV", desc: "Schedule of values, previous billings, and statutory lien holdbacks.", href: "/progress-billing", category: "Core", tag: "FINANCE", glow: "from-emerald-500/20 via-green-500/5 to-transparent", border: "border-emerald-500/40", text: "text-emerald-400" },
    { title: "Job Costing & Budgeting", desc: "Real-time budget vs actual labor variance and profit margin analytics.", href: "/job-costing", category: "Core", tag: "FINANCE", glow: "from-teal-500/20 via-cyan-500/5 to-transparent", border: "border-teal-500/40", text: "text-teal-400" },
    
    { title: "RFI Tracking", desc: "Technical engineering clarifications and formal response logs.", href: "/rfis", category: "Execution", tag: "ENGINEERING", glow: "from-cyan-500/20 via-blue-500/5 to-transparent", border: "border-cyan-500/40", text: "text-cyan-400" },
    { title: "Change Orders & Variations", desc: "Out-of-scope cost variations, extra work tickets, and client approvals.", href: "/change-orders", category: "Execution", tag: "CONTRACTS", glow: "from-emerald-500/20 via-teal-500/5 to-transparent", border: "border-emerald-500/40", text: "text-emerald-400" },
    { title: "Material Submittals", desc: "Equipment cut sheets, manufacturer specs, and engineering sign-offs.", href: "/submittals", category: "Execution", tag: "ENGINEERING", glow: "from-indigo-500/20 via-purple-500/5 to-transparent", border: "border-indigo-500/40", text: "text-indigo-400" },
    { title: "Drawings & Blueprints", desc: "Version-controlled electrical schematics, single-lines, and P&IDs.", href: "/drawings", category: "Execution", tag: "TECHNICAL", glow: "from-purple-500/20 via-pink-500/5 to-transparent", border: "border-purple-500/40", text: "text-purple-400" },
    { title: "Cable Testing & Megger IR", desc: "Cable pull tracking, reel lengths, and insulation resistance logs.", href: "/cable-testing", category: "Execution", tag: "ELECTRICAL", glow: "from-cyan-500/20 via-teal-500/5 to-transparent", border: "border-cyan-500/40", text: "text-cyan-400" },
    { title: "Commissioning & Energization", desc: "Phase rotation, trip settings, relay tests, and live energization sign-offs.", href: "/commissioning", category: "Execution", tag: "ELECTRICAL", glow: "from-emerald-500/20 via-emerald-500/5 to-transparent", border: "border-emerald-500/40", text: "text-emerald-400" },
    { title: "Punch List & Deficiencies", desc: "Inspection punch items, deficiency tracking, and trade sign-offs.", href: "/punch-list", category: "Execution", tag: "QUALITY", glow: "from-rose-500/20 via-red-500/5 to-transparent", border: "border-rose-500/40", text: "text-rose-400" },

    { title: "Safety & Near Miss Logs", desc: "Hazard reporting, incident severity scoring, and corrective action workflows.", href: "/safety-logs", category: "Safety", tag: "HSE", glow: "from-rose-500/20 via-orange-500/5 to-transparent", border: "border-rose-500/40", text: "text-rose-400" },
    { title: "LOTO & Permit to Work", desc: "Energy isolation, lock serial numbers, and zero-energy verification.", href: "/loto-permits", category: "Safety", tag: "HSE", glow: "from-red-500/20 via-rose-500/5 to-transparent", border: "border-red-500/40", text: "text-red-400" },
    { title: "Safety Tailgate Meetings", desc: "Pre-shift safety talks, hazard discussions, and crew attendance logs.", href: "/tailgate-logs", category: "Safety", tag: "HSE", glow: "from-amber-500/20 via-yellow-500/5 to-transparent", border: "border-amber-500/40", text: "text-amber-400" },
    { title: "Subcontractor Compliance", desc: "WCB standing, general liability insurance, and COR safety checks.", href: "/sub-compliance", category: "Safety", tag: "COMPLIANCE", glow: "from-emerald-500/20 via-green-500/5 to-transparent", border: "border-emerald-500/40", text: "text-emerald-400" },
    { title: "Defect Liability & Claims", desc: "Post-completion warranty claims, deficiency tracking, and rectifications.", href: "/defect-liability", category: "Safety", tag: "WARRANTY", glow: "from-blue-500/20 via-indigo-500/5 to-transparent", border: "border-blue-500/40", text: "text-blue-400" },
    { title: "Warranty & Maintenance", desc: "Manufacturer warranties, service SLAs, and contact directories.", href: "/warranty", category: "Safety", tag: "WARRANTY", glow: "from-blue-500/20 via-cyan-500/5 to-transparent", border: "border-blue-500/40", text: "text-blue-400" },

    { title: "Subcontractor & Vendors", desc: "Trade partner directories, WCB standing, and insurance certificates.", href: "/vendors", category: "Supply Chain", tag: "PROCUREMENT", glow: "from-emerald-500/20 via-teal-500/5 to-transparent", border: "border-emerald-500/40", text: "text-emerald-400" },
    { title: "Supplier RFQs & Bidding", desc: "Material package RFQs, wholesaler bids, and purchase orders.", href: "/rfq", category: "Supply Chain", tag: "PROCUREMENT", glow: "from-emerald-500/20 via-green-500/5 to-transparent", border: "border-emerald-500/40", text: "text-emerald-400" },
    { title: "Warehouse Inventory Stock", desc: "Stock quantities, bin locations, reorder thresholds, and unit costs.", href: "/warehouse-inventory", category: "Supply Chain", tag: "INVENTORY", glow: "from-amber-500/20 via-yellow-500/5 to-transparent", border: "border-amber-500/40", text: "text-amber-400" },
    { title: "Tool Crib Asset Management", desc: "Test equipment checkouts, calibration dates, and asset tags.", href: "/tool-crib", category: "Supply Chain", tag: "ASSETS", glow: "from-amber-500/20 via-orange-500/5 to-transparent", border: "border-amber-500/40", text: "text-amber-400" },
    { title: "Equipment Rental Tracking", desc: "Heavy machinery, daily rental rates, and return schedules.", href: "/equipment-rentals", category: "Supply Chain", tag: "ASSETS", glow: "from-teal-500/20 via-blue-500/5 to-transparent", border: "border-teal-500/40", text: "text-teal-400" },
    { title: "Fleet & Service Vehicles", desc: "Service truck mileage, preventative maintenance, and driver logs.", href: "/fleet", category: "Supply Chain", tag: "FLEET", glow: "from-teal-500/20 via-emerald-500/5 to-transparent", border: "border-teal-500/40", text: "text-teal-400" },
    { title: "Timecards & Payroll Export", desc: "Regular hours, overtime multipliers, and shutdown premium rates.", href: "/timecards", category: "Supply Chain", tag: "PAYROLL", glow: "from-indigo-500/20 via-purple-500/5 to-transparent", border: "border-indigo-500/40", text: "text-indigo-400" },
  ];

  const categories = ["All", "Core", "Execution", "Safety", "Supply Chain"];

  const filteredModules = modules.filter(mod => {
    const matchesSearch = mod.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          mod.desc.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          mod.tag.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesTab = selectedTab === "All" || mod.category === selectedTab;
    return matchesSearch && matchesTab;
  });

  return (
    <div className="min-h-screen bg-[#07090e] text-slate-100 font-sans selection:bg-cyan-500 selection:text-black antialiased">
      {/* Absolute Ambient Background Gradients */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none"></div>
      <div className="absolute top-20 right-1/4 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl pointer-events-none"></div>

      {/* Top Tactical Command Nav */}
      <header className="border-b border-slate-800/80 bg-[#0b0f17]/90 backdrop-blur-xl sticky top-0 z-50 px-6 lg:px-12 py-4">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="flex items-center space-x-4">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-cyan-400 via-blue-600 to-indigo-700 flex items-center justify-center font-black text-xl text-black shadow-lg shadow-cyan-500/20 border border-cyan-300/30">
              TQ
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-xl font-extrabold tracking-tight text-white">TradeQuote <span className="text-cyan-400">PRO</span></h1>
                <span className="text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 uppercase tracking-widest">
                  Enterprise v3.0
                </span>
              </div>
              <p className="text-xs text-slate-400 font-mono">Industrial Shutdown & Electrical Command Infrastructure</p>
            </div>
          </div>

          <div className="flex items-center space-x-6">
            <div className="hidden lg:flex items-center space-x-4 text-xs font-mono text-slate-400 bg-slate-900/80 px-4 py-2 rounded-xl border border-slate-800">
              <div>SYS TIME: <span className="text-cyan-400 font-bold">{currentTime || "00:00:00"}</span></div>
              <div className="w-px h-3 bg-slate-800"></div>
              <div>PORT: <span className="text-white font-bold">3001</span></div>
            </div>

            <div className="flex items-center space-x-2 bg-emerald-500/10 border border-emerald-500/30 px-3.5 py-1.5 rounded-full">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span className="text-xs font-mono font-bold text-emerald-400 tracking-wider">ONLINE</span>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Header Section */}
      <main className="max-w-7xl mx-auto px-6 lg:px-12 pt-10 pb-16">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-8 mb-12 border-b border-slate-800/80 pb-10">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-mono mb-4">
              <span>âš¡ INDUSTRIAL SHUTDOWN SUITE</span>
            </div>
            <h2 className="text-4xl sm:text-6xl font-black tracking-tight text-white mb-4 leading-none">
              Command <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-500">Center</span>
            </h2>
            <p className="text-slate-400 max-w-2xl text-sm sm:text-base leading-relaxed">
              Fully integrated full-stack architecture engineered to replace legacy software with unmatched speed, precision, and interactive control.
            </p>
          </div>

          {/* Quick Metrics Ticker */}
          <div className="grid grid-cols-3 gap-3 w-full lg:w-auto">
            <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-2xl text-center backdrop-blur-md">
              <div className="text-3xl font-black text-cyan-400 font-mono">27</div>
              <div className="text-[10px] text-slate-400 uppercase tracking-widest font-bold mt-1">Modules</div>
            </div>
            <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-2xl text-center backdrop-blur-md">
              <div className="text-3xl font-black text-emerald-400 font-mono">100%</div>
              <div className="text-[10px] text-slate-400 uppercase tracking-widest font-bold mt-1">Operational</div>
            </div>
            <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-2xl text-center backdrop-blur-md">
              <div className="text-3xl font-black text-purple-400 font-mono">PRO</div>
              <div className="text-[10px] text-slate-400 uppercase tracking-widest font-bold mt-1">Tier</div>
            </div>
          </div>
        </div>

        {/* Interactive Search & Category Filter Navigation */}
        <div className="flex flex-col md:flex-row justify-between items-center gap-4 mb-10 bg-slate-900/60 p-4 rounded-2xl border border-slate-800/80 backdrop-blur-xl shadow-2xl">
          <div className="w-full md:w-96 relative">
            <span className="absolute inset-y-0 left-0 flex items-center pl-4 text-slate-500">ðŸ”</span>
            <input 
              type="text"
              placeholder="Search modules or tags (e.g. LOTO, Estimating)..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-[#07090e] border border-slate-800 rounded-xl pl-11 pr-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition font-mono shadow-inner"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedTab(cat)}
                className={`px-5 py-2.5 rounded-xl text-xs font-bold transition-all duration-200 uppercase tracking-wider ${
                  selectedTab === cat 
                    ? "bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-lg shadow-cyan-600/30 border border-cyan-400/30 scale-105" 
                    : "bg-[#07090e] text-slate-400 hover:text-white border border-slate-800/80 hover:border-slate-700"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Modules Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredModules.map((mod, idx) => (
            <Link 
              key={idx} 
              href={mod.href} 
              className={`group relative bg-gradient-to-b ${mod.glow} bg-slate-900/80 border ${mod.border} rounded-2xl p-7 transition-all duration-300 hover:-translate-y-2 hover:shadow-2xl hover:shadow-cyan-500/10 hover:border-cyan-400/60 flex flex-col justify-between backdrop-blur-xl`}
            >
              <div>
                <div className="flex justify-between items-center mb-4">
                  <span className={`text-[10px] font-mono font-extrabold px-3 py-1 rounded-full bg-slate-950/80 border border-slate-800 ${mod.text} tracking-wider`}>
                    {mod.tag}
                  </span>
                  <span className="text-[10px] font-mono text-slate-500 uppercase">{mod.category}</span>
                </div>

                <h3 className="text-xl font-bold text-white mb-3 group-hover:text-cyan-300 transition flex items-center justify-between">
                  {mod.title}
                  <span className="opacity-0 group-hover:opacity-100 transition text-cyan-400 transform -translate-x-2 group-hover:translate-x-0 font-mono text-lg">
                    &rarr;
                  </span>
                </h3>

                <p className="text-slate-400 text-xs sm:text-sm leading-relaxed mb-6">
                  {mod.desc}
                </p>
              </div>

              <div className="pt-4 border-t border-slate-800/60 flex items-center justify-between text-xs font-mono font-bold">
                <span className="text-slate-500 group-hover:text-slate-300 transition flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                  READY
                </span>
                <span className="text-cyan-400 group-hover:underline flex items-center gap-1">
                  LAUNCH MODULE &rarr;
                </span>
              </div>
            </Link>
          ))}
        </div>

        {filteredModules.length === 0 && (
          <div className="text-center py-24 bg-slate-900/40 rounded-2xl border border-slate-800 mt-6 backdrop-blur-xl">
            <p className="text-slate-400 text-sm font-mono mb-4">No enterprise modules matching &quot;{searchTerm}&quot;</p>
            <button 
              onClick={() => { setSearchTerm(""); setSelectedTab("All"); }}
              className="px-6 py-3 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl text-xs font-bold transition shadow-lg shadow-cyan-600/30 uppercase tracking-wider"
            >
              Reset Filters
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

