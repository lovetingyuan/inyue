import type { Account } from "~~/shared/types/library";

export interface OfflineAccount {
  account: Account;
  expiresAt: number;
}

export interface OfflineState {
  revision: string;
  profile?: OfflineAccount;
}
