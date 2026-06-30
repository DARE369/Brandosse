import {
  connectAccount,
  disconnectAccount,
  getAccountsForUser,
  triggerReconnect,
} from './platforms/connectionService';

export class MockOAuthService {
  static async connectMockAccount(platform, userId, formData = {}) {
    try {
      const data = await connectAccount({
        userId,
        platform,
        scope: 'personal',
        formData,
      });

      return {
        success: true,
        data,
        message: `Mock ${platform} account connected successfully`,
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        message: error?.message || `Failed to connect ${platform} account`,
      };
    }
  }

  static async disconnectAccount(accountId) {
    await disconnectAccount(accountId);
    return { success: true };
  }

  static async getConnectedAccounts(userId) {
    return getAccountsForUser(userId, 'personal');
  }

  static async refreshMockToken(accountId) {
    await triggerReconnect(accountId);
    return { success: true };
  }

  static async isPlatformConnected(userId, platform) {
    const accounts = await getAccountsForUser(userId, 'personal');
    return accounts.some((account) => account.platform === platform);
  }
}
