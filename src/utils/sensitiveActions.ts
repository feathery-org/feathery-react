import internalState, { setFormInternalState } from './internalState';
import Auth from '../auth/internal/AuthIntegrationInterface';

export const getSensitiveActions = (formUuid: string) => {
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
    }
  };
};
