import { useContext } from 'react';
import featheryContext from './featheryContext';

export default function useFeathery() {
    return useContext(featheryContext);
}
