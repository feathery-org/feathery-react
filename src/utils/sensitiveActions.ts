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
    _sendSmsCode: (phoneNumber: string) => {
      const { client } = internalState[formUuid];
      return Auth.sendSms(phoneNumber, client);
    },
    _telesignVoice: (phoneNumber: string) => {
      const { client } = internalState[formUuid];
      return client.telesignVoiceOTP(phoneNumber);
    },
    _sendEmail: (templateId: string) => {
      const { client } = internalState[formUuid];
      return client.sendEmail(templateId);
    }
  };
};
