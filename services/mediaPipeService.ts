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
  trackedFrame?: string; // Base64 image
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
      modelComplexity: 1, // Use 1 (Full) for better accuracy at 30fps
      smoothLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    // Data collection
    const rawSignals: { ankleDist: number, shoulderWidth: number, timestamp: number }[] = [];
    const bosMeasurements: number[] = []; 
    
    // Debug capture
    let capturedDebugFrame: string | undefined = undefined;
    const captureFrameIndex = 30; 
    let currentFrameIndex = 0;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    pose.onResults((results: any) => {
      currentFrameIndex++;

      // Capture logic
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

        // 1. Data Collection for Step Analysis
        if (leftAnkle && rightAnkle && leftShoulder && rightShoulder && 
            leftAnkle.visibility > 0.5 && rightAnkle.visibility > 0.5) {
            
            // Raw Ankle Distance
            const dx = leftAnkle.x - rightAnkle.x;
            const dy = leftAnkle.y - rightAnkle.y;
            const ankleDist = Math.sqrt(dx*dx + dy*dy);

            // Shoulder Width (for Normalization)
            const sx = leftShoulder.x - rightShoulder.x;
            const sy = leftShoulder.y - rightShoulder.y;
            const shoulderWidth = Math.sqrt(sx*sx + sy*sy);

            rawSignals.push({
                ankleDist,
                shoulderWidth: shoulderWidth > 0.01 ? shoulderWidth : 1, // Prevent divide by zero
                timestamp: videoElement.currentTime
            });
        } else {
            // Push previous value or 0 if occlusion
             const prev = rawSignals.length > 0 ? rawSignals[rawSignals.length - 1] : { ankleDist: 0, shoulderWidth: 1, timestamp: videoElement.currentTime };
             rawSignals.push({ ...prev, timestamp: videoElement.currentTime });
        }

        // 2. Base of Support Logic
        if (leftHeel && rightHeel && nose && leftHeel.visibility > 0.5 && rightHeel.visibility > 0.5) {
            const avgHeelY = (leftHeel.y + rightHeel.y) / 2;
            const subjectPixelHeight = Math.abs(avgHeelY - nose.y);
            
            if (subjectPixelHeight > 0.2) { 
                const cmPerUnit = userHeightCm / subjectPixelHeight;
                const yDiff = Math.abs(leftHeel.y - rightHeel.y);
                
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

        // --- ADAPTIVE PIPELINE START ---
        
        // 1. Normalization (Scale Invariance)
        // Ratio = AnkleDist / ShoulderWidth. 
        const normalizedSignal = rawSignals.map(s => s.ankleDist / s.shoulderWidth);
        const timestamps = rawSignals.map(s => s.timestamp);

        // 2. Statistics & Adaptive Threshold
        const { mean } = calculateStatistics(normalizedSignal);
        
        // Revised Threshold Strategy:
        // Use the Mean as the primary threshold. A step is defined as separation greater than average.
        // We removed the stdDev buffer because it was filtering out valid, low-amplitude steps (false negatives).
        // We add a 'floor' of 0.15 to ensure we don't count noise when standing still.
        const adaptiveThreshold = Math.max(mean, 0.15);

        // 3. Peak Detection (Time Domain)
        const smoothedSignal = movingAverage(normalizedSignal, 4);
        const timeDomainPeaks = findPeaks(smoothedSignal, timestamps, adaptiveThreshold);
        const peakCount = timeDomainPeaks.length;

        // 4. Frequency Analysis (FFT / Frequency Domain)
        const fftResult = calculateDominantFrequency(normalizedSignal, PROCESSING_FPS);
        
        // Frequency Logic Update:
        // Ankle Distance Signal has 2 peaks per gait cycle (L step + R step).
        // Therefore, dominant freq = steps/sec.
        // If the walker is asymmetric, the 'stride' frequency (1/2 cadence) might be dominant.
        // If detected cadence is < 60spm (1Hz) but > 0.4Hz, it's likely a stride count (half steps).
        let fftPredictedSteps = Math.round(fftResult.frequency * analyzeDuration);
        
        const detectedCadence = (fftPredictedSteps / analyzeDuration) * 60;
        if (detectedCadence > 25 && detectedCadence < 65) {
             // Likely detected stride frequency instead of step frequency. Double it.
             // Unless the person is EXTREMELY slow, but 60spm is very slow already.
             // To be safe, we only double if Peak Count is also roughly double.
             if (peakCount > fftPredictedSteps * 1.5) {
                 fftPredictedSteps *= 2;
             }
        }

        // 5. Consensus Logic
        let finalStepCount = peakCount;
        
        // If the counts diverge by more than 20%, we check reliability.
        const discrepancy = Math.abs(peakCount - fftPredictedSteps);
        const percentDiff = discrepancy / ((peakCount + fftPredictedSteps) / 2);

        // We trust peaks more now that threshold is lowered, but if peaks are wildly high (noise), we clamp with FFT.
        // Or if peaks are wildly low (missed steps), we boost with FFT.
        if (percentDiff > 0.20 && fftPredictedSteps > 5) {
            console.log(`Discrepancy detected. Peaks: ${peakCount}, FFT: ${fftPredictedSteps}`);
            // If peaks are significantly lower than FFT, we probably missed steps (undercount). Trust FFT.
            if (peakCount < fftPredictedSteps) {
                 finalStepCount = fftPredictedSteps;
            } 
            // If peaks are significantly higher, it might be noise. 
            // However, with smoothing=4, noise is rare. 
            // We usually trust the higher number in gait analysis (it's hard to hallucinate rhythmic steps).
            else {
                 finalStepCount = peakCount;
            }
        }

        // --- METRICS CALCULATION ---

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

        // BOS Calculation
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

    // Range 0.5Hz (30spm) to 4.0Hz (240spm)
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
    // Reduced from 0.25 to 0.20 to allow for faster steps and prevent merging close peaks
    const minTimeDiff = 0.20;

    for(let i=1; i<data.length-1; i++) {
        // Local maxima
        if(data[i] > data[i-1] && data[i] > data[i+1]) {
            // Must be above average width (or noise floor)
            if(data[i] > adaptiveThreshold) {
                if (peaks.length === 0 || (times[i] - peaks[peaks.length-1].time > minTimeDiff)) {
                    peaks.push({ val: data[i], time: times[i] });
                }
            }
        }
    }
    return peaks;
}