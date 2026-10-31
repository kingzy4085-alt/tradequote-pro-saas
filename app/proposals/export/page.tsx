'use client';

export default function ProposalExportPage() {
  return (
    <main className="p-8 max-w-4xl mx-auto bg-white text-black min-h-screen">
      <div className="flex justify-between items-center border-b pb-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold">TRADEQUOTE PRO</h1>
          <p className="text-sm text-gray-600">Industrial & Commercial Electrical Contracting</p>
        </div>
        <div className="text-right">
          <h2 className="text-xl font-semibold">PROJECT PROPOSAL</h2>
          <p className="text-sm text-gray-500">Date: {new Date().toISOString().split('T')[0]}</p>
        </div>
      </div>
      <div className="mb-6">
        <h3 className="font-bold text-lg mb-2">Scope of Work</h3>
        <p className="text-gray-700 whitespace-pre-line">Reviewing itemized project requirements and safety compliance standards for industrial operations.</p>
      </div>
      <div className="mt-8 flex justify-end gap-4">
        <button onClick={() => window.print()} className="bg-black text-white px-4 py-2 rounded hover:bg-gray-800 cursor-pointer">Print / Save PDF</button>
      </div>
    </main>
  );
}
