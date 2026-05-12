import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';

export type FaceDescriptor = Record<string, any>;

export interface VerifyResult {
  available: boolean; // false si la IA no estuvo disponible o no había descriptor
  match: boolean; // true si la persona de la foto es el trabajador esperado
  confidence: number; // 0..100, probabilidad de que sea esa persona
  reasoning: string;
  greeting: string; // saludo corto generado por la IA
}

/**
 * Servicio de visión facial apoyado en la IA de Groq
 * (API compatible con OpenAI, modelos Llama con visión).
 *
 * Estrategia:
 *  - Al inscribir a un trabajador (o en su primer marcaje) se genera un
 *    "descriptor facial" estructurado de su rostro (`describeFace`).
 *  - Cada vez que el trabajador marca desde su panel, se verifica con `verify`
 *    que la foto corresponde a su descriptor y se genera un saludo corto.
 */
@Injectable()
export class FaceService {
  private readonly logger = new Logger('FaceService');

  constructor(private readonly config: ConfigService) {}

  private get apiKey(): string {
    return this.config.get<string>('GROQ_API_KEY') || '';
  }

  private get model(): string {
    return this.config.get<string>('GROQ_MODEL') || DEFAULT_MODEL;
  }

  get enabled(): boolean {
    return Boolean(this.apiKey);
  }

  private async callGroq(messages: any[], maxTokens = 700): Promise<string> {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: 0.1,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Groq ${res.status}: ${text.slice(0, 300)}`);
    }
    const data: any = await res.json();
    return data?.choices?.[0]?.message?.content || '';
  }

  private parseJson(raw: string): any {
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) {
        try {
          return JSON.parse(m[0]);
        } catch {
          /* noop */
        }
      }
      return null;
    }
  }

  /**
   * Genera un descriptor facial estructurado a partir de una imagen
   * (data URL base64 o URL pública accesible por Groq).
   */
  async describeFace(imageUrl: string): Promise<FaceDescriptor | null> {
    if (!this.enabled || !imageUrl) return null;
    const schema =
      '{"apparentGender":"","apparentAgeRange":"","skinTone":"","faceShape":"",' +
      '"hairColor":"","hairLength":"","hairStyle":"","facialHair":"","eyebrows":"",' +
      '"eyeColor":"","eyeShape":"","noseShape":"","lipsShape":"",' +
      '"glasses":"ninguno|graduados|de sol","distinctiveMarks":"","summary":""}';
    try {
      const content = await this.callGroq(
        [
          {
            role: 'system',
            content:
              'Eres un asistente de extracción de rasgos faciales para un sistema de control de asistencia laboral. ' +
              'Observa la cara de la persona en la foto y devuelve SOLO un objeto JSON con rasgos visuales estables y distintivos ' +
              `usando exactamente este esquema (valores en español, concisos): ${schema}. ` +
              'Si no se aprecia ninguna cara con claridad, devuelve {"error":"no_face"}.',
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Extrae el descriptor facial de esta persona.' },
              { type: 'image_url', image_url: { url: imageUrl } },
            ],
          },
        ],
        600,
      );
      const json = this.parseJson(content);
      if (!json || json.error) return null;
      return json;
    } catch (e: any) {
      this.logger.warn(`describeFace falló: ${e?.message || e}`);
      return null;
    }
  }

  /**
   * Verifica si la persona de la foto es el trabajador esperado (que ya inició sesión)
   * y genera un saludo corto adecuado a la hora y al tipo de marcaje.
   */
  async verify(
    imageUrl: string,
    descriptor: FaceDescriptor | null,
    name: string,
    ctx: { type: 'in' | 'out'; hour: number },
  ): Promise<VerifyResult> {
    const firstName = (name || '').split(' ')[0] || name;
    const saludoBase = ctx.hour < 12 ? 'buenos días' : ctx.hour < 19 ? 'buenas tardes' : 'buenas noches';
    const fallbackGreeting =
      ctx.type === 'in'
        ? `¡${capitalize(saludoBase)}, ${firstName}! Que tengas un buen turno.`
        : `¡${capitalize(saludoBase)}, ${firstName}! Buen trabajo, hasta mañana.`;

    if (!this.enabled || !descriptor) {
      return {
        available: false,
        match: false,
        confidence: 0,
        reasoning: !this.enabled ? 'IA no configurada' : 'El trabajador no tiene rostro inscrito',
        greeting: fallbackGreeting,
      };
    }
    try {
      const content = await this.callGroq(
        [
          {
            role: 'system',
            content:
              'Eres el asistente de un sistema de control de asistencia laboral con reconocimiento facial. ' +
              `La foto adjunta debería corresponder al trabajador "${name}". Su descriptor facial de referencia es: ${JSON.stringify(descriptor)}. ` +
              'Compara los rasgos de la persona de la foto con ese descriptor y decide si es la misma persona. ' +
              'Además genera un saludo MUY corto (máximo 12 palabras), cálido y en español, basado en "' + saludoBase + '", dirigido a la persona por su nombre de pila ("' + firstName + '"), ' +
              (ctx.type === 'in'
                ? 'dándole la bienvenida al inicio de su jornada de trabajo.'
                : 'despidiéndose de él/ella al terminar su jornada de trabajo.') +
              ' Responde SOLO con JSON: {"match": <true|false>, "confidence": <entero 0-100, probabilidad de que sea ese trabajador>, "reasoning": "<breve, en español>", "greeting": "<el saludo>"}.',
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: `Verifica si esta foto es de ${name} y genera el saludo:` },
              { type: 'image_url', image_url: { url: imageUrl } },
            ],
          },
        ],
        400,
      );
      const json = this.parseJson(content);
      if (!json) {
        return { available: true, match: true, confidence: 50, reasoning: 'Respuesta de la IA no interpretable', greeting: fallbackGreeting };
      }
      let confidence = Number(json.confidence);
      if (!isFinite(confidence)) confidence = 0;
      confidence = Math.max(0, Math.min(100, Math.round(confidence)));
      const greeting = typeof json.greeting === 'string' && json.greeting.trim() ? json.greeting.trim() : fallbackGreeting;
      return {
        available: true,
        match: json.match === true || json.match === 'true',
        confidence,
        reasoning: String(json.reasoning || ''),
        greeting,
      };
    } catch (e: any) {
      this.logger.warn(`verify falló: ${e?.message || e}`);
      return { available: false, match: false, confidence: 0, reasoning: `Error de la IA: ${e?.message || e}`, greeting: fallbackGreeting };
    }
  }
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
