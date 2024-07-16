import { useEffect, useRef } from 'react';
import { featheryWindow } from '../utils/browser';

export default function useOTPListener(onOTP: (otp: string) => void) {
  const onOTPRef = useRef(onOTP);

  useEffect(() => {
    onOTPRef.current = onOTP;
  }, [onOTP]);

  useEffect(() => {
    // not supported on user's browser
    if (!('OTPCredential' in featheryWindow())) {
      console.log('WebOTP API not supported');
      return;
    }

    // cancelable signal on unmount
    const abortController = new AbortController();

    // Invoke the WebOTP API and listen to otp sms
    navigator.credentials
      .get({
        otp: { transport: ['sms'] },
        signal: abortController.signal
      } as any)
      .then((otp: any) => {
        onOTPRef.current(otp.code);
      })
      .catch((err) => {
        console.log(err);
      });

    return () => {
      abortController.abort();
    };
  }, []);
}
