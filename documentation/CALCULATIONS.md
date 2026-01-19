# Mathematical & Algorithmic Documentation

This document outlines the specific calculations, signal processing techniques, and heuristics used to derive gait metrics in the Computerized Gait Analysis application.

The analysis is performed using a hybrid engine:
1.  **Quantitative Analysis:** Uses MediaPipe Pose (Computer Vision) for precise temporal and spatial measurements.
2.  **Qualitative Analysis:** Uses Gemini 2.0 Flash (Generative AI) for visual observation and clinical summarization.

---

## 1. Coordinate System & Scaling
MediaPipe Pose returns normalized landmarks $(x, y)$ where values range from $0.0$ to $1.0$.

### Vertical Scaling Factor ($S_y$)
We calculate the subject's height in the frame by measuring the vertical distance between the Nose landmark and the average of the two Heel landmarks.
$$
\text{Scale Factor (cm/unit)} = \frac{\text{User Input Height (cm)}}{H_{pixels}}
$$

---

## 2. Adaptive Spatiotemporal Metrics (Computer Vision)

We employ an **Adaptive Signal Processing Pipeline** to handle variations in video quality, subject distance, and gait pathology.

### A. Signal Normalization (Scale Invariance)
To ensure the step detection works regardless of how close the subject is to the camera, we normalize the raw ankle distance by the subject's shoulder width.

$$ Signal(t) = \frac{\text{AnkleDistance}(t)}{\text{ShoulderWidth}(t)} $$

### B. Adaptive Thresholding
We calculate a dynamic threshold based on the statistical mean of the signal.

1.  Calculate Mean ($\mu$) of the normalized signal.
2.  $$ \text{Threshold} = \max(\mu, 0.15) $$

*   *Logic:* Any ankle separation wider than the average separation during the walk is considered a potential step. The 0.15 floor prevents noise accumulation when standing still.

### C. Dual-Method Step Counting
We calculate step count using two independent methods and consensus logic:

1.  **Time Domain (Peak Detection):** Finds local maxima in the smoothed signal above the Adaptive Threshold.
2.  **Frequency Domain (FFT):** Performs a Discrete Fourier Transform (DFT) to find the dominant frequency ($f_{dom}$).

**Consensus Logic:**
*   If Peaks count is significantly lower than FFT count, we assume missed steps and use FFT.
*   Otherwise, we prioritize the Peak Count for its temporal precision.

### D. Step Time Variability
Calculated as the standard deviation of step intervals (in ms).

---

## 3. Spatial Metrics (Base of Support)

Base of Support (BOS) is defined as the medial-lateral distance between the heels during the double-support phase.

### Algorithm
1.  **Phase Detection:** Heels must be vertically aligned ($|y_L - y_R| < 0.03$).
2.  **Perspective Correction:** $W_{cm} = (W_{raw} \times \text{Scale Factor}) \times 0.85$.
3.  **Statistical Selection:** We use the **25th Percentile** of all valid measurements to represent the narrowest consistent walking base.

---

## 4. Qualitative Metrics (Generative AI)

The Gemini 2.0 Vision model provides:
*   **Gait Speed Classification:** "Slow", "Normal", "Fast".
*   **Turning Duration:** Time taken to turn 180 degrees.
*   **Clinical Summary:** Text description of arm swing, posture, and fluidity.
