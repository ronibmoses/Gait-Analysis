import { GaitMetrics } from '../types';

const MP_POSE_SCRIPT = "https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/pose.js";
const LEFT_HEEL = 29;
const RIGHT_HEEL = 30;
const LEFT_ANKLE = 27;
const RIGHT_ANKLE = 28;
const NOSE = 0;
const LEFT_SHOULDER = 11;
const RIGHT_SHOULDER = 12;
const LEFT_HIP = 23;
const RIGHT_HIP = 24;
const LEFT_KNEE = 25;
const RIGHT_KNEE = 26;

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
  averageBaseOfSupportCm: number;
  averageHeelLiftCm: number; // Added
  trackedFrame?: string;
}

export const analyzeGaitCV = async (
    videoFile: File, 
    userHeightCm: number,
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
      modelComplexity: 1,
      smoothLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    // Data collection
    const rawSignals: { ankleDist: number, shoulderWidth: number, timestamp: number }[] = [];
    const bosMeasurements: number[] = []; 
    // Heel Y coordinates for lift calculation (Y is normalized 0-1, increases downwards)
    const heelData: { leftY: number, rightY: number, noseY: number, timestamp: number }[] = [];
    
    let capturedDebugFrame: string | undefined = undefined;
    const captureFrameIndex = 30; 
    let currentFrameIndex = 0;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    pose.onResults((results: any) => {
      currentFrameIndex++;

      // Debug Frame Capture
      if (!capturedDebugFrame && results.poseLandmarks && currentFrameIndex > captureFrameIndex && ctx) {
          canvas.width = videoElement.videoWidth;
          canvas.height = videoElement.videoHeight;
          ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
          drawSkeleton(ctx, results.poseLandmarks, canvas.width, canvas.height);
          capturedDebugFrame = canvas.toDataURL('image/jpeg');
      }

      if (results.poseLandmarks) {
        const leftAnkle = results.poseLandmarks[LEFT_ANKLE];
        const rightAnkle = results.poseLandmarks[RIGHT_ANKLE];
        const leftHeel = results.poseLandmarks[LEFT_HEEL];
        const rightHeel = results.poseLandmarks[RIGHT_HEEL];
        const leftShoulder = results.poseLandmarks[LEFT_SHOULDER];
        const rightShoulder = results.poseLandmarks[RIGHT_SHOULDER];
        const nose = results.poseLandmarks[NOSE];

        // 1. Separation Data
        if (leftAnkle && rightAnkle && leftShoulder && rightShoulder && 
            leftAnkle.visibility > 0.5 && rightAnkle.visibility > 0.5) {
            
            const dx = leftAnkle.x - rightAnkle.x;
            const dy = leftAnkle.y - rightAnkle.y;
            const ankleDist = Math.sqrt(dx*dx + dy*dy);

            const sx = leftShoulder.x - rightShoulder.x;
            const sy = leftShoulder.y - rightShoulder.y;
            const shoulderWidth = Math.sqrt(sx*sx + sy*sy);

            rawSignals.push({
                ankleDist,
                shoulderWidth: shoulderWidth > 0.01 ? shoulderWidth : 1,
                timestamp: videoElement.currentTime
            });
        } else {
             const prev = rawSignals.length > 0 ? rawSignals[rawSignals.length - 1] : { ankleDist: 0, shoulderWidth: 1, timestamp: videoElement.currentTime };
             rawSignals.push({ ...prev, timestamp: videoElement.currentTime });
        }

        // 2. Base of Support Logic
        if (leftHeel && rightHeel && nose && leftHeel.visibility > 0.5 && rightHeel.visibility > 0.5) {
            const avgHeelY = (leftHeel.y + rightHeel.y) / 2;
            const subjectPixelHeight = Math.abs(avgHeelY - nose.y);
            
            // Collect Heel Data for Lift Calculation
            heelData.push({
                leftY: leftHeel.y,
                rightY: rightHeel.y,
                noseY: nose.y,
                timestamp: videoElement.currentTime
            });

            if (subjectPixelHeight > 0.2) { 
                const cmPerUnit = userHeightCm / subjectPixelHeight;
                const yDiff = Math.abs(leftHeel.y - rightHeel.y);
                // Only measure BOS when feet are aligned vertically (double support phase)
                if (yDiff < 0.03) {
                    const widthUnit = Math.abs(leftHeel.x - rightHeel.x);
                    const widthCm = (widthUnit * cmPerUnit) * 0.85;
                    if (widthCm > 2 && widthCm < 45) {
                        bosMeasurements.push(widthCm);
                    }
                }
            }
        }
      }
    });

    const runAnalysis = async () => {
      try {
        await new Promise((r) => {
            if (videoElement.readyState >= 1) r(null);
            else videoElement.onloadedmetadata = () => r(null);
        });

        const duration = videoElement.duration;
        const analyzeDuration = Math.min(duration, 180); 
        
        const interval = 1 / PROCESSING_FPS;
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
            await pose.send({ image: videoElement });
            currentTime += interval;
            framesProcessed++;
            
            if (onProgress && framesProcessed % 5 === 0) {
                 onProgress(Math.round((currentTime / analyzeDuration) * 100));
                 await new Promise(r => setTimeout(r, 0));
            }
        }

        document.body.removeChild(videoElement);
        URL.revokeObjectURL(videoUrl);
        pose.close();

        // --- STEP DETECTION PIPELINE ---
        
        const normalizedSignal = rawSignals.map(s => s.ankleDist / s.shoulderWidth);
        const timestamps = rawSignals.map(s => s.timestamp);
        const { mean } = calculateStatistics(normalizedSignal);
        const adaptiveThreshold = Math.max(mean, 0.05);

        const smoothedSignal = movingAverage(normalizedSignal, 3);
        const timeDomainPeaks = findPeaks(smoothedSignal, timestamps, adaptiveThreshold);
        const peakCount = timeDomainPeaks.length;

        const fftResult = calculateDominantFrequency(normalizedSignal, PROCESSING_FPS);
        let fftPredictedSteps = Math.round(fftResult.frequency * analyzeDuration);
        const detectedCadence = (fftPredictedSteps / analyzeDuration) * 60;
        
        let finalStepCount = peakCount;
        if (peakCount > fftPredictedSteps * 1.5 && detectedCadence > 20 && fftPredictedSteps > 3) {
             finalStepCount = fftPredictedSteps;
        }

        // --- HEEL LIFT CALCULATION (SHUFFLING DETECTION) ---
        // 1. Determine Scale Factor (average over session)
        let cmPerUnitAverage = 0;
        if (heelData.length > 0) {
            const avgHeightUnit = heelData.reduce((acc, curr) => acc + Math.abs(curr.noseY - (curr.leftY+curr.rightY)/2), 0) / heelData.length;
            if (avgHeightUnit > 0) {
                cmPerUnitAverage = userHeightCm / avgHeightUnit;
            }
        }

        // 2. Calculate Lift for each foot
        // Note: Y coordinates increase DOWNWARDS. 
        // Max Y = Floor Level. Min Y = Peak Lift.
        const calculateLift = (ySignal: number[]) => {
             // Find "Floor" (e.g., 90th percentile of Y values to ignore outliers)
             const sortedY = [...ySignal].sort((a,b) => a-b);
             const floorLevel = sortedY[Math.floor(sortedY.length * 0.90)];
             
             // Find "Peak Heights" (Local Minima in Y)
             const lifts: number[] = [];
             const smoothedY = movingAverage(ySignal, 5);
             
             // Simple valley detection for height
             for(let i=1; i<smoothedY.length-1; i++) {
                 if (smoothedY[i] < smoothedY[i-1] && smoothedY[i] < smoothedY[i+1]) {
                     // Check if this peak is significantly above floor
                     const liftAmountUnit = floorLevel - smoothedY[i];
                     if (liftAmountUnit > 0.01) { // Filter tiny noise
                        lifts.push(liftAmountUnit);
                     }
                 }
             }
             return lifts;
        };

        const leftLifts = calculateLift(heelData.map(d => d.leftY));
        const rightLifts = calculateLift(heelData.map(d => d.rightY));
        const allLifts = [...leftLifts, ...rightLifts];
        
        let averageLiftCm = 0;
        if (allLifts.length > 0 && cmPerUnitAverage > 0) {
            const avgLiftUnit = allLifts.reduce((a,b) => a+b, 0) / allLifts.length;
            averageLiftCm = avgLiftUnit * cmPerUnitAverage;
        }

        // --- METRICS ---

        const durationMin = analyzeDuration / 60;
        const cadence = durationMin > 0 ? Math.round(finalStepCount / durationMin) : 0;

        let meanStepInterval = 0;
        let stepTimeVariability = 0;

        if (timeDomainPeaks.length > 1) {
            let intervals: number[] = [];
            for(let i = 1; i < timeDomainPeaks.length; i++) {
                intervals.push(timeDomainPeaks[i].time - timeDomainPeaks[i-1].time);
            }
            meanStepInterval = intervals.reduce((a,b) => a+b, 0) / intervals.length;
            const variance = intervals.reduce((a, b) => a + Math.pow(b - meanStepInterval, 2), 0) / intervals.length;
            stepTimeVariability = Math.sqrt(variance) * 1000;
        } else {
            meanStepInterval = finalStepCount > 0 ? analyzeDuration / finalStepCount : 0;
            stepTimeVariability = 20; 
        }

        let calculatedBOS = 0;
        if (bosMeasurements.length > 0) {
            bosMeasurements.sort((a, b) => a - b);
            const quarterIndex = Math.floor(bosMeasurements.length * 0.25);
            calculatedBOS = bosMeasurements[quarterIndex];
        }

        resolve({
            stepCount: finalStepCount,
            cadence,
            meanStepInterval,
            stepTimeVariability: Math.round(stepTimeVariability),
            averageBaseOfSupportCm: parseFloat(calculatedBOS.toFixed(1)),
            averageHeelLiftCm: parseFloat(averageLiftCm.toFixed(1)), // Return the new metric
            trackedFrame: capturedDebugFrame
        });

      } catch (err) {
        reject(err);
      }
    };

    runAnalysis();
    videoElement.onerror = (e) => reject(new Error("Failed to load video for CV analysis"));
  });
};

