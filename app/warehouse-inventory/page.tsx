"use client";

import { useState } from "react";

export default function WarehouseInventoryPage() {
  const [itemName, setItemName] = useState("3/C #2/0 AWG TECK90 Cable Connector (Aluminum)");
  const [partNumber, setPartNumber] = useState("TTC-20-AL");
  const [binLocation, setBinLocation] = useState("Bin 412-B");
  const [quantityInStock, setQuantityInStock] = useState(38);
  const [minThreshold, setMinThreshold] = useState(15);
  const [unitCost, setUnitCost] = useState(42.50);
  const [warehouseLocation, setWarehouseLocation] = useState("Moose Jaw Main Warehouse");
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/warehouse-inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemName, partNumber, binLocation, quantityInStock, minThreshold, unitCost, warehouseLocation })
      });
      const data = await res.json();
      setResult(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">TradeQuote PRO — Material Inventory & Warehouse Stock</h1>
        <p className="text-slate-400 mb-8">Manage warehouse stock levels, bin locations, reorder thresholds, and unit material costs.</p>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Item Description / Name</label>
              <input 
                type="text" 
                value={itemName} 
                onChange={(e) => setItemName(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500"
                required 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Part Number / SKU</label>
              <input 
                type="text" 
                value={partNumber} 
                onChange={(e) => setPartNumber(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white font-mono text-sm focus:outline-none focus:border-blue-500"
                required 
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Bin Location</label>
              <input 
                type="text" 
                value={binLocation} 
                onChange={(e) => setBinLocation(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white font-mono text-sm focus:outline-none focus:border-blue-500"
                required 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Quantity in Stock</label>
              <input 
                type="number" 
                value={quantityInStock} 
                onChange={(e) => setQuantityInStock(Number(e.target.value))}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white font-mono text-sm focus:outline-none focus:border-blue-500"
                required 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Min Threshold (Reorder)</label>
              <input 
                type="number" 
                value={minThreshold} 
                onChange={(e) => setMinThreshold(Number(e.target.value))}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white font-mono text-sm focus:outline-none focus:border-blue-500"
                required 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Unit Cost ($)</label>
              <input 
                type="number" 
                step="0.01"
                value={unitCost} 
                onChange={(e) => setUnitCost(Number(e.target.value))}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white font-mono text-sm focus:outline-none focus:border-blue-500"
                required 
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Warehouse Facility / Location</label>
            <input 
              type="text" 
              value={warehouseLocation} 
              onChange={(e) => setWarehouseLocation(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-white text-sm focus:outline-none focus:border-blue-500"
              required 
            />
          </div>

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-amber-600 hover:bg-amber-500 text-white font-semibold py-3 rounded-xl transition"
          >
            {loading ? "Saving Inventory Item..." : "Save Warehouse Inventory Record"}
          </button>
        </form>

        {result && (
          <div className="mt-8 bg-slate-900 border border-amber-500/50 rounded-xl p-6">
            <h3 className="text-lg font-bold text-amber-400 mb-2">Inventory Item Saved Successfully!</h3>
            <pre className="bg-slate-950 p-4 rounded text-xs text-slate-300 overflow-x-auto font-mono">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
