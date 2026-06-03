import 'package:go_router/go_router.dart';
import 'screens/welcome_screen.dart';
import 'screens/home_screen.dart';
import 'screens/enrollment_screen.dart';
import 'screens/verification_screen.dart';
import 'screens/admin_screen.dart';
import 'screens/admin/admin_auth_screen.dart';
import 'screens/admin/admin_login_screen.dart';
import 'screens/admin/admin_signup_screen.dart';
import 'screens/admin/admin_dashboard_screen.dart';
import 'screens/admin/workers_list_screen.dart';
import 'screens/admin/add_worker_screen.dart';
import 'screens/admin/admin_calendar_screen.dart';
import 'screens/admin/admin_worker_calendar_screen.dart';
import 'screens/admin/admin_settings_screen.dart';
import 'screens/worker/worker_login_screen.dart';
import 'screens/worker/worker_onboard_screen.dart';
import 'screens/worker/punch_screen.dart';
import 'screens/worker/punch_capture_screen.dart';
import 'screens/worker/punch_result_screen.dart';
import 'screens/worker/worker_calendar_screen.dart';

final GoRouter appRouter = GoRouter(
  initialLocation: '/welcome',
  routes: [
    GoRoute(path: '/welcome', name: 'Welcome', builder: (_, __) => const WelcomeScreen()),
    GoRoute(path: '/home', name: 'Home', builder: (_, __) => const HomeScreen()),
    GoRoute(
      path: '/enroll',
      name: 'Enroll',
      builder: (_, state) => EnrollmentScreen(
        prefilledUserId: state.uri.queryParameters['userId'],
        prefilledName: state.uri.queryParameters['name'],
        purpose: state.uri.queryParameters['purpose'],
        returnTo: state.uri.queryParameters['returnTo'],
      ),
    ),
    GoRoute(path: '/verify', name: 'Verify', builder: (_, __) => const VerificationScreen()),
    GoRoute(path: '/admin', name: 'Admin', builder: (_, __) => const AdminScreen()),
    GoRoute(path: '/admin/auth', name: 'AdminAuth', builder: (_, __) => const AdminAuthScreen()),
    GoRoute(path: '/admin/login', name: 'AdminLogin', builder: (_, __) => const AdminLoginScreen()),
    GoRoute(path: '/admin/signup', name: 'AdminSignup', builder: (_, __) => const AdminSignupScreen()),
    GoRoute(path: '/admin/dashboard', name: 'AdminDashboard', builder: (_, __) => const AdminDashboardScreen()),
    GoRoute(path: '/admin/workers', name: 'AdminWorkers', builder: (_, __) => const WorkersListScreen()),
    GoRoute(path: '/admin/workers/add', name: 'AdminAddWorker', builder: (_, __) => const AddWorkerScreen()),
    GoRoute(path: '/admin/calendar', name: 'AdminCalendar', builder: (_, __) => const AdminCalendarScreen()),
    GoRoute(
      path: '/admin/worker-calendar',
      name: 'AdminWorkerCalendar',
      builder: (_, state) => AdminWorkerCalendarScreen(
        workerId: state.uri.queryParameters['workerId'],
        workerName: state.uri.queryParameters['workerName'],
      ),
    ),
    GoRoute(path: '/admin/settings', name: 'AdminSettings', builder: (_, __) => const AdminSettingsScreen()),
    GoRoute(path: '/worker/onboard', name: 'WorkerOnboard', builder: (_, __) => const WorkerOnboardScreen()),
    GoRoute(path: '/worker/login', name: 'WorkerLogin', builder: (_, __) => const WorkerLoginScreen()),
    GoRoute(path: '/worker/punch', name: 'WorkerPunch', builder: (_, __) => const PunchScreen()),
    GoRoute(
      path: '/worker/punch/capture',
      name: 'WorkerPunchCapture',
      builder: (_, state) => PunchCaptureScreen(punchType: state.uri.queryParameters['type'] ?? 'in'),
    ),
    GoRoute(
      path: '/worker/punch/result',
      name: 'WorkerPunchResult',
      builder: (_, state) => PunchResultScreen(
        punchType: state.uri.queryParameters['type'] ?? 'in',
        success: state.uri.queryParameters['success'] == 'true',
        failReason: state.uri.queryParameters['reason'],
      ),
    ),
    GoRoute(path: '/worker/calendar', name: 'WorkerCalendar', builder: (_, __) => const WorkerCalendarScreen()),
  ],
);
