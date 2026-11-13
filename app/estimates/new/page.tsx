'use client';

import React, { useState } from 'react';
import AiScopeUpload from '@/components/estimates/AiScopeUpload';
import SavedAssembliesLibrary, { Assembly } from '@/components/estimates/saved-assemblies-library';

export default function NewEstimatePage() {
  const [quoteItems, setQuoteItems] = useState<Assembly[]>([]);

  const handleAddAssembly = (assembly: Assembly) => {
    setQuoteItems([...quoteItems, { ...assembly, id: crypto.randomUUID() }]);
  };

  const handleRemoveItem = (idToRemove: string) => {
    setQuoteItems(quoteItems.filter(item => item.id !== idToRemove));
  };

  const totalLabor = quoteItems.reduce((sum, item) => sum + item.laborHours, 0);
  const totalMaterial = quoteItems.reduce((sum, item) => sum + item.materialCost, 0);
  
  const LABOR_RATE = 85.00; 
  const grossTotal = (totalLabor * LABOR_RATE) + totalMaterial;

  return (
    <div className="p-6 max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6 text-slate-200">
      
      {/* Left Column: Active Quote Sheet */}
      <div className="lg:col-span-8 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-white">Build New Estimate</h1>
          <span className="text-sm text-slate-400">Draft Status</span>
        </div>
        
        <div className="bg-slate-900 p-6 rounded-xl shadow-sm border border-slate-800 min-h-[500px]">
          <h2 className="text-lg font-semibold mb-4 border-b border-slate-800 pb-2 text-white">Line Items</h2>
          
          {quoteItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-slate-500 border-2 border-dashed border-slate-800 bg-slate-900/50 rounded-lg">
              <svg className="w-12 h-12 mb-3 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              <p>No items added yet.</p>
              <p className="text-sm mt-1">Select assemblies from the library to build your quote.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {quoteItems.map((item) => (
                <div key={item.id} className="flex justify-between items-center p-4 bg-slate-950 rounded-lg border border-slate-800 group">
                  <div>
                    <p className="font-semibold text-slate-200 text-sm">{item.name}</p>
                    <p className="text-xs text-slate-500 uppercase tracking-wide mt-1">{item.category}</p>
                  </div>
                  <div className="flex items-center gap-6 text-sm">
                    <div className="text-right">
                      <p className="text-slate-400">{item.laborHours} hrs</p>
                      <p className="text-slate-400">$ mat.</p>
                    </div>
                    <button 
                      onClick={() => handleRemoveItem(item.id)}
                      className="text-red-400 hover:text-red-300 opacity-0 group-hover:opacity-100 transition-opacity p-2"
                      title="Remove line item"
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right Column: Library & Summary Engine */}
      <div className="lg:col-span-4 space-y-6">
        
        <AiScopeUpload onScopeProcessed={(data) => console.log(data)} />
        <SavedAssembliesLibrary onSelectAssembly={handleAddAssembly} />
        
        <div className="bg-slate-900 p-6 rounded-xl shadow-sm border border-slate-800 sticky top-6">
          <h2 className="text-lg font-semibold mb-4 text-white">Estimate Summary</h2>
          
          <div className="space-y-3 text-sm border-b border-slate-800 pb-4 mb-4">
            <div className="flex justify-between">
              <span className="text-slate-400">Total Labor:</span> 
              <span className="font-medium text-slate-200">{totalLabor} hrs</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Labor Subtotal (@ $85/hr):</span> 
              <span className="font-medium text-slate-200">$</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Material Subtotal:</span> 
              <span className="font-medium text-slate-200">$</span>
            </div>
          </div>
          
          <div className="flex justify-between items-center text-lg font-bold text-white mb-6">
            <span>Gross Total:</span>
            <span>$</span>
          </div>

          <button 
            className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-500 transition-colors shadow-sm disabled:opacity-50 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed"
            disabled={quoteItems.length === 0}
          >
            Review & Save Estimate
          </button>
        </div>
      </div>

    </div>
  );
}
