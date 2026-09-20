import prisma from '@/lib/db';
import { verifySession } from '@/lib/auth/session';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import FinalizeButton from './FinalizeButton';
import EditableSheetsTable from './EditableSheetsTable';

export default async function BatchDashboard({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await verifySession();
  if (!session) redirect('/login');

  const batch = await prisma.batch.findFirst({
    where: { id: id, professor_id: session.professorId },
    include: {
      answer_sheets: true,
      pdf_uploads: true,
    }
  });

  if (!batch) redirect('/batches');

  // Calculate stats
  const totalSheets = batch.answer_sheets.length;
  const processing = batch.answer_sheets.filter(s => s.status === 'processing').length;
  const needsReview = batch.answer_sheets.filter(s => s.status === 'needs_review').length;
  const failed = batch.answer_sheets.filter(s => s.status === 'failed').length;
  const autoApproved = batch.answer_sheets.filter(s => s.status === 'auto_approved').length;
  const manual = batch.answer_sheets.filter(s => s.status === 'manual').length;
  const reviewed = batch.answer_sheets.filter(s => s.status === 'reviewed').length;
  
  const requiresReview = needsReview + failed;
  const isProcessing = processing > 0 || batch.pdf_uploads.some(p => p.status === 'processing' || p.status === 'split');
  const canFinalize = !isProcessing && requiresReview === 0 && totalSheets > 0;
  const isApproved = batch.status === 'approved' || batch.status === 'exported';

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">
              {batch.declared_subject_code} - {batch.declared_subject_name}
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Course Batch: {batch.declared_course_batch} | Status: <span className="font-semibold text-blue-600">{batch.status.replace(/_/g, ' ')}</span>
            </p>
          </div>
          <Link
            href="/batches"
            className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
          >
            Back to Batches
          </Link>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
            <h3 className="text-sm font-medium text-gray-500">Total Sheets</h3>
            <p className="mt-1 text-2xl font-semibold text-gray-900">{totalSheets}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-4 border border-blue-200">
            <h3 className="text-sm font-medium text-blue-600">Processing</h3>
            <p className="mt-1 text-2xl font-semibold text-blue-900">{processing}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-4 border border-yellow-200">
            <h3 className="text-sm font-medium text-yellow-600">Needs Review / Failed</h3>
            <p className="mt-1 text-2xl font-semibold text-yellow-900">{requiresReview}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-4 border border-green-200">
            <h3 className="text-sm font-medium text-green-600">Approved / Reviewed</h3>
            <p className="mt-1 text-2xl font-semibold text-green-900">{autoApproved + manual + reviewed}</p>
          </div>
        </div>

        {/* Actions */}
        <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
          <div className="px-4 py-5 sm:p-6 space-y-4">
            <h3 className="text-lg font-medium leading-6 text-gray-900">Actions</h3>
            
            <div className="flex flex-col sm:flex-row gap-4">
              <Link
                href={`/batches/${batch.id}/upload`}
                className={`inline-flex justify-center items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 ${isApproved ? 'opacity-50 pointer-events-none' : ''}`}
              >
                Upload More Sheets
              </Link>
              
              {requiresReview > 0 && (
                <Link
                  href={`/batches/${batch.id}/review`}
                  className="inline-flex justify-center items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-yellow-600 hover:bg-yellow-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-yellow-500"
                >
                  Review {requiresReview} Flagged Sheets
                </Link>
              )}
              
              {!isApproved && (
                <FinalizeButton 
                  batchId={batch.id} 
                  disabled={!canFinalize} 
                />
              )}

              {isApproved && (
                <div className="flex items-center gap-4">
                  <a
                    href={`http://localhost:8000/api/export/${batch.id}`}
                    className="inline-flex justify-center items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Download Excel
                  </a>
                  {batch.status === 'approved' && (
                    <span className="text-sm text-amber-600 font-medium">
                      Edited since last download (or ready for first download)
                    </span>
                  )}
                </div>
              )}
            </div>
            {!canFinalize && !isApproved && totalSheets > 0 && (
              <p className="text-sm text-red-500 mt-2">
                Cannot finalize: {requiresReview} sheets need review, {isProcessing} processing.
              </p>
            )}
          </div>
        </div>

        {/* Editable Table */}
        {isApproved && (
          <EditableSheetsTable
            batchId={batch.id}
            sheets={batch.answer_sheets.map(sheet => ({
              ...sheet,
              total_marks: sheet.total_marks ? Number(sheet.total_marks) : null
            }))}
            subjectCode={batch.declared_subject_code}
            subjectName={batch.declared_subject_name}
          />
        )}

      </div>
    </div>
  );
}
