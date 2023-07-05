import { dynamicImport } from './utils';
import { featheryWindow } from '../utils/browser';

export async function verifyRecaptcha(client: any) {
  await dynamicImport(
    'https://www.google.com/recaptcha/api.js?render=6Lcx9vAmAAAAAKnC1kO1nIdr125hCRfukaMb_R_-'
  );
  featheryWindow().grecaptcha.ready(() => {
    featheryWindow()
      .grecaptcha.execute('6Lcx9vAmAAAAAKnC1kO1nIdr125hCRfukaMb_R_-', {
        action: 'submit'
      })
      .then((token: string) => client.verifyRecaptchaToken(token))
      .then((data: any) => console.log(data.score));
  });
}
