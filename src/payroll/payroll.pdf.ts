// PDFKit es CommonJS: `module.exports = PDFDocument`. Usamos require() directo
// para evitar problemas de interop ESM/CJS en producción — con `import * as` y
// esModuleInterop=true, tsc envuelve el módulo en un namespace y `new (X)()` falla.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument: any = require('pdfkit');
import { Writable } from 'stream';
import { MonthlyPayroll } from './payroll.service';

function fmtDur(min: number): string {
  if (!min) return '0 h';
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

const STATUS_LABEL: Record<string, string> = {
  present: 'Presente',
  late: 'Tardanza',
  absent: 'Ausente',
  justified: 'Justificado',
  rest: 'Descanso',
  holiday: 'Feriado',
  partial: 'Sin salida',
};

const STATUS_COLOR: Record<string, string> = {
  present: '#10b981',
  late: '#f59e0b',
  absent: '#ef4444',
  justified: '#6366f1',
  rest: '#64748b',
  holiday: '#a78bfa',
  partial: '#f97316',
};

interface RenderOpts {
  companyName: string;
  companyTagline: string;
}

/**
 * Renderiza un PDF de reporte mensual sobre el writable stream proporcionado.
 * El caller es responsable de pipe()-ear el stream al destino HTTP/file.
 *
 * Para producción, prefiere `renderPayrollPdfBuffer` que devuelve el PDF
 * completo en memoria — más robusto frente a middlewares de compresión
 * y proxies que buffereá streams.
 */
export function renderPayrollPdf(payroll: MonthlyPayroll, out: Writable, opts: RenderOpts): void {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 40,
    info: { Title: `Reporte ${payroll.worker.name} ${payroll.month.label}`, Author: opts.companyName },
  });
  doc.pipe(out);

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const left = doc.page.margins.left;

  // --- Header ---
  doc.fillColor('#0f172a').fontSize(20).font('Helvetica-Bold').text(opts.companyName, left, 38);
  doc.fillColor('#64748b').fontSize(9).font('Helvetica').text(opts.companyTagline, left, doc.y);
  doc.fillColor('#4f46e5').fontSize(11).font('Helvetica-Bold').text('Reporte mensual de asistencia', left, 38, { width: pageWidth, align: 'right' });
  doc.fillColor('#64748b').fontSize(9).font('Helvetica').text(payroll.month.label.toUpperCase(), { width: pageWidth, align: 'right' });

  // Línea separadora
  doc.moveTo(left, 90).lineTo(left + pageWidth, 90).strokeColor('#e2e8f0').lineWidth(1).stroke();

  // --- Datos del trabajador ---
  doc.moveDown(1);
  let y = 102;
  doc.fillColor('#0f172a').fontSize(14).font('Helvetica-Bold').text(payroll.worker.name, left, y);
  y = doc.y + 2;
  const subtitle: string[] = [];
  if (payroll.worker.code) subtitle.push(`Cód. ${payroll.worker.code}`);
  if (payroll.worker.position) subtitle.push(payroll.worker.position);
  if (payroll.worker.department) subtitle.push(payroll.worker.department);
  if (subtitle.length) {
    doc.fillColor('#64748b').fontSize(10).font('Helvetica').text(subtitle.join(' · '), left, y);
    y = doc.y + 1;
  }
  doc.fillColor('#94a3b8').fontSize(9).font('Helvetica').text(payroll.worker.email, left, y);

  // --- Totales (4×2 grid) ---
  doc.moveDown(2);
  const totalsY = doc.y;
  const cellW = pageWidth / 4;
  const cellH = 50;
  const cells: Array<{ label: string; value: string; tone?: string }> = [
    { label: 'DÍAS LABORABLES', value: String(payroll.totals.workDays) },
    { label: 'DÍAS TRABAJADOS', value: String(payroll.totals.workedDays), tone: '#10b981' },
    { label: 'HORAS REGULARES', value: fmtDur(payroll.totals.workedMinutes - payroll.totals.overtimeMinutes), tone: '#0ea5e9' },
    { label: 'HORAS EXTRA', value: fmtDur(payroll.totals.overtimeMinutes), tone: '#6366f1' },
    { label: 'TARDANZAS', value: `${payroll.totals.lateDays}` + (payroll.totals.lateMinutes ? ` (${fmtDur(payroll.totals.lateMinutes)})` : ''), tone: '#f59e0b' },
    { label: 'AUSENCIAS', value: String(payroll.totals.absentDays), tone: '#ef4444' },
    { label: 'JUSTIFICADAS', value: String(payroll.totals.justifiedDays), tone: '#8b5cf6' },
    { label: 'ACTIVIDADES', value: `${payroll.totals.activitiesCount}` + (payroll.totals.activitiesMinutes ? ` (${fmtDur(payroll.totals.activitiesMinutes)})` : ''), tone: '#64748b' },
  ];
  cells.forEach((c, i) => {
    const col = i % 4;
    const row = Math.floor(i / 4);
    const x = left + col * cellW;
    const cy = totalsY + row * (cellH + 4);
    doc.roundedRect(x, cy, cellW - 4, cellH, 4).fillColor('#f8fafc').fill();
    doc.fillColor('#64748b').fontSize(7).font('Helvetica-Bold').text(c.label, x + 8, cy + 6, { width: cellW - 16 });
    doc.fillColor(c.tone || '#0f172a').fontSize(13).font('Helvetica-Bold').text(c.value, x + 8, cy + 22, { width: cellW - 16 });
  });

  // --- Detalle diario (tabla) ---
  const tableY = totalsY + 2 * (cellH + 4) + 18;
  doc.fillColor('#0f172a').fontSize(11).font('Helvetica-Bold').text('Detalle diario', left, tableY);
  doc.fillColor('#94a3b8').fontSize(8).font('Helvetica').text('Sólo se muestran días con eventos o laborables.', left, doc.y);

  let rowY = doc.y + 8;
  const headers = ['Fecha', 'Día', 'Entrada', 'Almuerzo', 'Vuelta', 'Salida', 'Trabajadas', 'Estado', 'Tardanza', 'Extra'];
  const widths = [60, 30, 50, 50, 50, 50, 60, 65, 50, 50];
  const totalW = widths.reduce((a, b) => a + b, 0);
  const scale = pageWidth / totalW;
  const cols = widths.map((w) => w * scale);

  // Función para dibujar la cabecera de la tabla (se repite en cada página nueva).
  function drawTableHeader(y: number): number {
    doc.fillColor('#475569').fontSize(8).font('Helvetica-Bold');
    let xx = left;
    for (let i = 0; i < headers.length; i++) {
      doc.text(headers[i], xx + 4, y + 4, { width: cols[i] - 8 });
      xx += cols[i];
    }
    const next = y + 18;
    doc.moveTo(left, next - 2).lineTo(left + pageWidth, next - 2).strokeColor('#e2e8f0').lineWidth(0.6).stroke();
    return next;
  }

  rowY = drawTableHeader(rowY);

  // Data rows
  doc.font('Helvetica').fontSize(8);
  for (const r of payroll.daily) {
    // Salto de página + redibujar cabecera de la tabla.
    // Reservamos 36 px porque la fila puede traer una sub-línea de justificación.
    if (rowY > doc.page.height - doc.page.margins.bottom - 36) {
      doc.addPage();
      rowY = doc.page.margins.top;
      rowY = drawTableHeader(rowY);
      doc.font('Helvetica').fontSize(8);
    }
    // skip días sin eventos y no laborables (descanso plano sin nada interesante)
    const empty = !r.firstIn && !r.lastOut && r.status === 'rest';
    if (empty) continue;

    const cells = [
      r.date.slice(8) + '/' + r.date.slice(5, 7),
      r.weekday,
      r.firstIn || '—',
      r.lunchOut || '—',
      r.lunchIn || '—',
      r.lastOut || '—',
      r.workedMinutes ? fmtDur(r.workedMinutes) : '—',
      STATUS_LABEL[r.status] || r.status,
      r.lateMinutes ? `${r.lateMinutes} min` : '—',
      r.overtimeMinutes ? `${r.overtimeMinutes} min` : '—',
    ];
    let x = left;
    for (let i = 0; i < cells.length; i++) {
      if (i === 7) {
        // Status con color
        doc.fillColor(STATUS_COLOR[r.status] || '#0f172a');
      } else {
        doc.fillColor('#334155');
      }
      doc.text(cells[i], x + 4, rowY + 4, { width: cols[i] - 8 });
      x += cols[i];
    }
    rowY += 16;

    // Si hay justificación, agrega una línea pequeña debajo
    if (r.justification) {
      doc.fillColor('#6366f1').fontSize(7).font('Helvetica-Oblique').text(
        `Justificación (${r.justification.type}): ${r.justification.reason.slice(0, 110)}`,
        left + cols[0] + cols[1] + 4,
        rowY,
        { width: pageWidth - cols[0] - cols[1] - 4 },
      );
      doc.fontSize(8).font('Helvetica');
      rowY += 12;
    }

    // separador suave
    doc.moveTo(left, rowY - 1).lineTo(left + pageWidth, rowY - 1).strokeColor('#f1f5f9').lineWidth(0.4).stroke();
  }

  // --- Footer ---
  const footY = doc.page.height - doc.page.margins.bottom + 8;
  doc.fillColor('#94a3b8').fontSize(7).font('Helvetica').text(
    `Generado el ${new Date().toLocaleString('es-EC')} · ${opts.companyName}`,
    left,
    footY,
    { width: pageWidth, align: 'center' },
  );

  doc.end();
}

/**
 * Versión bufferizada — genera el PDF entero en memoria y resuelve con un Buffer.
 * Más confiable en producción detrás de `compression()` y proxies: se envía con
 * Content-Length conocido y sin streaming chunked.
 *
 * Internamente reusa `renderPayrollPdf` capturando los chunks que PDFKit emite.
 */
export function renderPayrollPdfBuffer(payroll: MonthlyPayroll, opts: RenderOpts): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _enc, cb) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        cb();
      },
    });
    sink.on('finish', () => resolve(Buffer.concat(chunks)));
    sink.on('error', reject);
    try {
      renderPayrollPdf(payroll, sink, opts);
    } catch (e) {
      reject(e);
    }
  });
}
