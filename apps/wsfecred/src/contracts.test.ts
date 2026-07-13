import { describe, expect, test } from 'bun:test';

import {
  buildLifecycleResponse,
  computeTacitAcceptanceDeadline,
  daysUntilTacitAcceptance,
  DEFAULT_ACCEPTANCE_WINDOW_DAYS,
  lifecycleResponseSchema,
  mapLifecycleState,
  parseLifecycleCoordinates,
  resolveAcceptanceWindowDays,
  type LifecycleState,
  type NormalizedLifecycle,
} from './contracts';

function norm(overrides: Partial<NormalizedLifecycle> = {}): NormalizedLifecycle {
  return {
    estadoComprobante: null,
    estadoCtaCte: null,
    tipoAceptacion: null,
    opcionTransferencia: null,
    fechaEmision: null,
    fechaHoraAcep: null,
    fechaVenAcep: null,
    codMoneda: null,
    importeTotal: null,
    saldoAceptado: null,
    codCtaCte: null,
    ...overrides,
  };
}

describe('ARCA tuple -> desk lifecycle state mapping', () => {
  const cases: ReadonlyArray<readonly [string, Partial<NormalizedLifecycle>, LifecycleState]> = [
    ['full cancellation wins over acceptance', { estadoCtaCte: 'CanceladaTotal', estadoComprobante: 'Aceptado', tipoAceptacion: 'Expresa' }, 'cancelada'],
    ['comprobante rechazado', { estadoComprobante: 'Rechazado' }, 'rechazada'],
    ['cuenta corriente rechazada', { estadoCtaCte: 'Rechazada' }, 'rechazada'],
    ['express acceptance', { estadoComprobante: 'Aceptado', tipoAceptacion: 'Expresa' }, 'aceptada_expresa'],
    ['tacit acceptance', { estadoComprobante: 'Aceptado', tipoAceptacion: 'Tacita' }, 'aceptada_tacita'],
    ['accepted via cuenta corriente estado', { estadoCtaCte: 'Aceptada', tipoAceptacion: 'Tacita' }, 'aceptada_tacita'],
    ['accepted but form unqualified fails closed', { estadoComprobante: 'Aceptado', tipoAceptacion: null }, 'unknown'],
    ['pending reception is still emitida', { estadoComprobante: 'PendienteRecepcion' }, 'emitida'],
    ['received but not acted on is emitida', { estadoComprobante: 'Recepcionado' }, 'emitida'],
    ['modifiable cuenta corriente is emitida', { estadoCtaCte: 'Modificable' }, 'emitida'],
    ['empty tuple is unknown', {}, 'unknown'],
  ];
  for (const [name, input, expected] of cases) {
    test(name, () => expect(mapLifecycleState(norm(input))).toBe(expected));
  }

  test('SCA transfer option never fabricates a cedida state (no ARCA cesión estado exists)', () => {
    expect(mapLifecycleState(norm({ estadoComprobante: 'Aceptado', tipoAceptacion: 'Expresa', opcionTransferencia: 'SCA' }))).toBe('aceptada_expresa');
    expect(mapLifecycleState(norm({ estadoComprobante: 'PendienteRecepcion', opcionTransferencia: 'SCA' }))).toBe('emitida');
    // `cedida` is reserved in the contract but the mapper never emits it.
    const everyMapped = cases.map(([, input]) => mapLifecycleState(norm(input)));
    expect(everyMapped).not.toContain('cedida');
  });
});

