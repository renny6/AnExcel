'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';

export default function ReviewQueuePage() {
  const params = useParams();
  const router = useRouter();
  const batchId = params.id as string;

  const [sheets, setSheets] = useState<any[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form State
  const [regNumber, setRegNumber] = useState('');
  const [questions, setQuestions] = useState<any[]>([]);

  useEffect(() => {
    fetchSheets();
  }, [batchId]);

  const fetchSheets = async () => {
    try {
      const res = await fetch(`/api/batches/${batchId}/review`);
      if (!res.ok) throw new Error('Failed to fetch review sheets');
      const data = await res.json();
      setSheets(data.sheets || []);
      if (data.sheets && data.sheets.length > 0) {
        initForm(data.sheets[0]);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const initForm = (sheet: any) => {
    setRegNumber(sheet.register_number || '');
    // If failed, no questions will exist, so we initialize empty ones
    if (sheet.status === 'failed' || !sheet.question_marks || sheet.question_marks.length === 0) {
      const defaultQuestions = [];
      for (let i = 1; i <= 10; i++) {
        defaultQuestions.push({ question_no: i.toString(), sub_part: 'a', marks: 0, tick_state: true });
        defaultQuestions.push({ question_no: i.toString(), sub_part: 'b', marks: 0, tick_state: true });
      }
      setQuestions(defaultQuestions);
    } else {
      setQuestions(sheet.question_marks.map((q: any) => ({ ...q })));
    }
  };

  const handleNext = () => {
    if (currentIndex < sheets.length - 1) {
      const nextIndex = currentIndex + 1;
      setCurrentIndex(nextIndex);
      initForm(sheets[nextIndex]);
    } else {
      router.push(`/batches/${batchId}`);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const sheet = sheets[currentIndex];
      const totalMarks = questions.reduce((sum, q) => sum + Number(q.marks), 0);

      const res = await fetch(`/api/sheets/${sheet.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          register_number: regNumber,
          total_marks: totalMarks,
          questions: questions
        }),
      });

      if (!res.ok) throw new Error('Failed to save corrections');
      handleNext();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const updateQuestion = (index: number, field: string, value: any) => {
    const newQs = [...questions];
    newQs[index] = { ...newQs[index], [field]: value };
    setQuestions(newQs);
  };

  if (loading) return <div className="p-12 text-center">Loading review queue...</div>;
  if (error) return <div className="p-12 text-center text-red-600">Error: {error}</div>;
  
  if (sheets.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-2xl font-bold mb-4">No sheets require review!</h2>
          <Link href={`/batches/${batchId}`} className="text-blue-600 hover:underline">Return to Batch Dashboard</Link>
        </div>
      </div>
    );
  }

  const currentSheet = sheets[currentIndex];
  const isFailed = currentSheet.status === 'failed';

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <h1 className="text-xl font-semibold">Review Queue ({currentIndex + 1} of {sheets.length})</h1>
          <Link href={`/batches/${batchId}`} className="text-gray-500 hover:text-gray-700">Exit Review</Link>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {isFailed && (
          <div className="mb-4 bg-red-50 p-4 border border-red-200 rounded-md">
            <h3 className="text-red-800 font-medium">Failed Extraction</h3>
            <p className="text-red-600 text-sm">This sheet failed processing. Please enter all data manually from the full image below.</p>
          </div>
        )}

        <div className="flex flex-col lg:flex-row gap-8">
          {/* Left Side: Image */}
          <div className="lg:w-1/2 bg-white p-4 rounded-lg shadow-sm border border-gray-200 overflow-hidden flex flex-col">
            <h3 className="text-lg font-medium mb-4">Source Image</h3>
            <div className="flex-1 overflow-auto bg-gray-100 rounded border border-gray-300 relative min-h-[600px]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img 
                src={currentSheet.presignedUrl} 
                alt="Answer Sheet" 
                className="w-full h-auto object-contain"
                style={{ maxHeight: 'none' }}
              />
            </div>
          </div>

          {/* Right Side: Form */}
          <div className="lg:w-1/2 bg-white p-6 rounded-lg shadow-sm border border-gray-200">
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Register Number</label>
                <input 
                  type="text" 
                  value={regNumber} 
                  onChange={(e) => setRegNumber(e.target.value)}
                  className="w-full border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 p-2"
                  required
                />
              </div>

              <div className="space-y-4">
                <h4 className="font-medium text-gray-900 border-b pb-2">Marks</h4>
                <div className="grid grid-cols-2 gap-4 max-h-[500px] overflow-y-auto pr-2">
                  {questions.map((q, idx) => (
                    <div key={`${q.question_no}_${q.sub_part}`} className="p-3 bg-gray-50 rounded border border-gray-200 flex items-center justify-between">
                      <label className="text-sm font-medium text-gray-700 w-12">
                        {q.question_no}{q.sub_part}
                      </label>
                      <input 
                        type="number"
                        min="0"
                        step="0.5"
                        value={q.marks}
                        onChange={(e) => updateQuestion(idx, 'marks', parseFloat(e.target.value) || 0)}
                        className="w-20 border border-gray-300 rounded shadow-sm text-sm p-1 text-center"
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-4 border-t flex justify-end gap-4">
                <button 
                  type="button" 
                  onClick={handleNext}
                  className="px-4 py-2 border border-gray-300 rounded text-sm text-gray-700 hover:bg-gray-50"
                >
                  Skip for now
                </button>
                <button 
                  type="submit" 
                  disabled={submitting}
                  className={`px-4 py-2 border border-transparent rounded text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 ${submitting ? 'opacity-50' : ''}`}
                >
                  {submitting ? 'Saving...' : 'Save & Next'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
