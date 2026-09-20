'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Sheet = {
  id: string;
  register_number: string | null;
  total_marks: any; // Decimal comes back as string/number
  status: string;
};

export default function EditableSheetsTable({
  batchId,
  sheets: initialSheets,
  subjectCode,
  subjectName,
}: {
  batchId: string;
  sheets: Sheet[];
  subjectCode: string;
  subjectName: string;
}) {
  const [sheets, setSheets] = useState(initialSheets);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ register_number: string; total_marks: string }>({
    register_number: '',
    total_marks: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleEditClick = (sheet: Sheet) => {
    setEditingId(sheet.id);
    setEditForm({
      register_number: sheet.register_number || '',
      total_marks: sheet.total_marks?.toString() || '',
    });
    setError(null);
  };

  const handleCancel = () => {
    setEditingId(null);
    setError(null);
  };

  const handleSave = async (sheetId: string) => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/sheets/${sheetId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batch_id: batchId,
          register_number: editForm.register_number.trim() || null,
          total_marks: editForm.total_marks.trim() ? parseFloat(editForm.total_marks) : null,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to save changes');
        setLoading(false);
        return;
      }

      // Update local state
      setSheets((prev) =>
        prev.map((s) =>
          s.id === sheetId
            ? { ...s, register_number: data.sheet.register_number, total_marks: data.sheet.total_marks }
            : s
        )
      );
      setEditingId(null);
      // Trigger a server refresh so the parent page knows status might have downgraded
      router.refresh();
    } catch (err: any) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-8 bg-white shadow rounded-lg border border-gray-200 overflow-hidden">
      <div className="px-4 py-5 sm:px-6 bg-gray-50 border-b border-gray-200">
        <h3 className="text-lg leading-6 font-medium text-gray-900">
          Batch Export Data
        </h3>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          {subjectCode} - {subjectName}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Register Number
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Total Marks
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {sheets.map((sheet) => (
              <tr key={sheet.id}>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {editingId === sheet.id ? (
                    <input
                      type="text"
                      value={editForm.register_number}
                      onChange={(e) => setEditForm({ ...editForm, register_number: e.target.value })}
                      className="border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    />
                  ) : (
                    sheet.register_number || <span className="text-gray-400 italic">Empty</span>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {editingId === sheet.id ? (
                    <input
                      type="number"
                      step="0.5"
                      value={editForm.total_marks}
                      onChange={(e) => setEditForm({ ...editForm, total_marks: e.target.value })}
                      className="border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm w-24"
                    />
                  ) : (
                    sheet.total_marks !== null ? Number(sheet.total_marks) : <span className="text-gray-400 italic">Empty</span>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {sheet.status.replace(/_/g, ' ')}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  {editingId === sheet.id ? (
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => handleSave(sheet.id)}
                        disabled={loading}
                        className="text-green-600 hover:text-green-900 disabled:opacity-50"
                      >
                        Save
                      </button>
                      <button
                        onClick={handleCancel}
                        disabled={loading}
                        className="text-gray-500 hover:text-gray-700 disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => handleEditClick(sheet)}
                      className="text-blue-600 hover:text-blue-900"
                    >
                      Edit
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {sheets.length === 0 && (
              <tr>
                <td colSpan={4} className="px-6 py-4 text-center text-sm text-gray-500">
                  No sheets available.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {error && (
        <div className="px-4 py-3 bg-red-50 border-t border-red-200">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}
    </div>
  );
}
