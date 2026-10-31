"use client";

import { useState } from "react";

export default function EstimatesPage() {
  const [projectName, setProjectName] = useState("");
  const [clientName, setClientName] = useState("");
  const [markup, setMarkup] = useState(15);
  const [lineItems, setLineItems] = useState([
    { description: "Industrial Feeder Cable (AWG 3)", quantity: 100, unitCost: 8.50, type: "material" },
    { description: "Lead Electrician Labor", quantity: 16, unitCost: 95.00, type: "labor" }
  ]);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const addItem = () => {
    setLineItems([...lineItems, { description: "", quantity: 1, unitCost: 0, type: "material" }]);
  };

  const updateItem = (index: number, field: string, value: any) => {
    const updated = [...lineItems];
  // @ts-ignore
    updated[index][field] = value;
    setLineItems(updated);
  };

  const removeItem = (index: number) => {
    setLineItems(lineItems.filter((_, i) => i !== index));
  };

  const calculateEstimate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/estimates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectName, clientName, lineItems, markupPercentage: markup })
      });
      const data = await res.json();
      setResult(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const currentSubtotal = lineItems.reduce((acc, item) => acc + (Number(item.quantity) * Number(item.unitCost)), 0);
  const currentMarkupAmount = currentSubtotal * (markup / 100);
  const currentTotal = currentSubtotal + currentMarkupAmount;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">TradeQuote PRO — Estimating Calculator</h1>
        <p className="text-slate-400 mb-8">Build precise quotes with live material pricing and labor markup calculations.</p>

        <form onSubmit={calculateEstimate} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Project Name</label>
              <input 
                type="text" 
                value={projectName} 
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="e.g., Cargill Canola Plant Shutdown - Panel Upgrades"
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500"
                required 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Client Name</label>
              <input 
                type="text" 
                value={clientName} 
                onChange={(e) => setClientName(e.target.value)}
                placeholder="e.g., Cargill Ltd."
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500"
                required 
              />
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold">Line Items</h2>
              <button 
                type="button" 
                onClick={addItem}
                className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition"
              >
                + Add Item
              </button>
            </div>

            <div className="space-y-4">
              {lineItems.map((item, idx) => (
                <div key={idx} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center bg-slate-950 p-4 rounded-lg border border-slate-800">
                  <div className="md:col-span-5">
                    <input 
                      type="text" 
                      value={item.description} 
                      onChange={(e) => updateItem(idx, "description", e.target.value)}
                      placeholder="Description"
                      className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-sm text-white"
                      required
                    />
                  </div>
                  <div className="md:col-span-2">
                    <input 
                      type="number" 
                      value={item.quantity} 
                      onChange={(e) => updateItem(idx, "quantity", Number(e.target.value))}
                      placeholder="Qty"
                      className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-sm text-white"
                      min="1"
                      required
                    />
                  </div>
                  <div className="md:col-span-2">
                    <input 
                      type="number" 
                      step="0.01"
                      value={item.unitCost} 
                      onChange={(e) => updateItem(idx, "unitCost", Number(e.target.value))}
                      placeholder="Unit Cost ($)"
                      className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-sm text-white"
                      required
                    />
                  </div>
                  <div className="md:col-span-2 text-right font-mono text-slate-300">
                    ${(item.quantity * item.unitCost).toFixed(2)}
                  </div>
                  <div className="md:col-span-1 text-center">
                    <button 
                      type="button" 
                      onClick={() => removeItem(idx)}
                      className="text-red-400 hover:text-red-300 text-sm font-bold px-2 py-1"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col md:flex-row justify-between items-center gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Contractor Markup (%)</label>
              <input 
                type="number" 
                value={markup} 
                onChange={(e) => setMarkup(Number(e.target.value))}
                className="bg-slate-950 border border-slate-800 rounded p-2 w-32 text-white font-mono"
                min="0"
                max="100"
              />
            </div>
            <div className="text-right space-y-1">
              <div className="text-sm text-slate-400">Subtotal: <span className="font-mono text-white">${currentSubtotal.toFixed(2)}</span></div>
              <div className="text-sm text-slate-400">Markup ({markup}%): <span className="font-mono text-white">${currentMarkupAmount.toFixed(2)}</span></div>
              <div className="text-2xl font-bold text-emerald-400">Total: ${currentTotal.toFixed(2)}</div>
            </div>
          </div>

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 rounded-xl transition"
          >
            {loading ? "Saving Estimate..." : "Save & Generate Estimate"}
          </button>
        </form>

        {result && (
          <div className="mt-8 bg-slate-900 border border-emerald-500/50 rounded-xl p-6">
            <h3 className="text-lg font-bold text-emerald-400 mb-2">Estimate Saved Successfully!</h3>
            <pre className="bg-slate-950 p-4 rounded text-xs text-slate-300 overflow-x-auto font-mono">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
