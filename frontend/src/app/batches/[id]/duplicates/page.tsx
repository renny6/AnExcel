'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';

export default function DuplicateResolutionPage() {
  const params = useParams();
  const router = useRouter();
  const batchId = params.id as string;

  const [groupedDuplicates, setGroupedDuplicates] = useState<Record<string, any[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDuplicates();
  }, [batchId]);

  const fetchDuplicates = async () => {
    try {
      const res = await fetch(`/api/batches/${batchId}/duplicates`);
      if (!res.ok) throw new Error('Failed to fetch duplicates');
      const data = await res.json();
      setGroupedDuplicates(data.duplicates || {});
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (sheetId: string) => {
    if (!confirm('Are you sure you want to delete this duplicate sheet completely? This action cannot be undone.')) return;
    try {
      const res = await fetch(`/api/sheets/${sheetId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete sheet');
      await fetchDuplicates();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleChangeRegister = async (sheetId: string, currentReg: string) => {
    const newReg = prompt('Enter the correct register number for this sheet:', currentReg);
    if (newReg && newReg !== currentReg) {
      try {
        const res = await fetch(`/api/sheets/${sheetId}/register`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ register_number: newReg })
        });
        if (!res.ok) throw new Error('Failed to update register number');
        await fetchDuplicates();
      } catch (err: any) {
        alert(err.message);
      }
    }
  };

  if (loading) return <div className="p-12 text-center">Loading duplicates...</div>;
  if (error) return <div className="p-12 text-center text-red-600">Error: {error}</div>;

  const keys = Object.keys(groupedDuplicates);
  if (keys.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8 text-center">
        <h2 className="text-2xl font-bold mb-4 text-green-600">No duplicates found!</h2>
        <Link href={`/batches/${batchId}`} className="px-4 py-2 bg-blue-600 text-white rounded-md inline-block mt-4">
          Return to Batch Dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto space-y-8">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-semibold text-red-600">Duplicate Register Numbers Detected</h1>
          <Link href={`/batches/${batchId}`} className="text-gray-500 hover:text-gray-700">Back to Dashboard</Link>
        </div>
        <p className="text-gray-600">The following sheets share the same register number. Please review the images to determine if one was misread, or if a physical page was scanned twice. You must delete the duplicate or correct the register number.</p>

        {keys.map(regNumber => (
          <div key={regNumber} className="bg-white shadow rounded-lg p-6 border border-red-200">
            <h2 className="text-xl font-bold mb-4">Register Number: {regNumber}</h2>
            <div className="flex flex-col lg:flex-row gap-6 overflow-x-auto">
              {groupedDuplicates[regNumber].map((sheet, index) => (
                <div key={sheet.id} className="flex-1 min-w-[300px] border border-gray-200 rounded-md p-4 bg-gray-50 flex flex-col">
                  <h3 className="font-semibold mb-2 text-gray-700">Sheet {index + 1}</h3>
                  <div className="flex-1 bg-white border border-gray-300 rounded overflow-hidden min-h-[400px] mb-4 relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img 
                      src={sheet.presignedUrl} 
                      alt="Duplicate Sheet" 
                      className="w-full h-auto object-contain absolute top-0"
                    />
                  </div>
                  <div className="mt-auto space-y-3">
                    <button 
                      onClick={() => handleChangeRegister(sheet.id, sheet.register_number)}
                      className="w-full px-4 py-2 border border-gray-300 rounded shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                    >
                      Change Register Number
                    </button>
                    <button 
                      onClick={() => handleDelete(sheet.id)}
                      className="w-full px-4 py-2 border border-transparent rounded shadow-sm text-sm font-medium text-white bg-red-600 hover:bg-red-700"
                    >
                      Delete / Ignore this Sheet
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
