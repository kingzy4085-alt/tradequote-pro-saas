"use client";

import { useState, useEffect } from "react";

export default function ClientPortalPage() {
  const [proposals, setProposals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/proposals")
      .then((res) => res.json())
      .then((data) => {
        setProposals(data.data || []);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });
  }, []);

  const handleApprove = async (id: string) => {
    try {
      const res = await fetch(`/api/proposals/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "Approved" })
      });
      if (res.ok) {
        setProposals(proposals.map(p => p.id === id ? { ...p, status: "Approved" } : p));
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-8">
      <h1 className="text-3xl font-bold mb-6">Client Portal — Proposal Approvals</h1>
      {loading ? <p>Loading...</p> : (
        <div className="space-y-4">
          {proposals.map((proposal) => (
            <div key={proposal.id} className="bg-slate-900 border border-slate-800 p-6 rounded-lg">
              <h2 className="text-xl font-bold">{proposal.project_name}</h2>
              <p className="text-slate-400">Client: {proposal.client_name}</p>
              <p className="text-slate-400">Status: {proposal.status}</p>
              <p className="text-slate-400">Amount: ${proposal.amount}</p>
              {proposal.status !== "Approved" && (
                <button 
                  onClick={() => handleApprove(proposal.id)}
                  className="mt-4 bg-green-600 hover:bg-green-500 text-white py-2 px-4 rounded"
                >
                  Approve Proposal
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
