import React, { useState } from 'react';
import MicrophoneIcon from '../elements/components/icons/MicrophoneIcon';
import Microphone from './Microphone';

const styles = {
  button: {
    width: '35px',
    height: '35px',
    backgroundColor: 'red',
    border: '0',
    borderRadius: '35px',
    margin: '18px',
    outline: 'none',
    display: 'flex',
    alignItems: 'center', // center the icon vertically
    justifyContent: 'center', // center the icon horizontally,
    cursor: 'pointer', // Change cursor to pointer
    transition: '0.3s' // Smooth transition for hover effects
  },
  hover: {
    // Hover effect (you can customize this as you see fit)
    transform: 'scale(1.05)',
    boxShadow: '0px 0px 5px 0px rgba(0,0,0,0.3)'
  },
  notRec: {
    backgroundColor: 'darkred'
  },
  Rec: {
    animationName: 'pulse',
    animationDuration: '1.5s',
    animationIterationCount: 'infinite',
    animationTimingFunction: 'linear'
  },
  icon: {
    color: 'lightgrey',
    fontSize: '20px' // Adjust size as necessary
  }
};

export default function RecordButton({ updateFieldValues, client }: any) {
  const [isHovered, setIsHovered] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [microphone] = useState(new Microphone(updateFieldValues, client));

  const combinedStyles = {
    ...styles.button,
    ...(isRecording ? styles.Rec : styles.notRec),
    ...(isHovered ? styles.hover : {})
  };

  return (
    <button
      id='recButton'
      style={combinedStyles}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        if (isRecording) {
          setIsRecording(false);
          microphone.stopRecording();
        } else {
          setIsRecording(true);
          microphone.startRecording();
        }
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <MicrophoneIcon color='lightgrey' width={20} height={20} />
    </button>
  );
}
