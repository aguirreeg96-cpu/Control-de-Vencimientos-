import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { UpdateCompanyStatusDto } from './dto/update-company-status.dto';

@Injectable()
export class CompaniesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.company.findMany({ orderBy: { createdAt: 'asc' } });
  }

  async findOne(id: string) {
    const company = await this.prisma.company.findUnique({ where: { id } });
    if (!company) throw new NotFoundException('Empresa no encontrada');
    return company;
  }

  async create(dto: CreateCompanyDto) {
    if (dto.taxId) {
      const existing = await this.prisma.company.findFirst({ where: { taxId: dto.taxId } });
      if (existing) throw new ConflictException('El CUIT/CUIL ya está registrado');
    }
    return this.prisma.company.create({
      data: { name: dto.name, taxId: dto.taxId ?? null, active: true },
    });
  }

  async update(id: string, dto: UpdateCompanyDto) {
    await this.findOne(id);
    if (dto.taxId) {
      const existing = await this.prisma.company.findFirst({
        where: { taxId: dto.taxId, NOT: { id } },
      });
      if (existing) throw new ConflictException('El CUIT/CUIL ya está registrado');
    }
    return this.prisma.company.update({ where: { id }, data: dto });
  }

  async updateStatus(id: string, dto: UpdateCompanyStatusDto) {
    await this.findOne(id);
    return this.prisma.company.update({ where: { id }, data: { active: dto.active } });
  }
}
