import { Chess } from 'chess.js';
import { sendWithFallback } from './ai-router';
import type { UserSettings } from '@shared/types/storage';
import type { AIImageContent, AITextContent } from './ai-types';

const VISION_SYSTEM_PROMPT = `You are a chess position recognition expert. Your task is to analyze chess board images and extract the exact position as a FEN string.

Rules:
- Output ONLY a single valid FEN string (Forsyth-Edwards Notation), nothing else
- The FEN must represent the exact position shown on the board
- If the board orientation is clear (letters/numbers visible), use that to determine piece placement
- If orientation is unclear, assume white plays from the bottom
- Include all 6 FEN fields: piece placement, active color, castling, en passant, halfmove, fullmove
- If you cannot determine castling rights, default to "KQkq"
- If you cannot determine whose turn it is, default to "w"
- Set halfmove clock to 0 and fullmove number to 1 if unknown
- If the image is not a chess board, respond with "NOT_A_CHESS_BOARD"`;

export interface PositionRecognitionResult {
  fen: string;
  isValid: boolean;
  error?: string;
}

/**
 * Recognize a chess position from an image.
 * Sends the image to the AI vision API, extracts FEN, validates with chess.js.
 */
export async function recognizePosition(
  settings: UserSettings,
  imageBase64: string,
  mediaType: string,
): Promise<PositionRecognitionResult> {
  try {
    const imageContent: AIImageContent = {
      type: 'image',
      mediaType,
      base64Data: imageBase64,
    };

    const textContent: AITextContent = {
      type: 'text',
      text: 'What is the FEN for this chess position? Output only the FEN string.',
    };

    const response = await sendWithFallback(
      settings,
      VISION_SYSTEM_PROMPT,
      [{ role: 'user', content: [imageContent, textContent] }],
      512,
    );

    // Extract FEN from response (trim whitespace, handle possible wrapping)
    const cleaned = response.trim();

    if (cleaned === 'NOT_A_CHESS_BOARD') {
      return { fen: '', isValid: false, error: 'The image does not appear to be a chess board.' };
    }

    // Try to extract a FEN pattern from the response
    const fenMatch = cleaned.match(
      /([rnbqkpRNBQKP1-8]+\/){7}[rnbqkpRNBQKP1-8]+(\s[wb]\s[KQkq-]+\s[a-h1-8-]+\s\d+\s\d+)?/,
    );

    const fen = fenMatch ? fenMatch[0] : cleaned;

    // Ensure we have all 6 fields — add defaults if only piece placement is given
    const parts = fen.split(' ');
    const fullFen =
      parts.length >= 6
        ? fen
        : `${parts[0]} ${parts[1] ?? 'w'} ${parts[2] ?? 'KQkq'} ${parts[3] ?? '-'} ${parts[4] ?? '0'} ${parts[5] ?? '1'}`;

    // Validate with chess.js
    try {
      const chess = new Chess(fullFen);
      // If chess.js accepted it, it's valid
      return { fen: chess.fen(), isValid: true };
    } catch {
      return {
        fen: fullFen,
        isValid: false,
        error: 'AI returned an invalid FEN. You can try editing it manually.',
      };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { fen: '', isValid: false, error: `Recognition failed: ${message}` };
  }
}

/**
 * Resize an image to max dimensions to reduce API cost.
 * Returns base64 data (without data: prefix) and the media type.
 */
export async function resizeImageForAPI(
  file: File | Blob,
  maxSize: number = 1024,
): Promise<{ base64: string; mediaType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        // Calculate new dimensions
        let { width, height } = img;
        if (width > maxSize || height > maxSize) {
          const ratio = Math.min(maxSize / width, maxSize / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        // Draw to canvas
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, width, height);

        // Convert to base64 (use JPEG for photos, PNG for screenshots)
        const mediaType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        const quality = mediaType === 'image/jpeg' ? 0.85 : undefined;
        const dataUrl = canvas.toDataURL(mediaType, quality);
        const base64 = dataUrl.split(',')[1];

        resolve({ base64, mediaType });
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}
