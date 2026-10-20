import React, { useState } from 'react';
import { type LinkConfirmOutcome } from '../../utils/accessLink';

// The width FormOff lays its copy out at, so this screen and the blocked states
// it can turn into share one type scale and measure.
const WIDTH = 400;

// The outcomes that leave the user here. `storage_blocked` never reached the
// server, so the link is still good somewhere the browser can store its device
// secret, and the copy has to point the user there rather than at a retry.
const RETRY_MESSAGES: Partial<Record<LinkConfirmOutcome, string>> = {
  failed: "Couldn't open this link. Try again.",
  storage_blocked:
    "This browser can't remember this device, so the link can't be opened here. Open it directly in a new browser tab instead."
};

/**
 * Shown when a single-use access link has not been redeemed yet. The redeem is
 * deliberately behind a click: email security scanners prefetch links, and a
 * bare GET must not burn the one opening the recipient has.
 *
 * Deliberately has no illustration. FormOff's is a closed form, which reads as
 * a dead end on a screen that is about to open one, and the icon set has
 * nothing neutral at this size. Copy alone is clearer than the wrong picture.
 */
export default function LinkContinue({
  onContinue
}: {
  onContinue: () => Promise<LinkConfirmOutcome>;
}) {
  const [continuing, setContinuing] = useState(false);
  const [retryMessage, setRetryMessage] = useState('');

  const confirmDevice = async () => {
    if (continuing) return;
    setContinuing(true);
    setRetryMessage('');

    const outcome = await onContinue();
    setContinuing(false);
    // An adopted link remounts the form and a rejected one swaps in the blocked
    // state, so only the retryable outcomes leave the user on this screen. The
    // button stays enabled for all of them: storage can be allowed and the
    // click repeated without leaving the page.
    setRetryMessage(RETRY_MESSAGES[outcome] ?? '');
  };

  return (
    <div
      css={{
        width: '100%',
        height: '100%',
        minHeight: '50vh',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'white'
      }}
    >
      <div
        css={{
          maxWidth: `${WIDTH}px`,
          fontWeight: 600,
          fontSize: '26px',
          lineHeight: '32px',
          textAlign: 'center',
          margin: '50px 0'
        }}
      >
        This form link can only be opened on one device.
      </div>
      <button
        type='button'
        disabled={continuing}
        css={{
          border: '1px solid #e2626e',
          color: 'white',
          outline: 'none',
          backgroundColor: '#e2626e',
          padding: '10px 20px',
          minHeight: '44px',
          cursor: continuing ? 'default' : 'pointer',
          opacity: continuing ? 0.6 : 1,
          borderRadius: '10px',
          fontSize: '18px'
        }}
        onClick={confirmDevice}
      >
        Continue
      </button>
      {retryMessage && (
        <div
          css={{
            maxWidth: `${WIDTH}px`,
            marginTop: '20px',
            color: '#e2626e',
            fontSize: '16px',
            textAlign: 'center'
          }}
        >
          {retryMessage}
        </div>
      )}
    </div>
  );
}
