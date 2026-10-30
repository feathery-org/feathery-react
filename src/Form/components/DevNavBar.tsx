import React, { useMemo, useState } from 'react';
import { getStepDepthMap } from '../../utils/stepHelperFunctions';
import {
  DiagonalArrowIcon,
  LeftChevronIcon,
  RightChevronIcon
} from '../../elements/components/icons';
import { noTextSelectStyles } from '../../elements/styles';
import { DEV_NAV_BAR_Z_INDEX } from '../../utils/styles';

const lightGrey = 'rgb(235, 239, 242)';

function handleBoth(prevData: any, nextData: any, func: any) {
  return [func(prevData, nextData), func(nextData, prevData)];
}

export default function DevNavBar({
  allSteps,
  curStep,
  changeStep,
  formName,
  visible = true,
  draft
}: any) {
  const [activeNav, setActiveNav] = useState('');
  const [isVisible, setIsVisible] = useState(visible);

  const [prevStepKeys, nextStepKeys] = useMemo(() => {
    const [prevStepKeys, nextStepKeys] = handleBoth(
      null,
      null,
      () => new Set()
    );
    let [prevCondKeys, nextCondKeys] = handleBoth(
      [curStep.previous_conditions, 'previous_step_key'],
      [curStep.next_conditions, 'next_step_key'],
      // @ts-expect-error TS(7031): Binding element 'conditions' implicitly has an 'an... Remove this comment to see the full error message
      ([conditions, attr]) => new Set(conditions.map((cond: any) => cond[attr]))
    );

    // Sort by branches
    [prevCondKeys, nextCondKeys] = handleBoth(
      [prevCondKeys, prevStepKeys],
      [nextCondKeys, nextStepKeys],
      // @ts-expect-error TS(7031): Binding element 'prevCondKeys' implicitly has an '... Remove this comment to see the full error message
      ([prevCondKeys, prevStepKeys], [nextCondKeys]) =>
        Array.from(prevCondKeys).filter((key) => {
          const bidirectional = nextCondKeys.has(key);
          if (!bidirectional) prevStepKeys.add(key);
          return bidirectional;
        })
    );

    const depthMap = getStepDepthMap(allSteps);
    if (curStep.key in depthMap) {
      // Then sort by step depth
      const curDepth = depthMap[curStep.key];
      [...prevCondKeys, ...nextCondKeys].forEach((key) => {
        const depth = depthMap[key];
        if (depth < curDepth) prevStepKeys.add(key);
        else nextStepKeys.add(key);
      });
    } else {
      // If step is floating, allow forward navigation to go to origin step
      const originStep = Object.values(allSteps).find(
        (step) => (step as any).origin
      );
      nextStepKeys.add((originStep as any).key);
    }

    // If step is the first, add floating steps to the previous navigation
    if (curStep.origin) {
      Object.keys(allSteps).forEach((stepKey) => {
        if (!(stepKey in depthMap)) prevStepKeys.add(stepKey);
      });
    }

    return [Array.from(prevStepKeys), Array.from(nextStepKeys)];
  }, [curStep.id]);

  const navigate = (stepKey: any) => {
    setActiveNav('');
    changeStep(stepKey);
  };

  const stepSelector = useMemo(() => {
    if (!activeNav) return null;
    const isForward = activeNav === 'forward';
    const stepKeys = isForward ? nextStepKeys : prevStepKeys;
    return (
      <div
        css={{
          position: 'absolute',
          top: 'calc(100% + 8px)',
          maxHeight: '300px',
          width: '200px',
          backgroundColor: 'white',
          color: 'black',
          boxShadow: '0 4px 14px #00000040',
          borderRadius: '6px',
          overflowY: 'scroll',
          ...(isForward ? { right: 0 } : { left: 0 })
        }}
      >
        {stepKeys.map((key) => (
          <button
            type='button'
            // @ts-expect-error TS(2322): Type 'unknown' is not assignable to type 'Key | nu... Remove this comment to see the full error message
            key={key}
            css={{
              width: '100%',
              minHeight: '38px',
              border: 0,
              backgroundColor: 'white',
              font: 'inherit',
              textAlign: 'left',
              borderBottom: `1px solid ${lightGrey}`,
              display: 'flex',
              alignItems: 'center',
              padding: '5px 15px',
              cursor: 'pointer',
              '&:hover': { backgroundColor: lightGrey }
            }}
            onClick={() => navigate(key)}
          >
            {/* @ts-expect-error TS(2322): Type 'unknown' is not assignable to type 'ReactNod... Remove this comment to see the full error message */}
            {key}
          </button>
        ))}
      </div>
    );
  }, [prevStepKeys, nextStepKeys, activeNav]);

  return isVisible ? (
    <div
      css={{
        zIndex: DEV_NAV_BAR_Z_INDEX,
        position: 'relative',
        minHeight: '55px',
        width: '100%',
        padding: '8px 16px',
        boxSizing: 'border-box',
        backgroundColor: 'white',
        boxShadow: '-3px 3px 4px #575c8214',
        display: 'flex',
        flexWrap: 'wrap',
        gap: '8px 16px',
        alignItems: 'center'
      }}
    >
      <span css={{ flex: '1 1 240px', minWidth: 0, fontWeight: 700 }}>
        <span
          css={{
            color: '#e2626e',
            paddingRight: '8px',
            borderRight: '2px solid #cfd4dd'
          }}
        >
          {formName}
        </span>
        <span css={{ paddingLeft: '8px' }}>
          {draft ? 'Draft Preview' : 'Test Form'}
        </span>
      </span>
      <div
        css={{
          position: 'relative',
          width: '288px',
          maxWidth: '100%',
          height: '40px',
          marginLeft: 'auto',
          border: '1px solid #DBDFE8',
          borderRadius: '6px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}
      >
        <button
          type='button'
          aria-label='Previous test step'
          css={navArrowCSS}
          onClick={() => {
            if (prevStepKeys.length === 1) navigate(prevStepKeys[0]);
            else setActiveNav(activeNav === 'back' ? '' : 'back');
          }}
          style={{
            visibility: prevStepKeys.length === 0 ? 'hidden' : 'visible'
          }}
        >
          <LeftChevronIcon />
        </button>
        <span
          title={curStep.key}
          css={{
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: 'black',
            ...noTextSelectStyles
          }}
        >
          {curStep.key}
        </span>
        <button
          type='button'
          aria-label='Next test step'
          css={navArrowCSS}
          onClick={() => {
            if (nextStepKeys.length === 1) navigate(nextStepKeys[0]);
            else setActiveNav(activeNav === 'forward' ? '' : 'forward');
          }}
          style={{
            visibility: nextStepKeys.length === 0 ? 'hidden' : 'visible'
          }}
        >
          <RightChevronIcon />
        </button>
        {stepSelector}
      </div>
      <button
        type='button'
        aria-label='Hide test controls'
        css={{
          width: '32px',
          height: '32px',
          flexShrink: 0,
          padding: 0,
          border: '1px solid #DBDFE8',
          boxSizing: 'border-box',
          boxShadow: '0px 1px 2px #2b364726',
          borderRadius: '6px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'white'
        }}
        onClick={() => setIsVisible(false)}
      >
        <DiagonalArrowIcon />
      </button>
    </div>
  ) : (
    <button
      type='button'
      aria-label='Show test controls'
      css={{
        border: 0,
        padding: 0,
        zIndex: DEV_NAV_BAR_Z_INDEX,
        position: 'fixed',
        top: '0',
        backgroundColor: '#e2626e',
        // Specific values required for this to be the same height as the Preview header
        right: '-2px',
        width: '108px',
        height: '52px',
        transform: 'rotate(45deg) translate(4px,-42px)',
        boxShadow: '-3px 3px 4px #575c8214',
        cursor: 'pointer'
      }}
      onClick={() => setIsVisible(true)}
    >
      <div
        css={{
          transform: 'rotate(135deg)',
          position: 'fixed',
          right: '28px',
          bottom: '4px'
        }}
      >
        <DiagonalArrowIcon color='white' />
      </div>
    </button>
  );
}

const navArrowCSS = {
  width: '32px',
  height: '32px',
  margin: '4px',
  padding: 0,
  border: 0,
  backgroundColor: 'white',
  flexShrink: 0,
  borderRadius: '6px',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  '&:hover': { backgroundColor: lightGrey }
};
