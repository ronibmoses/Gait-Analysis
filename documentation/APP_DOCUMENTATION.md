# Computerized Gait Analysis - Application Guide

## 1. Overview
This application provides biomechanical gait analysis using a hybrid approach:
1.  **Computer Vision (MediaPipe):** Accurately tracks joints to calculate step count, cadence, and timing.
2.  **Generative AI (Gemini 2.0):** Observes the video to provide clinical summaries and qualitative assessments (posture, arm swing, etc).

## 2. How to Use
1.  **Patient Details:** Enter the First Name, Last Name, Age, and Gender. This helps the AI contextulize "Normal" vs "Abnormal" speeds.
2.  **Video Input:**
    *   **Option A (Upload):** Upload a video file (MP4/WebM) from your computer.
    *   **Option B (Record):** Use your webcam to record. Walk back and forth in front of the camera.
    *   *Tip:* Ensure the full body (especially feet) is visible.
3.  **Analysis:** Wait 10-30 seconds. The app processes the video through both engines simultaneously.
4.  **Results:** View the dashboard containing:
    *   Calculated metrics (Cadence, Speed, etc).
    *   Clinical Summary written by the AI.
    *   Visual Charts.

## 3. Privacy Note
Video data is processed in memory and sent to Google Gemini API for analysis. It is not permanently stored on any server by this application.