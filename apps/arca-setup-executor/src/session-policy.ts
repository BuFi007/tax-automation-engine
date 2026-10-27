import type { ArcaSetupHandoffTicket } from '@tax-engine/arca-setup-contract';
import { mayControl, type ControlState } from '@tax-engine/arca-setup-contract/control';

/**
 * Which handoff tickets the session may redeem. Pure: the Durable Object reads
 * storage, asks here, and records the redemption in the same transaction.
 */

type Role = 'customer' | 'provider';
export type PolicyCurrent = {
  state: 'queued' | 'awaiting_handoff' | 'done';
  handoff: { role: Role; reason: 'authentication' | 'choice' } | null;
};

export type TicketRefusal = 'redeemed_or_finished' | 'no_pending_sign_in' | 'private_sign_in' | 'preview_unavailable' | 'not_controller' | null;

export const TICKET_REFUSAL_MESSAGES: Record<Exclude<TicketRefusal, null>, string> = {
  redeemed_or_finished: 'Este enlace ya se usó o el trámite terminó. Volvé a BUFI.',
  no_pending_sign_in: 'No hay un ingreso pendiente para este trámite. Volvé a BUFI.',
  private_sign_in: 'Ingreso privado en curso. La vista previa vuelve cuando termines de ingresar.',
  preview_unavailable: 'La vista previa no está disponible.',
  not_controller: 'El control de esta sesión no es tuyo en este momento.',
};

export function currentHandoff(current: PolicyCurrent | null | undefined): 'none' | 'authentication' | 'choice' {
  return current?.state === 'awaiting_handoff' && current.handoff ? current.handoff.reason : 'none';
}

export function ticketRefusal(input: {
  purpose: ArcaSetupHandoffTicket['purpose'];
  ticketExecutionId: string;
  actorId: string;
  metaExecutionId: string | null;
  redeemed: boolean;
  cancelled: boolean;
  current: PolicyCurrent | null;
  control: ControlState;
  liveViewConfigured: boolean;
}): TicketRefusal {
  const { current } = input;
  if (input.metaExecutionId !== input.ticketExecutionId || input.redeemed || input.cancelled) return 'redeemed_or_finished';
  switch (input.purpose) {
    case 'customer_authentication':
    case 'provider_authentication': {
      const role: Role = input.purpose === 'provider_authentication' ? 'provider' : 'customer';
      if (current?.state !== 'awaiting_handoff' || current.handoff?.role !== role) return 'no_pending_sign_in';
      return null;
    }
    case 'customer_view':
      // Credentials are being typed: no shared preview, only the private sign-in tab.
      if (currentHandoff(current) === 'authentication') return 'private_sign_in';
      if (!input.liveViewConfigured) return 'preview_unavailable';
      return null;
    case 'customer_control':
      return mayControl(input.control, input.actorId) ? null : 'not_controller';
  }
}
