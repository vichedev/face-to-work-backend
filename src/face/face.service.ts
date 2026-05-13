import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';

export type FaceDescriptor = Record<string, any>;
export type MarkType = 'in' | 'lunch_out' | 'lunch_in' | 'out';

export interface VerifyResult {
  available: boolean; // false si la IA no estuvo disponible / no había referencia
  match: boolean; // true si la persona de la foto es el trabajador esperado
  confidence: number; // 0..100, probabilidad de que sea esa persona
  reasoning: string;
  greeting: string; // saludo corto ya armado (con el saludo de la hora correcto)
}

function clampHour(hour: number): number {
  return Number.isFinite(hour) ? ((Math.trunc(hour) % 24) + 24) % 24 : new Date().getHours();
}

/** "Buenos días" / "Buenas tardes" / "Buenas noches" según la hora (0-23). */
function salutationFor(hour: number): string {
  const h = clampHour(hour);
  if (h < 12) return 'Buenos días';
  if (h < 20) return 'Buenas tardes';
  return 'Buenas noches';
}

function partOfDay(hour: number): string {
  const h = clampHour(hour);
  return h < 12 ? 'la mañana' : h < 20 ? 'la tarde' : 'la noche';
}

function fallbackPhrase(type: MarkType): string {
  switch (type) {
    case 'in': return '¡Que tengas un buen turno!';
    case 'lunch_out': return '¡Buen provecho, disfruta el almuerzo!';
    case 'lunch_in': return '¡Listos para seguir!';
    case 'out': return '¡Buen trabajo, descansa!';
    default: return '¡Bienvenido/a!';
  }
}
function actionPromptHint(type: MarkType): string {
  switch (type) {
    case 'in': return 'animándole al inicio de su jornada (p. ej. "¡que tengas un gran turno!")';
    case 'lunch_out': return 'deseándole un buen almuerzo (p. ej. "¡buen provecho, disfruta!")';
    case 'lunch_in': return 'dándole la bienvenida de regreso del almuerzo (p. ej. "¡vamos con la segunda mitad!")';
    case 'out': return 'felicitándole por terminar su jornada (p. ej. "¡buen trabajo, descansa!")';
    default: return 'con un mensaje cálido y breve';
  }
}

function firstNameOf(name: string): string {
  return (name || '').trim().split(/\s+/)[0] || name || 'compañero/a';
}

// Quita un "buenos días / buenas tardes / buenas noches" al inicio de la frase de la IA
// (el saludo de la hora lo añade el sistema, así nunca está desfasado).
function stripSalutation(s: string): string {
  return (s || '')
    .replace(/^[¡!\s]*buen[oa]s?\s+(d[ií]as|tardes|noches)[\s,.:;!¡)-]*/i, '')
    .trim();
}

