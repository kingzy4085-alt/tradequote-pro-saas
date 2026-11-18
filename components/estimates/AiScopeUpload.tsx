'use client';

import { useState } from 'react';
import { Loader2, Sparkles, Upload } from 'lucide-react';

interface AiScopeUploadProps {
  onExtracted?: (data: { estimatedLabor: number; estimatedMaterials: number; description: string }) => void;
}

export function AiScopeUpload({ onExtracted }: AiScopeUploadProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/ai/extract-scope', {
        method: 'POST',
        body: formData,
      });

      const json = await res.json();

      if (!json.success) {
        throw new Error(json.error || 'Failed to extract scope from document.');
      }

      if (onExtracted) {
        onExtracted(json.data);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 border border-slate-700 rounded-lg bg-slate-900/50 space-y-3">
      <div className="flex items-center gap-2 text-amber-400 font-medium">
        <Sparkles className="w-5 h-5" />
        <span>AI Scope & Estimate Assistant (Gemini)</span>
      </div>
      <p className="text-xs text-slate-400">
        Upload a client scope document or PDF to automatically extract labor hours, CAD material costs, and description.
      </p>

      <label className="flex items-center justify-center gap-2 px-4 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold rounded-md cursor-pointer transition-colors text-sm">
        {loading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Analyzing Scope...</span>
          </>
        ) : (
          <>
            <Upload className="w-4 h-4" />
            <span>Upload Scope Document</span>
          </>
        )}
        <input
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.txt,.doc,.docx"
          className="hidden"
          onChange={handleFileChange}
          disabled={loading}
        />
      </label>

      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