describe('acceptance-window math (21 días corridos, Resolución 219/2025)', () => {
  test('default window is 21 calendar days', () => {
    expect(DEFAULT_ACCEPTANCE_WINDOW_DAYS).toBe(21);
    expect(computeTacitAcceptanceDeadline('2026-07-01')).toBe('2026-07-22');
  });

  test('adds días corridos across month and year boundaries', () => {
    expect(computeTacitAcceptanceDeadline('2026-07-15', 21)).toBe('2026-08-05');
    expect(computeTacitAcceptanceDeadline('2026-02-15', 21)).toBe('2026-03-08');
    expect(computeTacitAcceptanceDeadline('2026-12-20', 21)).toBe('2027-01-10');
  });

  test('countdown resolves "today" in Buenos Aires, not UTC', () => {
    // 2026-07-10T12:00Z is 09:00 in Buenos Aires (UTC-3): today = 2026-07-10.
    expect(daysUntilTacitAcceptance('2026-07-01', '2026-07-10T12:00:00.000Z', 21)).toBe(12);
    // 2026-07-10T02:30Z is 2026-07-09 23:30 in Buenos Aires: today = 2026-07-09.
    expect(daysUntilTacitAcceptance('2026-07-01', '2026-07-10T02:30:00.000Z', 21)).toBe(13);
  });

  test('window config parses, defaults, and fails closed on garbage', () => {
    expect(resolveAcceptanceWindowDays(undefined)).toBe(21);
    expect(resolveAcceptanceWindowDays('')).toBe(21);
    expect(resolveAcceptanceWindowDays('25')).toBe(25);
    expect(() => resolveAcceptanceWindowDays('0')).toThrow('FCE_ACCEPTANCE_WINDOW_DAYS_INVALID');
    expect(() => resolveAcceptanceWindowDays('abc')).toThrow('FCE_ACCEPTANCE_WINDOW_DAYS_INVALID');
    expect(() => resolveAcceptanceWindowDays('400')).toThrow('FCE_ACCEPTANCE_WINDOW_DAYS_INVALID');
  });

  test('rejects an unparseable anchor date', () => {
    expect(() => computeTacitAcceptanceDeadline('07/01/2026')).toThrow('WSFECRED_ANCHOR_DATE_INVALID');
  });
});

describe('lifecycle path coordinate parsing', () => {
  test('accepts valid FCE coordinates', () => {
    expect(parseLifecycleCoordinates({ cuitEmisor: '20123456786', pointOfSale: '4', comprobanteType: '201', invoiceNumber: '81' }))
      .toEqual({ cuitEmisor: '20123456786', pointOfSale: 4, comprobanteType: 201, invoiceNumber: '81' });
  });

  test('rejects a bad CUIT check digit', () => {
    expect(() => parseLifecycleCoordinates({ cuitEmisor: '20123456787', pointOfSale: '4', comprobanteType: '201', invoiceNumber: '81' })).toThrow();
  });

  test('rejects a non-FCE comprobante type', () => {
    // 6 = Factura B (not an FCE MiPyMEs type); 200 is not in the set.
    expect(() => parseLifecycleCoordinates({ cuitEmisor: '20123456786', pointOfSale: '4', comprobanteType: '6', invoiceNumber: '81' })).toThrow();
    expect(() => parseLifecycleCoordinates({ cuitEmisor: '20123456786', pointOfSale: '4', comprobanteType: '200', invoiceNumber: '81' })).toThrow();
  });

  test('rejects non-numeric path segments', () => {
    expect(() => parseLifecycleCoordinates({ cuitEmisor: '20123456786', pointOfSale: 'x', comprobanteType: '201', invoiceNumber: '81' })).toThrow('WSFECRED_POINT_OF_SALE_INVALID');
  });
});

describe('lifecycle response assembly', () => {
  test('builds the pinned response and a countdown estimate from emission', () => {
    const response = buildLifecycleResponse(
      { cuitEmisor: '20123456786', pointOfSale: 4, comprobanteType: 201, invoiceNumber: '81' },
      norm({ estadoComprobante: 'Aceptado', estadoCtaCte: 'Aceptada', tipoAceptacion: 'Expresa', fechaEmision: '2026-07-01', fechaHoraAcep: '2026-07-10T12:00:00', fechaVenAcep: '2026-07-22', saldoAceptado: '15000.00', codMoneda: 'PES', importeTotal: '15000.00', codCtaCte: '778899', opcionTransferencia: 'ADC' }),
      21
    );
    expect(response).toEqual(expect.objectContaining({
      schema: 'motora-wsfecred-lifecycle-v1',
      estado: 'aceptada_expresa',
      fchVtoAceptacion: '2026-07-22',
      fchAceptacion: '2026-07-10T12:00:00',
      montoAceptado: '15000.00',
    }));
    expect(response.raw.fchVtoAceptacionEstimado).toBe('2026-07-22');
    expect(response.raw.opcionTransferencia).toBe('ADC');
    // Round-trips through the published schema.
    expect(() => lifecycleResponseSchema.parse(response)).not.toThrow();
  });

  test('estimate is null when there is no usable emission date', () => {
    const response = buildLifecycleResponse(
      { cuitEmisor: '20123456786', pointOfSale: 4, comprobanteType: 211, invoiceNumber: '5' },
      norm({ estadoComprobante: 'PendienteRecepcion', fechaEmision: null }),
      21
    );
    expect(response.estado).toBe('emitida');
    expect(response.raw.fchVtoAceptacionEstimado).toBeNull();
  });
});
