import { GaitMetrics } from '../types';

const MP_POSE_SCRIPT = "https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/pose.js";
const LEFT_ANKLE = 27;
const RIGHT_ANKLE = 28;
// Restored to 30 FPS for high-precision gait analysis as requested.
const PROCESSING_FPS = 30; 

declare global {
  interface Window {
    Pose: any;
  }
}

interface CVAnalysisResult {
  stepCount: number;
  cadence: number;
  meanStepInterval: number;
  stepTimeVariability: number;
}

export const analyzeGaitCV = async (
    videoFile: File, 
    onProgress?: (percent: number) => void
): Promise<CVAnalysisResult> => {
  
  if (!window.Pose) {
    await loadScript(MP_POSE_SCRIPT);
  }

  return new Promise((resolve, reject) => {
    const videoUrl = URL.createObjectURL(videoFile);
    const videoElement = document.createElement('video');
    videoElement.src = videoUrl;
    videoElement.muted = true;
    videoElement.playsInline = true;
    videoElement.style.display = 'none'; 
    document.body.appendChild(videoElement);

    let pose: any;
    try {
        pose = new window.Pose({
            locateFile: (file: string) => {
                return `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/${file}`;
            },
        });
    } catch (e) {
        reject(e);
        return;
    }

    pose.setOptions({
      modelComplexity: 1, // Use 1 (Full) for better accuracy at 30fps
      smoothLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    const ankleDistances: number[] = [];
    const timestamps: number[] = [];
    
    pose.onResults((results: any) => {
      if (results.poseLandmarks) {
        const left = results.poseLandmarks[LEFT_ANKLE];
        const right = results.poseLandmarks[RIGHT_ANKLE];

        if (left && right && left.visibility > 0.5 && right.visibility > 0.5) {
            const dx = left.x - right.x;
            const dy = left.y - right.y;
            const dist = Math.sqrt(dx*dx + dy*dy);
            ankleDistances.push(dist);
            timestamps.push(videoElement.currentTime);
        } else {
            ankleDistances.push(ankleDistances.length > 0 ? ankleDistances[ankleDistances.length - 1] : 0);
            timestamps.push(videoElement.currentTime);
        }
      } else {
         ankleDistances.push(ankleDistances.length > 0 ? ankleDistances[ankleDistances.length - 1] : 0);
         timestamps.push(videoElement.currentTime);
      }
    });

    const runAnalysis = async () => {
      try {
        await new Promise((r) => {
            if (videoElement.readyState >= 1) r(null);
            else videoElement.onloadedmetadata = () => r(null);
        });

        const duration = videoElement.duration;
        // Limit processing duration if video is extremely long to prevent crashes
        const analyzeDuration = Math.min(duration, 180); 
        
        const interval = 1 / PROCESSING_FPS;
        let currentTime = 0;
        
        // Progress reporting interval
        const reportInterval = 5; 
        let framesProcessed = 0;

        while (currentTime < analyzeDuration) {
            videoElement.currentTime = currentTime;
            
            await new Promise((r) => {
                const onSeeked = () => {
                    videoElement.removeEventListener('seeked', onSeeked);
                    r(null);
                };
                videoElement.addEventListener('seeked', onSeeked);
            });

            await pose.send({ image: videoElement });

            currentTime += interval;
            framesProcessed++;
            
            if (onProgress && framesProcessed % reportInterval === 0) {
                 onProgress(Math.round((currentTime / analyzeDuration) * 100));
                 // Small yield to UI thread to allow rendering the progress bar
                 await new Promise(r => setTimeout(r, 0));
            }
        }

        document.body.removeChild(videoElement);
        URL.revokeObjectURL(videoUrl);
        pose.close();

        // Analysis
        const smoothed = movingAverage(ankleDistances, 5);
        const peaks = findPeaks(smoothed, timestamps);

        const stepCount = peaks.length;
        const durationMin = analyzeDuration / 60;
        const cadence = durationMin > 0 ? Math.round(stepCount / durationMin) : 0;

        let intervals: number[] = [];
        for(let i = 1; i < peaks.length; i++) {
            intervals.push(peaks[i].time - peaks[i-1].time);
        }

        const meanStepInterval = intervals.length > 0 
            ? intervals.reduce((a,b) => a+b, 0) / intervals.length 
            : 0;

        const variance = intervals.length > 0
            ? intervals.reduce((a, b) => a + Math.pow(b - meanStepInterval, 2), 0) / intervals.length
            : 0;
        const stepTimeVariability = Math.sqrt(variance) * 1000;

        resolve({
            stepCount,
            cadence,
            meanStepInterval,
            stepTimeVariability: Math.round(stepTimeVariability)
        });

      } catch (err) {
        reject(err);
      }
    };

    runAnalysis();
    
    videoElement.onerror = (e) => reject(new Error("Failed to load video for CV analysis"));
  });
};

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
        resolve();
        return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.crossOrigin = "anonymous";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.body.appendChild(script);
  });
}

function movingAverage(data: number[], window: number) {
    let result = [];
    for(let i=0; i<data.length; i++) {
        let sum = 0;
        let count = 0;
        for(let j=Math.max(0, i-window+1); j<=i; j++) {
            sum += data[j];
            count++;
        }
        result.push(sum/count);
    }
    return result;
}

function findPeaks(data: number[], times: number[]) {
    const threshold = 0.08; 
    let peaks = [];
    
    for(let i=1; i<data.length-1; i++) {
        if(data[i] > data[i-1] && data[i] > data[i+1]) {
            if(data[i] > threshold) {
                if (peaks.length === 0 || (times[i] - peaks[peaks.length-1].time > 0.3)) {
                    peaks.push({ val: data[i], time: times[i] });
                }
            }
        }
    }
    return peaks;
}
