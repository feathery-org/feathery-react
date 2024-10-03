import React, { useEffect, useState } from 'react';
import { FaceLivenessDetector } from '@aws-amplify/ui-react-liveness';
import { Loader, ThemeProvider } from '@aws-amplify/ui-react';
import { Amplify } from 'aws-amplify';
import awsexports from '../../../aws-exports';
import { defaultClient } from '../../../utils/init';
import FaceLivenessStyles from './styles';

Amplify.configure(awsexports);

export function FaceLivenessField({ changeStep }: any) {
  const [loading, setLoading] = useState(true);
  const [createLivenessApiData, setCreateLivenessApiData] = useState({
    sessionId: ''
  });

  useEffect(() => {
    const fetchCreateLiveness = async () => {
      /*
       * This should be replaced with a real call to your own backend API
       */
      const sessionId = await defaultClient.rekognitionSessionCreate();
      setCreateLivenessApiData({ sessionId });
      setLoading(false);
    };

    fetchCreateLiveness();
  }, []);

  const handleAnalysisComplete = async () => {
    const response = await defaultClient.rekognitionSessionResults(
      createLivenessApiData.sessionId
    );
    let nextStep = 'Success';
    if (!response.is_live) nextStep = 'Not Live';
    else if (!response.face_matched) nextStep = 'Not Same Person';
    changeStep(nextStep);
  };

  return (
    <ThemeProvider>
      <FaceLivenessStyles />
      {loading ? (
        <Loader />
      ) : (
        <FaceLivenessDetector
          sessionId={createLivenessApiData.sessionId}
          region='us-east-1'
          onAnalysisComplete={handleAnalysisComplete}
          onError={(error) => console.error(error)}
        />
      )}
    </ThemeProvider>
  );
}
