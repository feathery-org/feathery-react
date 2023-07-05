import { dynamicImport } from './utils';
import { featheryWindow } from '../utils/browser';

const ERROR_THRESHOLD = 0.5;

let recaptchaReady = false;

async function waitOnRecaptcha() {
  return await new Promise((resolve) => {
    const interval = setInterval(() => {
      if (recaptchaReady) {
        resolve('');
        clearInterval(interval);
      }
    }, 100);
  });
}

export async function verifyRecaptcha(client: any) {
  if (!recaptchaReady) {
    await dynamicImport(
      'https://www.google.com/recaptcha/api.js?render=6Lcx9vAmAAAAAKnC1kO1nIdr125hCRfukaMb_R_-'
    ).then(() =>
      featheryWindow().grecaptcha.ready(() => (recaptchaReady = true))
    );
  }
  await waitOnRecaptcha();

  return featheryWindow()
    .grecaptcha.execute('6Lcx9vAmAAAAAKnC1kO1nIdr125hCRfukaMb_R_-', {
      action: 'submit'
    })
    .then((token: string) => client.verifyRecaptchaToken(token))
    .then((data: any) => data.score < ERROR_THRESHOLD);
}
