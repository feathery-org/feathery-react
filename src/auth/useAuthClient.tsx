import { useContext } from 'react';
import { AuthContext } from './LoginForm';

const useAuthClient = () => useContext(AuthContext);

export default useAuthClient;
