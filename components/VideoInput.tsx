import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from './Button';

interface VideoInputProps {
  onVideoReady: (file: File) => void;
  onBack: () => void;
}

export const VideoInput: React.FC<VideoInputProps> = ({ onVideoReady, onBack }) => {
  const [mode, setMode] = useState<'upload' | 'record'>('upload');
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [recordedChunks, setRecordedChunks] = useState<Blob[]>([]);
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);

  // Clean up URL object
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      if (timerRef.current) window.clearInterval(timerRef.current);
      stopStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  };

  const startCamera = async () => {
    try {
      // Request 30 FPS explicitly for gait analysis
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { 
          width: { ideal: 1280 }, 
          height: { ideal: 720 },
          frameRate: { ideal: 30, min: 30 } 
        },
        audio: false
      });
      
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      setError(null);
    } catch (err) {
      console.error(err);
      setError("Could not access camera. Please check permissions and ensure no other app is using it.");
    }
  };

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    if (timerRef.current) window.clearInterval(timerRef.current);
  }, []);

  const startRecording = useCallback(() => {
    if (!streamRef.current) return;

    setRecordedChunks([]);
    setRecordingTime(0);
    setError(null);

    // Increase bitrate for better quality (2.5 Mbps)
    // Note: Larger files (>20MB) may take longer to upload to AI.
    const options: MediaRecorderOptions = {
      mimeType: 'video/webm;codecs=vp8',
      bitsPerSecond: 2500000 
    };

    let mediaRecorder: MediaRecorder;
    try {
      mediaRecorder = new MediaRecorder(streamRef.current, options);
    } catch (e) {
      console.warn("Preferred mimeType/bitrate not supported, falling back to default.", e);
      mediaRecorder = new MediaRecorder(streamRef.current);
    }

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        setRecordedChunks((prev) => [...prev, event.data]);
      }
    };

    mediaRecorder.start(1000); // Slice every second to ensure data availability
    setIsRecording(true);
    mediaRecorderRef.current = mediaRecorder;

    timerRef.current = window.setInterval(() => {
      setRecordingTime(prev => {
        if (prev >= 120) {
          stopRecording();
          return prev;
        }
        return prev + 1;
      });
    }, 1000);
  }, [stopRecording]);

  useEffect(() => {
    if (!isRecording && recordedChunks.length > 0) {
      const blob = new Blob(recordedChunks, { type: 'video/webm' });
      if (recordingTime < 2) { 
         setError("Recording too short. Please record at least a few seconds for analysis.");
         return;
      }
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
      if (videoRef.current) {
        videoRef.current.srcObject = null;
        videoRef.current.src = url;
        videoRef.current.controls = true;
        videoRef.current.play();
      }
      stopStream();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRecording, recordedChunks, recordingTime]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
        if (!file.type.startsWith('video/')) {
            setError("Please upload a valid video file.");
            return;
        }
        // Removed strict 20MB limit check to allow larger files. 
        // Note: Very large files might still fail depending on API constraints, 
        // but we want to allow the attempt.

        const url = URL.createObjectURL(file);
        setPreviewUrl(url);
        setError(null);
    }
  };

  const handleSubmit = async () => {
    if (previewUrl) {
      if (recordedChunks.length > 0) {
         const file = new File([new Blob(recordedChunks, { type: 'video/webm' })], "recording.webm", { type: 'video/webm' });
         onVideoReady(file);
      } else {
        try {
          const response = await fetch(previewUrl);
          const blob = await response.blob();
          const file = new File([blob], "upload.mp4", { type: blob.type });
          onVideoReady(file);
        } catch (e) {
           setError("Failed to process video file.");
        }
      }
    }
  };

  const handleRetake = () => {
    setPreviewUrl(null);
    setRecordedChunks([]);
    setRecordingTime(0);
    if (mode === 'record') {
        startCamera();
    }
  };

  return (
    <div className="max-w-2xl mx-auto bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
      <div className="flex justify-between items-center mb-6">
        <button onClick={onBack} className="text-gray-500 hover:text-gray-700 font-medium text-sm">
          ← Back to Details
        </button>
        <h2 className="text-xl font-bold text-gray-900">Gait Video Source</h2>
      </div>

      <div className="flex space-x-4 mb-6">
        <button
          onClick={() => { setMode('upload'); setPreviewUrl(null); stopStream(); setError(null); }}
          className={`flex-1 py-3 rounded-lg font-medium transition-colors ${
            mode === 'upload' ? 'bg-indigo-50 text-indigo-700 border-2 border-indigo-200' : 'bg-gray-50 text-gray-600 border border-transparent hover:bg-gray-100'
          }`}
        >
          Upload Video
        </button>
        <button
          onClick={() => { setMode('record'); setPreviewUrl(null); startCamera(); setError(null); }}
          className={`flex-1 py-3 rounded-lg font-medium transition-colors ${
            mode === 'record' ? 'bg-indigo-50 text-indigo-700 border-2 border-indigo-200' : 'bg-gray-50 text-gray-600 border border-transparent hover:bg-gray-100'
          }`}
        >
          Record Video
        </button>
      </div>

      <div className="bg-gray-900 rounded-xl overflow-hidden aspect-video relative mb-4 flex items-center justify-center">
        {mode === 'record' && !previewUrl && (
           <video ref={videoRef} className="w-full h-full object-cover transform scale-x-[-1]" muted playsInline />
        )}
        
        {mode === 'upload' && !previewUrl && (
           <div className="text-center p-8">
             <div className="mx-auto h-12 w-12 text-gray-400 mb-3">
               <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
               </svg>
             </div>
             <p className="text-gray-400 mb-2">Click to select or drag video here</p>
             <input 
                type="file" 
                accept="video/*" 
                onChange={handleFileUpload} 
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
             />
             <p className="text-xs text-gray-500">Supports MP4, WebM, MOV</p>
           </div>
        )}

        {previewUrl && (
            <video src={previewUrl} className="w-full h-full object-contain bg-black" controls />
        )}

        {isRecording && (
          <div className="absolute top-4 right-4 bg-red-600 text-white px-3 py-1 rounded-full text-sm font-mono animate-pulse">
             ● {Math.floor(recordingTime / 60)}:{(recordingTime % 60).toString().padStart(2, '0')} / 02:00
          </div>
        )}
      </div>

      {error && (
          <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm flex items-center">
              <span className="mr-2">⚠️</span> {error}
          </div>
      )}

      <div className="mt-6 flex justify-between items-center">
         {mode === 'record' && !previewUrl ? (
            <div className="w-full flex justify-center">
               {!isRecording ? (
                   <button 
                     onClick={startRecording}
                     className="bg-red-600 hover:bg-red-700 text-white w-16 h-16 rounded-full flex items-center justify-center shadow-lg transition-transform hover:scale-105"
                   >
                     <div className="w-6 h-6 bg-white rounded-sm" />
                   </button>
               ) : (
                   <button 
                     onClick={stopRecording}
                     className="bg-gray-800 hover:bg-gray-900 text-white w-16 h-16 rounded-full flex items-center justify-center shadow-lg border-4 border-red-500"
                   >
                      <div className="w-6 h-6 bg-red-500 rounded-sm" />
                   </button>
               )}
            </div>
         ) : (
             <>
               {previewUrl && (
                 <Button variant="secondary" onClick={handleRetake}>
                   {mode === 'record' ? 'Retake' : 'Choose Different File'}
                 </Button>
               )}
               <div className="flex-1" />
               <Button 
                 disabled={!previewUrl} 
                 onClick={handleSubmit}
               >
                 Analyze Gait
               </Button>
             </>
         )}
      </div>
      
      <div className="mt-4 text-xs text-center text-gray-400">
        Recommended: 30-120 seconds of walking.
        <br/>
        Large videos may take longer to analyze.
      </div>
    </div>
  );
};