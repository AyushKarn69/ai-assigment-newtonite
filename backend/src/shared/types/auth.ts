/**
 * Authenticated user context attached to requests.
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  role: GlobalRole;
}

export enum GlobalRole {
  ADMIN = 'ADMIN',
  USER = 'USER',
}

export enum TeamRole {
  MANAGER = 'MANAGER',
  MEMBER = 'MEMBER',
}

export interface TeamMembership {
  teamId: string;
  role: TeamRole;
}
