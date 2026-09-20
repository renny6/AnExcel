import prisma from '@/lib/db';
import { verifySession } from '@/lib/auth/session';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export default async function BatchesDashboard() {
  const session = await verifySession();
  if (!session) redirect('/login');

  const batches = await prisma.batch.findMany({
    where: { professor_id: session.professorId },
    orderBy: { created_at: 'desc' },
  });

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-2xl font-semibold text-gray-900">Your Batches</h1>
          <Link
            href="/batches/new"
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            + Create New Batch
          </Link>
        </div>

        <div className="bg-white shadow overflow-hidden sm:rounded-md border border-gray-200">
          {batches.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              No batches found. Create your first batch to start uploading answer sheets.
            </div>
          ) : (
            <ul className="divide-y divide-gray-200">
              {batches.map((batch) => (
                <li key={batch.id}>
                  <div className="px-4 py-4 sm:px-6 hover:bg-gray-50 transition-colors">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-blue-600 truncate">
                        <Link href={`/batches/${batch.id}`} className="hover:underline">
                          {batch.declared_subject_code} - {batch.declared_subject_name}
                        </Link>
                      </p>
                      <div className="ml-2 flex-shrink-0 flex">
                        <p className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-gray-100 text-gray-800">
                          {batch.status.replace(/_/g, ' ')}
                        </p>
                      </div>
                    </div>
                    <div className="mt-2 sm:flex sm:justify-between">
                      <div className="sm:flex">
                        <p className="flex items-center text-sm text-gray-500">
                          {batch.declared_course_batch}
                        </p>
                      </div>
                      <div className="mt-2 flex items-center text-sm text-gray-500 sm:mt-0">
                        <p>
                          Created {new Date(batch.created_at).toLocaleDateString()}
                        </p>
                        <Link
                          href={`/batches/${batch.id}/upload`}
                          className="ml-4 text-blue-600 hover:text-blue-900 font-medium"
                        >
                          Upload Sheets &rarr;
                        </Link>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