/**
 * Reconocimiento facial apoyado en la IA de Groq (modelos Llama con visión).
 *
 *  - `describeFace`  → genera un descriptor de rasgos a partir de una foto (al inscribir).
 *  - `verify`        → compara la foto recién tomada con la foto de referencia (y el
 *                      descriptor) del trabajador, y arma un saludo acorde a la hora local.
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

  /** Saludo determinista (sin IA): "Buenas tardes, Vicente. ¡Que tengas un buen turno!" */
  composeGreeting(name: string, type: MarkType, hour: number): string {
    return `${salutationFor(hour)}, ${firstNameOf(name)}. ${fallbackPhrase(type)}`.trim();
  }

  private async callGroq(messages: any[], maxTokens = 600): Promise<string> {
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

  /** Genera un descriptor facial estructurado a partir de una imagen (data URL base64 o URL). */
  async describeFace(imageUrl: string): Promise<FaceDescriptor | null> {
    if (!this.enabled || !imageUrl) return null;
    const schema =
      '{"apparentGender":"","apparentAgeRange":"","skinTone":"","faceShape":"","jawline":"",' +
      '"hairColor":"","hairLength":"","hairStyle":"","hairline":"","facialHair":"","eyebrows":"",' +
      '"eyeColor":"","eyeShape":"","eyeSpacing":"","noseShape":"","noseSize":"","lipsShape":"",' +
      '"ears":"","glasses":"ninguno|graduados|de sol","distinctiveMarks":"","summary":""}';
    try {
      const content = await this.callGroq(
        [
          {
            role: 'system',
            content:
              'Eres un asistente de extracción de rasgos faciales para un sistema de control de asistencia laboral. ' +
              'Observa la cara de la persona y devuelve SOLO un objeto JSON con rasgos visuales ESTABLES y distintivos ' +
              `(no expresión ni iluminación) usando exactamente este esquema (valores cortos, en español): ${schema}. ` +
              'Si no se aprecia ninguna cara con claridad, devuelve {"error":"no_face"}.',
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Extrae el descriptor facial de esta persona:' },
              { type: 'image_url', image_url: { url: imageUrl } },
            ],
          },
        ],
        700,
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
   * Verifica que la persona de la foto recién tomada sea el trabajador esperado,
   * comparándola con su foto de referencia (y su descriptor), y arma el saludo
   * acorde a la hora local del trabajador (`ctx.hour`, 0-23).
   */
  async verify(
    capturedUrl: string,
    referenceUrl: string | null,
    descriptor: FaceDescriptor | null,
    name: string,
    ctx: { type: MarkType; hour: number },
  ): Promise<VerifyResult> {
    const firstName = firstNameOf(name);
    const salutation = salutationFor(ctx.hour);
    const compose = (phrase: string) => `${salutation}, ${firstName}. ${phrase}`.replace(/\s+/g, ' ').trim();
    const fallbackGreeting = compose(fallbackPhrase(ctx.type));

    if (!this.enabled) {
      return { available: false, match: false, confidence: 0, reasoning: 'IA no configurada', greeting: fallbackGreeting };
    }
    if (!referenceUrl && !descriptor) {
      return { available: false, match: false, confidence: 0, reasoning: 'El trabajador aún no tiene rostro de referencia inscrito', greeting: fallbackGreeting };
    }

    const userContent: any[] = [];
    if (referenceUrl) {
      userContent.push({ type: 'text', text: `FOTO DE REFERENCIA del trabajador "${name}":` });
      userContent.push({ type: 'image_url', image_url: { url: referenceUrl } });
    }
    if (descriptor) {
      userContent.push({ type: 'text', text: `Descriptor facial de referencia (JSON): ${JSON.stringify(descriptor)}` });
    }
    userContent.push({ type: 'text', text: 'FOTO A VERIFICAR (recién tomada en el marcaje):' });
    userContent.push({ type: 'image_url', image_url: { url: capturedUrl } });

    try {
      const content = await this.callGroq(
        [
          {
            role: 'system',
            content:
              'Eres el módulo de reconocimiento facial de un sistema de control de asistencia laboral. ' +
              `Recibes la foto de referencia (y/o un descriptor) del trabajador "${name}" y una foto recién tomada al marcar. ` +
              'Compara con cuidado los rasgos faciales ESTABLES: forma de la cara y de la mandíbula, ojos y cejas, nariz, labios, orejas, color y línea del cabello, vello facial, lunares o cicatrices. ' +
              'IGNORA las diferencias de iluminación, ángulo, expresión, gafas, gorra, mascarilla o peinado. ' +
              'Decide si es la MISMA persona y da una confianza 0-100 (probabilidad de que la foto a verificar sea ese trabajador). ' +
              'Sé prudente: si dudas, o la cara está borrosa, muy oscura, cortada o de espaldas, baja la confianza por debajo de 50. ' +
              `Además escribe "phrase": una frase MUY corta (máx. 10 palabras), cálida, en español, dirigida a "${firstName}", ` +
              actionPromptHint(ctx.type) + '. ' +
              `NO incluyas "buenos días", "buenas tardes" ni "buenas noches" en "phrase" (el saludo de la hora lo pone el sistema; ahora es ${partOfDay(ctx.hour)}). ` +
              'Responde SOLO con JSON: {"match": true|false, "confidence": <entero 0-100>, "reasoning": "<motivo breve en español>", "phrase": "<la frase>"}.',
          },
          { role: 'user', content: userContent },
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
      const match = json.match === true || json.match === 'true';
      let phrase = stripSalutation(typeof json.phrase === 'string' ? json.phrase : '');
      if (!phrase) phrase = fallbackPhrase(ctx.type);
      return { available: true, match, confidence, reasoning: String(json.reasoning || ''), greeting: compose(phrase) };
    } catch (e: any) {
      this.logger.warn(`verify falló: ${e?.message || e}`);
      return { available: false, match: false, confidence: 0, reasoning: `Error de la IA: ${e?.message || e}`, greeting: fallbackGreeting };
    }
  }
}
