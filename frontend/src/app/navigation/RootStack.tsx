import React from 'react';
import {createNativeStackNavigator} from '@react-navigation/native-stack';

// Existing screens
import HomeScreen from '../screens/HomeScreen';
import EnrollmentScreen from '../screens/EnrollmentScreen';
import VerificationScreen from '../screens/VerificationScreen';
import AdminScreen from '../screens/AdminScreen';

// New role-based flow screens
import WelcomeScreen from '../screens/WelcomeScreen';
import AdminAuthScreen from '../screens/admin/AdminAuthScreen';
import AdminSignupScreen from '../screens/admin/AdminSignupScreen';
import AdminLoginScreen from '../screens/admin/AdminLoginScreen';
import AdminMain from './AdminTabs';
import AddWorkerScreen from '../screens/admin/AddWorkerScreen';
import AdminWorkerCalendarScreen from '../screens/admin/AdminWorkerCalendarScreen';
import WorkerLoginScreen from '../screens/worker/WorkerLoginScreen';
import WorkerOnboardScreen from '../screens/worker/WorkerOnboardScreen';
import PunchScreen from '../screens/worker/PunchScreen';
import PunchCaptureScreen from '../screens/worker/PunchCaptureScreen';
import PunchResultScreen from '../screens/worker/PunchResultScreen';
import WorkerCalendarScreen from '../screens/worker/WorkerCalendarScreen';

import {useThemeContext} from '../theme/ThemeContext';

export type RootStackParamList = {
  // Entry
  Welcome: undefined;

  // Legacy (kept for backwards compat / debug)
  Home: undefined;
  Enroll:
    | undefined
    | {
        prefilledUserId?: string;
        prefilledName?: string;
        purpose?: 'admin_signup' | 'add_worker' | 'worker_onboard' | 'standalone';
        returnTo?: keyof RootStackParamList;
      };
  Verify: undefined;
  Admin: undefined;

  // Admin
  AdminAuth: undefined;
  AdminSignup: undefined;
  AdminLogin: undefined;
  AdminMain: undefined;
  AddWorker: undefined;
  AdminWorkerCalendar: {workerId: string; workerName: string};

  // Worker
  WorkerOnboard: undefined;
  WorkerLogin: undefined;
  WorkerHome: undefined;
  PunchCapture: {type: 'in' | 'out'};
  PunchResult: {
    success: boolean;
    type: 'in' | 'out';
    timestamp?: number;
    reason?: string;
    gpsAvailable?: boolean;
  };
  WorkerCalendar: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootStack() {
  const {isAAA} = useThemeContext();

  return (
    <Stack.Navigator
      initialRouteName="Welcome"
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        contentStyle: {backgroundColor: isAAA ? '#000' : '#0A2540'},
      }}>
      <Stack.Screen name="Welcome" component={WelcomeScreen} />

      {/* Admin */}
      <Stack.Screen name="AdminAuth" component={AdminAuthScreen} />
      <Stack.Screen name="AdminSignup" component={AdminSignupScreen} />
      <Stack.Screen name="AdminLogin" component={AdminLoginScreen} />
      <Stack.Screen name="AdminMain" component={AdminMain} />
      <Stack.Screen
        name="AddWorker"
        component={AddWorkerScreen}
        options={{presentation: 'modal'}}
      />
      <Stack.Screen
        name="AdminWorkerCalendar"
        component={AdminWorkerCalendarScreen}
        options={{presentation: 'modal'}}
      />

      {/* Worker */}
      <Stack.Screen name="WorkerOnboard" component={WorkerOnboardScreen} />
      <Stack.Screen name="WorkerLogin" component={WorkerLoginScreen} />
      <Stack.Screen name="WorkerHome" component={PunchScreen} />
      <Stack.Screen
        name="PunchCapture"
        component={PunchCaptureScreen}
        options={{presentation: 'fullScreenModal'}}
      />
      <Stack.Screen
        name="PunchResult"
        component={PunchResultScreen}
        options={{presentation: 'fullScreenModal', animation: 'fade'}}
      />
      <Stack.Screen name="WorkerCalendar" component={WorkerCalendarScreen} />

      {/* Legacy / shared (used by Admin signup + Add worker for face capture) */}
      <Stack.Screen name="Home" component={HomeScreen} />
      <Stack.Screen name="Enroll" component={EnrollmentScreen} />
      <Stack.Screen name="Verify" component={VerificationScreen} />
      <Stack.Screen name="Admin" component={AdminScreen} />
    </Stack.Navigator>
  );
}
