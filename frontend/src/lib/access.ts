import type { User } from '../types';

/** Data de expiracao de acesso, ja passada? (mesma logica usada no admin e aqui). */
export function isExpired(user: Pick<User, 'access_expires_at'>): boolean {
  if (!user.access_expires_at) return false;
  return new Date(user.access_expires_at).getTime() < Date.now();
}

/**
 * Tem um plano pago ativo (ou e admin, que nunca fica bloqueado)? Usado em
 * UserArea pra decidir se mostra o sistema inteiro ou so "Solicitar Acesso".
 */
export function hasPaidAccess(user: User): boolean {
  if (user.role === 'admin') return true;

  return user.status === 'active' && !isExpired(user);
}
