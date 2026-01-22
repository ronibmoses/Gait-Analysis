// We avoid ESM imports for TFJS in this browser-only build to prevent
// "does not provide an export named 'Pose'" errors caused by dependencies.
// Instead, we load UMD scripts dynamically.

const TF_SCRIPT = "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.17.0/dist/tf.min.js";
const POSE_DETECTION_SCRIPT = "https://cdn.jsdelivr.net/npm/@tensorflow-models/pose-detection@2.1.3/dist/pose-detection.min.js";

declare global {
  interface Window {
    tf: any;
    poseDetection: any;
  }
}

interface TFAnalysisResult {
  stepCount: number;
  cadence: number;
  confidenceScore: number;
}

export const analyzeGaitTF = async (
    videoFile: File, 
    onProgress?: (percent: number) => void
): Promise<TFAnalysisResult> => {
  
  // Load TFJS first, then Pose Detection
  if (!window.tf) {
      await loadScript(TF_SCRIPT);
  }
  if (!window.poseDetection) {
      await loadScript(POSE_DETECTION_SCRIPT);
  }

  // Ensure backend is ready
  await window.tf.ready();

  const MOVENET_CONFIG = {
    modelType: window.poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
    enableSmoothing: true
  };

  const detector = await window.poseDetection.createDetector(
      window.poseDetection.SupportedModels.MoveNet, 
      MOVENET_CONFIG
  );

  return new Promise((resolve, reject) => {
    const videoUrl = URL.createObjectURL(videoFile);
    const videoElement = document.createElement('video');
    videoElement.src = videoUrl;
    videoElement.muted = true;
    videoElement.playsInline = true;
    videoElement.style.display = 'none'; 
    document.body.appendChild(videoElement);

    // Data containers
    const leftAnkleY: number[] = [];
    const rightAnkleY: number[] = [];
    const timestamps: number[] = [];

    const runAnalysis = async () => {
      try {
        await new Promise((r) => {
            if (videoElement.readyState >= 1) r(null);
            else videoElement.onloadedmetadata = () => r(null);
        });

        const duration = videoElement.duration;
        const analyzeDuration = Math.min(duration, 180); 
        
        // Use 30fps
        const interval = 1 / 30;
        let currentTime = 0;
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

            // Pass the video element to the detector
            const poses = await detector.estimatePoses(videoElement);
            
            if (poses.length > 0) {
                const keypoints = poses[0].keypoints;
                const left = keypoints.find((k: any) => k.name === 'left_ankle');
                const right = keypoints.find((k: any) => k.name === 'right_ankle');

                if (left && right && (left.score || 0) > 0.3 && (right.score || 0) > 0.3) {
                     leftAnkleY.push(left.y);
                     rightAnkleY.push(right.y);
                } else {
                     leftAnkleY.push(leftAnkleY.length > 0 ? leftAnkleY[leftAnkleY.length-1] : 0);
                     rightAnkleY.push(rightAnkleY.length > 0 ? rightAnkleY[rightAnkleY.length-1] : 0);
                }
                timestamps.push(currentTime);
            }

            currentTime += interval;
            framesProcessed++;
            
            if (onProgress && framesProcessed % 10 === 0) {
                 onProgress(Math.round((currentTime / analyzeDuration) * 100));
                 await new Promise(r => setTimeout(r, 0));
            }
        }

        detector.dispose();
        document.body.removeChild(videoElement);
        URL.revokeObjectURL(videoUrl);

        // --- ANALYSIS LOGIC: VERTICAL OSCILLATION ---
        const leftSteps = countValleys(leftAnkleY, timestamps);
        const rightSteps = countValleys(rightAnkleY, timestamps);
        
        const totalSteps = leftSteps + rightSteps;
        
        const durationMin = analyzeDuration / 60;
        const cadence = durationMin > 0 ? Math.round(totalSteps / durationMin) : 0;
        const confidence = (leftAnkleY.filter(y => y > 0).length / leftAnkleY.length);

        resolve({
            stepCount: totalSteps,
            cadence,
            confidenceScore: confidence
        });

      } catch (err) {
        reject(err);
      }
    };

    runAnalysis();
    videoElement.onerror = (e) => reject(new Error("Failed to load video for TF analysis"));
  });
};

function countValleys(data: number[], times: number[]): number {
    const smoothed = movingAverage(data, 5);
    let valleys = 0;
    let lastValleyTime = -1;
    // Reduced to 0.25 (240spm) to allow for festination.
    const minStepTime = 0.25; 

    // Dynamic Threshold based on range
    const minVal = Math.min(...smoothed);
    const maxVal = Math.max(...smoothed);
    const range = maxVal - minVal;
    
    // Adjusted Threshold for NPH/Shuffling: 
    // Increased from 0.55 to 0.65.
    // In magnetic gait, feet barely leave the floor (minVal is close to maxVal).
    // By increasing this factor, we are saying "Anything that isn't the absolute bottom 35% of the curve is considered a lift".
    // This makes the detector much more sensitive to slight lifts.
    const threshold = minVal + (range * 0.65); 
    
    // Also cross-check with mean to ensure it's a significant dip
    const mean = smoothed.reduce((a,b)=>a+b,0)/smoothed.length;
    
    for(let i=1; i<smoothed.length-1; i++) {
        // Local minimum (valley) in Y coordinates = Physical Peak Height
        if (smoothed[i] < smoothed[i-1] && smoothed[i] < smoothed[i+1]) {
            // Must be "higher" (lower Y) than average AND within the top ~65% range of movement
            if (smoothed[i] < mean && smoothed[i] < threshold) {
                if (lastValleyTime === -1 || (times[i] - lastValleyTime > minStepTime)) {
                    valleys++;
                    lastValleyTime = times[i];
                }
            }
        }
    }
    return valleys;
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