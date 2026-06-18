/**
 * Seed de demostración — LOGICONTROL PRO
 *
 * Crea datos claramente identificados como demo.
 * Idempotente: puede ejecutarse varias veces sin duplicar registros.
 * No contiene contraseñas ni credenciales.
 *
 * Ejecutar con: npm run prisma:seed
 */

import { PrismaClient, ExpirationCategory, AuditAction } from '@prisma/client';

const prisma = new PrismaClient();

// IDs fijos para garantizar idempotencia mediante upsert
const DEMO_COMPANY_ID     = '00000000-0000-0000-0000-000000000001';
const DEMO_DRIVER_ID      = '00000000-0000-0000-0000-000000000002';
const DEMO_VEHICLE_ID     = '00000000-0000-0000-0000-000000000003';
const DEMO_EXPIRATION_ID  = '00000000-0000-0000-0000-000000000004';
const DEMO_HAZARDOUS_ID   = '00000000-0000-0000-0000-000000000005';
const DEMO_AUDIT_ID       = '00000000-0000-0000-0000-000000000006';

async function main() {
  console.log('🌱 Iniciando seed de demostración...\n');

  // ── 1. Empresa demo ────────────────────────────────────────
  const company = await prisma.company.upsert({
    where: { id: DEMO_COMPANY_ID },
    update: { name: '[DEMO] LogiCorp S.A.', taxId: 'DEMO-00000000' },
    create: {
      id: DEMO_COMPANY_ID,
      name: '[DEMO] LogiCorp S.A.',
      taxId: 'DEMO-00000000',
      active: true,
    },
  });
  console.log(`✅ Empresa:   ${company.name} (${company.id})`);

  // ── 2. Chofer demo ─────────────────────────────────────────
  const driver = await prisma.driver.upsert({
    where: { id: DEMO_DRIVER_ID },
    update: {
      name: 'Juan',
      lastName: 'Pérez (Demo)',
      dni: '00000001',
      licenseCategory: 'D',
      licenseNumber: 'LIC-DEMO-0001',
    },
    create: {
      id: DEMO_DRIVER_ID,
      companyId: DEMO_COMPANY_ID,
      name: 'Juan',
      lastName: 'Pérez (Demo)',
      dni: '00000001',
      licenseCategory: 'D',
      licenseNumber: 'LIC-DEMO-0001',
      notes: 'Chofer de demostración',
      active: true,
    },
  });
  console.log(`✅ Chofer:    ${driver.name} ${driver.lastName} (${driver.id})`);

  // ── 3. Vehículo demo asociado al chofer ────────────────────
  const vehicle = await prisma.vehicle.upsert({
    where: { id: DEMO_VEHICLE_ID },
    update: {
      patent: 'DEMO 001',
      brand: 'Mercedes-Benz',
      model: 'Actros 2651 (Demo)',
      year: 2024,
      driverId: DEMO_DRIVER_ID,
    },
    create: {
      id: DEMO_VEHICLE_ID,
      companyId: DEMO_COMPANY_ID,
      patent: 'DEMO 001',
      brand: 'Mercedes-Benz',
      model: 'Actros 2651 (Demo)',
      year: 2024,
      driverId: DEMO_DRIVER_ID,
      notes: 'Vehículo de demostración',
      active: true,
    },
  });
  console.log(`✅ Vehículo:  ${vehicle.patent} — ${vehicle.brand} ${vehicle.model} (${vehicle.id})`);

  // ── 4. Vencimiento demo asociado al vehículo ───────────────
  const expiration = await prisma.expiration.upsert({
    where: { id: DEMO_EXPIRATION_ID },
    update: {
      type: 'Seguro RC (Demo)',
      category: ExpirationCategory.VEHICLE,
      vehicleId: DEMO_VEHICLE_ID,
      issueDate: new Date('2025-01-01'),
      expiryDate: new Date('2026-12-31'),
      observations: 'Vencimiento de demostración',
    },
    create: {
      id: DEMO_EXPIRATION_ID,
      companyId: DEMO_COMPANY_ID,
      type: 'Seguro RC (Demo)',
      category: ExpirationCategory.VEHICLE,
      vehicleId: DEMO_VEHICLE_ID,
      driverId: null,
      issueDate: new Date('2025-01-01'),
      expiryDate: new Date('2026-12-31'),
      description: 'Seguro de Responsabilidad Civil — datos demo',
      observations: 'Vencimiento de demostración',
    },
  });
  console.log(`✅ Vencimiento: ${expiration.type} — vto. ${expiration.expiryDate.toISOString().split('T')[0]} (${expiration.id})`);

  // ── 5. Documento de residuos peligrosos demo ───────────────
  const hazardous = await prisma.hazardousDocument.upsert({
    where: { id: DEMO_HAZARDOUS_ID },
    update: {
      type: 'Habilitación Ambiental (Demo)',
      entityName: '[DEMO] LogiCorp S.A.',
      permitNumber: 'HA-DEMO-001',
      issuingAuthority: 'Min. Ambiente (Demo)',
      issueDate: new Date('2025-01-01'),
      expiryDate: new Date('2026-06-30'),
    },
    create: {
      id: DEMO_HAZARDOUS_ID,
      companyId: DEMO_COMPANY_ID,
      type: 'Habilitación Ambiental (Demo)',
      entityName: '[DEMO] LogiCorp S.A.',
      permitNumber: 'HA-DEMO-001',
      issuingAuthority: 'Min. Ambiente (Demo)',
      issueDate: new Date('2025-01-01'),
      expiryDate: new Date('2026-06-30'),
      observations: 'Documento de residuos peligrosos de demostración',
    },
  });
  console.log(`✅ Residuos:   ${hazardous.type} — permiso ${hazardous.permitNumber} (${hazardous.id})`);

  // ── 6. Registro de auditoría demo ──────────────────────────
  const audit = await prisma.auditLog.upsert({
    where: { id: DEMO_AUDIT_ID },
    update: {
      description: 'Seed de demostración ejecutado',
    },
    create: {
      id: DEMO_AUDIT_ID,
      companyId: DEMO_COMPANY_ID,
      action: AuditAction.CREATE,
      entityType: 'seed',
      entityId: DEMO_COMPANY_ID,
      entityName: '[DEMO] LogiCorp S.A.',
      description: 'Seed de demostración ejecutado',
      metadata: {
        seededAt: new Date().toISOString(),
        entities: ['company', 'driver', 'vehicle', 'expiration', 'hazardousDocument'],
      },
    },
  });
  console.log(`✅ Auditoría:  ${audit.action} — ${audit.description} (${audit.id})`);

  // ── Resumen ────────────────────────────────────────────────
  console.log('\n📊 Resumen de relaciones:');
  console.log(`   Empresa   "${company.name}"`);
  console.log(`   └─ Chofer    "${driver.name} ${driver.lastName}" (dni: ${driver.dni})`);
  console.log(`   └─ Vehículo  "${vehicle.patent}" → chofer asignado: ${vehicle.driverId}`);
  console.log(`   └─ Vencimiento "${expiration.type}" → vehicleId: ${expiration.vehicleId}`);
  console.log(`   └─ Residuos  "${hazardous.type}" → permiso: ${hazardous.permitNumber}`);
  console.log(`   └─ Auditoría id: ${audit.id}`);
  console.log('\n✅ Seed completado correctamente.\n');
}

main()
  .catch((e) => {
    console.error('❌ Error en seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
