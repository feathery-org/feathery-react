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

export async function installRecaptcha(steps: Record<string, any>) {
  if (recaptchaReady) return;

  const shouldInstall = Object.values(steps).some((step) =>
    step.buttons.some((button: any) => button.properties.captcha_verification)
  );
  if (shouldInstall) {
    await dynamicImport(
      'https://www.google.com/recaptcha/api.js?render=6Lcx9vAmAAAAAKnC1kO1nIdr125hCRfukaMb_R_-'
    ).then(() =>
      // Sometimes recaptcha fails to install, so use ?.
      // https://feathery-forms.sentry.io/issues/4378968555
      featheryWindow().grecaptcha?.ready(() => (recaptchaReady = true))
    );
  }
}

export async function verifyRecaptcha(client: any) {
  await waitOnRecaptcha();
  return featheryWindow()
    .grecaptcha.execute('6Lcx9vAmAAAAAKnC1kO1nIdr125hCRfukaMb_R_-', {
      action: 'submit'
    })
    .then((token: string) => client.verifyRecaptchaToken(token))
    .then((data: any) => data.score < ERROR_THRESHOLD);
}