// --- HELPER FUNCTIONS ---

function calculateStatistics(data: number[]) {
    const n = data.length;
    if (n === 0) return { mean: 0, stdDev: 0 };
    const mean = data.reduce((a, b) => a + b) / n;
    const variance = data.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / n;
    return { mean, stdDev: Math.sqrt(variance) };
}

function calculateDominantFrequency(data: number[], fps: number): { frequency: number, magnitude: number } {
    const N = data.length;
    let maxMag = 0;
    let dominantFreq = 0;

    for (let f = 0.5; f <= 4.0; f += 0.05) {
        let real = 0;
        let imag = 0;
        for (let n = 0; n < N; n++) {
            const angle = -2 * Math.PI * f * n / fps;
            real += data[n] * Math.cos(angle);
            imag += data[n] * Math.sin(angle);
        }
        const mag = Math.sqrt(real * real + imag * imag);
        if (mag > maxMag) {
            maxMag = mag;
            dominantFreq = f;
        }
    }
    return { frequency: dominantFreq, magnitude: maxMag };
}

function drawSkeleton(ctx: CanvasRenderingContext2D, landmarks: any[], width: number, height: number) {
    ctx.strokeStyle = '#00FF00'; 
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.fillStyle = '#FF0000'; 

    const connections = [
        [LEFT_SHOULDER, RIGHT_SHOULDER],
        [LEFT_SHOULDER, LEFT_HIP],
        [RIGHT_SHOULDER, RIGHT_HIP],
        [LEFT_HIP, RIGHT_HIP],
        [LEFT_HIP, LEFT_KNEE],
        [LEFT_KNEE, LEFT_ANKLE],
        [LEFT_ANKLE, LEFT_HEEL],
        [RIGHT_HIP, RIGHT_KNEE],
        [RIGHT_KNEE, RIGHT_ANKLE],
        [RIGHT_ANKLE, RIGHT_HEEL],
    ];

    connections.forEach(([start, end]) => {
        const s = landmarks[start];
        const e = landmarks[end];
        if (s.visibility > 0.5 && e.visibility > 0.5) {
            ctx.beginPath();
            ctx.moveTo(s.x * width, s.y * height);
            ctx.lineTo(e.x * width, e.y * height);
            ctx.stroke();
        }
    });

    const nose = landmarks[NOSE];
    if(nose.visibility > 0.5) {
        ctx.beginPath();
        ctx.arc(nose.x * width, nose.y * height, 6, 0, 2 * Math.PI);
        ctx.fill();
    }
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

function findPeaks(data: number[], times: number[], adaptiveThreshold: number) {
    let peaks = [];
    const minTimeDiff = 0.25;

    for(let i=1; i<data.length-1; i++) {
        if(data[i] > data[i-1] && data[i] > data[i+1]) {
            if(data[i] > adaptiveThreshold) {
                if (peaks.length === 0 || (times[i] - peaks[peaks.length-1].time > minTimeDiff)) {
                    peaks.push({ val: data[i], time: times[i] });
                }
            }
        }
    }
    return peaks;
}