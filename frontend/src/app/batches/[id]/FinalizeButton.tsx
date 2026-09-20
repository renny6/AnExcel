'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function FinalizeButton({ batchId, disabled }: { batchId: string, disabled: boolean }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleFinalize = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/batches/${batchId}/finalize`, {
        method: 'POST',
      });
      const data = await res.json();
      
      if (!res.ok) {
        if (res.status === 409) {
          // Duplicates detected
          router.push(`/batches/${batchId}/duplicates`);
        } else {
          setError(data.error || 'Failed to finalize batch');
        }
      } else {
        router.refresh();
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="inline-flex flex-col">
      <button
        onClick={handleFinalize}
        disabled={disabled || loading}
        className={`inline-flex justify-center items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 ${(disabled || loading) ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        {loading ? 'Finalizing...' : 'Approve & Finalize Batch'}
      </button>
      {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
    </div>
  );
}
