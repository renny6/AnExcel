'use client';

import { useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import heic2any from 'heic2any';
import imageCompression from 'browser-image-compression';
import * as pdfjsLib from 'pdfjs-dist';

// pdfjs worker setup
if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
}

type FileStatus = 'pending' | 'processing' | 'uploading' | 'done' | 'error';

interface UploadItem {
  id: string;
  originalFile: File;
  status: FileStatus;
  progress: number;
  errorMessage?: string;
  hash?: string;
}

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB
const MAX_BATCH_SIZE = 100;
const MAX_PDF_PAGES = 100;

export default function UploadPage() {
  const params = useParams();
  const router = useRouter();
  const batchId = params.id as string;

  const [items, setItems] = useState<UploadItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  const handleFiles = useCallback((files: FileList | File[]) => {
    const newItems: UploadItem[] = [];
    const filesArray = Array.from(files);

    // Enforce 100 limit globally
    setItems((prev) => {
      const remainingSlots = MAX_BATCH_SIZE - prev.length;
      if (remainingSlots <= 0) return prev; // totally full

      const allowedFiles = filesArray.slice(0, remainingSlots);
      
      allowedFiles.forEach(file => {
        const item: UploadItem = {
          id: Math.random().toString(36).substring(7),
          originalFile: file,
          status: 'pending',
          progress: 0,
        };

        // Immediate size check
        if (file.size > MAX_FILE_SIZE) {
          item.status = 'error';
          item.errorMessage = 'Exceeds 20MB limit';
        }

        newItems.push(item);
      });

      const updated = [...prev, ...newItems];
      // Automatically start processing the pending ones
      setTimeout(() => processQueue(updated), 0);
      return updated;
    });
  }, []);

  const computeHash = async (blob: Blob): Promise<string> => {
    const arrayBuffer = await blob.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  };

  const processQueue = async (currentItems: UploadItem[]) => {
    // Find first pending item
    const pendingItem = currentItems.find(i => i.status === 'pending');
    if (!pendingItem) return; // Done

    updateItem(pendingItem.id, { status: 'processing', progress: 10 });

    try {
      let finalBlob: Blob = pendingItem.originalFile;
      let fileType = pendingItem.originalFile.type;
      let fileName = pendingItem.originalFile.name;

      // 1. PDF Page check
      if (fileType === 'application/pdf') {
        const arrayBuffer = await pendingItem.originalFile.arrayBuffer();
        const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
        if (pdf.numPages > MAX_PDF_PAGES) {
          throw new Error(`PDF exceeds ${MAX_PDF_PAGES} pages`);
        }
      } 
      // 2. Image Pipeline
      else if (fileType.startsWith('image/')) {
        // HEIC Conversion
        if (fileName.toLowerCase().endsWith('.heic') || fileName.toLowerCase().endsWith('.heif')) {
          const converted = await heic2any({
            blob: pendingItem.originalFile,
            toType: 'image/jpeg',
          });
          finalBlob = Array.isArray(converted) ? converted[0] : converted;
          fileType = 'image/jpeg';
          fileName = fileName.replace(/\.heic$/i, '.jpeg');
        }

        // Hash before compression
        const hash = await computeHash(finalBlob);
        updateItem(pendingItem.id, { hash, progress: 30 });

        // Compression
        const compressedFile = await imageCompression(new File([finalBlob], fileName, { type: fileType }), {
          maxWidthOrHeight: 2000,
          initialQuality: 0.8,
          useWebWorker: true,
        });
        finalBlob = compressedFile;
      }

      // Hash if not already hashed (PDFs)
      const finalHash = pendingItem.hash || await computeHash(finalBlob);
      updateItem(pendingItem.id, { progress: 50, status: 'uploading' });

      // 3. Presign
      const presignRes = await fetch(`/api/batches/${batchId}/upload/presign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName,
          fileType,
          fileSize: finalBlob.size, // Size after compression
          fileHash: finalHash
        }),
      });

      const presignData = await presignRes.json();
      if (!presignRes.ok) throw new Error(presignData.error || 'Presign failed');

      if (presignData.duplicate) {
        updateItem(pendingItem.id, { status: 'done', progress: 100 });
      } else {
        // 4. PUT to MinIO
        const putRes = await fetch(presignData.presignedUrl, {
          method: 'PUT',
          headers: { 'Content-Type': fileType },
          body: finalBlob,
        });

        if (!putRes.ok) throw new Error('Upload to storage failed');

        updateItem(pendingItem.id, { progress: 90 });

        // 5. Finalize
        const finRes = await fetch(`/api/batches/${batchId}/upload/finalize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            storageKey: presignData.storageKey,
            fileName,
            fileType,
          })
        });

        const finData = await finRes.json();
        if (!finRes.ok) throw new Error(finData.error || 'Finalization failed');

        updateItem(pendingItem.id, { status: 'done', progress: 100 });
      }

    } catch (err: any) {
      updateItem(pendingItem.id, { 
        status: 'error', 
        errorMessage: err.message || 'Unknown error' 
      });
    }

    // Process next recursively via state
    setItems(prev => {
      setTimeout(() => processQueue(prev), 0);
      return prev;
    });
  };

  const updateItem = (id: string, updates: Partial<UploadItem>) => {
    setItems(prev => prev.map(item => item.id === id ? { ...item, ...updates } : item));
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const onDragLeave = () => setIsDragging(false);
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) handleFiles(e.dataTransfer.files);
  };

  const triggerSelect = () => {
    document.getElementById('file-input')?.click();
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Upload Answer Sheets</h1>
            <p className="text-sm text-gray-500 mt-1">Upload images or PDFs (max 100 pages). Max 20MB per file.</p>
          </div>
          <button
            onClick={() => router.push('/batches')}
            className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
          >
            Done
          </button>
        </div>

        <div 
          className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
            isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-white hover:border-gray-400'
          }`}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <input 
            type="file" 
            id="file-input"
            multiple 
            accept="image/jpeg,image/png,image/heic,application/pdf"
            className="hidden" 
            onChange={(e) => { if (e.target.files) handleFiles(e.target.files); }} 
          />
          <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
          <h3 className="mt-2 text-sm font-medium text-gray-900">Drag files here</h3>
          <p className="mt-1 text-xs text-gray-500">or</p>
          <button onClick={triggerSelect} className="mt-2 inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500">
            Select Files
          </button>
        </div>

        {items.length > 0 && (
          <div className="mt-8 bg-white shadow sm:rounded-md border border-gray-200">
            <ul className="divide-y divide-gray-200">
              {items.map(item => (
                <li key={item.id} className="px-4 py-4 sm:px-6 flex items-center justify-between">
                  <div className="flex-1 truncate pr-4">
                    <p className="text-sm font-medium text-gray-900 truncate">{item.originalFile.name}</p>
                    {item.status === 'error' ? (
                      <p className="text-sm text-red-600 font-medium mt-1">{item.errorMessage}</p>
                    ) : (
                      <div className="w-full bg-gray-200 rounded-full h-2 mt-2 max-w-md">
                        <div 
                          className={`h-2 rounded-full ${item.status === 'done' ? 'bg-blue-500' : 'bg-blue-400'}`}
                          style={{ width: `${item.progress}%` }}
                        ></div>
                      </div>
                    )}
                  </div>
                  <div className="ml-4 flex-shrink-0">
                    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                      item.status === 'done' ? 'bg-blue-100 text-blue-800' : 
                      item.status === 'error' ? 'bg-red-100 text-red-800' : 
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {item.status === 'done' ? 'Uploaded' : item.status}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
