"use client";

import { useState } from "react";

export default function AiScopeUpload({ onScopeProcessed }: { onScopeProcessed: (data: any) => void }) {
  const [uploading, setUploading] = useState(false);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setUploading(true);
    
    const formData = new FormData();
    formData.append('file', file);
    
    try {
      const res = await fetch("/api/ai/extract-scope", {
        method: "POST",
        body: formData
      });
      
      const data = await res.json();
      if (data.success) {
        onScopeProcessed(data.data);
      }
    } catch (err) {
      console.error("Failed to process AI scope:", err);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 p-4 rounded-lg mt-4">
      <h3 className="font-semibold text-slate-200 mb-2">AI Scope Analysis</h3>
      <input 
        type="file" 
        onChange={handleFileUpload} 
        disabled={uploading}
        className="w-full bg-slate-950 border border-slate-700 p-2 rounded text-sm text-slate-300"
      />
      {uploading && <p className="text-sm text-amber-500 mt-2 animate-pulse">Analyzing PDF...</p>}
    </div>
  );
}
