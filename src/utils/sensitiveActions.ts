import internalState, { setFormInternalState } from './internalState';
import Auth from '../auth/internal/AuthIntegrationInterface';

// Certain actions are only supported in the no code logic rule
// And we do not want to expose them in formContext for SDK access
export const getPrivateActions = (formUuid: string) => {
  if (!internalState[formUuid]) {
    setFormInternalState(formUuid, {
      fields: {}
    });
  }

  return {
    _sendSmsCode: async (phoneNumber: string) => {
      const { client } = internalState[formUuid];
      await client.flushCustomFields();
      return Auth.sendSms(phoneNumber, client);
    },
    _telesignVoice: async (phoneNumber: string) => {
      const { client } = internalState[formUuid];
      await client.flushCustomFields();
      return client.telesignSendOTP(phoneNumber, 'voice');
    },
    _telesignSms: async (phoneNumber: string) => {
      const { client } = internalState[formUuid];
      await client.flushCustomFields();
      return client.telesignSendOTP(phoneNumber, 'sms');
    },
    _sendEmail: async (templateId: string) => {
      const { client } = internalState[formUuid];
      await client.flushCustomFields();
      return client.sendEmail(templateId);
    },
    _sendEmailOTP: async (emailAddress: string) => {
      const { client } = internalState[formUuid];
      await client.flushCustomFields();
      return client.sendEmailOTP(emailAddress);
    }
  };
};
