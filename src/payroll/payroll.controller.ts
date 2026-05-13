import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { AdminGuard } from '../auth/admin.guard';
import { PayrollService } from './payroll.service';
import { renderPayrollPdf } from './payroll.pdf';

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
  constructor(
    private readonly service: PayrollService,
    private readonly config: ConfigService,
  ) {}

  @UseGuards(AdminGuard)
  @Get(':workerId')
  json(@Param('workerId') workerId: string, @Query('month') month?: string) {
    const { year, month: m } = parseMonth(month);
    return this.service.computeMonth(workerId, year, m);
  }

  @UseGuards(AdminGuard)
  @Get(':workerId/pdf')
  async pdf(
    @Param('workerId') workerId: string,
    @Query('month') month: string | undefined,
    @Res() res: Response,
    @Req() _req: any,
  ) {
    const { year, month: m } = parseMonth(month);
    const payroll = await this.service.computeMonth(workerId, year, m);
    const filename = `nomina-${payroll.worker.code || payroll.worker.id.slice(0, 8)}-${year}-${String(m).padStart(2, '0')}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    renderPayrollPdf(payroll, res, {
      companyName: this.config.get<string>('COMPANY_NAME') || 'Face to Work',
      companyTagline: this.config.get<string>('COMPANY_TAGLINE') || 'Control de asistencia con reconocimiento facial',
    });
  }
}
