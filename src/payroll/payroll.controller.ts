import {
  BadRequestException,
  Controller,
  Get,
  InternalServerErrorException,
  Logger,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { StaffGuard } from '../auth/staff.guard';
import { PayrollService } from './payroll.service';
import { renderPayrollPdfBuffer } from './payroll.pdf';

function parseMonth(month?: string): { year: number; month: number } {
  if (!month) {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  }
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) throw new BadRequestException("Parámetro 'month' debe ser YYYY-MM");
  return { year: +m[1], month: +m[2] };
}

@Controller('payroll')
export class PayrollController {
  private readonly logger = new Logger('PayrollController');

  constructor(
    private readonly service: PayrollService,
    private readonly config: ConfigService,
  ) {}

  @UseGuards(StaffGuard)
  @Get(':workerId')
  json(@Param('workerId') workerId: string, @Query('month') month?: string) {
    const { year, month: m } = parseMonth(month);
    return this.service.computeMonth(workerId, year, m);
  }

  @UseGuards(StaffGuard)
  @Get(':workerId/trend')
  trend(@Param('workerId') workerId: string, @Query('months') months?: string) {
    const n = months ? Math.max(2, Math.min(parseInt(months, 10) || 6, 24)) : 6;
    return this.service.monthlyTrend(workerId, n);
  }

  @UseGuards(StaffGuard)
  @Get(':workerId/pdf')
  async pdf(
    @Param('workerId') workerId: string,
    @Query('month') month: string | undefined,
    @Res() res: Response,
    @Req() _req: any,
  ) {
    const { year, month: m } = parseMonth(month);
    try {
      const payroll = await this.service.computeMonth(workerId, year, m);
      const filename = `nomina-${payroll.worker.code || payroll.worker.id.slice(0, 8)}-${year}-${String(m).padStart(2, '0')}.pdf`;
      // Generamos el PDF entero en memoria (Buffer). Más robusto que streaming detrás
      // de compression() y proxies inversos. El reporte mensual pesa pocas decenas de KB.
      const buf = await renderPayrollPdfBuffer(payroll, {
        companyName: this.config.get<string>('COMPANY_NAME') || 'Face to Work',
        companyTagline: this.config.get<string>('COMPANY_TAGLINE') || 'Control de asistencia con reconocimiento facial',
      });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', String(buf.length));
      res.setHeader('Cache-Control', 'no-store');
      res.end(buf);
    } catch (e: any) {
      // Loguear con detalle del workerId/month antes de relanzar, para diagnóstico en prod.
      this.logger.error(
        `Error generando PDF nómina worker=${workerId} month=${year}-${m}: ${e?.message || e}`,
        e?.stack,
      );
      throw new InternalServerErrorException(
        `No se pudo generar el PDF: ${e?.message || 'error interno'}`,
      );
    }
  }
}
