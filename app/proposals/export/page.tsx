"use client";

import { useState } from "react";

export default function PdfExportPage() {
  const [proposalData, setProposalData] = useState({
    proposalNumber: "TQ-2026-089",
    clientName: "Cargill Ltd.",
    projectName: "Canola Plant Shutdown - Electrical Panel Upgrade",
    date: new Date().toLocaleDateString(),
    items: [
      { description: "Industrial Feeder Cable (AWG 3)", qty: 100, unit: 8.50, total: 850.00 },
      { description: "Lead Electrician Labor (Shutdown Rate)", qty: 16, unit: 95.00, total: 1520.00 },
      { description: "Safety Delineation & Lockout/Tagout Gear", qty: 1, unit: 350.00, total: 350.00 }
    ],
    subtotal: 2720.00,
    markup: 408.00,
    grandTotal: 3128.00,
    terms: "50% deposit required upon acceptance. Net 30 days upon completion.",
    signature: "John Doe (Authorized Representative)"
  });

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-8">
      <div className="max-w-3xl mx-auto">
        <div className="flex justify-between items-center mb-8 print:hidden">
          <div>
            <h1 className="text-2xl font-bold">PDF Proposal Preview</h1>
            <p className="text-slate-400 text-sm">Ready for export or direct client printing.</p>
          </div>
          <button 
            onClick={handlePrint}
            className="bg-blue-600 hover:bg-blue-500 text-white font-semibold px-6 py-2.5 rounded-xl transition shadow-lg"
          >
            Download / Print PDF
          </button>
        </div>

        {/* Printable Document Sheet */}
        <div className="bg-white text-slate-900 p-10 rounded-2xl shadow-2xl print:shadow-none print:p-0 print:w-full">
          <div className="flex justify-between items-start border-b border-slate-200 pb-6 mb-6">
            <div>
              <h2 className="text-3xl font-extrabold tracking-tight text-slate-900">TradeQuote PRO</h2>
              <p className="text-sm text-slate-500">Industrial Electrical & Mechanical Contracting</p>
            </div>
            <div className="text-right">
              <div className="text-sm font-bold text-slate-700">Proposal #{proposalData.proposalNumber}</div>
              <div className="text-xs text-slate-500">Date: {proposalData.date}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6 mb-8 text-sm">
            <div>
              <span className="block text-xs uppercase font-bold text-slate-400 tracking-wider">Prepared For:</span>
              <strong className="text-base text-slate-800">{proposalData.clientName}</strong>
            </div>
            <div>
              <span className="block text-xs uppercase font-bold text-slate-400 tracking-wider">Project:</span>
              <span className="text-slate-700">{proposalData.projectName}</span>
            </div>
          </div>

          <table className="w-full mb-8 text-sm text-left">
            <thead>
              <tr className="border-b border-slate-300 text-slate-600">
                <th className="pb-3 font-semibold">Description</th>
                <th className="pb-3 font-semibold text-center">Qty</th>
                <th className="pb-3 font-semibold text-right">Unit Price</th>
                <th className="pb-3 font-semibold text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {proposalData.items.map((item, idx) => (
                <tr key={idx}>
                  <td className="py-3 text-slate-800">{item.description}</td>
                  <td className="py-3 text-center text-slate-600">{item.qty}</td>
                  <td className="py-3 text-right text-slate-600">${item.unit.toFixed(2)}</td>
                  <td className="py-3 text-right font-mono text-slate-800">${item.total.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="border-t border-slate-200 pt-4 mb-8 flex justify-end">
            <div className="w-64 space-y-2 text-sm">
              <div className="flex justify-between text-slate-600">
                <span>Subtotal:</span>
                <span className="font-mono">${proposalData.subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Contractor Markup (15%):</span>
                <span className="font-mono">${proposalData.markup.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-lg font-bold text-slate-900 border-t border-slate-300 pt-2">
                <span>Grand Total:</span>
                <span className="font-mono text-emerald-600">${proposalData.grandTotal.toFixed(2)}</span>
              </div>
            </div>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-6 text-xs text-slate-600">
            <strong className="block text-slate-700 mb-1">Terms & Conditions:</strong>
            {proposalData.terms}
          </div>

          <div className="border-t border-slate-200 pt-6 flex justify-between items-end">
            <div>
              <span className="block text-xs uppercase font-bold text-slate-400 tracking-wider mb-1">Client Authorization:</span>
              <div className="font-serif italic text-lg text-slate-800 border-b border-slate-400 pb-1 w-64">
                {proposalData.signature}
              </div>
            </div>
            <div className="text-right text-xs text-slate-400">
              Generated via TradeQuote PRO
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
