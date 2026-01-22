import React, { useState } from 'react';
import { UserForm } from './components/UserForm';
import { VideoInput } from './components/VideoInput';
import { ResultsView } from './components/ResultsView';
import { UserProfile, GaitMetrics, AppState } from './types';
import { analyzeGaitVideo } from './services/geminiService';
import { analyzeGaitCV } from './services/mediaPipeService';
import { analyzeGaitTF } from './services/tensorFlowService';

const LoadingScreen = ({ progress, status }: { progress: number, status: string }) => (
  <div className="flex flex-col items-center justify-center p-12 bg-white rounded-2xl shadow-sm border border-gray-100 max-w-md mx-auto">
    <div className="w-16 h-16 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mb-6"></div>
    <h3 className="text-xl font-bold text-gray-900 mb-2">Analyzing Gait Pattern</h3>
    
    <div className="w-full bg-gray-200 rounded-full h-2.5 mb-4 max-w-xs mt-4">
      <div className="bg-indigo-600 h-2.5 rounded-full transition-all duration-300" style={{ width: `${progress}%` }}></div>
    </div>
    <p className="text-sm text-gray-500 mb-6">{progress}% Complete</p>

    <div className="text-left space-y-3 mt-4 text-sm text-gray-500 w-full">
        <div className="flex items-center">
            <span className="w-2 h-2 bg-indigo-500 rounded-full mr-2 animate-pulse"></span>
            Gemini AI: Clinical Analysis (Screening for NPH/Pathology)
        </div>
        <div className="flex items-center">
            <span className={`w-2 h-2 rounded-full mr-2 ${status.includes('MediaPipe') ? 'bg-emerald-500 animate-pulse' : 'bg-gray-300'}`}></span>
            MediaPipe: Micro-Step Detection
        </div>
        <div className="flex items-center">
             <span className={`w-2 h-2 rounded-full mr-2 ${status.includes('TensorFlow') ? 'bg-orange-500 animate-pulse' : 'bg-gray-300'}`}></span>
            TensorFlow (MoveNet): Shuffle Detection
        </div>
    </div>
  </div>
);

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>(AppState.FORM);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [results, setResults] = useState<GaitMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [loadingStatus, setLoadingStatus] = useState("Initializing...");

  const handleUserSubmit = (profile: UserProfile) => {
    setUserProfile(profile);
    setAppState(AppState.VIDEO_INPUT);
  };

  const handleVideoReady = async (file: File) => {
    if (!userProfile) return;
    
    setAppState(AppState.ANALYZING);
    setError(null);
    setProgress(0);
    
    try {
      // --- TANDEM ANALYSIS ENGINE ---
      
      // 1. Gemini (Qualitative)
      const geminiPromise = analyzeGaitVideo(file);
      
      // 2. MediaPipe (Quantitative - Separation Method)
      setLoadingStatus("Running MediaPipe & TensorFlow...");
      const cvPromise = analyzeGaitCV(file, userProfile.height, (p) => setProgress(p));

      // 3. TensorFlow (Quantitative - Vertical Method)
      const tfPromise = analyzeGaitTF(file);

      // Wait for all three
      const [geminiMetrics, mpMetrics, tfMetrics] = await Promise.all([geminiPromise, cvPromise, tfPromise]);

      console.log("MediaPipe Count:", mpMetrics.stepCount);
      console.log("TensorFlow Count:", tfMetrics.stepCount);
      console.log("Gemini Count:", geminiMetrics.stepCount);

      // --- CONSENSUS LOGIC (REVISED FOR PATHOLOGY) ---
      
      // In pathological gaits (NPH, Parkinson's), standard algorithms tend to UNDERCOUNT 
      // because steps are shuffles (low amplitude).
      // Therefore, if there is a discrepancy, the engine detecting MORE steps is usually 
      // the one that successfully captured the low-amplitude shuffling.
      
      let bestStepCount = Math.max(mpMetrics.stepCount, tfMetrics.stepCount);
      let usedMethod = mpMetrics.stepCount > tfMetrics.stepCount ? "MediaPipe (Sensitive)" : "TensorFlow (Sensitive)";

      // Recalculate cadence based on the "Best" step count
      const durationMin = mpMetrics.meanStepInterval * mpMetrics.stepCount / 60; // Approximate duration from MP data
      const finalCadence = durationMin > 0 ? Math.round(bestStepCount / durationMin) : mpMetrics.cadence;

      const finalMetrics: GaitMetrics = {
          ...geminiMetrics,
          stepCount: bestStepCount,
          cadence: finalCadence, 
          meanStepInterval: mpMetrics.meanStepInterval,
          stepTimeVariability: mpMetrics.stepTimeVariability,
          averageBaseOfSupportCm: mpMetrics.averageBaseOfSupportCm,
          averageHeelLiftCm: mpMetrics.averageHeelLiftCm, // New metric
          trackedSubjectImage: mpMetrics.trackedFrame,
          analysisSummary: `${geminiMetrics.analysisSummary}\n\n[System Note: Count derived via ${usedMethod}.]`
      };

      setResults(finalMetrics);
      setAppState(AppState.RESULTS);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "An unexpected error occurred during analysis.");
      setAppState(AppState.VIDEO_INPUT);
    }
  };

  const handleReset = () => {
    setResults(null);
    setAppState(AppState.FORM);
    setUserProfile(null);
    setProgress(0);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">Computerized Gait Analysis</h1>
          </div>
          {userProfile && (
             <div className="text-sm font-medium text-gray-500 hidden sm:block">
                Patient: {userProfile.firstName} {userProfile.lastName}
             </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {error && (
            <div className="max-w-2xl mx-auto mb-8 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg flex items-center justify-between">
               <span>{error}</span>
               <button onClick={() => setError(null)} className="font-bold">&times;</button>
            </div>
        )}

        {appState === AppState.FORM && (
          <div className="animate-fade-in-up">
            <UserForm onSubmit={handleUserSubmit} />
          </div>
        )}

        {appState === AppState.VIDEO_INPUT && (
          <div className="animate-fade-in-up">
            <VideoInput 
                onVideoReady={handleVideoReady} 
                onBack={() => setAppState(AppState.FORM)} 
            />
          </div>
        )}

        {appState === AppState.ANALYZING && (
          <div className="animate-fade-in-up">
            <LoadingScreen progress={progress} status={loadingStatus} />
          </div>
        )}

        {appState === AppState.RESULTS && results && userProfile && (
          <div className="animate-fade-in-up">
            <ResultsView 
                metrics={results} 
                user={userProfile} 
                onReset={handleReset} 
            />
          </div>
        )}
      </main>
    </div>
  );
};

export default App;