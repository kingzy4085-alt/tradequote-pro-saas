"use client";

import React from "react";

interface ProposalExportProps {
  projectName: string;
  clientName: string;
  estimateData: {
    journeymanHours: number;
    apprenticeHours: number;
    shiftMultiplier: number;
    nptFactor: number;
    teckCableFootage: number;
    motorHookups: number;
    conduitRuns: number;
    liftRentalCost: number;
    meggerTestingFee: number;
    permitFee: number;
    subtotal: number;
    contingencyCost: number;
    finalPriceWithGst: number;
    gstAmount: number;
    netProfit: number;
  };
}

export default function ExportProposalPdf({ projectName, clientName, estimateData }: ProposalExportProps) {
  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-end print:hidden">
        <button
          onClick={handlePrint}
          className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold px-6 py-2.5 rounded-lg text-sm transition-all shadow-lg flex items-center gap-2"
        >
          🖨️ Export / Print Formal Proposal (PDF)
        </button>
      </div>

      {/* Printable Proposal Document Container */}
      <div className="bg-white text-slate-900 p-8 lg:p-12 rounded-xl shadow-2xl max-w-4xl mx-auto print:shadow-none print:p-0 print:w-full">
        {/* Header */}
        <div className="flex justify-between items-start border-b-2 border-slate-900 pb-6 mb-8">
          <div>
            <h1 className="text-3xl font-black tracking-tight text-slate-950">TRADEQUOTE PRO</h1>
            <p className="text-sm font-medium text-slate-600 mt-1">Industrial Shutdown & Electrical Contracting Operations Hub</p>
            <p className="text-xs text-slate-500 mt-0.5">Western Canada Regional Operations • TSASK Compliant</p>
          </div>
          <div className="text-right">
            <span className="inline-block bg-slate-900 text-amber-400 text-xs font-bold px-3 py-1 rounded uppercase tracking-wider mb-2">
              Official Bid Proposal
            </span>
            <p className="text-xs text-slate-600 font-mono">Date: {new Date().toLocaleDateString()}</p>
            <p className="text-xs text-slate-600 font-mono">Valid Until: 30 Days</p>
          </div>
        </div>

        {/* Client & Project Details */}
        <div className="grid grid-cols-2 gap-8 mb-8 bg-slate-50 p-6 rounded-lg border border-slate-200">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">Prepared For (Client):</h3>
            <p className="text-lg font-bold text-slate-900">{clientName || "Cargill Ltd. (Canola Crushing Facility)"}</p>
            <p className="text-sm text-slate-600">Attn: Plant Maintenance & Electrical Engineering Dept.</p>
            <p className="text-sm text-slate-600">Moose Jaw Region, SK</p>
          </div>
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">Project Scope:</h3>
            <p className="text-lg font-bold text-slate-900">{projectName || "Industrial Shutdown Maintenance & Motor Hookups"}</p>
            <p className="text-sm text-slate-600">Execution Schedule: Monday – Thursday Shift Schedule</p>
          </div>
        </div>

        {/* Cost Breakdown Table */}
        <div className="mb-8">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900 mb-4 border-b border-slate-300 pb-2">
            Detailed Scope & Cost Breakdown
          </h3>
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-300 text-slate-600 uppercase text-xs">
                <th className="py-2.5 font-semibold">Line Item Description</th>
                <th className="py-2.5 font-semibold text-right">Units / Details</th>
                <th className="py-2.5 font-semibold text-right">Extended Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-slate-800 font-mono">
              <tr>
                <td className="py-3 font-sans font-medium">Crew Labor (Journeyman & Apprentice Burn w/ Shift & LOTO NPT)</td>
                <td className="py-3 text-right">Multi-Shift Matrix</td>
                <td className="py-3 text-right">${(estimateData?.subtotal * 0.35 || 4922).toLocaleString('en-CA', { maximumFractionDigits: 2 })}</td>
              </tr>
              <tr>
                <td className="py-3 font-sans font-medium">Assemblies & Material (Teck90 Cable, Motor Hookups, Rigid Conduit)</td>
                <td className="py-3 text-right">Industrial Grade</td>
                <td className="py-3 text-right">${(estimateData?.subtotal * 0.55 || 13450).toLocaleString('en-CA', { maximumFractionDigits: 2 })}</td>
              </tr>
              <tr>
                <td className="py-3 font-sans font-medium">Equipment Rentals, Insulation Megger Testing & TSASK Permits</td>
                <td className="py-3 text-right">Allowances</td>
                <td className="py-3 text-right">${(estimateData?.subtotal * 0.10 || 2750).toLocaleString('en-CA', { maximumFractionDigits: 2 })}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Totals & Tax Box */}
        <div className="flex justify-end mb-12">
          <div className="w-72 space-y-2 text-sm font-mono bg-slate-50 p-4 rounded-lg border border-slate-200">
            <div className="flex justify-between text-slate-600">
              <span>Subtotal:</span>
              <span>${(estimateData?.subtotal || 21122).toLocaleString('en-CA', { maximumFractionDigits: 2 })}</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>GST (5% SK Tax):</span>
              <span>${(estimateData?.gstAmount || 1548.99).toLocaleString('en-CA', { maximumFractionDigits: 2 })}</span>
            </div>
            <div className="flex justify-between text-slate-950 font-bold text-base pt-2 border-t border-slate-300">
              <span>Total Proposal:</span>
              <span>${(estimateData?.finalPriceWithGst || 32527.88).toLocaleString('en-CA', { maximumFractionDigits: 2 })} CAD</span>
            </div>
          </div>
        </div>

        {/* Regulatory & Terms Footer */}
        <div className="border-t border-slate-300 pt-6 space-y-4 text-xs text-slate-600">
          <div>
            <h4 className="font-bold text-slate-900 uppercase tracking-wider mb-1">Canadian Electrical Code & Safety Compliance</h4>
            <p>All work executed strictly in accordance with the Canadian Electrical Code (CEC) and provincial safety standards. Includes mandatory lock-out/tag-out (LOTO) safety protocols and insulation resistance (Megger) testing documentation.</p>
          </div>
          <div>
            <h4 className="font-bold text-slate-900 uppercase tracking-wider mb-1">Scope Exclusions</h4>
            <p>Proposal excludes core drilling, hazardous classification upgrades beyond specified zones, and structural asbestos abatement unless explicitly noted.</p>
          </div>
          <div className="pt-6 flex justify-between items-end">
            <div>
              <p className="font-bold text-slate-900">Authorized Signature:</p>
              <div className="h-12 border-b border-slate-400 w-48 mt-2"></div>
            </div>
            <div className="text-right">
              <p className="font-bold text-slate-900">TradeQuote PRO SaaS</p>
              <p className="text-slate-500">www.tradequotepro.com</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
