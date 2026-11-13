"use client";

import { useState } from "react";

export default function EstimateCalculator() {
  // 1. Crew & Shift Labor Matrix
  const [journeymanHours, setJourneymanHours] = useState<number>(40);
  const [apprenticeHours, setApprenticeHours] = useState<number>(40);
  const [jmRate, setJmRate] = useState<number>(65);
  const [appRate, setAppRate] = useState<number>(42);
  const [shiftMultiplier, setShiftMultiplier] = useState<number>(1.0);
  const [nptFactor, setNptFactor] = useState<number>(1.15); // LOTO / Safety tailgates

  // 2. Assemblies & Heavy Material Modules
  const [teckCableFootage, setTeckCableFootage] = useState<number>(500); // 3C #2 Teck90
  const [motorHookups, setMotorHookups] = useState<number>(4); // 9/12 lead industrial motors
  const [conduitRuns, setConduitRuns] = useState<number>(200); // Rigid conduit

  // 3. Industrial Job Direct Costs (Equipment, Testing, Permits)
  const [liftRentalCost, setLiftRentalCost] = useState<number>(1800); // Scissor/Boom lift for height
  const [meggerTestingFee, setMeggerTestingFee] = useState<number>(600); // Insulation resistance testing
  const [permitFee, setPermitFee] = useState<number>(350); // TSASK / Provincial regulatory fee

  // 4. Risk & Margin
  const [contingencyPct, setContingencyPct] = useState<number>(10);
  const [marginPct, setMarginPct] = useState<number>(25);
  const [applyGst, setApplyGst] = useState<boolean>(true); // 5% GST (SK)

  // --- CALCULATIONS ---
  const baseLaborCost = (journeymanHours * jmRate) + (apprenticeHours * appRate);
  const adjustedLaborCost = baseLaborCost * shiftMultiplier * nptFactor;
  const materialCost = (teckCableFootage * 18.50) + (motorHookups * 450) + (conduitRuns * 12.00);
  const industrialOverheadCost = liftRentalCost + meggerTestingFee + permitFee;

  const subtotal = adjustedLaborCost + materialCost + industrialOverheadCost;
  const contingencyCost = subtotal * (contingencyPct / 100);
  const totalCost = subtotal + contingencyCost;
  
  const finalPriceBeforeTax = marginPct >= 100 ? totalCost : totalCost / (1 - marginPct / 100);
  const gstAmount = applyGst ? finalPriceBeforeTax * 0.05 : 0;
  const finalPriceWithGst = finalPriceBeforeTax + gstAmount;
  const netProfit = finalPriceBeforeTax - totalCost;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 text-slate-100 shadow-2xl max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-6 pb-4 border-b border-slate-800">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-amber-400">Industrial Estimating Engine (Pro Edition)</h2>
          <p className="text-sm text-slate-400">Multi-shift labor burns, LOTO NPT factors, heavy equipment, and TSASK compliance.</p>
        </div>
        <div className="text-right">
          <span className="text-xs uppercase tracking-wider text-slate-400 block">Proposal Total (Incl. GST)</span>
          <span className="text-3xl font-extrabold text-emerald-400">${finalPriceWithGst.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} CAD</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="space-y-6">
          {/* Labor Matrix */}
          <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 space-y-4">
            <h3 className="font-semibold text-amber-300 text-sm uppercase tracking-wider">1. Crew & Shift Labor Matrix</h3>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Journeyman Hours</label>
                <input type="number" value={journeymanHours} onChange={(e) => setJourneymanHours(Number(e.target.value))} className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white focus:outline-none focus:border-amber-400" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Jm Rate ($/hr)</label>
                <input type="number" value={jmRate} onChange={(e) => setJmRate(Number(e.target.value))} className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white focus:outline-none focus:border-amber-400" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Apprentice Hours</label>
                <input type="number" value={apprenticeHours} onChange={(e) => setApprenticeHours(Number(e.target.value))} className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white focus:outline-none focus:border-amber-400" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">App Rate ($/hr)</label>
                <input type="number" value={appRate} onChange={(e) => setAppRate(Number(e.target.value))} className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white focus:outline-none focus:border-amber-400" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 pt-2">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Shift Multiplier</label>
                <select value={shiftMultiplier} onChange={(e) => setShiftMultiplier(Number(e.target.value))} className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white focus:outline-none focus:border-amber-400">
                  <option value={1.0}>Standard Day Shift (1.0x)</option>
                  <option value={1.35}>Night Shift Premium (1.35x)</option>
                  <option value={1.5}>Overtime / Shutdown Rush (1.5x)</option>
                  <option value={2.0}>Stat Holiday / Emergency (2.0x)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Non-Productive Time (NPT)</label>
                <select value={nptFactor} onChange={(e) => setNptFactor(Number(e.target.value))} className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white focus:outline-none focus:border-amber-400">
                  <option value={1.10}>Low Risk Plant (10% NPT)</option>
                  <option value={1.15}>Shutdown / LOTO Heavy (15% NPT)</option>
                  <option value={1.25}>Complex Hazardous Site (25% NPT)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Assemblies & Material */}
          <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 space-y-4">
            <h3 className="font-semibold text-amber-300 text-sm uppercase tracking-wider">2. Assemblies & Material</h3>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Teck Cable Run (Linear Feet)</label>
              <input type="number" value={teckCableFootage} onChange={(e) => setTeckCableFootage(Number(e.target.value))} className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white focus:outline-none focus:border-amber-400" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Motor Hookups (9/12 Lead)</label>
                <input type="number" value={motorHookups} onChange={(e) => setMotorHookups(Number(e.target.value))} className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white focus:outline-none focus:border-amber-400" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Rigid Conduit (Feet)</label>
                <input type="number" value={conduitRuns} onChange={(e) => setConduitRuns(Number(e.target.value))} className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white focus:outline-none focus:border-amber-400" />
              </div>
            </div>
          </div>

          {/* Industrial Equipment & Testing Allowances */}
          <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 space-y-4">
            <h3 className="font-semibold text-amber-300 text-sm uppercase tracking-wider">3. Equipment, Testing & Permits</h3>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Lift Rental ($)</label>
                <input type="number" value={liftRentalCost} onChange={(e) => setLiftRentalCost(Number(e.target.value))} className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white focus:outline-none focus:border-amber-400 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Megger Test ($)</label>
                <input type="number" value={meggerTestingFee} onChange={(e) => setMeggerTestingFee(Number(e.target.value))} className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white focus:outline-none focus:border-amber-400 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">TSASK Permit ($)</label>
                <input type="number" value={permitFee} onChange={(e) => setPermitFee(Number(e.target.value))} className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white focus:outline-none focus:border-amber-400 text-sm" />
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Job-Costing & Profit Summary */}
        <div className="space-y-6 flex flex-col justify-between">
          <div className="bg-slate-950 p-6 rounded-lg border border-slate-800 space-y-5">
            <h3 className="font-semibold text-amber-300 text-sm uppercase tracking-wider border-b border-slate-800 pb-3">4. Job-Costing & Profit Summary</h3>
            
            <div className="space-y-2.5 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-400">Adjusted Labor (Shift + NPT):</span>
                <span className="font-mono font-medium">${adjustedLaborCost.toLocaleString('en-CA', { maximumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Material & Assemblies:</span>
                <span className="font-mono font-medium">${materialCost.toLocaleString('en-CA', { maximumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Equipment & Testing:</span>
                <span className="font-mono font-medium">${industrialOverheadCost.toLocaleString('en-CA', { maximumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between pt-2 border-t border-slate-800">
                <span className="text-slate-300 font-semibold">Direct Job Cost:</span>
                <span className="font-mono font-bold text-slate-200">${subtotal.toLocaleString('en-CA', { maximumFractionDigits: 2 })}</span>
              </div>

              <div className="grid grid-cols-2 gap-4 pt-4 border-t border-slate-800">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Contingency (%)</label>
                  <input type="number" value={contingencyPct} onChange={(e) => setContingencyPct(Number(e.target.value))} className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-1 text-sm text-white" />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Target Margin (%)</label>
                  <input type="number" value={marginPct} onChange={(e) => setMarginPct(Number(e.target.value))} className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-1 text-sm text-emerald-400 font-bold" />
                </div>
              </div>

              <div className="flex justify-between items-center pt-2">
                <span className="text-xs text-slate-400">Include 5% GST (SK Tax):</span>
                <input type="checkbox" checked={applyGst} onChange={(e) => setApplyGst(e.target.checked)} className="rounded bg-slate-900 border-slate-700 text-amber-500 focus:ring-0" />
              </div>

              <div className="flex justify-between pt-3 text-emerald-400 font-semibold border-t border-slate-800">
                <span>Projected Net Profit:</span>
                <span className="font-mono">${netProfit.toLocaleString('en-CA', { maximumFractionDigits: 2 })}</span>
              </div>
            </div>
          </div>

          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 text-amber-300 text-xs leading-relaxed">
            <strong className="block font-semibold mb-1">TradeQuote PRO Industrial Guarantee:</strong>
            Calculations include LOTO safety factors, insulation resistance testing allowances, and TSASK provincial compliance locking your gross margins against market inflation.
          </div>
        </div>
      </div>
    </div>
  );
}
