'use client';

import React, { useState } from 'react';

export interface Assembly {
  id: string;
  name: string;
  description: string;
  laborHours: number;
  materialCost: number;
  category: string;
}

const standardAssemblies: Assembly[] = [
  { id: 'asm-01', name: 'Industrial Motor Connection (9-Lead)', description: 'Terminate and test 9-lead dual-voltage motor including peckerhead makeup and Megger testing.', laborHours: 2.5, materialCost: 45.00, category: 'Industrial Motors' },
  { id: 'asm-02', name: '4-20mA Instrument Loop', description: 'Run shielded twisted pair, terminate, and test 4-20mA current loop to PLC cabinet.', laborHours: 1.5, materialCost: 30.00, category: 'Instrumentation' },
  { id: 'asm-03', name: 'Transformer Bank (Delta-Wye)', description: 'Set, wire, and test 3-phase delta-wye transformer bank. Includes primary/secondary lug terminations.', laborHours: 8.0, materialCost: 1250.00, category: 'Power Distribution' },
];

interface Props {
  onSelectAssembly: (assembly: Assembly) => void;
}

export default function SavedAssembliesLibrary({ onSelectAssembly }: Props) {
  const [searchTerm, setSearchTerm] = useState('');

  const filtered = standardAssemblies.filter(a =>
    a.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    a.category.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="bg-slate-900 p-4 rounded-xl shadow-sm border border-slate-800">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold text-slate-100">Saved Assemblies</h3>
        <span className="bg-blue-900/40 text-blue-400 border border-blue-800/50 text-xs font-medium px-2.5 py-0.5 rounded-full">
          {standardAssemblies.length} Items
        </span>
      </div>
      
      <input
        type="text"
        placeholder="Search standard scope (e.g., motor, 4-20mA)..."
        className="w-full p-2 bg-slate-950 border border-slate-800 text-slate-200 rounded-lg mb-4 focus:ring-2 focus:ring-blue-500 focus:outline-none placeholder:text-slate-600"
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
      />
      
      <div className="space-y-3 max-h-96 overflow-y-auto pr-2 custom-scrollbar">
        {filtered.map(assembly => (
          <div key={assembly.id} className="p-3 bg-slate-950 border border-slate-800 rounded-lg hover:border-blue-500/50 hover:bg-slate-900 flex justify-between items-center transition-all group">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h4 className="font-medium text-slate-200 text-sm">{assembly.name}</h4>
                <span className="text-[10px] uppercase tracking-wider text-slate-400 bg-slate-800 px-2 py-0.5 rounded">
                  {assembly.category}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1 line-clamp-2">{assembly.description}</p>
              <div className="text-xs font-medium text-slate-400 mt-2 flex gap-4">
                <span className="flex items-center gap-1">
                  <svg className="w-3 h-3 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  {assembly.laborHours} hrs
                </span>
                <span className="flex items-center gap-1">
                  <svg className="w-3 h-3 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  $
                </span>
              </div>
            </div>
            <button
              onClick={() => onSelectAssembly(assembly)}
              className="opacity-0 group-hover:opacity-100 ml-4 bg-blue-600 text-white px-3 py-1.5 rounded-md text-sm hover:bg-blue-500 transition-all font-medium whitespace-nowrap focus:opacity-100"
            >
              + Add
            </button>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="text-slate-500 text-sm text-center py-8 bg-slate-950 rounded-lg border border-dashed border-slate-800">
            No standard assemblies found matching "{searchTerm}".
          </div>
        )}
      </div>
    </div>
  );
}
