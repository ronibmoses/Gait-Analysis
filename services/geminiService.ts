import { GoogleGenAI, Type, Schema } from "@google/genai";
import { GaitMetrics } from '../types';

// Using gemini-2.0-flash-exp for video analysis capabilities.
const MODEL_NAME = 'gemini-2.0-flash-exp';

export const analyzeGaitVideo = async (videoFile: File): Promise<GaitMetrics> => {
  // Access the key injected by Vite
  const apiKey = process.env.API_KEY;

  // Explicit check to provide a helpful error message in the UI if the build failed to capture the key
  if (!apiKey) {
      throw new Error("API Key is missing. If you are running on Vercel, please ensuring your Environment Variable is named 'API_KEY' and REDEPLOY the project to apply changes.");
  }

  // Use process.env.API_KEY directly. @types/node provides the type definition.
  const ai = new GoogleGenAI({ apiKey });

  // Convert File to Base64
  const base64Data = await fileToGenerativePart(videoFile);

  const schema: Schema = {
    type: Type.OBJECT,
    properties: {
      stepCount: { type: Type.NUMBER, description: "Total number of steps taken in the video." },
      cadence: { type: Type.NUMBER, description: "Cadence in steps per minute." },
      stepTimeVariability: { type: Type.NUMBER, description: "Variability of step time in milliseconds (approximate)." },
      meanStepInterval: { type: Type.NUMBER, description: "Average time between steps in seconds." },
      gaitSpeed: { type: Type.STRING, description: "Relative gait speed assessment (e.g., 'Slow', 'Normal', 'Fast')." },
      baseOfSupport: { type: Type.STRING, description: "Relative base of support width (e.g., 'Narrow', 'Normal', 'Wide')." },
      turningDuration: { type: Type.NUMBER, description: "Duration of turning movement in seconds. Return 0 if no turn is observed." },
      analysisSummary: { type: Type.STRING, description: "A brief professional clinical summary of the gait abnormalities or normalities observed." }
    },
    required: ["stepCount", "cadence", "stepTimeVariability", "meanStepInterval", "gaitSpeed", "baseOfSupport", "turningDuration", "analysisSummary"],
  };

  const prompt = `
    Analyze this video for gait analysis. The video shows a person walking.
    Please calculate or estimate the following biomechanical parameters based on the visual evidence:
    1. Step count
    2. Cadence (steps/min)
    3. Step time variability
    4. Mean step interval
    5. Relative Gait speed
    6. Relative Base of support
    7. Turning duration (if they turn around)

    Provide a professional summary of the gait.
  `;

  try {
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: {
        parts: [
          base64Data,
          { text: prompt }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: schema,
        temperature: 0.2, // Low temperature for more analytical/factual output
      }
    });

    const text = response.text;
    if (!text) throw new Error("No response from AI");

    return JSON.parse(text) as GaitMetrics;

  } catch (error: any) {
    console.error("Gemini Analysis Error:", error);
    
    let msg = error instanceof Error ? error.message : "Unknown error";
    
    if (msg.includes("404") || msg.includes("NOT_FOUND")) {
       throw new Error(`Model ${MODEL_NAME} is currently unavailable or the API key is invalid.`);
    }

    if (msg.includes("413") || msg.includes("too large")) {
      throw new Error("Video file is too large. Please shorten the recording or use a lower resolution.");
    }
    
    throw new Error(`Analysis failed: ${msg}`);
  }
};

async function fileToGenerativePart(file: File): Promise<{ inlineData: { data: string; mimeType: string } }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = (reader.result as string).split(',')[1];
      resolve({
        inlineData: {
          data: base64String,
          mimeType: file.type
        }
      });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}