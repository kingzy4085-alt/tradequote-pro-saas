'use client';

export default function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="bg-black text-white px-4 py-2 rounded hover:bg-gray-800">
      Print / Save PDF
    </button>
  );
}
