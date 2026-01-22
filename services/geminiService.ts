import { GoogleGenAI, Type, Schema } from "@google/genai";
import { GaitMetrics } from '../types';

// Using gemini-2.0-flash-exp for video analysis capabilities.
const MODEL_NAME = 'gemini-2.0-flash-exp';

export const analyzeGaitVideo = async (videoFile: File): Promise<GaitMetrics> => {
  // Access the key injected by Vite
  const apiKey = process.env.API_KEY;

  if (!apiKey) {
      throw new Error("API Key is missing. If you are running on Vercel, please ensuring your Environment Variable is named 'API_KEY' and REDEPLOY the project to apply changes.");
  }

  const ai = new GoogleGenAI({ apiKey });
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
      analysisSummary: { type: Type.STRING, description: "Clinical observation focusing on pathology." }
    },
    required: ["stepCount", "cadence", "stepTimeVariability", "meanStepInterval", "gaitSpeed", "baseOfSupport", "turningDuration", "analysisSummary"],
  };

  const prompt = `
    Act as a Neurologist specializing in Normal Pressure Hydrocephalus (NPH) and Parkinson's Disease.
    Analyze this video for gait pathology.

    CRITICAL INSTRUCTION: You must strictly evaluate for "Magnetic Gait" and "Shuffling".
    
    1. **Magnetic Gait Assessment:**
       - Watch the feet closely. Do they fully leave the ground?
       - If the feet appear to "glide" or "slide" without clear vertical lift, you MUST classify this as magnetic gait or shuffling.
       - Do NOT mistake a smooth sliding motion for a "normal fluid gait". In this context, sliding is pathological.

    2. **Key Signs to Report:**
       - **Low Foot Clearance:** Heels barely clearing the floor.
       - **Festination:** Steps becoming smaller and faster.
       - **Start Hesitation:** Difficulty initiating the first step.
       - **Turning en bloc:** Turning the body as a rigid unit rather than pivoting.

    Output the requested biomechanical metrics. 
    In the 'analysisSummary', be direct. If feet are dragging or sliding, state: "Evidence of magnetic/shuffling gait observed."
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
        temperature: 0.1, // Very low temperature for strict adherence to instructions
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