import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export interface Point {
  x: number;
  y: number;
}

export interface WallSegment {
  id?: string;
  start: Point;
  end: Point;
  thickness: number;
}

export interface Opening {
  position: Point;
  width: number;
  type: 'door' | 'window' | 'window-floor';
  rotation: number; // in degrees
  thickness?: number; // thickness of the wall it's on
  wallId?: string;
  offsetAlongWall?: number;
}

export interface FloorPlanData {
  walls: WallSegment[];
  openings: Opening[];
  suggestedScale: number; // pixels to meters
  imageAspectRatio?: number; // width / height
}

export async function analyzeFloorPlan(base64Image: string, mimeType: string): Promise<FloorPlanData> {
  const model = "gemini-3-flash-preview"; // Using a standard vision-capable model

  const prompt = `Analyze this 2D floor plan image and extract the architectural geometry. 
  Return a JSON object representing the walls, doors, and windows.
  
  Guidelines:
  1. Walls should be represented as line segments (start and end points in a relative coordinate system 0-1000).
  2. Doors and windows should be identified with their position, width, and type.
  3. Try to estimate a scale (how many units in your 0-1000 system represent 1 meter).
  
  The JSON schema must be:
  {
    "walls": [{"start": {"x": number, "y": number}, "end": {"x": number, "y": number}, "thickness": number}],
    "openings": [{"position": {"x": number, "y": number}, "width": number, "type": "door" | "window" | "window-floor", "rotation": number}],
    "suggestedScale": number
  }`;

  try {
    const response = await ai.models.generateContent({
      model: model,
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inlineData: {
                data: base64Image.split(',')[1] || base64Image,
                mimeType: mimeType
              }
            }
          ]
        }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            walls: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  start: {
                    type: Type.OBJECT,
                    properties: { x: { type: Type.NUMBER }, y: { type: Type.NUMBER } },
                    required: ["x", "y"]
                  },
                  end: {
                    type: Type.OBJECT,
                    properties: { x: { type: Type.NUMBER }, y: { type: Type.NUMBER } },
                    required: ["x", "y"]
                  },
                  thickness: { type: Type.NUMBER }
                },
                required: ["start", "end", "thickness"]
              }
            },
            openings: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  position: {
                    type: Type.OBJECT,
                    properties: { x: { type: Type.NUMBER }, y: { type: Type.NUMBER } },
                    required: ["x", "y"]
                  },
                  width: { type: Type.NUMBER },
                  type: { type: Type.STRING, enum: ["door", "window", "window-floor"] },
                  rotation: { type: Type.NUMBER }
                },
                required: ["position", "width", "type", "rotation"]
              }
            },
            suggestedScale: { type: Type.NUMBER }
          },
          required: ["walls", "openings", "suggestedScale"]
        }
      }
    });

    const text = response.text;
    if (!text) throw new Error("No response from AI");
    return JSON.parse(text) as FloorPlanData;
  } catch (error) {
    console.error("Error analyzing floor plan:", error);
    throw error;
  }
}
